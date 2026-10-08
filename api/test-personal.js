const assert = require('node:assert/strict');
const handlers = new Map();
const documents = new Map();
const blobs = new Map();
let version = 0;
let conflicts = 0;
let failUpload = false;
const owner = 'owner@example.com';
const secondOwner = 'second@example.com';
delete process.env.OWNER_EMAILS;
process.env.OWNER_EMAIL = owner;

function stub(name, exports) {
  require.cache[require.resolve(name)] = { id: name, filename: name, loaded: true, exports };
}
function getContainer(name) {
  function key(id, partition) { return `${name}:${partition}:${id}`; }
  return {
    item(id, partition) {
      const k = key(id, partition);
      return {
        async read() { return { resource: structuredClone(documents.get(k)) }; },
        async replace(value, options) {
          const current = documents.get(k);
          if (!current) throw { code: 404 };
          if (current._etag !== options.accessCondition.condition) {
            conflicts += 1;
            throw { code: 412 };
          }
          const resource = { ...structuredClone(value), _etag: String(++version) };
          documents.set(k, resource);
          return { resource: structuredClone(resource) };
        },
        async delete() {
          if (!documents.delete(k)) throw { code: 404 };
        },
      };
    },
    items: {
      async create(value) {
        const partition = value.email || value.ownerEmail;
        const k = key(value.id, name === 'publicLinks' ? value.token : partition);
        if (documents.has(k)) throw { code: 409 };
        const resource = { ...structuredClone(value), _etag: String(++version) };
        documents.set(k, resource);
        return { resource: structuredClone(resource) };
      },
      query({ parameters }) {
        return { async fetchAll() {
          return { resources: [...documents.entries()]
            .filter(([k, value]) => k.startsWith(`${name}:`) && value.ownerEmail === parameters[0].value)
            .map(([, value]) => structuredClone(value)) };
        } };
      },
    },
  };
}
stub('@azure/functions', { app: { http(name, config) { handlers.set(name, config.handler); } } });
stub('./src/lib/cosmos', { getContainer, async ensureSchema() {} });
stub('./src/lib/blob', {
  async uploadBlob(name, buffer) {
    if (failUpload) throw new Error('simulated storage failure');
    blobs.set(name, buffer);
  },
  async downloadBlob(name) {
    if (!blobs.has(name)) throw { statusCode: 404 };
    return blobs.get(name);
  },
  async deleteBlob(name) { blobs.delete(name); },
});
require('./src/index');
const { getPrincipal, isEmail, requireOwner, isOwner } = require('./src/lib/auth');
const { reserveQuota, releaseQuota } = require('./src/lib/quota');
const { DRIVE_QUOTA_BYTES } = require('./src/lib/validation');
function request(email = owner, params = {}) {
  const headers = new Headers();
  if (email) headers.set('x-ms-client-principal', Buffer.from(JSON.stringify({ userDetails: email })).toString('base64'));
  return { headers, params };
}
function call(name, email = owner, params = {}) {
  return handlers.get(name)(request(email, params));
}
async function upload(email = owner, bytes = Buffer.from('%PDF-1.7\nTest'), name = 'sample.pdf') {
  const req = request(email);
  req.formData = async () => new Map([['file', { name, async arrayBuffer() { return bytes; } }]]);
  return handlers.get('upload-file')(req);
}

(async () => {
  assert.equal(isEmail('mem*****'), false);
  assert.equal(isEmail(owner), true);
  assert.equal(getPrincipal(request('mem*****')), null);
  assert.equal(getPrincipal(request('Owner@Example.com')).email, owner);
  assert.equal((await requireOwner(request(null))).status, 401);
  assert.equal((await requireOwner(request('old-member@example.com'))).status, 403);
  process.env.OWNER_EMAIL = 'owner@example.com,second@example.com';
  assert.equal(isOwner(owner), false);
  delete process.env.OWNER_EMAIL;
  assert.equal(isOwner(owner), false);
  process.env.OWNER_EMAIL = owner;
  process.env.OWNER_EMAILS = ` ${owner.toUpperCase()}, ${secondOwner} `;
  assert.equal(isOwner(owner), true);
  assert.equal(isOwner(secondOwner), true);
  assert.equal((await requireOwner(request(secondOwner))).driveEmail, owner);
  for (const invalid of ['', `${owner},`, `${owner},not-an-email`, '*@example.com']) {
    process.env.OWNER_EMAILS = invalid;
    assert.equal((await requireOwner(request(owner))).status, 403);
  }
  process.env.OWNER_EMAILS = `${owner},${secondOwner}`;
  assert.equal(handlers.has('members'), false);
  assert.equal(handlers.has('share-file'), false);
  assert.equal(handlers.has('revoke-share'), false);
  await getContainer('users').items.create({ id: 'old-member@example.com', email: 'old-member@example.com' });
  for (const name of ['me', 'list-files', 'upload-file', 'download-file', 'delete-file', 'create-public-link']) {
    assert.equal((await call(name, 'old-member@example.com')).status, 403, name);
    assert.equal((await call(name, null)).status, 401, name);
  }
  const profiles = await Promise.all([call('me'), call('me', secondOwner)]);
  assert.equal(profiles[1].jsonBody.email, secondOwner);
  assert.equal(documents.has(`users:${secondOwner}:${secondOwner}`), false);
  assert.ok(profiles.every((r) => r.status === 200));
  assert.equal(profiles[0].jsonBody.quotaBytes, 104857600);
  const userKey = `users:${owner}:${owner}`;
  documents.get(userKey).quotaBytes = 1;
  assert.equal(await reserveQuota(owner, DRIVE_QUOTA_BYTES - 1), true);
  const reservations = await Promise.all([reserveQuota(owner, 1), reserveQuota(owner, 1)]);
  assert.equal(reservations.filter(Boolean).length, 1);
  assert.equal(documents.get(userKey).usedBytes, DRIVE_QUOTA_BYTES);
  assert.equal((await upload()).status, 413);
  assert.equal((await upload(secondOwner)).status, 413);
  await releaseQuota(owner, DRIVE_QUOTA_BYTES);
  failUpload = true;
  await assert.rejects(upload(), /simulated storage failure/);
  assert.equal(documents.get(userKey).usedBytes, 0);
  failUpload = false;
  assert.equal((await upload(owner, Buffer.alloc(0))).status, 400);
  for (const [name, bytes] of [
    ['notes.md', Buffer.from('# Markdown\nPersonal notes')],
    ['archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])],
    ['document.pdf', Buffer.from('Unrestricted content, regardless of extension')],
    ['unknown', Buffer.from([0x00, 0xff, 0x01])],
  ]) {
    const accepted = await upload(owner, bytes, name);
    assert.equal(accepted.status, 201, name);
    assert.equal(accepted.jsonBody.name, name);
    assert.equal(accepted.jsonBody.contentType, 'application/octet-stream');
    const downloaded = await call('download-file', owner, { fileId: accepted.jsonBody.id });
    assert.deepEqual(downloaded.body, bytes);
    assert.equal(downloaded.headers['Content-Type'], 'application/octet-stream');
    assert.match(downloaded.headers['Content-Disposition'], /^attachment;/);
    assert.equal((await call('delete-file', owner, { fileId: accepted.jsonBody.id })).status, 204);
    assert.equal(documents.get(userKey).usedBytes, 0);
  }
  assert.equal((await upload(owner, Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
  const shared = await upload(secondOwner);
  assert.equal(shared.status, 201);
  assert.equal(shared.jsonBody.ownerEmail, owner);
  assert.deepEqual((await call('list-files')).jsonBody, (await call('list-files', secondOwner)).jsonBody);
  assert.equal((await call('download-file', owner, { fileId: shared.jsonBody.id })).status, 200);
  assert.equal((await call('create-public-link', owner, { fileId: shared.jsonBody.id })).status, 201);
  assert.equal((await call('me', secondOwner)).jsonBody.usedBytes, shared.jsonBody.size);
  assert.equal((await call('delete-file', owner, { fileId: shared.jsonBody.id })).status, 204);
  assert.equal((await call('me', secondOwner)).jsonBody.usedBytes, 0);
  const uploaded = await upload();
  assert.equal(uploaded.status, 201);
  const fileId = uploaded.jsonBody.id;
  assert.equal(documents.get(userKey).usedBytes, uploaded.jsonBody.size);
  assert.equal((await call('list-files')).jsonBody.owned.length, 1);
  assert.equal((await call('download-file', owner, { fileId })).status, 200);
  assert.equal((await call('download-file', secondOwner, { fileId })).status, 200);
  const created = await call('create-public-link', secondOwner, { fileId });
  assert.equal(created.status, 201);
  assert.equal(created.jsonBody.maxDownloads, 50);
  assert.equal(created.jsonBody.remainingDownloads, 50);
  const token = created.jsonBody.path.split('=')[1];
  assert.equal((await call('create-public-link', owner, { fileId })).jsonBody.path, created.jsonBody.path);
  for (let i = 0; i < 45; i++) assert.equal((await call('download-public-link', null, { token })).status, 200);
  const downloads = await Promise.all(Array.from({ length: 6 }, () => call('download-public-link', null, { token })));
  assert.equal(downloads.filter((r) => r.status === 200).length, 5);
  assert.equal(downloads.filter((r) => r.status === 410).length, 1);
  assert.equal((await call('download-public-link', null, { token })).status, 410);
  assert.equal((await call('create-public-link', owner, { fileId })).jsonBody.remainingDownloads, 0);
  assert.ok(conflicts > 0, 'Concurrency must exercise ETag retries');
  // Simulate an old link with three of its original ten downloads already used.
  const legacy = documents.get(`publicLinks:${token}:${token}`);
  delete legacy.maxDownloads;
  legacy.remainingDownloads = 7;
  const upgraded = await Promise.all([call('create-public-link', owner, { fileId }), call('create-public-link', owner, { fileId })]);
  assert.ok(upgraded.every((r) => r.jsonBody.remainingDownloads === 47));
  assert.equal((await call('download-public-link', null, { token })).status, 200);
  assert.equal((await call('create-public-link', owner, { fileId })).jsonBody.remainingDownloads, 46);
  assert.equal((await call('download-public-link', null, { token: 'invalid' })).status, 404);
  process.env.OWNER_EMAILS = secondOwner;
  assert.equal((await call('list-files', owner)).status, 403);
  assert.equal((await call('list-files', secondOwner)).jsonBody.owned.length, 1);
  assert.equal((await call('delete-file', secondOwner, { fileId })).status, 204);
  process.env.OWNER_EMAILS = `${owner},${secondOwner}`;
  assert.equal(documents.get(userKey).usedBytes, 0);
  assert.equal((await call('download-public-link', null, { token })).status, 404);
  assert.equal((await call('list-files')).jsonBody.owned.length, 0);
  console.log('Personal drive: multiple owners, shared files and quota, 100 MiB quota, unrestricted file types, upload/delete, 50 public downloads, ETag races, and legacy links passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
