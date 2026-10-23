/**
 * All /api/game routes — session creation, interrogation, witness, verdict,
 * breakdown, and reconnect. Thin HTTP wrappers around the engine's own
 * orchestration layer (src/engine/session.ts) — no game logic lives here.
 */

import { Router } from 'express'
import { toPublicCase } from '../../engine/generate'
import {
  createSession,
  parsePlayerInput,
  playInterrogationTurn,
  playWitnessTurn,
  isWitnessAvailable,
} from '../../engine/session'
import type { PlayInterrogationResult, PlayWitnessResult } from '../../engine/session'
import type { GameSession, TokenUsage } from '../../engine/types'
import { buildBreakdown, buildTranscript } from '../breakdown'
import { checkBudget, estimateCostUsd, recordSpend } from '../budget'
import { asyncHandler, badRequest, conflict, notFoundSession, upstreamModelError } from '../errors'
import { getSession, getTranscriptPath, createSessionId, putSession } from '../sessions'
import { chooseSeed } from '../seed'
import {
  appendTranscriptExchange,
  appendTranscriptSessionEnd,
  appendTranscriptTurnFailed,
  appendTranscriptTurnStarted,
  createTranscriptLog,
} from '../../cli/transcript'
import { validateQuestionInput } from '../validation'
import {
  deriveSuspectVerdictType,
  deriveWitnessVerdictType,
  deriveVerdictReason,
  type Verdict,
} from '../verdict'

/**
 * Builds the client-safe turn result: everything from the engine's result
 * except the raw invigilator fields (`invigilatorSignals`/`invigilatorReasoning`),
 * which carry claim IDs and free-text written by a model with full hidden-case
 * context. `verdict` is derived from signals instead — see src/server/verdict.ts.
 */
function toPublicInterrogationResult(
  result: PlayInterrogationResult,
  question: string,
  presentedEvidenceDescriptions: string[],
) {
  const { invigilatorSignals, invigilatorReasoning, ...rest } = result
  const type = invigilatorSignals ? deriveSuspectVerdictType(invigilatorSignals) : 'no_change'
  const verdict: Verdict = {
    type,
    reason: deriveVerdictReason(type, { question, presentedEvidenceDescriptions }),
  }
  return { ...rest, verdict }
}

function toPublicWitnessResult(result: PlayWitnessResult, question: string) {
  const { invigilatorSignals, invigilatorReasoning, ...rest } = result
  const type = invigilatorSignals ? deriveWitnessVerdictType(invigilatorSignals) : 'no_change'
  const verdict: Verdict = {
    type,
    reason: deriveVerdictReason(type, { question, presentedEvidenceDescriptions: [] }),
  }
  return { ...rest, verdict }
}

/** Shallow-copies a TokenUsage snapshot so a before/after diff can be taken after a model call. */
function snapshotUsage(usage: TokenUsage): TokenUsage {
  return { ...usage }
}

/** Incremental cost of a model call, from a before/after TokenUsage snapshot. */
function incrementalCostUsd(before: TokenUsage, after: TokenUsage): number {
  return estimateCostUsd({
    inputTokens: after.inputTokens - before.inputTokens,
    outputTokens: after.outputTokens - before.outputTokens,
    cacheCreationTokens: after.cacheCreationTokens - before.cacheCreationTokens,
    cacheReadTokens: after.cacheReadTokens - before.cacheReadTokens,
  })
}

export const gameRouter = Router()

function requireSession(sessionId: string): GameSession {
  const session = getSession(sessionId)
  if (!session) throw notFoundSession(sessionId)
  return session
}

/**
 * Runs playInterrogationTurn with a rollback guard: session.ts increments
 * interrogationTurn and sets phase BEFORE awaiting the (non-retrying)
 * persona call, so a thrown error would otherwise leave the turn counter
 * one ahead of interrogationDetails.length. Nothing else mutates before
 * that call resolves, so restoring these two fields is sufficient to let
 * the player retry the exact same turn without losing it.
 */
async function playInterrogationTurnSafely(
  session: GameSession,
  input: string,
): Promise<PlayInterrogationResult> {
  const turnBefore = session.interrogationTurn
  const phaseBefore = session.phase
  try {
    return await playInterrogationTurn(session, input)
  } catch (err) {
    session.interrogationTurn = turnBefore
    session.phase = phaseBefore
    throw upstreamModelError(err)
  }
}

/** Same rollback guard as playInterrogationTurnSafely, scoped to the witness turn counter. */
async function playWitnessTurnSafely(
  session: GameSession,
  question: string,
): Promise<PlayWitnessResult> {
  const turnBefore = session.witnessTurn
  const phaseBefore = session.phase
  try {
    return await playWitnessTurn(session, question)
  } catch (err) {
    session.witnessTurn = turnBefore
    session.phase = phaseBefore
    throw upstreamModelError(err)
  }
}

// ─── POST /api/game — create a session ─────────────────────────────────────

gameRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>

    if (body.crime !== undefined && body.crime !== 'homicide') {
      throw badRequest('Only homicide is available in this version.')
    }

    // Seed policy lives in seed.ts: the server picks the seed, and client
    // seed/templateId are ignored unless ALLOW_CLIENT_SEED=1 (never in prod).
    const { seed, templateId } = chooseSeed(body)

    let session: GameSession
    try {
      session = createSession(seed, 'homicide', undefined, templateId)
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : String(err))
    }

    const sessionId = createSessionId()
    const transcriptPath = await createTranscriptLog(seed, 'homicide', sessionId)
    putSession(sessionId, session, transcriptPath)

    // Server-side only: the one place the derived seed is recorded, so a
    // case can be replayed with `npm run case <seed> homicide`. It must never
    // be added to the response below.
    console.log(
      JSON.stringify({
        evt: 'session_created',
        sid: sessionId,
        seed,
        templateId: session.caseFile.templateId,
      }),
    )

    res.status(201).json({
      sessionId,
      publicCase: toPublicCase(session.caseFile),
      caseStrength: session.caseStrength,
      maxInterrogationTurns: session.maxInterrogationTurns,
      maxWitnessTurns: session.maxWitnessTurns,
      witnessAvailable: isWitnessAvailable(session),
      witnessUsed: session.witnessUsed,
    })
  }),
)

// ─── GET /api/game/:id — reconnect / rehydrate ──────────────────────────────

gameRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const session = requireSession(req.params.id)
    res.json({
      publicCase: toPublicCase(session.caseFile),
      phase: session.phase,
      caseStrength: session.caseStrength,
      interrogationTurn: session.interrogationTurn,
      maxInterrogationTurns: session.maxInterrogationTurns,
      witnessTurn: session.witnessTurn,
      maxWitnessTurns: session.maxWitnessTurns,
      witnessAvailable: isWitnessAvailable(session),
      witnessUsed: session.witnessUsed,
      ending: session.ending,
      transcript: buildTranscript(session),
    })
  }),
)

// ─── POST /api/game/:id/interrogate ─────────────────────────────────────────

gameRouter.post(
  '/:id/interrogate',
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id
    const session = requireSession(sessionId)
    const body = (req.body ?? {}) as Record<string, unknown>
    const input = validateQuestionInput(body.input, 'input')

    if (session.ending) {
      throw conflict('This case is already resolved; no further interrogation turns are accepted.')
    }
    if (session.interrogationTurn >= session.maxInterrogationTurns) {
      throw conflict('No interrogation turns remaining.')
    }
    checkBudget(session)

    const transcriptPath = getTranscriptPath(sessionId)
    const turn = session.interrogationTurn + 1
    const parsedInput = parsePlayerInput(input, session.caseFile.evidence)
    if (transcriptPath) {
      await appendTranscriptTurnStarted(transcriptPath, {
        type: 'turn_started',
        phase: 'interrogation',
        turn,
        detectiveInput: input,
        detectiveMessage: parsedInput.question,
        aiRole: 'suspect',
        ...(parsedInput.presentedEvidenceIds.length > 0
          ? { presentedEvidenceIds: parsedInput.presentedEvidenceIds }
          : {}),
        ...(parsedInput.rejectedEvidenceIds.length > 0
          ? { rejectedEvidenceIds: parsedInput.rejectedEvidenceIds }
          : {}),
      })
    }

    const usageBefore = snapshotUsage(session.usage)
    let result: PlayInterrogationResult
    try {
      result = await playInterrogationTurnSafely(session, input)
    } catch (err) {
      if (transcriptPath) {
        const error = err instanceof Error ? err : new Error(String(err))
        await appendTranscriptTurnFailed(
          transcriptPath,
          {
            type: 'turn_failed',
            phase: 'interrogation',
            turn,
            aiRole: 'suspect',
            error: { name: error.name, message: error.message },
          },
          [process.env.ANTHROPIC_API_KEY ?? ''],
        )
      }
      throw err
    }
    recordSpend(incrementalCostUsd(usageBefore, session.usage))

    if (transcriptPath) {
      await appendTranscriptExchange(transcriptPath, {
        type: 'exchange',
        phase: 'interrogation',
        turn: session.interrogationTurn,
        detectiveMessage: input,
        aiRole: 'suspect',
        aiMessage: result.suspectDialogue,
        ...(result.presentedEvidenceIds.length > 0
          ? { presentedEvidenceIds: result.presentedEvidenceIds }
          : {}),
        invigilatorSignals: result.invigilatorSignals,
        caseStrengthDelta: result.caseStrengthDelta,
        caseStrengthAfter: session.caseStrength,
      })
      if (result.ending) {
        await appendTranscriptSessionEnd(transcriptPath, {
          type: 'session_end',
          finalCaseStrength: session.caseStrength,
          ending: result.ending,
        })
      }
    }

    const presentedEvidenceDescriptions = session.caseFile.evidence
      .filter((e) => result.presentedEvidenceIds.includes(e.id))
      .map((e) => e.claim)

    res.json({
      ...toPublicInterrogationResult(result, input, presentedEvidenceDescriptions),
      caseStrength: session.caseStrength,
      interrogationTurn: session.interrogationTurn,
      maxInterrogationTurns: session.maxInterrogationTurns,
      witnessAvailable: isWitnessAvailable(session),
    })
  }),
)

// ─── POST /api/game/:id/witness ─────────────────────────────────────────────

gameRouter.post(
  '/:id/witness',
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id
    const session = requireSession(sessionId)
    const body = (req.body ?? {}) as Record<string, unknown>
    const question = validateQuestionInput(body.question, 'question')

    if (session.ending) {
      throw conflict('This case is already resolved; no further witness turns are accepted.')
    }
    if (!isWitnessAvailable(session)) {
      throw conflict(
        session.witnessUsed
          ? 'The witness has already been questioned; that one-time session is closed.'
          : 'The witness is not available yet — Case Strength has not cleared the unlock threshold.',
      )
    }
    checkBudget(session)

    const transcriptPath = getTranscriptPath(sessionId)
    const turn = session.witnessTurn + 1
    if (transcriptPath) {
      await appendTranscriptTurnStarted(transcriptPath, {
        type: 'turn_started',
        phase: 'witness',
        turn,
        detectiveInput: question,
        detectiveMessage: question,
        aiRole: 'witness',
      })
    }

    const usageBefore = snapshotUsage(session.usage)
    let result: PlayWitnessResult
    try {
      result = await playWitnessTurnSafely(session, question)
    } catch (err) {
      if (transcriptPath) {
        const error = err instanceof Error ? err : new Error(String(err))
        await appendTranscriptTurnFailed(
          transcriptPath,
          {
            type: 'turn_failed',
            phase: 'witness',
            turn,
            aiRole: 'witness',
            error: { name: error.name, message: error.message },
          },
          [process.env.ANTHROPIC_API_KEY ?? ''],
        )
      }
      throw err
    }
    recordSpend(incrementalCostUsd(usageBefore, session.usage))

    if (transcriptPath) {
      await appendTranscriptExchange(transcriptPath, {
        type: 'exchange',
        phase: 'witness',
        turn: session.witnessTurn,
        detectiveMessage: question,
        aiRole: 'witness',
        aiMessage: result.witnessDialogue,
        invigilatorSignals: result.invigilatorSignals,
        caseStrengthDelta: result.caseStrengthDelta,
        caseStrengthAfter: session.caseStrength,
      })
      if (result.ending) {
        await appendTranscriptSessionEnd(transcriptPath, {
          type: 'session_end',
          finalCaseStrength: session.caseStrength,
          ending: result.ending,
        })
      }
    }

    res.json({
      ...toPublicWitnessResult(result, question),
      caseStrength: session.caseStrength,
      witnessTurn: session.witnessTurn,
      maxWitnessTurns: session.maxWitnessTurns,
      witnessUsed: session.witnessUsed,
    })
  }),
)

// ─── GET /api/game/:id/breakdown ────────────────────────────────────────────

gameRouter.get(
  '/:id/breakdown',
  asyncHandler(async (req, res) => {
    const session = requireSession(req.params.id)
    if (!session.ending) {
      throw conflict('The breakdown is only available after the case is resolved.')
    }
    res.json(buildBreakdown(session))
  }),
)
