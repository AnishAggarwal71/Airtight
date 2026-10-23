/**
 * All /api/game routes — session creation, interrogation, witness, verdict,
 * breakdown, and reconnect. Thin HTTP wrappers around the engine's own
 * orchestration layer (src/engine/session.ts) — no game logic lives here.
 */

import { Router, type Request } from 'express'
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
import {
  assertDailyCapacity,
  BUDGET_CONFIG,
  chargeForCompletedTurn,
  estimateCostUsd,
  reserveSpend,
  settleSpend,
  type SpendReservation,
} from '../budget'
import { rateLimit } from '../ratelimit'
import { asyncHandler, badRequest, conflict, notFoundSession, upstreamModelError } from '../errors'
import { resolveTimeouts, type TurnCallOptions, type TurnTimeouts } from '../../engine/timeouts'
import { withSessionLock } from '../lock'
import { getSession, createSessionId, putSession, saveSession, type StoredSession } from '../sessions'
import type { Store } from '../store'
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

/**
 * Settles the reservation of a turn whose persona call threw. The provider
 * may still have billed the request (e.g. a timeout after it was accepted),
 * so a small fixed charge is kept rather than refunding in full.
 */
async function settleFailedTurn(store: Store, reservation: SpendReservation): Promise<void> {
  await settleSpend(store, reservation, BUDGET_CONFIG.failedTurnChargeUsd)
}

export const gameRouter = Router()

/** The shared-state store injected by createApp() (see app.ts). */
function storeOf(req: Request): Store {
  return req.app.locals.store as Store
}

/**
 * Per-turn model-call limits: one request-wide deadline signal plus the
 * (possibly test-overridden) per-call caps. Created at the start of the turn
 * so the deadline covers the persona call AND the invigilator together.
 */
function turnCallOptions(req: Request): TurnCallOptions {
  const timeouts = req.app.locals.turnTimeouts as Partial<TurnTimeouts> | undefined
  return { abortSignal: AbortSignal.timeout(resolveTimeouts(timeouts).requestMs), timeouts }
}

/** Loads a session record from the store or throws a 404. The returned object is a private copy. */
async function requireSession(req: Request, sessionId: string): Promise<StoredSession> {
  const stored = await getSession(storeOf(req), sessionId)
  if (!stored) throw notFoundSession(sessionId)
  return stored
}

/**
 * Runs playInterrogationTurn and converts any failure into a clean 502.
 *
 * No manual rollback is needed (or wanted): the engine mutates the session
 * BEFORE its persona call (turn counter, phase, evidence.presented), but the
 * session here is a private copy loaded from the store for this request, and
 * the route saves it only after the turn succeeds. A thrown error therefore
 * discards every one of those mutations at once. The old field-by-field
 * restore covered only turn and phase and would have missed evidence.presented
 * and witnessUsed, which a player could use to burn evidence items for free.
 * A failed INVIGILATOR call does not throw: session.ts catches it and commits
 * a zero-delta turn.
 */
async function playInterrogationTurnSafely(
  session: GameSession,
  input: string,
  callOpts: TurnCallOptions,
): Promise<PlayInterrogationResult> {
  try {
    return await playInterrogationTurn(session, input, undefined, callOpts)
  } catch (err) {
    throw upstreamModelError(err)
  }
}

/** Same contract as playInterrogationTurnSafely (covers witnessTurn, witnessUsed and phase). */
async function playWitnessTurnSafely(
  session: GameSession,
  question: string,
  callOpts: TurnCallOptions,
): Promise<PlayWitnessResult> {
  try {
    return await playWitnessTurn(session, question, undefined, callOpts)
  } catch (err) {
    throw upstreamModelError(err)
  }
}

// ─── POST /api/game — create a session ─────────────────────────────────────

gameRouter.post(
  '/',
  rateLimit('create'),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>

    if (body.crime !== undefined && body.crime !== 'homicide') {
      throw badRequest('Only homicide is available in this version.')
    }

    // Once today's budget is spent, new games get a friendly "resting" 429
    // instead of a session whose first question would be refused anyway.
    await assertDailyCapacity(storeOf(req))

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
    await putSession(storeOf(req), sessionId, session, transcriptPath)

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
  rateLimit('read'),
  asyncHandler(async (req, res) => {
    const { session } = await requireSession(req, req.params.id)
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

/**
 * One suspect turn, run under the session lock (see the route below). Returns
 * the JSON payload rather than sending it, so the lock is released before the
 * client can see the response.
 */
async function runInterrogationTurn(req: Request, sessionId: string, input: string) {
    const callOpts = turnCallOptions(req)
    const stored = await requireSession(req, sessionId)
    const { session } = stored

    if (session.ending) {
      throw conflict('This case is already resolved; no further interrogation turns are accepted.')
    }
    if (session.interrogationTurn >= session.maxInterrogationTurns) {
      throw conflict('No interrogation turns remaining.')
    }
    // Reserve this turn's worst-case cost atomically BEFORE any paid call;
    // a 429 here means no turn counter moved and nothing was spent.
    const reservation = await reserveSpend(storeOf(req), sessionId)

    const transcriptPath = stored.transcriptPath || undefined
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
      result = await playInterrogationTurnSafely(session, input, callOpts)
    } catch (err) {
      await settleFailedTurn(storeOf(req), reservation)
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
    await settleSpend(
      storeOf(req),
      reservation,
      chargeForCompletedTurn(incrementalCostUsd(usageBefore, session.usage), result.invigilatorFailed),
    )
    // Persist only after the turn succeeded: a thrown persona call skips this,
    // so the stored session keeps the pre-turn counters and evidence flags.
    await saveSession(storeOf(req), sessionId, stored)

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

    return {
      ...toPublicInterrogationResult(result, input, presentedEvidenceDescriptions),
      caseStrength: session.caseStrength,
      interrogationTurn: session.interrogationTurn,
      maxInterrogationTurns: session.maxInterrogationTurns,
      witnessAvailable: isWitnessAvailable(session),
    }
}

// Request order: validate input -> lock -> load + phase/turn checks (409) ->
// reserve spend -> run -> settle + save -> release lock -> respond.
gameRouter.post(
  '/:id/interrogate',
  rateLimit('turn'),
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id
    const body = (req.body ?? {}) as Record<string, unknown>
    const input = validateQuestionInput(body.input, 'input')
    const payload = await withSessionLock(storeOf(req), sessionId, () => runInterrogationTurn(req, sessionId, input))
    res.json(payload)
  }),
)

// ─── POST /api/game/:id/witness ─────────────────────────────────────────────

/** One witness turn, run under the session lock; same contract as runInterrogationTurn. */
async function runWitnessTurn(req: Request, sessionId: string, question: string) {
    const callOpts = turnCallOptions(req)
    const stored = await requireSession(req, sessionId)
    const { session } = stored

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
    const reservation = await reserveSpend(storeOf(req), sessionId)

    const transcriptPath = stored.transcriptPath || undefined
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
      result = await playWitnessTurnSafely(session, question, callOpts)
    } catch (err) {
      await settleFailedTurn(storeOf(req), reservation)
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
    await settleSpend(
      storeOf(req),
      reservation,
      chargeForCompletedTurn(incrementalCostUsd(usageBefore, session.usage), result.invigilatorFailed),
    )
    await saveSession(storeOf(req), sessionId, stored)

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

    return {
      ...toPublicWitnessResult(result, question),
      caseStrength: session.caseStrength,
      witnessTurn: session.witnessTurn,
      maxWitnessTurns: session.maxWitnessTurns,
      witnessUsed: session.witnessUsed,
    }
}

gameRouter.post(
  '/:id/witness',
  rateLimit('turn'),
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id
    const body = (req.body ?? {}) as Record<string, unknown>
    const question = validateQuestionInput(body.question, 'question')
    const payload = await withSessionLock(storeOf(req), sessionId, () => runWitnessTurn(req, sessionId, question))
    res.json(payload)
  }),
)

// ─── GET /api/game/:id/breakdown ────────────────────────────────────────────

gameRouter.get(
  '/:id/breakdown',
  rateLimit('read'),
  asyncHandler(async (req, res) => {
    const { session } = await requireSession(req, req.params.id)
    if (!session.ending) {
      throw conflict('The breakdown is only available after the case is resolved.')
    }
    res.json(buildBreakdown(session))
  }),
)
