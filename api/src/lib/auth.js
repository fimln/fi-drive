function isEmail(value) {
  return typeof value === 'string' && /^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/.test(value);
}

/**
 * Satu-satunya sumber identitas di seluruh API.
 *
 * Header `x-ms-client-principal` di-inject oleh SWA edge setelah cookie sesi
 * diverifikasi. Edge membuang header dengan nama itu dari request yang datang
 * dari klien, sehingga nilainya tidak bisa dipalsukan dari luar.
 *
 * Modul ini TIDAK BOLEH membaca identitas dari query string, body, atau header
 * buatan klien mana pun.
 */

/**
 * @param {import('@azure/functions').HttpRequest} request
 * @returns {{ email: string } | null}
 */
function getPrincipal(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) {
    return null;
  }

  let principal;
  try {
    principal = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return null;
  }

  if (!principal || typeof principal.userDetails !== 'string') {
    return null;
  }

  const email = principal.userDetails.trim().toLowerCase();
  if (!isEmail(email)) {
    return null;
  }

  return { email };
}

function isOwner(email) {
  const owners = (process.env.OWNER_EMAILS ?? process.env.OWNER_EMAIL ?? '')
    .split(',').map((value) => value.trim().toLowerCase());
  return isEmail((process.env.OWNER_EMAIL || '').trim().toLowerCase())
    && owners.every(isEmail) && owners.includes(email);
}

async function requireOwner(request) {
  const principal = getPrincipal(request);
  if (!principal) return { status: 401 };
  if (!isOwner(principal.email)) return { status: 403 };
  // Keep the existing storage partition independent of the account signing in.
  const driveEmail = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  return { principal, driveEmail };
}

module.exports = { getPrincipal, isOwner, isEmail, requireOwner };
