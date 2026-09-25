/**
 * Claim ledger — the architectural centrepiece of the adjudication loop.
 *
 * The full transcript is never fed back to the model. Each turn the adjudicator
 * normalises the player's assertions into compact claim records. The ledger
 * accumulates and is passed in full each turn, keeping context flat across all
 * seven turns instead of growing with raw dialogue.
 *
 * "Does this contradict claim c3?" is far more reliable than "spot the
 * inconsistency in 4,000 tokens." — PRD §5.3
 */

import type { Claim } from './types'

/**
 * Append new claims from the adjudicator to the ledger.
 *
 * The adjudicator returns `newClaims` as `{ id, text }` pairs. We stamp each
 * with the turn number and assign sequential IDs (c1, c2, ...) based on the
 * existing ledger length, ignoring whatever ID the model generated.
 */
export function addClaims(
  existing: Claim[],
  turn: number,
  newClaims: { id: string; text: string; checkable: boolean }[],
): Claim[] {
  let nextIndex = existing.length + 1
  const additions: Claim[] = newClaims.map((c) => ({
    id: `c${nextIndex++}`,
    text: c.text,
    turn,
    checkable: c.checkable,
  }))
  return [...existing, ...additions]
}

/**
 * Serialise the ledger into a compact block for the adjudicator's user message.
 *
 * Format:
 *   c1 (turn 1): "I lent my fob to a contractor."
 *   c2 (turn 2): "The pathologist hedged — that injury is consistent with a fall."
 *
 * At 7 turns with 1–2 claims each, the whole block stays under ~150 tokens.
 */
export function serializeLedger(claims: Claim[]): string {
  if (claims.length === 0) return 'No prior claims.'
  return claims
    .map((c) => `${c.id} (turn ${c.turn})${c.checkable ? '' : ' [opinion, not checkable]'}: "${c.text}"`)
    .join('\n')
}
