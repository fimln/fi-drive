// Unit test for toSql(). With --write <file>, also writes the SQL so it can be
// applied to the LOCAL D1 (wrangler d1 execute fi-drive-db --local --file <file>).
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { toSql } from './migrate-azure-to-cf.mjs'

export const sample = {
  users: [{ id: 'owner@example.com', email: 'owner@example.com', usedBytes: 5, createdAt: '2025-01-01T00:00:00.000Z', _etag: 'x' }],
  files: [{
    id: 'legacy-file-1', ownerEmail: 'owner@example.com', name: "it's.txt", size: 5,
    contentType: 'application/octet-stream', blobName: 'legacy-file-1', createdAt: '2025-01-02T00:00:00.000Z',
    publicToken: 'LegacyTokenAAAAAAAAAAA',
  }],
  publicLinks: [{ id: 'LegacyTokenAAAAAAAAAAA', token: 'LegacyTokenAAAAAAAAAAA', fileId: 'legacy-file-1', ownerEmail: 'owner@example.com', remainingDownloads: 3 }],
}

const sql = toSql(sample)
assert.match(sql, /INSERT OR REPLACE INTO users \(email, used_bytes, created_at\) VALUES \('owner@example.com', 5, /)
assert.match(sql, /'it''s.txt'/)
assert.match(sql, /'LegacyTokenAAAAAAAAAAA', 'legacy-file-1', 'owner@example.com', 3, 10\);/)
assert.equal(sql.trim().split('\n').length, 3)
const target = process.argv.indexOf('--write')
if (target > 0) await writeFile(process.argv[target + 1], sql)
console.log('toSql OK')
