/**
 * Scoring engine — pure TypeScript, no model involvement.
 *
 * "The model acts; the engine scores." All Case Strength arithmetic lives
 * here, never in a prompt. This is what makes difficulty a config file you
 * can tune in seconds and what makes the game feel fair instead of arbitrary.
 *
 * V2 scores the ANSWER the question provoked, not the question itself.
 * Two scoring functions: one for suspect interrogation turns, one for
 * witness turns.
 */

import type {
  SuspectResponse,
  WitnessResponse,
  Ending,
  GameSession,
} from './types'

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * All scoring weights in one object. Tuning is a single-file change.
 */
export const SCORING_CONFIG = {
  // ── Starting point ─────────────────────────────────────────────────────────
  initialCaseStrength: 15,

  // ── Suspect response scoring ──────────────────────────────────────────────
  majorContradiction: 20,        // suspect contradicts their own earlier claim (major)
  minorContradiction: 8,         // suspect contradicts their own earlier claim (minor)

  evidenceQuality0: 12,          // terrible lie — made it worse
  evidenceQuality1: 8,           // weak deflection — didn't address the evidence
  evidenceQuality2: 3,           // plausible but cracked — leaves doubt
  evidenceQuality3: 0,           // airtight — exploited the vulnerability perfectly

  inadvertentReveal: 15,         // accidentally revealed guilty knowledge

  // ── Demeanor shifts ───────────────────────────────────────────────────────
  demeanorShift: 3,              // shifting from calm to nervous/defensive/aggressive/evasive

  // ── Witness scoring ───────────────────────────────────────────────────────
  witnessContradiction: 10,      // witness's honest account contradicts suspect's claim

  // ── Turn structure ────────────────────────────────────────────────────────
  maxInterrogationTurns: 6,
  maxWitnessTurns: 2,

  // ── Ending ─────────────────────────────────────────────────────────────────
  chargedThreshold: 80,

  // ── Clamps ─────────────────────────────────────────────────────────────────
  caseStrengthFloor: 0,
  caseStrengthCeiling: 100,
} as const

export type ScoringConfig = typeof SCORING_CONFIG

// ─── Pure helpers ────────────────────────────────────────────────────────────

function clamp(min: number, max: number, val: number): number {
  return Math.max(min, Math.min(max, val))
}

// ─── Score a suspect interrogation turn ─────────────────────────────────────

export type ScoreSuspectResult = {
  delta: number
  newCaseStrength: number
}

/**
 * Score one suspect interrogation turn. Pure — reads the response and current
 * case strength, returns the delta and new value. The caller applies it.
 *
 * Tracks the previous demeanor to detect shifts. On turn 1, previousDemeanor
 * is 'calm' (the suspect hasn't spoken yet).
 */
export function scoreSuspectTurn(
  response: SuspectResponse,
  currentCaseStrength: number,
  previousDemeanor: SuspectResponse['demeanor'],
  config: ScoringConfig = SCORING_CONFIG,
): ScoreSuspectResult {
  let delta = 0

  // 1. Self-contradiction — the heaviest cost
  if (response.selfContradiction) {
    delta += response.selfContradiction.severity === 'major'
      ? config.majorContradiction
      : config.minorContradiction
  }

  // 2. Evidence response quality (only when evidence was presented)
  if (response.evidenceResponse) {
    const q = response.evidenceResponse.quality
    if (q === 0) delta += config.evidenceQuality0
    else if (q === 1) delta += config.evidenceQuality1
    else if (q === 2) delta += config.evidenceQuality2
    // quality 3 adds nothing — the suspect nailed it
  }

  // 3. Inadvertent reveal of guilty knowledge
  if (response.inadvertentReveal) {
    delta += config.inadvertentReveal
  }

  // 4. Demeanor shift (calm → anything else is a signal)
  if (previousDemeanor === 'calm' && response.demeanor !== 'calm') {
    delta += config.demeanorShift
  }

  const newCaseStrength = clamp(
    config.caseStrengthFloor,
    config.caseStrengthCeiling,
    currentCaseStrength + delta,
  )

  return { delta, newCaseStrength }
}

// ─── Score a witness turn ───────────────────────────────────────────────────

export type ScoreWitnessResult = {
  delta: number
  newCaseStrength: number
}

/**
 * Score one witness interrogation turn. Simpler than suspect scoring —
 * the main signal is whether the witness contradicts a suspect claim.
 */
export function scoreWitnessTurn(
  response: WitnessResponse,
  currentCaseStrength: number,
  config: ScoringConfig = SCORING_CONFIG,
): ScoreWitnessResult {
  let delta = 0

  // Witness contradicts something the suspect claimed
  if (response.suspectContradiction) {
    delta += config.witnessContradiction
  }

  const newCaseStrength = clamp(
    config.caseStrengthFloor,
    config.caseStrengthCeiling,
    currentCaseStrength + delta,
  )

  return { delta, newCaseStrength }
}

// ─── Ending detection ────────────────────────────────────────────────────────

/**
 * Check whether the game has reached an ending. Called after every scoring
 * update, during any phase.
 *
 * - CHARGED_STRONG: Case Strength ≥ 80 at any point (clean win).
 * - Verdict phase handles CHARGED_WEAK / RELEASED based on player's gamble.
 *
 * Returns null if the game continues.
 */
export function checkEnding(
  caseStrength: number,
  config: ScoringConfig = SCORING_CONFIG,
): Ending | null {
  if (caseStrength >= config.chargedThreshold) return 'CHARGED_STRONG'
  return null
}
