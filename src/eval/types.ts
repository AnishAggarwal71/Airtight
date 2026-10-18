/**
 * Eval harness types — Layer 1 (invigilator accuracy) and Layer 2 (gameplay).
 */

import type { SuspectResponse, TokenUsage } from '../engine/types'

/** A hand-crafted test case for the invigilator's signal detection. */
export type EvalCase = {
  id: string
  category: 'guilty_knowledge' | 'contradiction' | 'evidence_handling' | 'clean' | 'demeanor'
  description: string
  seed: string
  turnNumber: number
  priorClaims: { id: string; text: string; turn: number; checkable: boolean }[]
  presentedEvidenceIds: string[]
  playerQuestion: string
  suspectDialogue: string
  /** Demeanor the suspect was reading as going into this turn — null only on turn 1. */
  previousDemeanor: SuspectResponse['demeanor'] | null
  expectedSignals: {
    contradictions: { againstClaimId: string; severity: 'minor' | 'major' }[]
    guiltyKnowledgeLeak: boolean
    evidenceQuality: Record<string, 0 | 1 | 2 | 3>
    demeanorShift: boolean
  }
}

/** Result of running one eval case through the invigilator. */
export type EvalResult = {
  caseId: string
  passed: boolean
  expected: EvalCase['expectedSignals']
  actual: {
    contradictions: { againstClaimId: string; severity: 'minor' | 'major' }[]
    guiltyKnowledgeLeak: boolean
    evidenceQuality: Record<string, number>
    demeanorShift: boolean
  }
  reasoning: string
}

/** Result of one automated full-game playthrough. */
export type GameResult = {
  seed: string
  completed: boolean
  finalCaseStrength: number
  ending: string | null
  turns: number
  signalCounts: {
    contradictions: number
    guiltyKnowledgeLeaks: number
    demeanorShifts: number
    witnessContradictions: number
  }
  perTurnDeltas: number[]
  tokenUsage: TokenUsage
  error?: string
}

/** Aggregate report across both eval layers. */
export type EvalReport = {
  timestamp: string
  model: string
  layer1: {
    total: number
    passed: number
    precision: number
    recall: number
    results: EvalResult[]
  }
  layer2: {
    gamesRequested: number
    gamesCompleted: number
    gamesAbandoned: number
    endingDistribution: Record<string, number>
    caseStrength: { mean: number; median: number; min: number; max: number }
    signalFrequency: Record<string, number>
    games: GameResult[]
  } | null
}
