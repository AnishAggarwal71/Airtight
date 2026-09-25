/**
 * Scoring engine — pure TypeScript, no model involvement.
 *
 * "The model judges; the engine scores." All arithmetic on Suspicion and
 * evidence weights lives here, never in a prompt. This is what makes
 * difficulty a config file you can tune in seconds and what makes the game
 * feel fair instead of arbitrary. — CLAUDE.md invariant #3
 *
 * Suspicion is the only meter — Case Strength was dropped. The player never
 * sees a number during play; feedback is the detective's tone, and the score
 * is revealed once, in the post-game breakdown.
 */

import type { Adjudication, Evidence, Ending, GameSession, Phase } from './types'

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * All scoring weights in one object. Tuning is a single-file change.
 */
export const SCORING_CONFIG = {
  // ── Starting point — never 0. A suspect is never presumed clean. ─────────
  initialSuspicion: 20,

  // ── Suspicion deltas ──────────────────────────────────────────────────────
  majorContradiction: 25,      // contradicting an earlier claim — the heaviest cost
  minorContradiction: 10,
  revisesEarlier: 12,          // changing the account after being pressed
  volunteersDetail: 5,         // unprompted detail that creates new checkable surface
  specificityFailure: 15,      // a testable detail offered, and it doesn't hold up
  flatDenialPattern: 10,       // 2nd+ occurrence of denial/don't-remember/decline; 1st is free
  injectionSuspicionPenalty: 20,
  explainsQuality3Relief: -8,  // nailing an explanation for a played piece of evidence

  // ── Evidence state transitions ───────────────────────────────────────────
  explainedQualityMin: 2,      // quality >= 2 on a played item → 'explained', can't be replayed

  // ── Bluff scheduling (decided at session start) — lives in the confront/corner phase ──
  bluffEarliestTurn: 5,
  bluffLatestTurn: 7,
  bluffChance: 0.7,

  // ── Turn structure ────────────────────────────────────────────────────────
  // Collect → Probe → Confront/Corner arc. Short enough to stay gripping,
  // long enough that collected lies have room to unravel.
  baseTurns: 7,
  earlyPhaseEnd: 1,              // turn 1 only: collect their timeline story
  midPhaseEnd: 3,                // turns 2-3: probe relationship, intent, specifics
                                 // turns 4-7 (late): confront with evidence + contradictions

  // ── Ending ─────────────────────────────────────────────────────────────────
  chargedThreshold: 80,

  // ── Clamps ─────────────────────────────────────────────────────────────────
  suspicionFloor: 0,
  suspicionCeiling: 100,
  evidenceWeightFloor: 0,
  evidenceWeightCeiling: 100,
} as const

export type ScoringConfig = typeof SCORING_CONFIG

// ─── Pure helpers ────────────────────────────────────────────────────────────

function clamp(min: number, max: number, val: number): number {
  return Math.max(min, Math.min(max, val))
}

/** Which behavioural phase a turn falls into. Engine decides this, not the model. */
export function getPhase(turn: number, config: ScoringConfig = SCORING_CONFIG): Phase {
  if (turn <= config.earlyPhaseEnd) return 'early'
  if (turn <= config.midPhaseEnd) return 'mid'
  return 'late'
}

/**
 * Pick the latent evidence item most worth the detective playing this turn.
 * Pure ordinal selection by weight — nothing offered in the collect phase
 * (turn 1), highest-weight latent item offered from probe onward. The
 * prompt guides when the detective actually drops it: mid-phase hints are
 * softer ("you may mention"), late-phase hits are direct confrontations.
 */
export function pickEvidenceToPlay(evidence: Evidence[], phase: Phase): Evidence | null {
  if (phase === 'early') return null
  const latent = evidence.filter((e) => e.state === 'latent')
  if (latent.length === 0) return null
  return [...latent].sort((a, b) => b.weight - a.weight)[0]
}

// ─── Ending detection ────────────────────────────────────────────────────────

/**
 * CHARGED triggers the instant Suspicion crosses 80 — the game can end on
 * any turn, not just the last. Otherwise the case ends RELEASED at turn 7.
 * Winning should be rare: 60 points of runway across 7 turns means two bad
 * slips and you're done.
 */
export function checkEnding(
  turn: number,
  maxTurns: number,
  suspicion: number,
  config: ScoringConfig = SCORING_CONFIG,
): Ending | null {
  if (suspicion >= config.chargedThreshold) return 'CHARGED'
  if (turn >= maxTurns) return 'RELEASED'
  return null
}

// ─── Score a single turn ─────────────────────────────────────────────────────

export type ScoreTurnResult = {
  suspicionDelta: number
  newSuspicion: number
  evidenceWeightChanges: Array<{ evidenceId: string; oldWeight: number; newWeight: number }>
  evidenceRevealed: string[]
  evidenceExplained: string[]
  /** Free-pass flags to write back onto the session (first occurrence of each stance is free). */
  freePassesUsed: {
    denial: boolean
    dontRemember: boolean
    decline: boolean
  }
  ending: Ending | null
}

/**
 * Apply one turn's adjudication to the game state. Pure — reads from session
 * and adjudication, returns a result. The caller (session.ts) applies it.
 */
export function scoreTurn(
  adjudication: Adjudication,
  session: GameSession,
  config: ScoringConfig = SCORING_CONFIG,
): ScoreTurnResult {
  const evidence = session.evidence.map((e) => ({ ...e }))
  const evidenceById = new Map(evidence.map((e) => [e.id, e]))
  const weightChanges: ScoreTurnResult['evidenceWeightChanges'] = []
  const revealed: string[] = []
  const explained: string[] = []

  let suspicionDelta = 0

  // ── 1. Contradictions against the player's own words — the heaviest cost ──
  for (const c of adjudication.contradictions) {
    suspicionDelta += c.severity === 'major' ? config.majorContradiction : config.minorContradiction
  }

  // ── 2. Revising an account after being pressed ────────────────────────────
  if (adjudication.revisesEarlier) {
    suspicionDelta += config.revisesEarlier
  }

  // ── 3. Response stance — free passes, patterns, and volunteered exposure ──
  const freePassesUsed = { denial: false, dontRemember: false, decline: false }
  switch (adjudication.responseStance) {
    case 'flat_denial':
      if (session.usedFreeDenial) suspicionDelta += config.flatDenialPattern
      else freePassesUsed.denial = true
      break
    case 'dont_remember':
      if (session.usedFreeDontRemember) suspicionDelta += config.flatDenialPattern
      else freePassesUsed.dontRemember = true
      break
    case 'decline_to_speculate':
      if (session.usedFreeDecline) suspicionDelta += config.flatDenialPattern
      else freePassesUsed.decline = true
      break
    case 'volunteers_detail':
      suspicionDelta += config.volunteersDetail
      break
    default:
      break
  }

  // ── 4. Specificity that can be tested and fails ────────────────────────────
  if (adjudication.specificityFailure) {
    suspicionDelta += config.specificityFailure
  }

  // ── 5. Evidence played this turn ────────────────────────────────────────────
  if (adjudication.evidencePlayed) {
    const { evidenceId, quality } = adjudication.evidencePlayed
    const ev = evidenceById.get(evidenceId)
    if (ev) {
      if (ev.state === 'latent') {
        ev.state = 'revealed'
        revealed.push(ev.id)
      }
      const oldWeight = ev.weight
      const delta = quality === 3 ? -40 : quality === 2 ? -20 : quality === 1 ? -5 : 10
      ev.weight = clamp(config.evidenceWeightFloor, config.evidenceWeightCeiling, ev.weight + delta)
      if (ev.weight !== oldWeight) {
        weightChanges.push({ evidenceId: ev.id, oldWeight, newWeight: ev.weight })
      }
      if (quality >= config.explainedQualityMin) {
        ev.state = 'explained'
        explained.push(ev.id)
      }
      if (quality === 3) suspicionDelta += config.explainsQuality3Relief
      if (quality === 0) suspicionDelta += config.specificityFailure
    }
  }

  // ── 6. Injection ─────────────────────────────────────────────────────────
  if (adjudication.injectionAttempt) {
    suspicionDelta += config.injectionSuspicionPenalty
  }

  // ── 7. New meter ─────────────────────────────────────────────────────────
  const newSuspicion = clamp(config.suspicionFloor, config.suspicionCeiling, session.suspicion + suspicionDelta)

  // ── 8. Check ending ──────────────────────────────────────────────────────
  const ending = checkEnding(session.turn, session.maxTurns, newSuspicion, config)

  return {
    suspicionDelta,
    newSuspicion,
    evidenceWeightChanges: weightChanges,
    evidenceRevealed: revealed,
    evidenceExplained: explained,
    freePassesUsed,
    ending,
  }
}
