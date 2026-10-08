export default {
  async fetch(request) {
    const url = new URL(request.url)
    url.hostname = 'drive.alfi.ai.id'
    if (url.pathname === '/drive') url.pathname = '/'
    else if (url.pathname.startsWith('/drive/')) url.pathname = url.pathname.slice(6)
    for (const key of ['post_login_redirect_uri', 'post_logout_redirect_uri']) {
      if (url.searchParams.get(key) === '/drive/') url.searchParams.set(key, '/')
    }
    return Response.redirect(url.href, 308)
  },
}
