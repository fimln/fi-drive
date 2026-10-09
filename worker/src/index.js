// fi-drive Worker: melayani SPA dari web/dist (binding ASSETS) dan API /api/*.
// Penyimpanan: metadata di D1 (binding DB), isi berkas privat di R2 (binding FILES).
import { requireOwner } from './auth.js';
import { DRIVE_QUOTA_BYTES, MAX_FILE_BYTES } from './validation.js';

const MAX_DOWNLOADS = 100;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

function json(status, body) {
  return Response.json(body, { status, headers: NO_STORE });
}

function error(status, code, message) {
  return json(status, { error: code, message });
}

function publicError(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE },
  });
}

function toPublicFile(row) {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    contentType: row.content_type,
    ownerEmail: row.owner_email,
    createdAt: row.created_at,
  };
}

function downloadResponse(file, object) {
  const safeName = String(file.name).replace(/["\\\r\n]/g, '_');
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': file.content_type,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Content-Length': String(object.size),
      ...NO_STORE,
    },
  });
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getFile(env, id, ownerEmail) {
  return env.DB.prepare('SELECT * FROM files WHERE id = ?1 AND owner_email = ?2')
    .bind(id, ownerEmail).first();
}

// Link lama punya 10 atau 50 unduhan. Upgrade atomik ke 100 dengan tetap menghitung
// unduhan yang sudah terpakai.
async function readLink(env, token) {
  await env.DB.prepare(
    `UPDATE public_links
       SET remaining_downloads = remaining_downloads + ?2 - max_downloads, max_downloads = ?2
     WHERE token = ?1 AND max_downloads != ?2`
  ).bind(token, MAX_DOWNLOADS).run();
  return env.DB.prepare('SELECT * FROM public_links WHERE token = ?1').bind(token).first();
}

function linkResponse(link, status = 200) {
  return json(status, {
    path: `/s/${link.token}`,
    remainingDownloads: link.remaining_downloads,
    maxDownloads: MAX_DOWNLOADS,
  });
}

// --- Quota: satu UPDATE atomik menggantikan loop ETag/IfMatch Cosmos. ---

async function userExists(env, email) {
  return Boolean(await env.DB.prepare('SELECT 1 FROM users WHERE email = ?1').bind(email).first());
}

/** @returns {Promise<'ok' | 'exceeded' | 'missing'>} */
async function reserveQuota(env, email, bytes) {
  const row = await env.DB.prepare(
    `UPDATE users SET used_bytes = used_bytes + ?2
     WHERE email = ?1 AND used_bytes + ?2 <= ?3 RETURNING used_bytes`
  ).bind(email, bytes, DRIVE_QUOTA_BYTES).first();
  if (row) return 'ok';
  return (await userExists(env, email)) ? 'exceeded' : 'missing';
}

/** @returns {Promise<boolean>} false bila dokumen user tidak ada */
async function releaseQuota(env, email, bytes) {
  const row = await env.DB.prepare(
    `UPDATE users SET used_bytes = used_bytes - ?2
     WHERE email = ?1 AND used_bytes >= ?2 RETURNING used_bytes`
  ).bind(email, bytes).first();
  if (row) return true;
  if (!(await userExists(env, email))) return false;
  throw new Error(`Quota release would make usedBytes negative for ${email}`);
}

// --- Handlers ---

async function me(env, { principal, driveEmail }) {
  await env.DB.prepare(
    'INSERT INTO users (email, used_bytes, created_at) VALUES (?1, 0, ?2) ON CONFLICT(email) DO NOTHING'
  ).bind(driveEmail, new Date().toISOString()).run();
  const user = await env.DB.prepare('SELECT used_bytes FROM users WHERE email = ?1')
    .bind(driveEmail).first();
  return json(200, {
    email: principal.email,
    usedBytes: user.used_bytes || 0,
    quotaBytes: DRIVE_QUOTA_BYTES,
  });
}

async function listFiles(env, { driveEmail }) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM files WHERE owner_email = ?1 ORDER BY created_at'
  ).bind(driveEmail).all();
  return json(200, { owned: results.map(toPublicFile) });
}

async function uploadFile(request, env, { driveEmail: email }) {
  let uploaded;
  let size;
  let name;
  const contentLength = request.headers.get('Content-Length');
  if (contentLength === null) return error(411, 'length_required', 'Content-Length diperlukan.');
  if (!/^\d+$/.test(contentLength)) return error(400, 'invalid_size', 'Ukuran berkas tidak valid.');
  size = Number(contentLength);
  if (!Number.isSafeInteger(size) || size > MAX_FILE_BYTES) {
    return error(413, 'file_too_large', `Ukuran berkas melebihi batas ${MAX_FILE_BYTES} byte.`);
  }
  if (request.headers.get('Content-Type') === 'application/octet-stream') {
    uploaded = request.body;
    try {
      name = decodeURIComponent(request.headers.get('X-File-Name') || '');
    } catch {
      return error(400, 'invalid_name', 'Nama berkas tidak valid.');
    }
  } else {
    // shortcut: legacy multipart stays at 10 MiB; use raw bodies for larger files.
    if (size > 10 * 1024 * 1024 + 65536) {
      return error(413, 'file_too_large', 'Gunakan application/octet-stream untuk berkas besar.');
    }
    let form;
    try {
      form = await request.formData();
    } catch {
      return error(400, 'invalid_body', 'Body harus berupa berkas atau multipart/form-data.');
    }
    uploaded = form.get('file');
    if (!uploaded || typeof uploaded.arrayBuffer !== 'function') {
      return error(400, 'missing_file', 'Field "file" tidak ada di form-data.');
    }
    size = uploaded.size;
    name = uploaded.name;
    if (size > 10 * 1024 * 1024) {
      return error(413, 'file_too_large', 'Gunakan application/octet-stream untuk berkas besar.');
    }
  }
  if (size === 0) {
    return error(400, 'empty_file', 'Berkas kosong.');
  }
  if (size > MAX_FILE_BYTES) {
    return error(413, 'file_too_large', `Ukuran berkas melebihi batas ${MAX_FILE_BYTES} byte.`);
  }
  const contentType = 'application/octet-stream';
  // Reservasi kuota lebih dulu, lalu tulis objek; bila penulisan gagal,
  // reservasi dibatalkan.
  const reserved = await reserveQuota(env, email, size);
  if (reserved === 'missing') {
    return error(401, 'user_not_registered', 'Panggil GET /api/me lebih dulu.');
  }
  if (reserved === 'exceeded') {
    return error(413, 'quota_exceeded', 'Kuota penyimpanan tidak mencukupi.');
  }
  const id = crypto.randomUUID();
  const blobName = id;
  name = typeof name === 'string' && name ? name : blobName;
  try {
    // Incoming request streams and Blob/File expose their length to R2.
    await env.FILES.put(blobName, uploaded, {
      httpMetadata: { contentType },
    });
  } catch (putError) {
    await releaseQuota(env, email, size);
    throw putError;
  }
  const row = {
    id,
    owner_email: email,
    name,
    size,
    content_type: contentType,
    blob_name: blobName,
    created_at: new Date().toISOString(),
  };
  await env.DB.prepare(
    `INSERT INTO files (id, owner_email, name, size, content_type, blob_name, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(row.id, row.owner_email, row.name, row.size, row.content_type, row.blob_name, row.created_at).run();
  return json(201, toPublicFile(row));
}

async function deleteFile(env, { driveEmail: email }, fileId) {
  const file = await getFile(env, fileId, email);
  if (!file) return error(403, 'forbidden', 'Anda bukan pemilik berkas ini.');
  await env.FILES.delete(file.blob_name);
  const statements = [
    env.DB.prepare('DELETE FROM files WHERE id = ?1 AND owner_email = ?2').bind(fileId, email),
  ];
  if (file.public_token) {
    statements.push(env.DB.prepare('DELETE FROM public_links WHERE token = ?1').bind(file.public_token));
  }
  await env.DB.batch(statements);
  await releaseQuota(env, email, file.size);
  return new Response(null, { status: 204 });
}

async function downloadFile(env, { driveEmail: email }, fileId) {
  const file = await getFile(env, fileId, email);
  // 403, bukan 404: jangan membocorkan keberadaan berkas.
  if (!file) return error(403, 'forbidden', 'Anda tidak punya akses ke berkas ini.');
  const object = await env.FILES.get(file.blob_name);
  if (!object) return error(404, 'blob_missing', 'Isi berkas tidak ditemukan di penyimpanan.');
  return downloadResponse(file, object);
}

async function createPublicLink(env, { driveEmail }, fileId) {
  const file = await getFile(env, fileId, driveEmail);
  if (!file) return error(403, 'forbidden', 'Anda bukan pemilik berkas ini.');
  if (file.public_token) {
    const existing = await readLink(env, file.public_token);
    return existing ? linkResponse(existing) : error(409, 'link_missing', 'Tautan tidak tersedia.');
  }
  const token = randomToken();
  // Klaim berkas dulu (hanya bila belum punya token), lalu buat link. Bila
  // kalah balapan, UPDATE tidak mengubah baris dan INSERT dilewati.
  const [claim] = await env.DB.batch([
    env.DB.prepare(
      'UPDATE files SET public_token = ?1 WHERE id = ?2 AND owner_email = ?3 AND public_token IS NULL'
    ).bind(token, fileId, driveEmail),
    env.DB.prepare(
      `INSERT INTO public_links (token, file_id, owner_email, remaining_downloads, max_downloads)
       SELECT ?1, ?2, ?3, ?4, ?4 WHERE EXISTS (SELECT 1 FROM files WHERE id = ?2 AND public_token = ?1)`
    ).bind(token, fileId, driveEmail, MAX_DOWNLOADS),
  ]);
  if (claim.meta.changes === 0) {
    const updated = await getFile(env, fileId, driveEmail);
    if (updated && updated.public_token) {
      const winner = await readLink(env, updated.public_token);
      if (winner) return linkResponse(winner);
    }
    return error(409, 'conflict', 'Berkas berubah. Coba lagi.');
  }
  return linkResponse({ token, remaining_downloads: MAX_DOWNLOADS }, 201);
}

async function downloadPublic(env, token) {
  if (!TOKEN_PATTERN.test(token)) return publicError(404, 'Tautan tidak ditemukan.');
  const link = await readLink(env, token);
  if (!link) return publicError(404, 'Tautan tidak ditemukan.');
  if (link.remaining_downloads <= 0) return publicError(410, 'Batas 100 unduhan tercapai.');
  const file = await getFile(env, link.file_id, link.owner_email);
  if (!file || file.public_token !== token) return publicError(404, 'Berkas tidak tersedia.');
  const object = await env.FILES.get(file.blob_name);
  if (!object) return publicError(404, 'Berkas tidak tersedia.');
  const decremented = await env.DB.prepare(
    `UPDATE public_links SET remaining_downloads = remaining_downloads - 1
     WHERE token = ?1 AND remaining_downloads > 0 RETURNING remaining_downloads`
  ).bind(token).first();
  if (!decremented) {
    await object.body.cancel();
    return publicError(410, 'Batas 100 unduhan tercapai.');
  }
  return downloadResponse(file, object);
}

// --- Router ---

const ROUTES = [
  { pattern: /^\/api\/me$/, methods: { GET: (req, env, auth) => me(env, auth) } },
  {
    pattern: /^\/api\/files$/,
    methods: {
      GET: (req, env, auth) => listFiles(env, auth),
      POST: (req, env, auth) => uploadFile(req, env, auth),
    },
  },
  {
    pattern: /^\/api\/files\/([^/]+)$/,
    methods: { DELETE: (req, env, auth, id) => deleteFile(env, auth, id) },
  },
  {
    pattern: /^\/api\/files\/([^/]+)\/download$/,
    methods: { GET: (req, env, auth, id) => downloadFile(env, auth, id) },
  },
  {
    pattern: /^\/api\/files\/([^/]+)\/public-link$/,
    methods: { POST: (req, env, auth, id) => createPublicLink(env, auth, id) },
  },
  {
    // Tanpa login: tautan publik.
    pattern: /^\/api\/public\/([^/]+)\/download$/,
    public: true,
    methods: { GET: (req, env, auth, token) => downloadPublic(env, token) },
  },
];

async function handleApi(request, env) {
  const { pathname } = new URL(request.url);
  for (const route of ROUTES) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const handler = route.methods[request.method];
    if (!handler) {
      return new Response(null, {
        status: 405,
        headers: { Allow: Object.keys(route.methods).join(', '), ...NO_STORE },
      });
    }
    const param = match[1] === undefined ? undefined : decodeURIComponent(match[1]);
    if (route.public) return handler(request, env, null, param);
    const auth = await requireOwner(request, env);
    if (auth.status) return error(auth.status, 'forbidden', 'Akses pemilik diperlukan.');
    return handler(request, env, auth, param);
  }
  return json(404, { error: 'not_found' });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env);
      } catch (err) {
        console.error(err);
        return json(500, { error: 'internal_error' });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
