/**
 * Session persistence over the shared Store (Redis in production).
 *
 * Replaces the old in-memory Map + setInterval sweeper: serverless instances
 * share nothing, so every request loads the session, mutates its own copy,
 * and writes it back on success. Redis EX handles expiry (no sweeper).
 *
 * Stored value is an envelope { v, session, createdAt, rev }. The
 * whole GameSession is stored, including the CaseFile snapshot — not just
 * the seed — so a deploy that changes template code mid-game cannot change
 * the case a player is already in.
 *
 * rev is a revision counter for optimistic concurrency: every save is a
 * compare-and-set on it, so a write based on a stale read fails instead of
 * silently overwriting a newer turn. The per-session lock (lock.ts) normally
 * prevents the conflict; this is the backstop if a lock expires mid-request.
 *
 * Transcripts are NOT part of this envelope: they live in their own Redis list
 * (`tx:<sessionId>`, see transcripts.ts) with a 14-day TTL, far longer than the
 * session's 1 hour.
 */

import crypto from 'node:crypto'
import type { GameSession } from '../engine/types'
import { conflict, storeUnavailable } from './errors'
import { describeError, logError } from './log'
import type { Store } from './store'

export type StoredSession = {
  session: GameSession
  createdAt: number
  /** Revision this copy was loaded at (0 = not yet stored). saveSession() bumps it. */
  rev: number
}

/** Envelope version; bump if StoredSession's shape changes so old blobs read as expired. */
const ENVELOPE_VERSION = 1

/** Sessions expire this long after their last write (each completed turn refreshes it). */
export const SESSION_TTL_SECONDS = 60 * 60

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const sessionKey = (sessionId: string) => `sess:${sessionId}`

export function createSessionId(): string {
  return crypto.randomUUID()
}

/** True for a well-formed session id. Anything else must never be used to build a store key. */
export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId)
}

/**
 * Wraps a store call so a backend failure becomes a generic 503 for the
 * player. The cause is logged server-side only; it may contain URLs or
 * tokens and must never reach a response.
 */
async function guarded<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    logError('store_error', { op, msg: describeError(err) })
    throw storeUnavailable()
  }
}

/** Creates a session record. Throws a 503 ApiError if the store is unreachable. */
export async function putSession(
  store: Store,
  sessionId: string,
  session: GameSession,
): Promise<void> {
  const stored: StoredSession = { session, createdAt: Date.now(), rev: 0 }
  await saveSession(store, sessionId, stored)
}

/**
 * Writes a (possibly mutated) session back and refreshes its TTL, as a
 * compare-and-set on `stored.rev`. Throws a 409 if the stored copy has moved
 * on since this one was loaded (nothing is written in that case). On success
 * `stored.rev` is advanced so the same object can be saved again.
 */
export async function saveSession(store: Store, sessionId: string, stored: StoredSession): Promise<void> {
  const nextRev = stored.rev + 1
  const envelope = { v: ENVELOPE_VERSION, ...stored, rev: nextRev }
  const written = await guarded('save', () =>
    store.setJsonIfRev(sessionKey(sessionId), stored.rev, envelope, SESSION_TTL_SECONDS),
  )
  if (!written) {
    throw conflict('This case changed while your request was running. Please try again.')
  }
  stored.rev = nextRev
}

/**
 * Loads a session, or undefined if the id is malformed, never existed,
 * expired, or has an unreadable/old envelope. Malformed ids never reach the
 * store. The returned object is a private copy — changes persist only via
 * saveSession().
 */
export async function getSession(store: Store, sessionId: string): Promise<StoredSession | undefined> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return undefined
  const raw = await guarded('load', () => store.getJson(sessionKey(sessionId)))
  if (!raw || typeof raw !== 'object') return undefined
  const envelope = raw as { v?: unknown } & Partial<StoredSession>
  if (envelope.v !== ENVELOPE_VERSION || !envelope.session) return undefined
  return {
    session: envelope.session,
    createdAt: envelope.createdAt ?? 0,
    rev: Number(envelope.rev ?? 0) || 0,
  }
}
