/**
 * Per-session request lock — one game-mutating request at a time per session.
 *
 * Why: the turn handlers do load -> check limits -> paid model calls -> save.
 * With serverless, parallel requests on one session would all pass the
 * "turns remaining" check against the same stale copy, each spend money, and
 * the last write would win (more than 6 suspect turns, lost updates). The lock
 * makes the second request fail fast with a 409 instead of racing.
 *
 * Key `lock:<sessionId>`, value = a random per-request token, TTL 70s (longer
 * than the 60s function limit, so a crashed instance cannot wedge a session
 * for more than about a minute). Release is compare-and-delete so a request
 * whose lock already expired can never delete a newer holder's lock.
 */

import crypto from 'node:crypto'
import { conflict, notFoundSession, storeUnavailable } from './errors'
import { isValidSessionId } from './sessions'
import type { Store } from './store'

/** Lock lifetime. Must stay above vercel.json maxDuration (60s). */
export const SESSION_LOCK_TTL_MS = 70_000

const lockKey = (sessionId: string) => `lock:${sessionId}`

function logStoreError(op: string, err: unknown): void {
  console.error(JSON.stringify({ evt: 'store_error', op, msg: err instanceof Error ? err.message : String(err) }))
}

/**
 * Runs `fn` while holding the session's lock and returns its result.
 *
 * - Malformed ids are rejected (404) before touching the store, so arbitrary
 *   strings can never become lock keys.
 * - If another request holds the lock: 409, `fn` is not run.
 * - If the store is down: 503 (fail closed — no lock means no safe paid call).
 * - The lock is released BEFORE this function returns, so callers must send
 *   the HTTP response after awaiting it. Releasing after the response would
 *   let a client's immediate next request race the release and get a spurious 409.
 */
export async function withSessionLock<T>(store: Store, sessionId: string, fn: () => Promise<T>): Promise<T> {
  if (!isValidSessionId(sessionId)) throw notFoundSession(sessionId)
  const key = lockKey(sessionId)
  const token = crypto.randomUUID()

  let acquired: boolean
  try {
    acquired = await store.acquireLock(key, token, SESSION_LOCK_TTL_MS)
  } catch (err) {
    logStoreError('lock_acquire', err)
    throw storeUnavailable()
  }
  if (!acquired) {
    throw conflict('Another request for this case is still being processed. Wait for it to finish, then try again.')
  }

  try {
    return await fn()
  } finally {
    // A failed release is harmless: the lock expires on its own TTL.
    try {
      await store.releaseLock(key, token)
    } catch (err) {
      logStoreError('lock_release', err)
    }
  }
}
