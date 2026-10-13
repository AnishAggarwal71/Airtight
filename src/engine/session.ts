/**
 * Session orchestration — wires the persona agent, invigilator, scoring
 * engine, and claim ledger into per-turn entry points.
 *
 * Two-call flow per turn:
 *   Call 1: Persona agent (suspect/witness) → dialogue + claims
 *   Call 2: Invigilator agent → structured signals for scoring
 *
 * play.ts calls createSession() once, then playInterrogationTurn() for each
 * of the 6 interrogation rounds, playWitnessTurn() for each witness question,
 * and resolveVerdict() at the end.
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
  locality?: string,
): GameSession {
  const caseFile = generate({ seed, crime, templateId, locality })

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
  invigilatorFailed: boolean
}

/**
 * Orchestrate one interrogation turn with two model calls:
 *   1. Persona agent → suspect dialogue + claims
 *   2. Invigilator agent → structured signals → scoring engine → delta
 *
 * If the invigilator fails after retries, the turn is zero-delta (dialogue
 * shown, claims in ledger, no score change).
 */
export async function playInterrogationTurn(
  session: GameSession,
  rawPlayerInput: string,
  config: ScoringConfig = SCORING_CONFIG,
): Promise<PlayInterrogationResult> {
  if (session.phase === 'briefing') session.phase = 'interrogation'

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

  const { response: suspectResponse, usage: suspectUsage } = await interrogateSuspect(suspectInput)
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

    const { response: evalResponse, usage: evalUsage } = await evaluateSuspectTurn(evalInput)
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

  const ending = checkEnding(session.caseStrength, config)
  if (ending) session.ending = ending

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
    invigilatorFailed,
  }
}

// ─── Play one witness turn ──────────────────────────────────────────────────

export type PlayWitnessResult = {
  witnessDialogue: string
  witnessDemeanor: string
  caseStrengthDelta: number
  ending: Ending | null
  invigilatorReasoning: string | null
  invigilatorFailed: boolean
}

/**
 * Orchestrate one witness turn with two model calls:
 *   1. Persona agent → witness dialogue + claims
 *   2. Invigilator agent → contradiction check → scoring
 */
export async function playWitnessTurn(
  session: GameSession,
  playerQuestion: string,
  config: ScoringConfig = SCORING_CONFIG,
): Promise<PlayWitnessResult> {
  if (session.phase === 'interrogation') session.phase = 'witness'

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

  const { response: witnessResponse, usage: witnessUsage } = await interrogateWitness(witnessInput)
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

    const { response: evalResponse, usage: evalUsage } = await evaluateWitnessTurn(evalInput)
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

  const ending = checkEnding(session.caseStrength, config)
  if (ending) session.ending = ending

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
    invigilatorFailed,
  }
}

// ─── Verdict ────────────────────────────────────────────────────────────────

export function resolveVerdict(
  session: GameSession,
  playerCharges: boolean,
): Ending {
  session.phase = 'verdict'

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
