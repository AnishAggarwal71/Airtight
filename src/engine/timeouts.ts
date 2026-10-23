/**
 * Time limits for the model calls inside one game turn.
 *
 * Why: a model call that hangs would hold the request (and the per-session
 * lock) until the platform kills the function, leaving the player staring at a
 * spinner and the turn in an unknown state. Every call is therefore given an
 * AbortSignal. Limits are layered:
 *   requestMs            one deadline for the whole turn (both calls together)
 *   personaMs            cap on the persona call, including the SDK's own retries
 *   invigilatorAttemptMs cap on EACH invigilator attempt (it retries up to 3x)
 * The request deadline is what bounds the total: it must stay under the
 * function's own limit (60s on Vercel, set via vercel.json `maxDuration`) and
 * under the session lock TTL (70s, src/server/lock.ts), or a lock could expire
 * while a turn is still running.
 *
 * This file only holds numbers and signal helpers. It changes no game rules,
 * prompts or scoring.
 */

/** The three limits, in milliseconds. */
export type TurnTimeouts = {
  requestMs: number
  personaMs: number
  invigilatorAttemptMs: number
}

/** Production defaults. Persona 25s + invigilator share of the remaining ~25s fits inside the 50s deadline. */
export const TURN_TIMEOUTS: TurnTimeouts = {
  requestMs: 50_000,
  personaMs: 25_000,
  invigilatorAttemptMs: 15_000,
}

/** What the engine reports when the invigilator fails and the turn falls back to zero-delta. */
export type InvigilatorFailureInfo = {
  kind: 'suspect' | 'witness'
  turn: number
  /** Attempts actually made (fewer than the maximum if the request deadline cut the retries short). */
  attempts: number
  err: unknown
}

/** Optional per-turn call options threaded from the HTTP layer into the engine. */
export type TurnCallOptions = {
  /** Called once when the invigilator fails and the turn is committed with no score change. Must not throw. */
  onInvigilatorFailure?: (info: InvigilatorFailureInfo) => void
  /** Request-wide deadline signal; aborting it cancels whatever model call is in flight. */
  abortSignal?: AbortSignal
  /** Overrides for TURN_TIMEOUTS (tests use short values). */
  timeouts?: Partial<TurnTimeouts>
}

/** Merges overrides over the defaults. */
export function resolveTimeouts(overrides?: Partial<TurnTimeouts>): TurnTimeouts {
  return { ...TURN_TIMEOUTS, ...overrides }
}

/** A signal that aborts when `parent` aborts OR after `ms`, whichever is first. */
export function capSignal(parent: AbortSignal | undefined, ms: number): AbortSignal {
  const timer = AbortSignal.timeout(ms)
  return parent ? AbortSignal.any([parent, timer]) : timer
}

/**
 * True if `err` (or anything in its `cause` chain) is an abort/timeout. The
 * engine wraps provider errors in a new Error with the original as `cause`, so
 * the chain has to be walked to tell "we gave up waiting" from "provider said no".
 */
export function isAbortError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    if (e instanceof Error || (typeof e === 'object' && e !== null && 'name' in e)) {
      const name = (e as { name?: string }).name
      if (name === 'AbortError' || name === 'TimeoutError') return true
      e = (e as { cause?: unknown }).cause
    } else {
      return false
    }
  }
  return false
}
