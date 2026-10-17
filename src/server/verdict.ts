/**
 * Derives a client-safe verdict type + one-line reason from invigilator
 * signals, per DESIGN.md section 6.
 *
 * This is the one place hidden state could leak to the browser: the
 * invigilator's free-text `reasoning`/`description` fields are written by a
 * model with full access to the true timeline, cover story, and claim
 * ledger, and could echo any of it. deriveVerdictReason() never reads those
 * fields — it only composes static per-type phrasing with the player's own
 * question text and already-public evidence descriptions, so there is
 * nothing in its inputs capable of carrying hidden state, by construction
 * rather than by filtering.
 */

import type {
  InvigilatorSuspectResponse,
  InvigilatorWitnessResponse,
} from '../engine/types'

export type VerdictType = 'contradiction' | 'slip' | 'tell' | 'weak_answer' | 'no_change'

const MAX_REASON_LENGTH = 90

function truncate(text: string): string {
  return text.length <= MAX_REASON_LENGTH ? text : `${text.slice(0, MAX_REASON_LENGTH - 1)}…`
}

/** Priority cascade from DESIGN.md section 6: contradiction > slip > tell > weak answer > no change. */
export function deriveSuspectVerdictType(
  signals: InvigilatorSuspectResponse['signals'],
): VerdictType {
  if (signals.contradictions.length > 0) return 'contradiction'
  if (signals.guiltyKnowledgeLeak) return 'slip'
  if (signals.demeanorShift) return 'tell'
  if (signals.evidenceHandling.some((eh) => eh.quality <= 1)) return 'weak_answer'
  return 'no_change'
}

export function deriveWitnessVerdictType(
  signals: InvigilatorWitnessResponse['signals'],
): VerdictType {
  return signals.suspectContradiction ? 'contradiction' : 'no_change'
}

type ReasonInput = {
  question: string
  presentedEvidenceDescriptions: string[]
}

/**
 * One sentence, built only from static phrasing + the player's own
 * question + already-public evidence text. Never reads invigilator
 * free-text, claim-ledger contents, or truth-timeline facts.
 */
export function deriveVerdictReason(type: VerdictType, input: ReasonInput): string {
  const { question, presentedEvidenceDescriptions } = input
  const shortQuestion = question.length > 40 ? `${question.slice(0, 39)}…` : question
  const evidenceNote = presentedEvidenceDescriptions.length > 0 ? ' against the evidence presented' : ''

  switch (type) {
    case 'contradiction':
      return truncate(`The answer to "${shortQuestion}" contradicts an earlier statement.`)
    case 'slip':
      return truncate(`The answer to "${shortQuestion}" revealed something the suspect shouldn't know.`)
    case 'tell':
      return truncate(`The suspect's demeanor shifted while answering "${shortQuestion}".`)
    case 'weak_answer':
      return truncate(`The suspect's answer to "${shortQuestion}" held up poorly${evidenceNote}.`)
    case 'no_change':
      return truncate(`The answer to "${shortQuestion}" changed nothing.`)
  }
}

export type Verdict = { type: VerdictType; reason: string }
