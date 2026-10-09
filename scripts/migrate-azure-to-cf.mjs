#!/usr/bin/env node
// One-off data migration: Cosmos DB (users, files, publicLinks) -> D1 SQL,
// Blob Storage -> R2. Run manually during cutover, never in CI.
//
//   npm i --no-save @azure/cosmos @azure/storage-blob
//   $env:COSMOS_CONNECTION="..."; $env:STORAGE_CONNECTION="..."
//   node scripts/migrate-azure-to-cf.mjs --out tmp/migration
//       -> writes tmp/migration/data.sql and tmp/migration/blobs/<blobName>,
//          prints the wrangler commands to apply them.
//   node scripts/migrate-azure-to-cf.mjs --out tmp/migration --apply --i-understand-this-touches-production
//       -> also runs those wrangler commands against the remote D1/R2.
//
// Options: --database <name> (Cosmos, default fidrive), --container <name>
// (Blob, default files), --d1 <name> (default fi-drive-db),
// --r2-bucket <name> (default fi-drive-files), --skip-blobs.
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid number ${value}`)
    return String(Math.trunc(value))
  }
  return `'${String(value).replace(/'/g, "''")}'`
}

function insert(table, row) {
  const columns = Object.keys(row)
  return `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => sqlValue(row[c])).join(', ')});`
}

/**
 * Pure conversion of Cosmos documents to D1 statements.
 * @param {{ users?: object[], files?: object[], publicLinks?: object[] }} docs
 */
export function toSql({ users = [], files = [], publicLinks = [] }) {
  const lines = []
  for (const u of users) {
    lines.push(insert('users', {
      email: String(u.email ?? u.id).toLowerCase(),
      used_bytes: u.usedBytes || 0,
      created_at: u.createdAt || new Date(0).toISOString(),
    }))
  }
  for (const f of files) {
    lines.push(insert('files', {
      id: f.id,
      owner_email: f.ownerEmail,
      name: f.name,
      size: f.size,
      content_type: f.contentType || 'application/octet-stream',
      blob_name: f.blobName || f.id,
      created_at: f.createdAt || new Date(0).toISOString(),
      public_token: f.publicToken || null,
    }))
  }
  for (const l of publicLinks) {
    lines.push(insert('public_links', {
      token: l.token ?? l.id,
      file_id: l.fileId,
      owner_email: l.ownerEmail,
      remaining_downloads: l.remainingDownloads,
      // Legacy docs without maxDownloads had 10; the Worker upgrades them to 100 on first use.
      max_downloads: l.maxDownloads || 10,
    }))
  }
  return lines.join('\n') + '\n'
}

function parseArgs(argv) {
  const args = { database: 'fidrive', container: 'files', d1: 'fi-drive-db', r2Bucket: 'fi-drive-files' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') args.out = argv[++i]
    else if (arg === '--database') args.database = argv[++i]
    else if (arg === '--container') args.container = argv[++i]
    else if (arg === '--d1') args.d1 = argv[++i]
    else if (arg === '--r2-bucket') args.r2Bucket = argv[++i]
    else if (arg === '--apply') args.apply = true
    else if (arg === '--skip-blobs') args.skipBlobs = true
    else if (arg === '--i-understand-this-touches-production') args.confirmed = true
    else throw new Error(`Unknown argument ${arg}`)
  }
  if (!args.out) throw new Error('--out <dir> is required')
  if (args.apply && !args.confirmed) {
    throw new Error('--apply writes to the remote D1/R2. Add --i-understand-this-touches-production to continue.')
  }
  return args
}

function run(command, commandArgs) {
  // Array args, no shell: values are never interpolated into a command line.
  console.log('$', command, commandArgs.join(' '))
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', shell: false })
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { COSMOS_CONNECTION, STORAGE_CONNECTION } = process.env
  if (!COSMOS_CONNECTION) throw new Error('COSMOS_CONNECTION is not set')
  if (!args.skipBlobs && !STORAGE_CONNECTION) throw new Error('STORAGE_CONNECTION is not set')

  const { CosmosClient } = await import('@azure/cosmos')
  const db = new CosmosClient(COSMOS_CONNECTION).database(args.database)
  const readAll = async (name) => (await db.container(name).items.readAll().fetchAll()).resources
  const docs = { users: await readAll('users'), files: await readAll('files'), publicLinks: await readAll('publicLinks') }
  console.log(`Cosmos: ${docs.users.length} users, ${docs.files.length} files, ${docs.publicLinks.length} publicLinks`)

  const out = resolve(args.out)
  await mkdir(join(out, 'blobs'), { recursive: true })
  const sqlFile = join(out, 'data.sql')
  await writeFile(sqlFile, toSql(docs))
  console.log(`Wrote ${sqlFile}`)

  const r2Commands = []
  if (!args.skipBlobs) {
    const { BlobServiceClient } = await import('@azure/storage-blob')
    const container = BlobServiceClient.fromConnectionString(STORAGE_CONNECTION).getContainerClient(args.container)
    for (const file of docs.files) {
      const key = file.blobName || file.id
      if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`Unexpected blob name ${key}`)
      const target = join(out, 'blobs', key)
      await container.getBlockBlobClient(key).downloadToFile(target)
      r2Commands.push(['wrangler', 'r2', 'object', 'put', `${args.r2Bucket}/${key}`,
        '--file', target, '--content-type', 'application/octet-stream', '--remote'])
    }
    console.log(`Downloaded ${r2Commands.length} blobs`)
  }

  const d1Command = ['wrangler', 'd1', 'execute', args.d1, '--remote', '--file', sqlFile]
  // Run the repo-pinned wrangler through node directly (no .cmd shim, no shell).
  const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
  if (!args.apply) {
    console.log('\nDry run. Commands to apply (or rerun with --apply --i-understand-this-touches-production):')
    for (const c of [...r2Commands, d1Command]) console.log(`npx ${c.join(' ')}`)
    return
  }
  for (const c of r2Commands) run(process.execPath, [wranglerBin, ...c.slice(1)])
  run(process.execPath, [wranglerBin, ...d1Command.slice(1)])
  console.log('Migration applied. Verify row counts and users.used_bytes against Cosmos.')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
