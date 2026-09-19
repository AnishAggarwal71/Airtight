/**
 * Session orchestration — wires the adjudicator, scoring engine, and claim
 * ledger into a single per-turn entry point.
 *
 * play.ts calls createSession() once and playTurn() each round. This keeps the
 * CLI thin and makes the same loop reusable for the API route in M3.
 */

import { generate } from './generate'
import { Rng } from './rng'
import { adjudicate, type AdjudicateInput } from './adjudicate'
import { addClaims } from './ledger'
import { scoreTurn, computeCaseStrength, SCORING_CONFIG, type ScoringConfig } from './score'
import type {
  CrimeType,
  GameSession,
  TokenUsage,
  TurnDetail,
  Ending,
} from './types'

// ─── Session creation ────────────────────────────────────────────────────────

/**
 * Initialise a new game session. Generates the case deterministically, decides
 * the bluff turn from a separate seeded RNG (so it doesn't couple with the
 * case generation sequence), and sets up all mutable state.
 */
export function createSession(
  seed: string,
  crime: CrimeType,
  config: ScoringConfig = SCORING_CONFIG,
): GameSession {
  const caseFile = generate({ seed, crime })

  // Bluff scheduling — separate RNG so it doesn't affect case generation
  const bluffRng = new Rng(`${seed}::bluff`)
  const willBluff = bluffRng.chance(config.bluffChance)
  const bluffTurn = willBluff
    ? bluffRng.int(config.bluffEarliestTurn, config.bluffLatestTurn)
    : null

  // Deep-copy evidence so we can mutate weights without touching the CaseFile
  const evidence = caseFile.evidence.map((e) => ({ ...e }))

  const contradictionPenalty = 0
  const caseStrength = computeCaseStrength(evidence, contradictionPenalty, config)

  return {
    seed,
    crime,
    turn: 0,
    maxTurns: config.baseTurns,
    caseFile,
    claims: [],
    evidence,
    caseStrength,
    suspicion: 0,
    contradictionPenalty,
    caseStrengthHistory: [],
    suspicionHistory: [],
    bluffTurn,
    bluffUsed: false,
    bluffDetail: null,
    extended: false,
    ending: null,
    endTurn: null,
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    turnDetails: [],
  }
}

// ─── Bluff check ─────────────────────────────────────────────────────────────

/** True if this is the bluff turn and it hasn't been used yet. */
export function isBluffAuthorized(session: GameSession): boolean {
  return (
    session.bluffTurn !== null &&
    session.turn === session.bluffTurn &&
    !session.bluffUsed
  )
}

// ─── Play one turn ───────────────────────────────────────────────────────────

export type PlayTurnResult = {
  detectiveResponse: string
  ending: Ending | null
  /** IDs of evidence newly revealed this turn. */
  evidenceRevealed: string[]
  /** True if the interrogation was just extended +3 rounds. */
  justExtended: boolean
}

/**
 * Orchestrate one turn of the game. Mutates the session in place.
 *
 * 1. Advance turn counter
 * 2. Call adjudicator
 * 3. Update claim ledger
 * 4. Score the turn
 * 5. Apply results to session state
 * 6. Check Suspicion extension
 * 7. Check ending
 * 8. Record turn detail for breakdown
 */
export async function playTurn(
  session: GameSession,
  playerAnswer: string,
  config: ScoringConfig = SCORING_CONFIG,
): Promise<PlayTurnResult> {
  session.turn++

  const csBefore = session.caseStrength
  const susBefore = session.suspicion

  // Build adjudicator input
  const revealedEvidence = session.evidence.filter((e) => e.state !== 'latent')
  const input: AdjudicateInput = {
    caseFile: session.caseFile,
    turn: session.turn,
    maxTurns: session.maxTurns,
    playerAnswer,
    claims: session.claims,
    revealedEvidence,
    bluffAuthorized: isBluffAuthorized(session),
  }

  // Call the model
  const { adjudication, usage } = await adjudicate(input)

  // Accumulate token usage
  accumulateUsage(session.usage, usage)

  // Update claim ledger
  session.claims = addClaims(session.claims, session.turn, adjudication.newClaims)

  // Record bluff if used
  if (adjudication.bluff) {
    session.bluffUsed = true
    session.bluffDetail = adjudication.bluff
  }

  // Score the turn
  const result = scoreTurn(adjudication, session, config)

  // Apply scoring results to session
  session.caseStrength = result.newCaseStrength
  session.suspicion = result.newSuspicion
  session.contradictionPenalty = result.newContradictionPenalty

  // Apply evidence mutations (weight changes, state transitions, revelations)
  for (const change of result.evidenceWeightChanges) {
    const ev = session.evidence.find((e) => e.id === change.evidenceId)
    if (ev) ev.weight = change.newWeight
  }
  for (const id of result.evidenceExplained) {
    const ev = session.evidence.find((e) => e.id === id)
    if (ev) ev.state = 'explained'
  }
  for (const id of result.evidenceRevealed) {
    const ev = session.evidence.find((e) => e.id === id)
    if (ev) ev.state = 'revealed'
  }

  // Check Suspicion extension (PRD §5.7: Suspicion >= 90 → +3 rounds)
  let justExtended = false
  if (
    !session.extended &&
    session.suspicion >= config.suspicionExtensionThreshold
  ) {
    session.maxTurns = config.baseTurns + config.extensionRounds
    session.extended = true
    justExtended = true
  }

  // Record history
  session.caseStrengthHistory.push(session.caseStrength)
  session.suspicionHistory.push(session.suspicion)

  // Check ending
  const ending = result.ending
  if (ending) {
    session.ending = ending
    session.endTurn = session.turn
  }

  // Record turn detail for post-game breakdown
  const detail: TurnDetail = {
    turn: session.turn,
    playerAnswer,
    adjudication,
    caseStrengthBefore: csBefore,
    caseStrengthAfter: session.caseStrength,
    suspicionBefore: susBefore,
    suspicionAfter: session.suspicion,
    evidenceRevealed: result.evidenceRevealed,
    evidenceWeightChanges: result.evidenceWeightChanges,
  }
  session.turnDetails.push(detail)

  return {
    detectiveResponse: adjudication.detectiveResponse,
    ending,
    evidenceRevealed: result.evidenceRevealed,
    justExtended,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function accumulateUsage(total: TokenUsage, turn: TokenUsage): void {
  total.inputTokens += turn.inputTokens
  total.outputTokens += turn.outputTokens
  total.cacheCreationTokens += turn.cacheCreationTokens
  total.cacheReadTokens += turn.cacheReadTokens
}
