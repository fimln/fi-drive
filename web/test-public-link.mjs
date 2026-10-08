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
  const config = JSON.parse(await readFile(new URL('public/staticwebapp.config.json', import.meta.url), 'utf8'))
  assert.ok(config.routes.some((route) => route.route === '/s/*' && route.rewrite === '/index.html' && route.allowedRoles.includes('anonymous')))
  console.log('Public links: new and legacy pages, invalid tokens and anonymous Azure rewrite passed.')
} finally {
  await server.close()
  delete globalThis.window
}
