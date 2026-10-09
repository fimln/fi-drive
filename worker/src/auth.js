// Satu-satunya sumber identitas di seluruh API.
//
// Produksi: Cloudflare Access memverifikasi login (OTP email) lalu
// meneruskan JWT di header `Cf-Access-Jwt-Assertion` (cadangan: cookie
// `CF_Authorization`). Worker tetap memverifikasi tanda tangan, `aud`, `iss`,
// dan masa berlaku JWT, sehingga request yang melewati Access (mis. langsung ke
// workers.dev) tidak bisa memalsukan identitas.
//
// Modul ini TIDAK BOLEH membaca identitas dari query string, body, atau header
// buatan klien lainnya.

const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = { url: '', keys: new Map(), fetchedAt: 0 };

export function isEmail(value) {
  return typeof value === 'string' && /^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/.test(value);
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

async function loadJwks(url, fetcher, force) {
  const fresh = jwksCache.url === url && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh && !force) return jwksCache.keys;
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`JWKS fetch failed with ${response.status}`);
  const { keys = [] } = await response.json();
  const map = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    map.set(jwk.kid, key);
  }
  jwksCache = { url, keys: map, fetchedAt: Date.now() };
  return map;
}

/**
 * Verifikasi JWT Cloudflare Access. Mengembalikan payload atau null.
 * @param {string} token
 * @param {{ teamDomain: string, aud: string, fetcher?: typeof fetch, now?: number }} options
 */
export async function verifyAccessJwt(token, { teamDomain, aud, fetcher = fetch, now = Date.now() }) {
  if (!token || !teamDomain || !aud) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  const issuer = `https://${teamDomain}`;
  const certsUrl = `${issuer}/cdn-cgi/access/certs`;
  let keys = await loadJwks(certsUrl, fetcher, false);
  if (!keys.has(header.kid)) keys = await loadJwks(certsUrl, fetcher, true);
  const key = keys.get(header.kid);
  if (!key) return null;

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) return null;

  const seconds = Math.floor(now / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) return null;
  if (payload.iss !== issuer) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= seconds) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > seconds + 60) return null;
  return payload;
}

function readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const pair of cookie.split(';')) {
    const index = pair.indexOf('=');
    if (index > 0 && pair.slice(0, index).trim() === name) return pair.slice(index + 1).trim();
  }
  return '';
}

function isLocalHost(request) {
  const { hostname } = new URL(request.url);
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * @returns {Promise<{ email: string } | null>}
 */
export async function getPrincipal(request, env) {
  // Bypass lokal: hanya bila DEV_AUTH_USER diatur (lewat .dev.vars) DAN host
  // adalah localhost, yaitu `wrangler dev`. Tidak berlaku di domain produksi.
  if (env.DEV_AUTH_USER && isLocalHost(request)) {
    const email = String(env.DEV_AUTH_USER).trim().toLowerCase();
    return isEmail(email) ? { email } : null;
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || readCookie(request, 'CF_Authorization');
  const payload = await verifyAccessJwt(token, {
    teamDomain: (env.ACCESS_TEAM_DOMAIN || '').trim(),
    aud: (env.ACCESS_AUD || '').trim(),
  });
  if (!payload || typeof payload.email !== 'string') return null;
  const email = payload.email.trim().toLowerCase();
  return isEmail(email) ? { email } : null;
}

export function isOwner(email, env) {
  const owners = (env.OWNER_EMAILS ?? env.OWNER_EMAIL ?? '')
    .split(',').map((value) => value.trim().toLowerCase());
  return isEmail((env.OWNER_EMAIL || '').trim().toLowerCase())
    && owners.every(isEmail) && owners.includes(email);
}

export async function requireOwner(request, env) {
  const principal = await getPrincipal(request, env);
  if (!principal) return { status: 401 };
  if (!isOwner(principal.email, env)) return { status: 403 };
  // Partisi penyimpanan tetap tidak bergantung pada akun yang login.
  const driveEmail = (env.OWNER_EMAIL || '').trim().toLowerCase();
  return { principal, driveEmail };
}
