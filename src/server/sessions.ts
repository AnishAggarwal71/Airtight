/**
 * Session persistence over the shared Store (Redis in production).
 *
 * Replaces the old in-memory Map + setInterval sweeper: serverless instances
 * share nothing, so every request loads the session, mutates its own copy,
 * and writes it back on success. Redis EX handles expiry (no sweeper).
 *
 * Stored value is an envelope { v, session, transcriptPath, createdAt }. The
 * whole GameSession is stored, including the CaseFile snapshot — not just
 * the seed — so a deploy that changes template code mid-game cannot change
 * the case a player is already in.
 *
 * transcriptPath is a local-filesystem path used only by the CLI-style file
 * transcripts; it is replaced when transcripts move to Redis (step 9).
 */

import crypto from 'node:crypto'
import type { GameSession } from '../engine/types'
import { storeUnavailable } from './errors'
import type { Store } from './store'

export type StoredSession = {
  session: GameSession
  transcriptPath: string
  createdAt: number
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

/**
 * Wraps a store call so a backend failure becomes a generic 503 for the
 * player. The cause is logged server-side only; it may contain URLs or
 * tokens and must never reach a response.
 */
async function guarded<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    console.error(JSON.stringify({ evt: 'store_error', op, msg: err instanceof Error ? err.message : String(err) }))
    throw storeUnavailable()
  }
}

/** Creates a session record. Throws a 503 ApiError if the store is unreachable. */
export async function putSession(
  store: Store,
  sessionId: string,
  session: GameSession,
  transcriptPath: string,
): Promise<void> {
  const stored: StoredSession = { session, transcriptPath, createdAt: Date.now() }
  await saveSession(store, sessionId, stored)
}

/** Writes a (possibly mutated) session back and refreshes its TTL. */
export async function saveSession(store: Store, sessionId: string, stored: StoredSession): Promise<void> {
  const envelope = { v: ENVELOPE_VERSION, ...stored }
  await guarded('save', () => store.setJson(sessionKey(sessionId), envelope, SESSION_TTL_SECONDS))
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
    transcriptPath: envelope.transcriptPath ?? '',
    createdAt: envelope.createdAt ?? 0,
  }
}
