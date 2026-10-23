/**
 * Spend cap — bounds model cost per session and across the whole server per
 * UTC day, so the game can be shared without an unbounded cost tail.
 *
 * Why reserve-then-settle: with many serverless instances, "check the total,
 * run the model, add the cost" lets N parallel requests all pass the same
 * check and all spend. Instead each turn first RESERVES its worst-case cost
 * against both counters in one atomic store operation (Lua on Redis); a turn
 * that doesn't fit is refused before any paid call. After the turn the
 * reservation is SETTLED down to the real cost by adding (actual - reserved).
 *
 * Counters are integer micro-dollars (Redis INCRBY is integer-only; floats
 * would drift):
 *   spend:sess:<sessionId>   this game's spend, TTL 2h
 *   spend:day:<YYYY-MM-DD>   server-wide spend for that UTC day, TTL 48h
 *
 * Fail-closed: if the store is unreachable the turn is refused with a 503.
 * Never run paid calls we cannot count. The one exception is settle(): by then
 * the model has already been paid for, so a settle failure is logged and
 * swallowed — the unreduced reservation over-counts, which errs on the safe side.
 */

import type { TokenUsage } from '../engine/types'
import { budgetExceeded, storeUnavailable } from './errors'
import type { Store } from './store'

// Anthropic Haiku 4.5 pricing per CLAUDE.md: $1.00/1M input tokens,
// $5.00/1M output tokens. Cache writes are billed at the input rate (cache
// reads are cheaper in reality, but pricing them at the input rate keeps
// this a conservative overestimate rather than an undercount).
const INPUT_USD_PER_TOKEN = 1.0 / 1_000_000
const OUTPUT_USD_PER_TOKEN = 5.0 / 1_000_000

/**
 * Current ceilings — change these numbers to retune the cap.
 * maxSessionSpendUsd: a full game is 16 model calls (~$0.05) over 8 turns, so
 *   $0.08 = exactly 8 reservations of turnReserveUsd; catches a runaway session.
 * defaultDailySpendUsd: global ceiling across all sessions, used unless the
 *   MAX_DAILY_SPEND_USD env var overrides it (see dailyCapMicros).
 * turnReserveUsd: cost reserved up front for ONE turn. A typical turn is
 *   ~$0.006 (~$0.05 / 8 turns), so $0.01 covers it with margin. It is
 *   deliberately BELOW the theoretical worst case (~$0.035: persona at its
 *   2048-token cap plus 3 invigilator attempts), so a few simultaneous
 *   pathological turns can overshoot a cap by up to ~$0.025 each before they
 *   settle; settling keeps the counters accurate afterwards.
 * failedTurnChargeUsd: what a turn whose persona call threw is charged — about
 *   one persona-sized input (~2.5k tokens). The call may have been billed
 *   even though it errored (e.g. a timeout).
 */
export const BUDGET_CONFIG = {
  maxSessionSpendUsd: 0.08,
  defaultDailySpendUsd: 2.0,
  turnReserveUsd: 0.01,
  failedTurnChargeUsd: 0.003,
}

const SESSION_COUNTER_TTL_SECONDS = 2 * 60 * 60
const DAY_COUNTER_TTL_SECONDS = 48 * 60 * 60

const usdToMicros = (usd: number) => Math.round(usd * 1_000_000)

export function estimateCostUsd(usage: TokenUsage): number {
  const inputTokens = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens
  return inputTokens * INPUT_USD_PER_TOKEN + usage.outputTokens * OUTPUT_USD_PER_TOKEN
}

/** Daily ceiling in micro-dollars: MAX_DAILY_SPEND_USD if it is a positive number, else the default. */
export function dailyCapMicros(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.MAX_DAILY_SPEND_USD)
  const usd = Number.isFinite(raw) && raw > 0 ? raw : BUDGET_CONFIG.defaultDailySpendUsd
  return usdToMicros(usd)
}

const sessionKey = (sessionId: string) => `spend:sess:${sessionId}`
/** One counter per UTC calendar day, so the daily total rolls over by key rather than by a reset job. */
export const dayKey = (now: Date) => `spend:day:${now.toISOString().slice(0, 10)}`

/** Handle returned by reserveSpend() and consumed by settleSpend(). */
export type SpendReservation = {
  sessionId: string
  sessionKey: string
  dayKey: string
  reservedMicros: number
}

/** Logs a store failure server-side (it may contain URLs/tokens) and returns the generic 503 to throw. */
function failClosed(op: string, err: unknown) {
  console.error(JSON.stringify({ evt: 'store_error', op, msg: err instanceof Error ? err.message : String(err) }))
  return storeUnavailable()
}

const DAILY_MESSAGE =
  'The detective bureau is resting for today — the daily budget for this game has been used up. Please come back tomorrow.'
const SESSION_MESSAGE =
  'This case has hit its model-spend limit for a single session. Start a new case to continue playing.'

/**
 * Gate for creating a new game: refuses with a friendly 429 when today's
 * budget cannot cover even one more turn. A plain read is fine here (no
 * money is spent by creating a session); the atomic guard is reserveSpend().
 */
export async function assertDailyCapacity(
  store: Store,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  let spent: unknown
  try {
    spent = await store.getJson(dayKey(now))
  } catch (err) {
    throw failClosed('daily_capacity', err)
  }
  if (Number(spent ?? 0) + usdToMicros(BUDGET_CONFIG.turnReserveUsd) > dailyCapMicros(env)) {
    throw budgetExceeded(DAILY_MESSAGE)
  }
}

/**
 * Atomically reserves one turn's worst-case cost against the session and
 * daily counters. Throws a 429 if either would go over its cap (nothing is
 * reserved in that case) and a 503 if the store is down. Callers MUST call
 * this before any paid model call, and settleSpend() afterwards.
 */
export async function reserveSpend(
  store: Store,
  sessionId: string,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<SpendReservation> {
  const reservedMicros = usdToMicros(BUDGET_CONFIG.turnReserveUsd)
  const sKey = sessionKey(sessionId)
  const dKey = dayKey(now)
  let result
  try {
    result = await store.reserve(
      [
        { key: sKey, cap: usdToMicros(BUDGET_CONFIG.maxSessionSpendUsd), ttlSeconds: SESSION_COUNTER_TTL_SECONDS },
        { key: dKey, cap: dailyCapMicros(env), ttlSeconds: DAY_COUNTER_TTL_SECONDS },
      ],
      reservedMicros,
    )
  } catch (err) {
    throw failClosed('reserve', err)
  }
  if (!result.ok) {
    throw budgetExceeded(result.blockedKey === dKey ? DAILY_MESSAGE : SESSION_MESSAGE)
  }
  return { sessionId, sessionKey: sKey, dayKey: dKey, reservedMicros }
}

/**
 * Reconciles a reservation to the real cost by adding (actual - reserved) to
 * both counters. Never throws: the model has already been paid for, and a
 * failed settle just leaves the (larger) reservation counted.
 */
export async function settleSpend(store: Store, reservation: SpendReservation, actualUsd: number): Promise<void> {
  const delta = usdToMicros(actualUsd) - reservation.reservedMicros
  if (delta === 0) return
  try {
    await store.adjust(reservation.sessionKey, delta, SESSION_COUNTER_TTL_SECONDS)
    await store.adjust(reservation.dayKey, delta, DAY_COUNTER_TTL_SECONDS)
  } catch (err) {
    console.error(
      JSON.stringify({ evt: 'store_error', op: 'settle', msg: err instanceof Error ? err.message : String(err) }),
    )
  }
}

/**
 * What a completed turn is charged. If the invigilator failed, its failed
 * attempts were probably billed but never reached session.usage, so charge
 * the full reservation instead of trusting the (undercounted) token usage.
 */
export function chargeForCompletedTurn(measuredUsd: number, invigilatorFailed: boolean): number {
  return invigilatorFailed ? Math.max(measuredUsd, BUDGET_CONFIG.turnReserveUsd) : measuredUsd
}
