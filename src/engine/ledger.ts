/**
 * Claim ledger — tracks what the suspect (and witness) have said.
 *
 * The full transcript is never fed back to the model. Each turn the structured
 * output extracts the suspect's assertions into compact claim records. The
 * ledger accumulates and is passed in full each turn, keeping context flat
 * instead of growing with raw dialogue.
 */

import type { Claim } from './types'

/**
 * Append new claims to a ledger. The model returns `{ text, checkable }` pairs;
 * we stamp each with a turn number and assign sequential IDs based on the
 * existing ledger length.
 */
export function addClaims(
  existing: Claim[],
  turn: number,
  newClaims: { text: string; checkable: boolean }[],
  prefix = 'c',
): Claim[] {
  let nextIndex = existing.length + 1
  const additions: Claim[] = newClaims.map((c) => ({
    id: `${prefix}${nextIndex++}`,
    text: c.text,
    turn,
    checkable: c.checkable,
  }))
  return [...existing, ...additions]
}

/**
 * Serialise the ledger for the model's user message. At 6 turns with 1–3
 * claims each, the whole block stays under ~200 tokens.
 */
export function serializeLedger(claims: Claim[]): string {
  if (claims.length === 0) return 'No prior claims.'
  return claims
    .map((c) => `${c.id} (turn ${c.turn})${c.checkable ? '' : ' [opinion, not checkable]'}: "${c.text}"`)
    .join('\n')
}
