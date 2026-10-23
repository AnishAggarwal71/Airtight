// Thin fetch wrappers, one per /api/game endpoint. Every non-2xx response is
// thrown as an ApiClientError carrying the server's { code, message } so the
// UI can show the real reason instead of a generic failure.

export class ApiClientError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
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
