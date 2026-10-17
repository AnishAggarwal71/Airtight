/**
 * Scoring engine — pure TypeScript, no model involvement.
 *
 * "The suspect acts; the invigilator judges; the engine scores."
 * The invigilator returns structured signals (contradictions, guilty knowledge
 * leaks, evidence handling quality, demeanor shifts). This module converts
 * those signals to case strength deltas using deterministic weights.
 *
 * Difficulty is a config-file change — never a prompt change.
 */

import type {
  InvigilatorSuspectResponse,
  InvigilatorWitnessResponse,
  Ending,
  Claim,
} from './types'

// ─── Config ──────────────────────────────────────────────────────────────────

export const SCORING_CONFIG = {
  initialCaseStrength: 15,

  majorContradiction: 20,
  minorContradiction: 8,

  evidenceQuality0: 12,          // terrible — made it worse
  evidenceQuality1: 8,           // weak deflection
  evidenceQuality2: 3,           // plausible but cracked
  evidenceQuality3: 0,           // airtight

  guiltyKnowledgeLeak: 15,

  demeanorShift: 3,

  witnessContradiction: 10,

  // Backstop against invigilator over-firing (stacked contradictions +
  // GK leak + demeanor shift all landing on one turn) — caps any single
  // turn's swing regardless of how many signals fired. See docs/decisions.md.
  maxTurnDelta: 25,

  maxInterrogationTurns: 6,
  maxWitnessTurns: 2,

  chargedThreshold: 80,

  // Below this at turn exhaustion, the suspect is RELEASED; at or above it
  // (and below chargedThreshold), the ending is a qualified CHARGED_WEAK.
  // See docs/decisions.md (2026-10-15, ending reframe).
  weakChargeThreshold: 50,

  // The witness becomes callable once case strength exceeds this value —
  // a separate knob from weakChargeThreshold even though both are 50 today,
  // since they tune different things (gameplay unlock vs. ending outcome).
  // See docs/decisions.md (2026-10-15, witness-timing change).
  witnessUnlockThreshold: 50,

  caseStrengthFloor: 0,
  caseStrengthCeiling: 100,
} as const

export type ScoringConfig = typeof SCORING_CONFIG

// ─── Pure helpers ────────────────────────────────────────────────────────────

function clamp(min: number, max: number, val: number): number {
  return Math.max(min, Math.min(max, val))
}

// ─── Score a suspect turn from invigilator signals ─────────────────────────

export type ScoreSuspectResult = {
  delta: number
  newCaseStrength: number
}

/**
 * Score one suspect turn using invigilator-detected signals.
 * Validates claim IDs against the actual ledger before counting contradictions.
 */
export function scoreSuspectTurn(
  invigilatorResponse: InvigilatorSuspectResponse,
  currentCaseStrength: number,
  suspectClaims: Claim[],
  config: ScoringConfig = SCORING_CONFIG,
): ScoreSuspectResult {
  let delta = 0
  const claimIds = new Set(suspectClaims.map((c) => c.id))

  for (const contradiction of invigilatorResponse.signals.contradictions) {
    if (!claimIds.has(contradiction.againstClaimId)) continue
    delta += contradiction.severity === 'major'
      ? config.majorContradiction
      : config.minorContradiction
  }

  const evidencePoints: number[] = invigilatorResponse.signals.evidenceHandling.map((eh) => {
    if (eh.quality === 0) return config.evidenceQuality0
    if (eh.quality === 1) return config.evidenceQuality1
    if (eh.quality === 2) return config.evidenceQuality2
    return config.evidenceQuality3
  })
  if (evidencePoints.length > 0) {
    delta += Math.round(evidencePoints.reduce((sum, p) => sum + p, 0) / evidencePoints.length)
  }

  if (invigilatorResponse.signals.guiltyKnowledgeLeak) {
    delta += config.guiltyKnowledgeLeak
  }

  if (invigilatorResponse.signals.demeanorShift) {
    delta += config.demeanorShift
  }

  delta = clamp(-config.maxTurnDelta, config.maxTurnDelta, delta)

  const newCaseStrength = clamp(
    config.caseStrengthFloor,
    config.caseStrengthCeiling,
    currentCaseStrength + delta,
  )

  return { delta, newCaseStrength }
}

// ─── Score a witness turn from invigilator signals ─────────────────────────

export type ScoreWitnessResult = {
  delta: number
  newCaseStrength: number
}

/**
 * Score one witness turn. The invigilator checks whether the witness's
 * testimony contradicts a suspect claim.
 */
export function scoreWitnessTurn(
  invigilatorResponse: InvigilatorWitnessResponse,
  currentCaseStrength: number,
  suspectClaims: Claim[],
  config: ScoringConfig = SCORING_CONFIG,
): ScoreWitnessResult {
  let delta = 0
  const claimIds = new Set(suspectClaims.map((c) => c.id))

  if (invigilatorResponse.signals.suspectContradiction) {
    if (claimIds.has(invigilatorResponse.signals.suspectContradiction.againstClaimId)) {
      delta += config.witnessContradiction
    }
  }

  // Same backstop as scoreSuspectTurn — a witness turn is a single-signal path
  // today (witnessContradiction: 10, well under maxTurnDelta), but routing it
  // through the shared clamp means that stays true if the weight ever changes,
  // instead of relying on the two scoring paths staying in sync by coincidence.
  delta = clamp(-config.maxTurnDelta, config.maxTurnDelta, delta)

  const newCaseStrength = clamp(
    config.caseStrengthFloor,
    config.caseStrengthCeiling,
    currentCaseStrength + delta,
  )

  return { delta, newCaseStrength }
}

// ─── Ending detection ────────────────────────────────────────────────────────

/**
 * Turn-exhaustion state needed to resolve CHARGED_WEAK/RELEASED once every
 * available question has been asked. The witness fields are irrelevant (and
 * ignored) when the witness was never opened — a game can exhaust purely on
 * suspect turns.
 */
export type TurnExhaustion = {
  interrogationTurn: number
  maxInterrogationTurns: number
  witnessUsed: boolean
  witnessTurn: number
  maxWitnessTurns: number
}

function isExhausted(turns: TurnExhaustion): boolean {
  const interrogationDone = turns.interrogationTurn >= turns.maxInterrogationTurns
  const witnessDone = !turns.witnessUsed || turns.witnessTurn >= turns.maxWitnessTurns
  return interrogationDone && witnessDone
}

/**
 * Resolve the ending for the current state. Call this after every turn:
 *   - Case Strength reaching chargedThreshold ends the game immediately as
 *     CHARGED_STRONG, regardless of remaining turns.
 *   - Otherwise, the game only ends once every available question has been
 *     asked (six suspect turns, plus both witness turns if the witness was
 *     used) — CHARGED_WEAK at or above weakChargeThreshold, RELEASED below it.
 *   - Mid-game (not yet exhausted, below chargedThreshold) returns null — the
 *     game continues.
 */
export function checkEnding(
  caseStrength: number,
  turns: TurnExhaustion,
  config: ScoringConfig = SCORING_CONFIG,
): Ending | null {
  if (caseStrength >= config.chargedThreshold) return 'CHARGED_STRONG'
  if (!isExhausted(turns)) return null
  return caseStrength >= config.weakChargeThreshold ? 'CHARGED_WEAK' : 'RELEASED'
}
