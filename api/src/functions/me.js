const { app } = require('@azure/functions');
const { ensureSchema, getContainer } = require('../lib/cosmos');
const { requireOwner } = require('../lib/auth');
const { json, error } = require('../lib/http');
const { DRIVE_QUOTA_BYTES } = require('../lib/validation');

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: async (request) => {
    const { principal, driveEmail: email, status } = await requireOwner(request);
    if (status) return error(status, 'forbidden', 'Akses pemilik diperlukan.');
    await ensureSchema();

    const container = getContainer('users');
    let { resource: user } = await container.item(email, email).read();
    if (!user) {
      try {
        ({ resource: user } = await container.items.create({
          id: email,
          email,
          usedBytes: 0,
          createdAt: new Date().toISOString(),
        }));
      } catch (createError) {
        if (createError.code !== 409 && createError.statusCode !== 409) throw createError;
        ({ resource: user } = await container.item(email, email).read());
      }
    }
    return json(200, {
      email: principal.email,
      usedBytes: user.usedBytes || 0,
      quotaBytes: DRIVE_QUOTA_BYTES,
    });
  },
});
