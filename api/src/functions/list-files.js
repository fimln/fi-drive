const { app } = require('@azure/functions');
const { ensureSchema, getContainer } = require('../lib/cosmos');
const { requireOwner } = require('../lib/auth');
const { json, error } = require('../lib/http');

/**
 * `blobName` sengaja tidak ikut di respons: ia detail internal penyimpanan dan
 * tidak dibutuhkan klien.
 */
function toPublicFile(document) {
  return {
    id: document.id,
    name: document.name,
    size: document.size,
    contentType: document.contentType,
    ownerEmail: document.ownerEmail,
    createdAt: document.createdAt,
  };
}

app.http('list-files', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'files',
  handler: async (request) => {
    const { principal, status } = await requireOwner(request);
    if (status) return error(status, 'forbidden', 'Akses pemilik diperlukan.');
    await ensureSchema();

    const { email } = principal;

    const { resources } = await getContainer('files').items
      .query({
        query: 'SELECT * FROM c WHERE c.ownerEmail = @me',
        parameters: [{ name: '@me', value: email }],
      })
      .fetchAll();

    return json(200, { owned: resources.map(toPublicFile) });
  },
});
