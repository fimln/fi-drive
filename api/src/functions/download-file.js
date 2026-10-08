const { app } = require('@azure/functions');
const { ensureSchema, getContainer } = require('../lib/cosmos');
const { requireOwner } = require('../lib/auth');
const { error } = require('../lib/http');
const { downloadBlob } = require('../lib/blob');

app.http('download-file', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'files/{fileId}/download',
  handler: async (request) => {
    const { driveEmail: email, status } = await requireOwner(request);
    if (status) return error(status, 'forbidden', 'Akses pemilik diperlukan.');
    await ensureSchema();

    const fileId = request.params.fileId;

    const { resource: file } = await getContainer('files').item(fileId, email).read();

    // 403, bukan 404: jangan membocorkan keberadaan file kepada yang tidak
    // punya akses.
    if (!file) {
      return error(403, 'forbidden', 'Anda tidak punya akses ke berkas ini.');
    }

    let buffer;
    try {
      buffer = await downloadBlob(file.blobName);
    } catch (blobError) {
      if (blobError.statusCode === 404) {
        return error(404, 'blob_missing', 'Isi berkas tidak ditemukan di penyimpanan.');
      }
      throw blobError;
    }

    const safeName = String(file.name).replace(/["\\\r\n]/g, '_');

    return {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
      body: buffer,
    };
  },
});
