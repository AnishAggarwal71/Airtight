/**
 * Server-side playtest transcripts, kept in Redis instead of on disk.
 *
 * Why: Vercel functions have no persistent disk, so the file transcripts the
 * CLI writes (src/cli/transcript.ts) would be lost. Each web game appends its
 * entries to one Redis list, `tx:<sessionId>`, that expires 14 days after the
 * last write. Read one back with `LRANGE tx:<sessionId> 0 -1` in the Upstash
 * console (entries are JSON text).
 *
 * Inputs:  a Store, a session id, and one entry per call (the same shapes the
 *          CLI logs: session / turn_started / exchange / turn_failed /
 *          session_end).
 * Outputs: entries appended in order. Nothing is returned.
 *
 * Rules:
 *  - Best-effort. A transcript failure is logged and swallowed; it must never
 *    fail or slow a player's turn beyond the one Redis call.
 *  - Redacted. Every string value passes through redactSecrets() (API key,
 *    SESSION_SECRET, Redis tokens, sk-ant- keys, Bearer tokens, URL
 *    credentials) before it is stored.
 *  - Switchable. TRANSCRIPTS=off (case-insensitive; also "0" or "false")
 *    records nothing; the player-facing notice in the UI should be removed too.
 *  - Bounded. At most MAX_TRANSCRIPT_ENTRIES per game (a full game is about 30).
 *  - Player text is stored, which is why the UI tells players their questions
 *    are recorded for improving the game.
 */

import type { Store } from './store'
import { describeError, logError, redactSecrets } from './log'

/** How long a transcript survives after its last entry. */
export const TRANSCRIPT_TTL_SECONDS = 14 * 24 * 60 * 60

/** Hard cap on entries per game; a normal 8-turn game writes about 30. */
export const MAX_TRANSCRIPT_ENTRIES = 200

/** Longest provider error text kept in a turn_failed entry. */
const MAX_ERROR_CHARS = 500

const transcriptKey = (sessionId: string) => `tx:${sessionId}`

/** False when TRANSCRIPTS is "off", "0" or "false" (any case). Read on every call so it can be flipped without a redeploy of code. */
export function transcriptsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.TRANSCRIPTS ?? '').trim().toLowerCase()
  return !(v === 'off' || v === '0' || v === 'false')
}

/** Copy of `value` with every string redacted, at any depth. Non-string leaves pass through. */
export function redactDeep(value: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof value === 'string') return redactSecrets(value, env)
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, env))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, env)]))
  }
  return value
}

/**
 * Appends one redacted entry to the game's transcript. Never throws. `entry`
 * must be a plain JSON object with a `type` field.
 */
export async function recordTranscript(
  store: Store,
  sessionId: string,
  entry: { type: string } & Record<string, unknown>,
): Promise<void> {
  if (!transcriptsEnabled()) return
  try {
    await store.appendList(
      transcriptKey(sessionId),
      redactDeep(entry),
      TRANSCRIPT_TTL_SECONDS,
      MAX_TRANSCRIPT_ENTRIES,
    )
  } catch (err) {
    logError('transcript_error', { sid: sessionId, entry: entry.type, err: describeError(err) })
  }
}

/** Builds the `error` field of a turn_failed entry from whatever was thrown (scrubbed message, capped). */
export function transcriptError(err: unknown): { name: string; message: string } {
  const cause = err instanceof Error && err.cause !== undefined ? err.cause : err
  const base = cause instanceof Error ? cause : new Error(String(cause))
  return { name: base.name, message: redactSecrets(base.message).slice(0, MAX_ERROR_CHARS) }
}

/** Reads a transcript back (oldest first). Used by tests and tooling, not by any HTTP route. */
export async function readTranscript(store: Store, sessionId: string): Promise<unknown[]> {
  return store.getList(transcriptKey(sessionId))
}
