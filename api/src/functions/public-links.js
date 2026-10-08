const { randomBytes } = require('node:crypto');
const { app } = require('@azure/functions');
const { ensureSchema, getContainer } = require('../lib/cosmos');
const { requireOwner } = require('../lib/auth');
const { json, error } = require('../lib/http');
const { downloadBlob } = require('../lib/blob');

const MAX_DOWNLOADS = 50;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function publicError(status, message) {
  return {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    body: message,
  };
}

// Legacy links had 10 downloads. Preserve downloads already used when upgrading.
async function readLink(item) {
  while (true) {
    const { resource: link } = await item.read();
    if (!link || link.maxDownloads === MAX_DOWNLOADS) return link;
    try {
      const { resource: updated } = await item.replace({
        ...link,
        remainingDownloads: link.remainingDownloads + MAX_DOWNLOADS - (link.maxDownloads || 10),
        maxDownloads: MAX_DOWNLOADS,
      }, { accessCondition: { type: 'IfMatch', condition: link._etag } });
      return updated;
    } catch (updateError) {
      if (updateError.code !== 412 && updateError.statusCode !== 412) throw updateError;
    }
  }
}

function linkResponse(link, status = 200) {
  return json(status, {
    path: `/?public=${link.token}`,
    remainingDownloads: link.remainingDownloads,
    maxDownloads: MAX_DOWNLOADS,
  });
}

app.http('create-public-link', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'files/{fileId}/public-link',
  handler: async (request) => {
    const { driveEmail, status } = await requireOwner(request);
    if (status) return error(status, 'forbidden', 'Akses pemilik diperlukan.');
    await ensureSchema();

    const fileId = request.params.fileId;
    const files = getContainer('files');
    const links = getContainer('publicLinks');
    const { resource: file } = await files.item(fileId, driveEmail).read();
    if (!file) {
      return error(403, 'forbidden', 'Anda bukan pemilik berkas ini.');
    }

    if (file.publicToken) {
      const existing = await readLink(links.item(file.publicToken, file.publicToken));
      return existing
        ? linkResponse(existing)
        : error(409, 'link_missing', 'Tautan tidak tersedia.');
    }

    const token = randomBytes(16).toString('base64url');
    const link = {
      id: token,
      token,
      fileId,
      ownerEmail: driveEmail,
      remainingDownloads: MAX_DOWNLOADS,
      maxDownloads: MAX_DOWNLOADS,
    };
    await links.items.create(link);

    try {
      await files.item(fileId, driveEmail).replace(
        { ...file, publicToken: token },
        { accessCondition: { type: 'IfMatch', condition: file._etag } }
      );
    } catch (replaceError) {
      await links.item(token, token).delete();
      if (replaceError.code === 412 || replaceError.statusCode === 412) {
        const { resource: updated } = await files.item(fileId, driveEmail).read();
        if (updated && updated.publicToken) {
          const winner = await readLink(links.item(updated.publicToken, updated.publicToken));
          if (winner) return linkResponse(winner);
        }
        return error(409, 'conflict', 'Berkas berubah. Coba lagi.');
      }
      throw replaceError;
    }

    return linkResponse(link, 201);
  },
});

app.http('download-public-link', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/{token}/download',
  handler: async (request) => {
    await ensureSchema();

    const token = request.params.token;
    if (!TOKEN_PATTERN.test(token)) {
      return publicError(404, 'Tautan tidak ditemukan.');
    }

    const links = getContainer('publicLinks');
    const item = links.item(token, token);
    let link = await readLink(item);
    if (!link) return publicError(404, 'Tautan tidak ditemukan.');
    if (link.remainingDownloads <= 0) return publicError(410, 'Batas 50 unduhan tercapai.');

    const { resource: file } = await getContainer('files')
      .item(link.fileId, link.ownerEmail)
      .read();
    if (!file || file.publicToken !== token) {
      return publicError(404, 'Berkas tidak tersedia.');
    }

    let buffer;
    try {
      buffer = await downloadBlob(file.blobName);
    } catch (blobError) {
      if (blobError.statusCode === 404) return publicError(404, 'Berkas tidak tersedia.');
      throw blobError;
    }

    while (link && link.remainingDownloads > 0) {
      try {
        await item.replace(
          { ...link, remainingDownloads: link.remainingDownloads - 1 },
          { accessCondition: { type: 'IfMatch', condition: link._etag } }
        );
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
      } catch (updateError) {
        if (updateError.code !== 412 && updateError.statusCode !== 412) throw updateError;
        link = await readLink(item);
      }
    }

    return publicError(410, 'Batas 50 unduhan tercapai.');
  },
});
