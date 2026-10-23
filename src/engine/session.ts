/**
 * Session orchestration — wires the persona agent, invigilator, scoring
 * engine, and claim ledger into per-turn entry points.
 *
 * Two-call flow per turn:
 *   Call 1: Persona agent (suspect/witness) → dialogue + claims
 *   Call 2: Invigilator agent → structured signals for scoring
 *
 * play.ts calls createSession() once, then playInterrogationTurn() for each
 * of the 6 interrogation rounds and playWitnessTurn() for the witness's two
 * questions, callable exactly once, mid-game, once Case Strength exceeds
 * SCORING_CONFIG.witnessUnlockThreshold. There is no separate verdict step —
 * checkEnding() resolves CHARGED_STRONG/CHARGED_WEAK/RELEASED from Case
 * Strength and turn exhaustion alone; the suspect's guilt is a given, not a
 * player choice. See docs/decisions.md (2026-10-15, ending reframe).
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
import {
  evaluateSuspectTurn,
  evaluateWitnessTurn,
  type EvaluateSuspectInput,
  type EvaluateWitnessInput,
} from './invigilator'
import { addClaims } from './ledger'
import type { TurnCallOptions } from './timeouts'
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
  InvigilatorSuspectResponse,
  InvigilatorWitnessResponse,
  InterrogationDetail,
  SuspectResponse,
  TokenUsage,
  WitnessDetail,
} from './types'

// ─── Session creation ────────────────────────────────────────────────────────

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
    witnessUsed: false,
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

export function parsePlayerInput(
  input: string,
  evidence: DetectiveEvidence[],
): { presentedEvidenceIds: string[]; rejectedEvidenceIds: string[]; question: string } {
  const match = input.match(/^PRESENT\s+(e\d+(?:\s*,\s*e\d+)*)\s*:\s*(.+)$/i)
  if (match) {
    const requestedIds = [...new Set(match[1].split(',').map((id) => id.trim().toLowerCase()))]
    const question = match[2].trim()
    const presentedEvidenceIds: string[] = []
    const rejectedEvidenceIds: string[] = []
    for (const evidenceId of requestedIds) {
      const item = evidence.find((e) => e.id === evidenceId)
      if (item && !item.presented) {
        presentedEvidenceIds.push(evidenceId)
      } else {
        rejectedEvidenceIds.push(evidenceId)
      }
    }
    return { presentedEvidenceIds, rejectedEvidenceIds, question }
  }
  return { presentedEvidenceIds: [], rejectedEvidenceIds: [], question: input.trim() }
}

// ─── Play one interrogation turn ────────────────────────────────────────────

export type PlayInterrogationResult = {
  suspectDialogue: string
  suspectDemeanor: SuspectResponse['demeanor']
  caseStrengthDelta: number
  ending: Ending | null
  presentedEvidenceIds: string[]
  rejectedEvidenceIds: string[]
  invigilatorReasoning: string | null
  invigilatorSignals: InvigilatorSuspectResponse['signals'] | null
  invigilatorFailed: boolean
}

/**
 * Orchestrate one interrogation turn with two model calls:
 *   1. Persona agent → suspect dialogue + claims
 *   2. Invigilator agent → structured signals → scoring engine → delta
 *
 * If the invigilator fails after retries, the turn is zero-delta (dialogue
 * shown, claims in ledger, no score change).
 *
 * `callOpts` (optional) carries the request deadline signal and timeout
 * overrides down to the model calls (see timeouts.ts). A persona timeout throws
 * like any persona failure; an invigilator timeout is the zero-delta path.
 */
export async function playInterrogationTurn(
  session: GameSession,
  rawPlayerInput: string,
  config: ScoringConfig = SCORING_CONFIG,
  callOpts: TurnCallOptions = {},
): Promise<PlayInterrogationResult> {
  // Suspect questioning can resume after a mid-game witness interruption, so
  // only 'verdict' (ending resolved) is left alone — any other phase reverts
  // to 'interrogation' while the suspect is actively being questioned.
  if (session.phase !== 'verdict') session.phase = 'interrogation'

  session.interrogationTurn++

  const { presentedEvidenceIds, rejectedEvidenceIds, question } = parsePlayerInput(
    rawPlayerInput,
    session.caseFile.evidence,
  )

  const presentedEvidence = session.caseFile.evidence.filter((e) =>
    presentedEvidenceIds.includes(e.id),
  )
  for (const evidence of presentedEvidence) evidence.presented = true

  const csBefore = session.caseStrength

  // ── Call 1: Persona agent (suspect) ─────────────────────────────────────
  const suspectInput: InterrogateSuspectInput = {
    caseFile: session.caseFile,
    turn: session.interrogationTurn,
    maxTurns: session.maxInterrogationTurns,
    playerQuestion: question,
    presentedEvidence,
    suspectClaims: session.suspectClaims,
  }

  const { response: suspectResponse, usage: suspectUsage } = await interrogateSuspect(suspectInput, callOpts)
  accumulateUsage(session.usage, suspectUsage)

  // Update claim ledger with suspect's new claims
  session.suspectClaims = addClaims(
    session.suspectClaims,
    session.interrogationTurn,
    suspectResponse.claims,
    'c',
  )

  // ── Call 2: Invigilator agent ───────────────────────────────────────────
  let invigilatorResponse: InvigilatorSuspectResponse | null = null
  let invigilatorFailed = false

  try {
    const previousDemeanor = session.interrogationDetails.length > 0
      ? session.interrogationDetails[session.interrogationDetails.length - 1].suspectResponse.demeanor
      : null

    const evalInput: EvaluateSuspectInput = {
      caseFile: session.caseFile,
      turn: session.interrogationTurn,
      maxTurns: session.maxInterrogationTurns,
      playerQuestion: question,
      suspectDialogue: suspectResponse.dialogue,
      presentedEvidence,
      suspectClaims: session.suspectClaims,
      previousDemeanor,
    }

    const { response: evalResponse, usage: evalUsage } = await evaluateSuspectTurn(evalInput, callOpts)
    accumulateUsage(session.usage, evalUsage)
    invigilatorResponse = evalResponse
  } catch {
    invigilatorFailed = true
  }

  // ── Scoring ─────────────────────────────────────────────────────────────
  let delta = 0
  if (invigilatorResponse) {
    const scoreResult = scoreSuspectTurn(
      invigilatorResponse,
      session.caseStrength,
      session.suspectClaims,
      config,
    )
    delta = scoreResult.delta
    session.caseStrength = scoreResult.newCaseStrength
  }
  session.caseStrengthHistory.push(session.caseStrength)

  const ending = checkEnding(
    session.caseStrength,
    {
      interrogationTurn: session.interrogationTurn,
      maxInterrogationTurns: session.maxInterrogationTurns,
      witnessUsed: session.witnessUsed,
      witnessTurn: session.witnessTurn,
      maxWitnessTurns: session.maxWitnessTurns,
    },
    config,
  )
  if (ending) {
    session.ending = ending
    session.phase = 'verdict'
  }

  // Record turn detail
  const detail: InterrogationDetail = {
    turn: session.interrogationTurn,
    playerQuestion: question,
    presentedEvidenceIds,
    suspectResponse,
    invigilatorResponse,
    caseStrengthBefore: csBefore,
    caseStrengthAfter: session.caseStrength,
  }
  session.interrogationDetails.push(detail)

  return {
    suspectDialogue: suspectResponse.dialogue,
    suspectDemeanor: suspectResponse.demeanor,
    caseStrengthDelta: delta,
    ending,
    presentedEvidenceIds,
    rejectedEvidenceIds,
    invigilatorReasoning: invigilatorResponse?.reasoning ?? null,
    invigilatorSignals: invigilatorResponse?.signals ?? null,
    invigilatorFailed,
  }
}

// ─── Witness availability ───────────────────────────────────────────────────

/**
 * The witness is callable exactly once, mid-game: never before Case Strength
 * exceeds config.witnessUnlockThreshold, and never again once that one
 * session has been opened and exhausted. While the session is open (one
 * question asked, one remaining) this stays true so the second question can
 * still be asked even if Case Strength has since dropped back at/below the
 * unlock threshold — the gate applies only to *opening* the session.
 */
export function isWitnessAvailable(
  session: GameSession,
  config: ScoringConfig = SCORING_CONFIG,
): boolean {
  if (session.witnessTurn >= session.maxWitnessTurns) return false
  if (session.witnessUsed) return true
  return session.caseStrength > config.witnessUnlockThreshold
}

// ─── Play one witness turn ──────────────────────────────────────────────────

export type PlayWitnessResult = {
  witnessDialogue: string
  witnessDemeanor: string
  caseStrengthDelta: number
  ending: Ending | null
  invigilatorReasoning: string | null
  invigilatorSignals: InvigilatorWitnessResponse['signals'] | null
  invigilatorFailed: boolean
}

/**
 * Orchestrate one witness turn with two model calls:
 *   1. Persona agent → witness dialogue + claims
 *   2. Invigilator agent → contradiction check → scoring
 *
 * Callers (CLI, server routes) are responsible for checking
 * isWitnessAvailable() before invoking this — same pattern as
 * playInterrogationTurn, which trusts callers to respect the turn budget.
 */
export async function playWitnessTurn(
  session: GameSession,
  playerQuestion: string,
  config: ScoringConfig = SCORING_CONFIG,
  callOpts: TurnCallOptions = {},
): Promise<PlayWitnessResult> {
  if (session.witnessTurn === 0) session.witnessUsed = true
  session.phase = 'witness'

  session.witnessTurn++

  const csBefore = session.caseStrength

  // ── Call 1: Persona agent (witness) ─────────────────────────────────────
  const witnessInput: InterrogateWitnessInput = {
    caseFile: session.caseFile,
    turn: session.witnessTurn,
    maxTurns: session.maxWitnessTurns,
    playerQuestion,
    suspectClaims: session.suspectClaims,
    witnessClaims: session.witnessClaims,
  }

  const { response: witnessResponse, usage: witnessUsage } = await interrogateWitness(witnessInput, callOpts)
  accumulateUsage(session.usage, witnessUsage)

  // Update witness claim ledger
  session.witnessClaims = addClaims(
    session.witnessClaims,
    session.witnessTurn,
    witnessResponse.claims,
    'wc',
  )

  // ── Call 2: Invigilator agent ───────────────────────────────────────────
  let invigilatorResponse: InvigilatorWitnessResponse | null = null
  let invigilatorFailed = false

  try {
    const evalInput: EvaluateWitnessInput = {
      caseFile: session.caseFile,
      turn: session.witnessTurn,
      maxTurns: session.maxWitnessTurns,
      playerQuestion,
      witnessDialogue: witnessResponse.dialogue,
      suspectClaims: session.suspectClaims,
      witnessClaims: session.witnessClaims,
    }

    const { response: evalResponse, usage: evalUsage } = await evaluateWitnessTurn(evalInput, callOpts)
    accumulateUsage(session.usage, evalUsage)
    invigilatorResponse = evalResponse
  } catch {
    invigilatorFailed = true
  }

  // ── Scoring ─────────────────────────────────────────────────────────────
  let delta = 0
  if (invigilatorResponse) {
    const scoreResult = scoreWitnessTurn(
      invigilatorResponse,
      session.caseStrength,
      session.suspectClaims,
      config,
    )
    delta = scoreResult.delta
    session.caseStrength = scoreResult.newCaseStrength
  }
  session.caseStrengthHistory.push(session.caseStrength)

  const ending = checkEnding(
    session.caseStrength,
    {
      interrogationTurn: session.interrogationTurn,
      maxInterrogationTurns: session.maxInterrogationTurns,
      witnessUsed: session.witnessUsed,
      witnessTurn: session.witnessTurn,
      maxWitnessTurns: session.maxWitnessTurns,
    },
    config,
  )
  if (ending) {
    session.ending = ending
    session.phase = 'verdict'
  }

  // Record turn detail
  const detail: WitnessDetail = {
    turn: session.witnessTurn,
    playerQuestion,
    witnessResponse,
    invigilatorResponse,
    caseStrengthBefore: csBefore,
    caseStrengthAfter: session.caseStrength,
  }
  session.witnessDetails.push(detail)

  return {
    witnessDialogue: witnessResponse.dialogue,
    witnessDemeanor: witnessResponse.demeanor,
    caseStrengthDelta: delta,
    ending,
    invigilatorReasoning: invigilatorResponse?.reasoning ?? null,
    invigilatorSignals: invigilatorResponse?.signals ?? null,
    invigilatorFailed,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function accumulateUsage(total: TokenUsage, turn: TokenUsage): void {
  total.inputTokens += turn.inputTokens
  total.outputTokens += turn.outputTokens
  total.cacheCreationTokens += turn.cacheCreationTokens
  total.cacheReadTokens += turn.cacheReadTokens
}
