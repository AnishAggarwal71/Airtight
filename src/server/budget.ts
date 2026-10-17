/**
 * Spend cap — bounds model cost per session and across the whole server
 * per day, so the game can be shared without an unbounded cost tail.
 *
 * In-memory only, same "no database" pattern as src/server/sessions.ts:
 * the daily total resets on server restart, not just on the UTC day
 * boundary. Acceptable for a portfolio deployment; flagged here rather
 * than hidden.
 */

import type { GameSession, TokenUsage } from '../engine/types'
import { budgetExceeded } from './errors'

// Anthropic Haiku 4.5 pricing per CLAUDE.md: $1.00/1M input tokens,
// $5.00/1M output tokens. Cache writes are billed at the input rate (cache
// reads are cheaper in reality, but pricing them at the input rate keeps
// this a conservative overestimate rather than an undercount).
const INPUT_USD_PER_TOKEN = 1.0 / 1_000_000
const OUTPUT_USD_PER_TOKEN = 5.0 / 1_000_000

/**
 * Current ceilings — change these two numbers to retune the cap.
 * maxSessionSpendUsd: a full game is 16 model calls; this leaves generous
 * headroom over typical per-game cost while still catching a runaway session.
 * maxDailySpendUsd: global ceiling across all sessions combined.
 */
export const BUDGET_CONFIG = {
  maxSessionSpendUsd: 0.5,
  maxDailySpendUsd: 25.0,
}

export function estimateCostUsd(usage: TokenUsage): number {
  const inputTokens = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens
  return inputTokens * INPUT_USD_PER_TOKEN + usage.outputTokens * OUTPUT_USD_PER_TOKEN
}

let dailySpendUsd = 0
let dailySpendResetAt = startOfNextUtcDay()

function startOfNextUtcDay(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
}

function rolloverIfNewDay(): void {
  if (Date.now() >= dailySpendResetAt) {
    dailySpendUsd = 0
    dailySpendResetAt = startOfNextUtcDay()
  }
}

/** Adds the incremental cost of a model call to today's running total. */
export function recordSpend(usd: number): void {
  rolloverIfNewDay()
  dailySpendUsd += usd
}

/**
 * Throws a 429 ApiError if either this session or the server-wide daily
 * total has already exceeded its ceiling. Callers must check this BEFORE
 * invoking the model so a refused turn never consumes a turn counter or
 * makes a paid call.
 */
export function checkBudget(session: GameSession): void {
  rolloverIfNewDay()

  const sessionSpend = estimateCostUsd(session.usage)
  if (sessionSpend >= BUDGET_CONFIG.maxSessionSpendUsd) {
    throw budgetExceeded(
      'This case has hit its model-spend limit for a single session. Start a new case to continue playing.',
    )
  }
  if (dailySpendUsd >= BUDGET_CONFIG.maxDailySpendUsd) {
    throw budgetExceeded(
      'The server has hit its daily model-spend limit. Please try again tomorrow.',
    )
  }
}
