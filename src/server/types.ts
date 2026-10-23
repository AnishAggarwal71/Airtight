/**
 * The one response shape that isn't already an engine type — the post-game
 * breakdown DTO. This is the only endpoint allowed to expose hidden CaseFile
 * fields (truth, fatalFact, suspectPersona, evidence vulnerabilities), and
 * only because by the time it's requested the game is already resolved.
 */

import type {
  Claim,
  DetectiveEvidence,
  Ending,
  InterrogationDetail,
  SuspectPersona,
  TimelineBeat,
  TokenUsage,
  WitnessDetail,
} from '../engine/types'

export type TurningPoint = {
  turn: number
  phase: 'interrogation'
  caseStrengthBefore: number
  caseStrengthAfter: number
  playerQuestion: string
}

export type BreakdownResponse = {
  ending: Ending
  caseStrength: number
  caseStrengthHistory: number[]
  interrogationTurn: number
  maxInterrogationTurns: number
  witnessTurn: number
  maxWitnessTurns: number
  truth: TimelineBeat[]
  fatalFact: string
  turningPoint: TurningPoint | null
  interrogationDetails: InterrogationDetail[]
  witnessDetails: WitnessDetail[]
  suspectPersona: SuspectPersona
  evidence: DetectiveEvidence[]
  suspectClaims: Claim[]
  witnessClaims: Claim[]
  contradictedClaimIds: string[]
  usage: TokenUsage
}

/** A single transcript entry, used by both the live game view and the reconnect endpoint. */
export type TranscriptEntry = {
  speaker: 'detective' | 'suspect' | 'witness'
  text: string
  demeanor?: string
  turn: number
}
