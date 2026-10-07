import assert from 'node:assert/strict'

const url = process.argv[2]
if (!url) {
  throw new Error('Berikan URL /api/public/{token}/download dari tautan baru pada file uji.')
}

async function downloadStatus() {
  const response = await fetch(url, { cache: 'no-store' })
  await response.arrayBuffer()
  if (response.status === 200) {
    assert.match(response.headers.get('content-disposition') || '', /^attachment;/)
  }
  return response.status
}

for (let index = 0; index < 45; index += 1) {
  assert.equal(await downloadStatus(), 200)
}

const concurrent = await Promise.all(Array.from({ length: 6 }, downloadStatus))
assert.equal(concurrent.filter((status) => status === 200).length, 5)
assert.equal(concurrent.filter((status) => status === 410).length, 1)
assert.equal(await downloadStatus(), 410)
console.log('Public link: tepat 50 download berhasil; permintaan berikutnya 410.')
