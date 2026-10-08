const { randomUUID } = require('node:crypto');
const { app } = require('@azure/functions');
const { ensureSchema, getContainer } = require('../lib/cosmos');
const { requireOwner } = require('../lib/auth');
const { json, error } = require('../lib/http');
const { uploadBlob } = require('../lib/blob');
const { reserveQuota, releaseQuota, UserNotFoundError } = require('../lib/quota');
const { MAX_FILE_BYTES } = require('../lib/validation');

app.http('upload-file', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'files',
  handler: async (request) => {
    const { driveEmail: email, status } = await requireOwner(request);
    if (status) return error(status, 'forbidden', 'Akses pemilik diperlukan.');
    await ensureSchema();

    let form;
    try {
      form = await request.formData();
    } catch {
      return error(400, 'invalid_body', 'Body harus berupa multipart/form-data dengan field "file".');
    }

    const uploaded = form.get('file');
    if (!uploaded || typeof uploaded.arrayBuffer !== 'function') {
      return error(400, 'missing_file', 'Field "file" tidak ada di form-data.');
    }

    const buffer = Buffer.from(await uploaded.arrayBuffer());

    if (buffer.length === 0) {
      return error(400, 'empty_file', 'Berkas kosong.');
    }

    if (buffer.length > MAX_FILE_BYTES) {
      return error(
        413,
        'file_too_large',
        `Ukuran berkas melebihi batas ${MAX_FILE_BYTES} byte.`
      );
    }

    const contentType = 'application/octet-stream';

    // Urutan reserve-sebelum-tulis: reservasi lebih dulu, lalu blob; bila
    // penulisan blob gagal, reservasi dibatalkan.
    let reserved;
    try {
      reserved = await reserveQuota(email, buffer.length);
    } catch (quotaError) {
      if (quotaError instanceof UserNotFoundError) {
        return error(401, 'user_not_registered', 'Panggil GET /api/me lebih dulu.');
      }
      throw quotaError;
    }

    if (!reserved) {
      return error(413, 'quota_exceeded', 'Kuota penyimpanan tidak mencukupi.');
    }

    const id = randomUUID();
    const blobName = id;
    const name = typeof uploaded.name === 'string' && uploaded.name ? uploaded.name : blobName;

    try {
      await uploadBlob(blobName, buffer, contentType);
    } catch (blobError) {
      await releaseQuota(email, buffer.length);
      throw blobError;
    }

    const fileDocument = {
      id,
      ownerEmail: email,
      name,
      size: buffer.length,
      contentType,
      blobName,
      createdAt: new Date().toISOString(),
    };

    await getContainer('files').items.create(fileDocument);

    return json(201, {
      id: fileDocument.id,
      name: fileDocument.name,
      size: fileDocument.size,
      contentType: fileDocument.contentType,
      ownerEmail: fileDocument.ownerEmail,
      createdAt: fileDocument.createdAt,
    });
  },
});
