/**
 * Helper respons agar bentuk error konsisten di seluruh endpoint.
 */

function json(status, body) {
  return { status, headers: { 'Cache-Control': 'no-store' }, jsonBody: body };
}

function error(status, code, message) {
  return { status, headers: { 'Cache-Control': 'no-store' }, jsonBody: { error: code, message } };
}

module.exports = { json, error };
