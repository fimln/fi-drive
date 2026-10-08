const { app } = require('@azure/functions');
const { ensureSchema, getContainer } = require('../lib/cosmos');
const { requireOwner } = require('../lib/auth');
const { error } = require('../lib/http');
const { deleteBlob } = require('../lib/blob');
const { releaseQuota, UserNotFoundError } = require('../lib/quota');

app.http('delete-file', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'files/{fileId}',
  handler: async (request) => {
    const { driveEmail: email, status } = await requireOwner(request);
    if (status) return error(status, 'forbidden', 'Akses pemilik diperlukan.');
    await ensureSchema();

    const fileId = request.params.fileId;

    // Hanya pemilik. Partisi files adalah /ownerEmail, jadi ini point read.
    const { resource: file } = await getContainer('files').item(fileId, email).read();

    if (!file) {
      return error(403, 'forbidden', 'Anda bukan pemilik berkas ini.');
    }

    await deleteBlob(file.blobName);
    await getContainer('files').item(fileId, email).delete();

    if (file.publicToken) {
      try {
        await getContainer('publicLinks').item(file.publicToken, file.publicToken).delete();
      } catch (linkError) {
        if (linkError.code !== 404) {
          throw linkError;
        }
      }
    }

    try {
      await releaseQuota(email, file.size);
    } catch (quotaError) {
      if (!(quotaError instanceof UserNotFoundError)) {
        throw quotaError;
      }
    }

    return { status: 204 };
  },
});
