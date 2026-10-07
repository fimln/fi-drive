const { getContainer } = require('./cosmos');
const { DRIVE_QUOTA_BYTES } = require('./validation');

const PRECONDITION_FAILED = 412;

/**
 * Dokumen user belum ada. Hanya `GET /api/me` yang boleh membuatnya, jadi
 * handler lain yang menemui kondisi ini harus membalas 401 dengan pesan yang
 * menyuruh pemanggil memanggil `/api/me` lebih dulu.
 */
class UserNotFoundError extends Error {
  constructor(email) {
    super(`User document not found for ${email}. Call GET /api/me first.`);
    this.name = 'UserNotFoundError';
    this.email = email;
  }
}

function isPreconditionFailed(error) {
  return (
    Boolean(error) &&
    (error.code === PRECONDITION_FAILED || error.statusCode === PRECONDITION_FAILED)
  );
}

/**
 * Menerapkan perubahan `usedBytes` dengan concurrency optimistik (ETag + IfMatch).
 *
 * Dua unggahan paralel dari pemilik drive akan membuat salah satunya gagal
 * dengan 412; percobaan itu lalu membaca ulang nilai terbaru dan mencoba lagi.
 * Inilah yang mencegah kuota dilewati saat unggahan bersamaan.
 *
 * @returns {Promise<boolean>} false bila delta positif akan melewati kuota
 */
async function mutateQuota(email, delta, maxAttempts = 3) {
  const container = getContainer('users');

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { resource: user } = await container.item(email, email).read();

    if (!user) {
      throw new UserNotFoundError(email);
    }

    const nextUsed = (user.usedBytes || 0) + delta;

    if (nextUsed < 0) {
      throw new Error(`Quota release would make usedBytes negative for ${email}`);
    }

    if (delta > 0 && nextUsed > DRIVE_QUOTA_BYTES) {
      return false;
    }

    try {
      await container
        .item(email, email)
        .replace({ ...user, usedBytes: nextUsed }, {
          accessCondition: { type: 'IfMatch', condition: user._etag },
        });
      return true;
    } catch (error) {
      if (isPreconditionFailed(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Quota update for ${email} failed after ${maxAttempts} attempts (concurrent writes)`
  );
}

/**
 * @returns {Promise<boolean>} true bila reservasi berhasil
 */
async function reserveQuota(email, bytes, maxAttempts = 3) {
  return mutateQuota(email, bytes, maxAttempts);
}

async function releaseQuota(email, bytes, maxAttempts = 3) {
  return mutateQuota(email, -bytes, maxAttempts);
}

module.exports = { reserveQuota, releaseQuota, UserNotFoundError };
