/**
 * In-memory session store — Map<sessionId, StoredSession>.
 *
 * No database (matches the project-wide "no database" decision — see
 * CLAUDE.md). Sessions are ephemeral: lost on server restart, swept after
 * SESSION_TTL_MS of inactivity. Acceptable for a portfolio project with no
 * persistence requirement.
 */

import crypto from 'node:crypto'
import type { GameSession } from '../engine/types'

export type StoredSession = {
  session: GameSession
  createdAt: number
  lastActiveAt: number
}

const SESSION_TTL_MS = 60 * 60 * 1000 // 1 hour of inactivity
const SWEEP_INTERVAL_MS = 10 * 60 * 1000 // sweep every 10 minutes

const store = new Map<string, StoredSession>()

export function createSessionId(): string {
  return crypto.randomUUID()
}

export function putSession(sessionId: string, session: GameSession): void {
  const now = Date.now()
  store.set(sessionId, { session, createdAt: now, lastActiveAt: now })
}

/** Returns the live GameSession for an id, or undefined if it never existed, expired, or the server restarted. */
export function getSession(sessionId: string): GameSession | undefined {
  const entry = store.get(sessionId)
  if (!entry) return undefined
  entry.lastActiveAt = Date.now()
  return entry.session
}

export function deleteSession(sessionId: string): void {
  store.delete(sessionId)
}

function sweepExpired(): void {
  const now = Date.now()
  for (const [id, entry] of store) {
    if (now - entry.lastActiveAt > SESSION_TTL_MS) store.delete(id)
  }
}

// Background sweep — unref() so it never keeps the process alive on its own.
const sweepTimer = setInterval(sweepExpired, SWEEP_INTERVAL_MS)
sweepTimer.unref()
