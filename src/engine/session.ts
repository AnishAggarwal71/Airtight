/**
 * Session orchestration — wires the suspect actor, witness, scoring engine,
 * and claim ledger into per-turn entry points.
 *
 * play.ts calls createSession() once, then playInterrogationTurn() for each
 * of the 6 interrogation rounds, playWitnessTurn() for each witness question,
 * and resolveVerdict() at the end. This keeps the CLI thin and makes the same
 * loop reusable for the API route in M3.
 *
 * Three-phase flow: briefing → interrogation → witness → verdict.
 */

import { generate } from './generate'
import {
  interrogateSuspect,
  type InterrogateSuspectInput,
} from './adjudicate'
import {
  interrogateWitness,
  type InterrogateWitnessInput,
} from './witness'
import { addClaims } from './ledger'
import {
  scoreSuspectTurn,
  scoreWitnessTurn,
  checkEnding,
  SCORING_CONFIG,
  type ScoringConfig,
} from './score'
import type {
  CrimeType,
  DetectiveEvidence,
  Ending,
  GameSession,
  InterrogationDetail,
  SuspectResponse,
  TokenUsage,
  WitnessDetail,
} from './types'

// ─── Session creation ────────────────────────────────────────────────────────

/**
 * Initialise a new game session. Generates the case deterministically and
 * sets up all mutable state for the three-phase game flow.
 */
export function createSession(
  seed: string,
  crime: CrimeType,
  config: ScoringConfig = SCORING_CONFIG,
  templateId?: string,
): GameSession {
  const caseFile = generate({ seed, crime, templateId })

  return {
    seed,
    crime,
    phase: 'briefing',
    interrogationTurn: 0,
    maxInterrogationTurns: config.maxInterrogationTurns,
    witnessTurn: 0,
    maxWitnessTurns: config.maxWitnessTurns,
    caseFile,
    suspectClaims: [],
    witnessClaims: [],
    caseStrength: config.initialCaseStrength,
    caseStrengthHistory: [config.initialCaseStrength],
    ending: null,
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    interrogationDetails: [],
    witnessDetails: [],
  }
}

// ─── Evidence presentation parsing ──────────────────────────────────────────

/**
 * Parse a player input that may include an evidence presentation prefix.
 * Format: "PRESENT e3: What about this key card?"
 * Returns the evidence ID (if any) and the question text.
 */
export function parsePlayerInput(
  input: string,
  evidence: DetectiveEvidence[],
): { presentedEvidenceId: string | null; question: string } {
  const match = input.match(/^PRESENT\s+(e\d+)\s*:\s*(.+)$/i)
  if (match) {
    const evidenceId = match[1].toLowerCase()
    const question = match[2].trim()
    const ev = evidence.find((e) => e.id === evidenceId)
    if (ev && !ev.presented) {
      return { presentedEvidenceId: evidenceId, question }
    }
    // If evidence not found or already presented, treat as plain question
    // (the CLI will warn about this)
  }
  return { presentedEvidenceId: null, question: input.trim() }
}

// ─── Play one interrogation turn ────────────────────────────────────────────

export type PlayInterrogationResult = {
  suspectDialogue: string
  suspectDemeanor: SuspectResponse['demeanor']
  caseStrengthDelta: number
  ending: Ending | null
  presentedEvidenceId: string | null
}

/**
 * Orchestrate one interrogation turn. Mutates the session in place.
 *
 * 1. Advance turn counter, transition to interrogation phase
 * 2. Parse evidence presentation from player input
 * 3. Call suspect actor
 * 4. Update claim ledger
 * 5. Score the response
 * 6. Apply results to session state
 * 7. Check ending
 * 8. Record turn detail for breakdown
 */
export async function playInterrogationTurn(
  session: GameSession,
  rawPlayerInput: string,
  config: ScoringConfig = SCORING_CONFIG,
): Promise<PlayInterrogationResult> {
  // Transition phase on first interrogation turn
  if (session.phase === 'briefing') session.phase = 'interrogation'

  session.interrogationTurn++

  // Parse evidence presentation
  const { presentedEvidenceId, question } = parsePlayerInput(
    rawPlayerInput,
    session.caseFile.evidence,
  )

  // Mark evidence as presented if applicable
  let presentedEvidence: DetectiveEvidence | null = null
  if (presentedEvidenceId) {
    const ev = session.caseFile.evidence.find((e) => e.id === presentedEvidenceId)
    if (ev) {
      ev.presented = true
      presentedEvidence = ev
    }
  }

  // Determine previous demeanor for scoring (calm on first turn)
  const previousDemeanor: SuspectResponse['demeanor'] =
    session.interrogationDetails.length > 0
      ? session.interrogationDetails[session.interrogationDetails.length - 1].suspectResponse.demeanor
      : 'calm'

  const csBefore = session.caseStrength

  // Build suspect actor input
  const input: InterrogateSuspectInput = {
    caseFile: session.caseFile,
    turn: session.interrogationTurn,
    maxTurns: session.maxInterrogationTurns,
    playerQuestion: question,
    presentedEvidence,
    suspectClaims: session.suspectClaims,
  }

  // Call the model
  const { response, usage } = await interrogateSuspect(input)

  // Accumulate token usage
  accumulateUsage(session.usage, usage)

  // Update claim ledger with suspect's new claims
  session.suspectClaims = addClaims(
    session.suspectClaims,
    session.interrogationTurn,
    response.claims,
    'c',
  )

  // Score the turn
  const scoreResult = scoreSuspectTurn(
    response,
    session.caseStrength,
    previousDemeanor,
    config,
  )

  // Apply scoring
  session.caseStrength = scoreResult.newCaseStrength
  session.caseStrengthHistory.push(session.caseStrength)

  // Check ending (CHARGED_STRONG can trigger mid-interrogation)
  const ending = checkEnding(session.caseStrength, config)
  if (ending) {
    session.ending = ending
  }

  // Record turn detail for post-game breakdown
  const detail: InterrogationDetail = {
    turn: session.interrogationTurn,
    playerQuestion: question,
    presentedEvidenceId,
    suspectResponse: response,
    caseStrengthBefore: csBefore,
    caseStrengthAfter: session.caseStrength,
  }
  session.interrogationDetails.push(detail)

  return {
    suspectDialogue: response.dialogue,
    suspectDemeanor: response.demeanor,
    caseStrengthDelta: scoreResult.delta,
    ending,
    presentedEvidenceId,
  }
}

// ─── Play one witness turn ──────────────────────────────────────────────────

export type PlayWitnessResult = {
  witnessDialogue: string
  witnessDemeanor: string
  caseStrengthDelta: number
  ending: Ending | null
}

/**
 * Orchestrate one witness interrogation turn. Mutates the session in place.
 */
export async function playWitnessTurn(
  session: GameSession,
  playerQuestion: string,
  config: ScoringConfig = SCORING_CONFIG,
): Promise<PlayWitnessResult> {
  // Transition phase on first witness turn
  if (session.phase === 'interrogation') session.phase = 'witness'

  session.witnessTurn++

  const csBefore = session.caseStrength

  // Build witness input
  const input: InterrogateWitnessInput = {
    caseFile: session.caseFile,
    turn: session.witnessTurn,
    maxTurns: session.maxWitnessTurns,
    playerQuestion,
    suspectClaims: session.suspectClaims,
    witnessClaims: session.witnessClaims,
  }

  // Call the model
  const { response, usage } = await interrogateWitness(input)

  // Accumulate token usage
  accumulateUsage(session.usage, usage)

  // Update witness claim ledger
  session.witnessClaims = addClaims(
    session.witnessClaims,
    session.witnessTurn,
    response.claims,
    'wc',
  )

  // Score the turn
  const scoreResult = scoreWitnessTurn(response, session.caseStrength, config)

  // Apply scoring
  session.caseStrength = scoreResult.newCaseStrength
  session.caseStrengthHistory.push(session.caseStrength)

  // Check ending
  const ending = checkEnding(session.caseStrength, config)
  if (ending) {
    session.ending = ending
  }

  // Record turn detail
  const detail: WitnessDetail = {
    turn: session.witnessTurn,
    playerQuestion,
    witnessResponse: response,
    caseStrengthBefore: csBefore,
    caseStrengthAfter: session.caseStrength,
  }
  session.witnessDetails.push(detail)

  return {
    witnessDialogue: response.dialogue,
    witnessDemeanor: response.demeanor,
    caseStrengthDelta: scoreResult.delta,
    ending,
  }
}

// ─── Verdict ────────────────────────────────────────────────────────────────

/**
 * Resolve the verdict phase. Called after all interrogation + witness turns
 * if the case hasn't already ended with CHARGED_STRONG.
 *
 * If case strength < 80, the player must gamble: charge (CHARGED_WEAK — they
 * guessed correctly since the suspect is always guilty in Phase 1) or release
 * (RELEASED — the guilty suspect walks free).
 */
export function resolveVerdict(
  session: GameSession,
  playerCharges: boolean,
): Ending {
  session.phase = 'verdict'

  // Already ended during interrogation/witness (CHARGED_STRONG)
  if (session.ending) return session.ending

  const ending: Ending = playerCharges ? 'CHARGED_WEAK' : 'RELEASED'
  session.ending = ending
  return ending
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function accumulateUsage(total: TokenUsage, turn: TokenUsage): void {
  total.inputTokens += turn.inputTokens
  total.outputTokens += turn.outputTokens
  total.cacheCreationTokens += turn.cacheCreationTokens
  total.cacheReadTokens += turn.cacheReadTokens
}
