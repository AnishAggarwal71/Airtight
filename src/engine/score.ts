/**
 * Scoring engine — pure TypeScript, no model involvement.
 *
 * "The model judges; the engine scores." All arithmetic on meters and evidence
 * weights lives here, never in a prompt. This is what makes difficulty a config
 * file you can tune in seconds (M4) and what makes the game feel fair instead
 * of arbitrary. — CLAUDE.md invariant #3
 *
 * The scoring table matches PRD §5.5 exactly. Every constant is in one exported
 * config object so M4 tuning is a single-file change.
 */

import type { Adjudication, Evidence, Ending, GameSession } from './types'

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * All scoring weights in one object. M4 changes this and nothing else.
 * Each field maps directly to a row in the PRD §5.5 table.
 */
export const SCORING_CONFIG = {
  // ── Scoring table (PRD §5.5) ─────────────────────
  majorContradiction: { caseStrength: 15, suspicion: 10 },
  minorContradiction: { caseStrength: 6, suspicion: 4 },
  /** Suspicion deltas indexed by evasion score 0–3. */
  evasion: [0, 0, 4, 8] as const,
  plausibilityZero: { caseStrength: 4, suspicion: 6 },
  /** Evidence weight deltas indexed by explanation quality 0–3. */
  explains: [0, -10, -25, -40] as const,
  /** Suspicion relief when the player nails an explanation (quality 3). */
  explainsQuality3SuspicionRelief: -5,
  injectionSuspicionPenalty: 20,

  // ── Evidence state transitions ───────────────────
  /** Minimum explanation quality to transition revealed → explained. */
  explainedQualityMin: 3,

  // ── Bluff scheduling (decided at session start) ──
  bluffEarliestTurn: 4,
  bluffLatestTurn: 8,
  bluffChance: 0.7,

  // ── Endings ──────────────────────────────────────
  chargedThreshold: 80,
  releasedCeiling: 50,
  suspicionExtensionThreshold: 90,
  extensionRounds: 3,
  baseTurns: 12,

  // ── Clamps ───────────────────────────────────────
  evidenceWeightFloor: 0,
  evidenceWeightCeiling: 100,
} as const

export type ScoringConfig = typeof SCORING_CONFIG

// ─── Pure helpers ────────────────────────────────────────────────────────────

function clamp(min: number, max: number, val: number): number {
  return Math.max(min, Math.min(max, val))
}

// ─── Case Strength ───────────────────────────────────────────────────────────

/**
 * Case Strength = normalised sum of revealed evidence weights + accumulated
 * contradiction penalty. (PRD §5.5)
 *
 * "Normalised sum" means: revealed weight total / total baseWeight for ALL
 * evidence (including latent), scaled to 0–100, then the contradiction penalty
 * is added on top. This means explaining evidence lowers CS, contradictions
 * raise it permanently, and revealing latent items raises the numerator.
 */
export function computeCaseStrength(
  evidence: Evidence[],
  contradictionPenalty: number,
  config: ScoringConfig = SCORING_CONFIG,
): number {
  const maxPossible = evidence.reduce((sum, e) => sum + e.baseWeight, 0)
  if (maxPossible === 0) return 0

  const revealedSum = evidence
    .filter((e) => e.state !== 'latent')
    .reduce((sum, e) => sum + e.weight, 0)

  const normalised = (revealedSum / maxPossible) * 100
  return clamp(0, 100, Math.round(normalised + contradictionPenalty))
}

// ─── Ending detection ────────────────────────────────────────────────────────

/**
 * Check whether the game has ended.
 *
 * CHARGED triggers at any point when CS >= 80. RELEASED and HELD are only
 * checked at the final turn.
 */
export function checkEnding(
  turn: number,
  maxTurns: number,
  caseStrength: number,
  config: ScoringConfig = SCORING_CONFIG,
): Ending | null {
  if (caseStrength >= config.chargedThreshold) return 'CHARGED'
  if (turn >= maxTurns) {
    return caseStrength < config.releasedCeiling ? 'RELEASED' : 'HELD_48_HOURS'
  }
  return null
}

// ─── Score a single turn ─────────────────────────────────────────────────────

export type ScoreTurnResult = {
  caseStrengthDelta: number
  suspicionDelta: number
  newCaseStrength: number
  newSuspicion: number
  newContradictionPenalty: number
  evidenceWeightChanges: Array<{
    evidenceId: string
    oldWeight: number
    newWeight: number
  }>
  evidenceRevealed: string[]
  evidenceExplained: string[]
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
  // Work on a shallow copy of evidence so we can mutate weights safely
  const evidence = session.evidence.map((e) => ({ ...e }))
  const evidenceById = new Map(evidence.map((e) => [e.id, e]))
  const weightChanges: ScoreTurnResult['evidenceWeightChanges'] = []
  const revealed: string[] = []
  const explained: string[] = []

  let contradictionPenalty = session.contradictionPenalty
  let suspicionDelta = 0

  // ── 1. Contradiction penalties ───────────────────
  for (const c of adjudication.contradictions) {
    if (c.severity === 'major') {
      contradictionPenalty += config.majorContradiction.caseStrength
      suspicionDelta += config.majorContradiction.suspicion
    } else {
      contradictionPenalty += config.minorContradiction.caseStrength
      suspicionDelta += config.minorContradiction.suspicion
    }
  }

  // ── 2. Evasion → Suspicion ───────────────────────
  suspicionDelta += config.evasion[adjudication.evasion]

  // ── 3. Plausibility = 0 penalty ──────────────────
  if (adjudication.plausibility === 0) {
    contradictionPenalty += config.plausibilityZero.caseStrength
    suspicionDelta += config.plausibilityZero.suspicion
  }

  // ── 4. Evidence explanation weights ──────────────
  let quality3Found = false
  for (const ex of adjudication.explains) {
    const ev = evidenceById.get(ex.evidenceId)
    if (!ev || ev.state === 'latent') continue

    const oldWeight = ev.weight
    ev.weight = clamp(
      config.evidenceWeightFloor,
      config.evidenceWeightCeiling,
      ev.weight + config.explains[ex.quality],
    )
    if (ev.weight !== oldWeight) {
      weightChanges.push({ evidenceId: ev.id, oldWeight, newWeight: ev.weight })
    }

    // State transition: revealed → explained
    if (ex.quality >= config.explainedQualityMin && ev.state === 'revealed') {
      ev.state = 'explained'
      explained.push(ev.id)
    }
    if (ex.quality === 3) quality3Found = true
  }

  // Suspicion relief for a quality-3 explanation
  if (quality3Found) {
    suspicionDelta += config.explainsQuality3SuspicionRelief
  }

  // ── 5. Injection → Suspicion ─────────────────────
  if (adjudication.injectionAttempt) {
    suspicionDelta += config.injectionSuspicionPenalty
  }

  // ── 6. Evidence revelation (major contradiction) ─
  const hasMajor = adjudication.contradictions.some((c) => c.severity === 'major')
  if (hasMajor) {
    const latent = evidence.filter((e) => e.state === 'latent')
    if (latent.length > 0) {
      // Prefer the model's suggestion if it's actually latent
      let toReveal: typeof latent[0] | undefined
      if (adjudication.evidenceToReveal) {
        toReveal = latent.find((e) => e.id === adjudication.evidenceToReveal)
      }
      // Fallback: highest baseWeight latent item
      if (!toReveal) {
        toReveal = latent.sort((a, b) => b.baseWeight - a.baseWeight)[0]
      }
      if (toReveal) {
        toReveal.state = 'revealed'
        revealed.push(toReveal.id)
      }
    }
  }

  // ── 7. Compute new meters ────────────────────────
  const newSuspicion = clamp(0, 100, session.suspicion + suspicionDelta)
  const newCaseStrength = computeCaseStrength(evidence, contradictionPenalty, config)
  const csDelta = newCaseStrength - session.caseStrength

  // ── 8. Check ending ──────────────────────────────
  const ending = checkEnding(session.turn, session.maxTurns, newCaseStrength, config)

  return {
    caseStrengthDelta: csDelta,
    suspicionDelta,
    newCaseStrength,
    newSuspicion,
    newContradictionPenalty: contradictionPenalty,
    evidenceWeightChanges: weightChanges,
    evidenceRevealed: revealed,
    evidenceExplained: explained,
    ending,
  }
}
