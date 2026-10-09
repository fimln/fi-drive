import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const server = await createServer({ root: fileURLToPath(new URL('.', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' })
try {
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const token = 'X-RyWMAOmlPvtqxjuuP1Nw'
  for (const [pathname, search, valid] of [
    [`/s/${token}`, '', true], ['/', `?public=${token}`, true],
    ['/s/invalid', '', false], ['/s/', '', false],
    [`/s/${token}/extra`, '', false], ['/', '?public=', false],
  ]) {
    globalThis.window = { location: { pathname, search } }
    const html = renderToStaticMarkup(createElement(App))
    assert.ok(html.includes(valid ? `href="/api/public/${token}/download"` : 'Invalid public link.'), pathname + search)
  }
  // /s/* must fall through to index.html via the Workers Static Assets SPA fallback.
  const jsonc = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  const config = JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, ''))
  assert.equal(config.assets.not_found_handling, 'single-page-application')
  assert.deepEqual(config.assets.run_worker_first, ['/api/*'])
  console.log('Public links: new and legacy pages, invalid tokens and SPA fallback for /s/* passed.')
} finally {
  await server.close()
  delete globalThis.window
}
