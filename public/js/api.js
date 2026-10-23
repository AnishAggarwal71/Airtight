// Thin fetch wrappers, one per /api/game endpoint. Every non-2xx response is
// thrown as an ApiClientError carrying the server's { code, message } so the
// UI can show the real reason instead of a generic failure.

import { getApiKey } from './byok.js'

export class ApiClientError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

// Build the request headers. The player's own Anthropic key (BYOK), if they
// entered one, rides along on every game request; it lives only in this tab's
// sessionStorage (see byok.js) and the server never stores it.
function headersFor(body) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const key = getApiKey()
  if (key) headers['X-Anthropic-Key'] = key
  return headers
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: headersFor(body),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = data.error || {}
    throw new ApiClientError(res.status, err.code || 'UNKNOWN', err.message || 'Something went wrong.')
  }
  return data
}

// The server picks the case; the client never sends or receives a seed.
export function createGame() {
  return request('POST', '/api/game', {})
}

export function getGame(sessionId) {
  return request('GET', `/api/game/${sessionId}`)
}

export function interrogate(sessionId, input) {
  return request('POST', `/api/game/${sessionId}/interrogate`, { input })
}

export function askWitness(sessionId, question) {
  return request('POST', `/api/game/${sessionId}/witness`, { question })
}

export function getBreakdown(sessionId) {
  return request('GET', `/api/game/${sessionId}/breakdown`)
}
