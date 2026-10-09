// End-to-end check against a running `wrangler dev` (local D1 + R2) with
// DEV_AUTH_USER set in .dev.vars. Usage: node scripts/test-worker-e2e.mjs [baseUrl]
import assert from 'node:assert/strict'

const base = process.argv[2] || 'http://127.0.0.1:8787'
const api = (path, init) => fetch(base + path, { redirect: 'manual', ...init })

function upload(name, bytes) {
  const form = new FormData()
  form.append('file', new Blob([bytes]), name)
  return api('/api/files', { method: 'POST', body: form })
}

const me = await api('/api/me')
assert.equal(me.status, 200)
const profile = await me.json()
assert.equal(typeof profile.usedBytes, 'number')
assert.equal(profile.quotaBytes, 8 * 1024 * 1024 * 1024)
console.log('GET /api/me 200', profile)

const empty = await upload('empty.txt', new Uint8Array(0))
assert.equal(empty.status, 400)
assert.equal((await empty.json()).error, 'empty_file')

const tooLarge = await upload('big.bin', new Uint8Array(10 * 1024 * 1024 + 1))
assert.equal(tooLarge.status, 413)
assert.equal((await tooLarge.json()).error, 'file_too_large')

const content = new TextEncoder().encode('# halo "fi-drive"\n')
const created = await upload('catatan uji.md', content)
assert.equal(created.status, 201)
const file = await created.json()
assert.deepEqual(Object.keys(file).sort(), ['contentType', 'createdAt', 'id', 'name', 'ownerEmail', 'size'])
assert.equal(file.size, content.length)
console.log('POST /api/files 201', file)

const afterUpload = await (await api('/api/me')).json()
assert.equal(afterUpload.usedBytes, profile.usedBytes + content.length)

const list = await api('/api/files')
assert.equal(list.status, 200)
const { owned } = await list.json()
assert.ok(owned.some((item) => item.id === file.id))
console.log('GET /api/files 200, count', owned.length)

const download = await api(`/api/files/${file.id}/download`)
assert.equal(download.status, 200)
assert.equal(download.headers.get('content-disposition'), 'attachment; filename="catatan uji.md"')
assert.equal(download.headers.get('cache-control'), 'no-store')
assert.deepEqual(new Uint8Array(await download.arrayBuffer()), content)
console.log('GET /api/files/:id/download 200, bytes match')

const missing = await api('/api/files/does-not-exist/download')
assert.equal(missing.status, 403)

const link = await api(`/api/files/${file.id}/public-link`, { method: 'POST' })
assert.equal(link.status, 201)
const linkBody = await link.json()
assert.match(linkBody.path, /^\/s\/[A-Za-z0-9_-]{22}$/)
assert.equal(linkBody.remainingDownloads, 100)
assert.equal(linkBody.maxDownloads, 100)
const again = await api(`/api/files/${file.id}/public-link`, { method: 'POST' })
assert.equal(again.status, 200)
assert.equal((await again.json()).path, linkBody.path)
console.log('POST /api/files/:id/public-link 201 then 200 (idempotent)', linkBody)

const token = linkBody.path.slice(3)
const spa = await fetch(`${base}/s/${token}`)
assert.equal(spa.status, 200)
assert.match(spa.headers.get('content-type') || '', /text\/html/)
console.log('GET /s/:token 200 SPA html')

// Anonymous: no cookie/header. DEV_AUTH_USER does not apply to public routes anyway.
const publicUrl = `${base}/api/public/${token}/download`
async function publicStatus() {
  const response = await fetch(publicUrl)
  await response.arrayBuffer()
  return response.status
}
const first = await fetch(publicUrl)
assert.equal(first.status, 200)
assert.deepEqual(new Uint8Array(await first.arrayBuffer()), content)
for (let i = 0; i < 94; i += 1) assert.equal(await publicStatus(), 200)
const burst = await Promise.all(Array.from({ length: 6 }, publicStatus))
assert.equal(burst.filter((s) => s === 200).length, 5)
assert.equal(burst.filter((s) => s === 410).length, 1)
assert.equal(await publicStatus(), 410)
console.log('Anonymous public download: exactly 100 x 200, then 410')

assert.equal((await fetch(`${base}/api/public/short/download`)).status, 404)
assert.equal((await api('/api/nope')).status, 404)
assert.equal((await api('/api/me', { method: 'POST' })).status, 405)

const del = await api(`/api/files/${file.id}`, { method: 'DELETE' })
assert.equal(del.status, 204)
const afterDelete = await (await api('/api/me')).json()
assert.equal(afterDelete.usedBytes, profile.usedBytes)
assert.equal((await api(`/api/files/${file.id}/download`)).status, 403)
assert.equal(await publicStatus(), 404)
console.log('DELETE /api/files/:id 204, quota released, link gone')

console.log('E2E OK')
