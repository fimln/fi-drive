// Unit test for Cloudflare Access JWT verification and owner logic.
// Runs in plain Node (WebCrypto is global). Usage: node scripts/test-access-jwt.mjs
import assert from 'node:assert/strict'
import { getPrincipal, isEmail, isOwner, requireOwner, verifyAccessJwt } from '../worker/src/auth.js'

const team = 'team.cloudflareaccess.com'
const aud = 'aud-tag-123'
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']
)
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'RS256' }
let fetchCount = 0
const fetcher = async (url) => {
  fetchCount += 1
  assert.equal(url, `https://${team}/cdn-cgi/access/certs`)
  return Response.json({ keys: [jwk] })
}
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
async function sign(payload, { kid = 'k1', key = privateKey } = {}) {
  const head = b64({ alg: 'RS256', kid })
  const body = b64(payload)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`
}
const now = Math.floor(Date.now() / 1000)
const good = { aud: [aud], iss: `https://${team}`, email: 'Owner@Example.com', exp: now + 600, iat: now }
const opts = { teamDomain: team, aud, fetcher }

assert.ok(await verifyAccessJwt(await sign(good), opts), 'valid token')
const token = await sign(good)
const accessEnv = { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud }
assert.deepEqual(await getPrincipal(new Request('https://drive.alfi.ai.id/api/me', {
  headers: { Cookie: `other=value; CF_Authorization=${token}` },
}), accessEnv), { email: 'owner@example.com' }, 'Access cookie fallback')

assert.equal(await verifyAccessJwt(await sign({ ...good, exp: now - 1 }), opts), null, 'expired')
assert.equal(await verifyAccessJwt(await sign({ ...good, aud: ['other'] }), opts), null, 'wrong aud')
assert.equal(await verifyAccessJwt(await sign({ ...good, iss: 'https://evil.cloudflareaccess.com' }), opts), null, 'wrong iss')
const other = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']
)
assert.equal(await verifyAccessJwt(await sign(good, { key: other.privateKey }), opts), null, 'bad signature')
assert.equal(await verifyAccessJwt(await sign(good, { kid: 'unknown' }), opts), null, 'unknown kid')
assert.equal(await verifyAccessJwt('not.a.jwt', opts), null, 'garbage')
assert.equal(await verifyAccessJwt(await sign(good), { ...opts, aud: '' }), null, 'empty ACCESS_AUD denies')
assert.ok(fetchCount <= 2, `JWKS cached (fetched ${fetchCount}x)`)

assert.ok(isEmail('a@b.co'))
for (const bad of ['', 'a@b', 'a b@c.d', '*@x.io', 'a,b@c.d', null]) assert.equal(isEmail(bad), false)
const env = { OWNER_EMAIL: 'owner@example.com', OWNER_EMAILS: 'owner@example.com, second@example.com' }
assert.ok(isOwner('second@example.com', env))
assert.equal(isOwner('stranger@example.com', env), false)
assert.equal(isOwner('owner@example.com', {}), false, 'no OWNER_EMAIL denies all')
assert.ok(isOwner('owner@example.com', { OWNER_EMAIL: 'owner@example.com' }), 'OWNER_EMAILS falls back to OWNER_EMAIL')

// Dev bypass: only on localhost.
const devEnv = { ...env, DEV_AUTH_USER: 'second@example.com' }
assert.deepEqual(await getPrincipal(new Request('http://127.0.0.1:8787/api/me'), devEnv), { email: 'second@example.com' })
assert.equal(await getPrincipal(new Request('https://drive.alfi.ai.id/api/me'), devEnv), null, 'bypass ignored in prod host')
assert.equal((await requireOwner(new Request('https://drive.alfi.ai.id/api/me'), devEnv)).status, 401)
const r = await requireOwner(new Request('http://localhost:8787/api/me'), devEnv)
assert.equal(r.driveEmail, 'owner@example.com', 'drive partition stays OWNER_EMAIL')
assert.equal((await requireOwner(new Request('http://localhost/api/me'), { ...env, DEV_AUTH_USER: 'x@evil.io' })).status, 403)

console.log('Access JWT + owner tests OK')
