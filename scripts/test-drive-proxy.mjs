import assert from 'node:assert/strict'
import proxy from './drive-proxy.mjs'

for (const [path, destination] of [
  ['/drive', '/'],
  ['/drive/?public=abc', '/?public=abc'],
  ['/drive/assets/app.js', '/assets/app.js'],
  ['/api/files', '/api/files'],
  ['/.auth/login/aad?post_login_redirect_uri=/drive/', '/.auth/login/aad?post_login_redirect_uri=%2F'],
  ['/.auth/logout?post_logout_redirect_uri=/drive/', '/.auth/logout?post_logout_redirect_uri=%2F'],
]) {
  const response = await proxy.fetch(new Request(`https://alfi.ai.id${path}`))
  assert.equal(response.status, 308)
  assert.equal(response.headers.get('location'), `https://drive.alfi.ai.id${destination}`)
}
console.log('Drive redirects: paths, auth destinations and public-link queries passed.')
