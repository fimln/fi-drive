// Thin client for the fi-drive API. Same-origin fetches only: SWA
// serves this app and /api/* from the same host, so the session cookie
// set by /.auth/login/aad is sent automatically with `credentials:
// 'include'`. No token handling here — that's the platform's job.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `Request failed with ${status}`)
    this.status = status
    this.code = code
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    // The 401 responseOverride in staticwebapp.config.json turns an
    // unauthenticated /api/* call into a 302 to the login page. Browser
    // fetch() follows redirects by default, which would swallow that
    // 302 and hand us a 200 containing the login page's HTML instead
    // of a clean 401. redirect: 'manual' stops that: the response
    // comes back as an opaque redirect (type 'opaqueredirect', status
    // 0) that we treat as "not signed in" below.
    redirect: 'manual',
    ...options,
  })

  if (response.type === 'opaqueredirect' || response.status === 0) {
    throw new ApiError(401, 'unauthorized', 'Not signed in.')
  }

  if (response.status === 204) {
    return null
  }

  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error,
      body?.message || `Request to ${path} failed with ${response.status}`
    )
  }

  return body
}

// GET /api/me — also the endpoint that lazily creates the user's Cosmos
// document on first call. 401 means not signed in.
export function getMe() {
  return request('/api/me')
}

// GET /api/files — { owned }
export function listFiles() {
  return request('/api/files')
}

// POST /api/files — multipart, field name must be "file".
export function uploadFile(file) {
  const form = new FormData()
  form.append('file', file)
  return request('/api/files', { method: 'POST', body: form })
}

// DELETE /api/files/{fileId} — owner only.
export function deleteFile(fileId) {
  return request(`/api/files/${fileId}`, { method: 'DELETE' })
}

export function createPublicLink(fileId) {
  return request(`/api/files/${fileId}/public-link`, { method: 'POST' })
}

// Download intentionally does not go through `request()`: it navigates
// the browser directly so the disposition header triggers a real
// download, and the session cookie rides along automatically.
export function downloadUrl(fileId) {
  return `/api/files/${fileId}/download`
}

export const LOGIN_URL = `/.auth/login/aad?post_login_redirect_uri=${import.meta.env.BASE_URL}`
export const LOGOUT_URL = `/.auth/logout?post_logout_redirect_uri=${import.meta.env.BASE_URL}`
