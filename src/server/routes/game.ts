/**
 * All /api/game routes — session creation, interrogation, witness, verdict,
 * breakdown, and reconnect. Thin HTTP wrappers around the engine's own
 * orchestration layer (src/engine/session.ts) — no game logic lives here.
 */

import { Router } from 'express'
import { toPublicCase } from '../../engine/generate'
import { randomSeed } from '../../engine/rng'
import {
  createSession,
  playInterrogationTurn,
  playWitnessTurn,
  resolveVerdict,
} from '../../engine/session'
import type { PlayInterrogationResult, PlayWitnessResult } from '../../engine/session'
import type { GameSession } from '../../engine/types'
import { buildBreakdown, buildTranscript } from '../breakdown'
import { asyncHandler, badRequest, conflict, notFoundSession, upstreamModelError } from '../errors'
import { getSession, createSessionId, putSession } from '../sessions'
import { validateLocality, validateQuestionInput } from '../validation'

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

    const locality = validateLocality(body.locality)

    const seed =
      typeof body.seed === 'string' && body.seed.trim().length > 0
        ? body.seed.trim()
        : randomSeed()

    const templateId = typeof body.templateId === 'string' ? body.templateId : undefined

    let session: GameSession
    try {
      session = createSession(seed, 'homicide', undefined, templateId, locality)
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : String(err))
    }

    const sessionId = createSessionId()
    putSession(sessionId, session)

    res.status(201).json({
      sessionId,
      publicCase: toPublicCase(session.caseFile),
      caseStrength: session.caseStrength,
      maxInterrogationTurns: session.maxInterrogationTurns,
      maxWitnessTurns: session.maxWitnessTurns,
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
      ending: session.ending,
      transcript: buildTranscript(session),
    })
  }),
)

// ─── POST /api/game/:id/interrogate ─────────────────────────────────────────

gameRouter.post(
  '/:id/interrogate',
  asyncHandler(async (req, res) => {
    const session = requireSession(req.params.id)
    const body = (req.body ?? {}) as Record<string, unknown>
    const input = validateQuestionInput(body.input, 'input')

    if (session.ending || session.phase === 'verdict') {
      throw conflict('This case is already resolved; no further interrogation turns are accepted.')
    }
    if (session.interrogationTurn >= session.maxInterrogationTurns) {
      throw conflict('No interrogation turns remaining.')
    }

    const result = await playInterrogationTurnSafely(session, input)

    res.json({
      ...result,
      caseStrength: session.caseStrength,
      interrogationTurn: session.interrogationTurn,
      maxInterrogationTurns: session.maxInterrogationTurns,
    })
  }),
)

// ─── POST /api/game/:id/witness ─────────────────────────────────────────────

gameRouter.post(
  '/:id/witness',
  asyncHandler(async (req, res) => {
    const session = requireSession(req.params.id)
    const body = (req.body ?? {}) as Record<string, unknown>
    const question = validateQuestionInput(body.question, 'question')

    if (session.ending) {
      throw conflict('This case is already resolved; no further witness turns are accepted.')
    }
    if (session.interrogationTurn < session.maxInterrogationTurns) {
      throw conflict('Finish the interrogation before questioning the witness.')
    }
    if (session.witnessTurn >= session.maxWitnessTurns) {
      throw conflict('No witness turns remaining.')
    }

    const result = await playWitnessTurnSafely(session, question)

    res.json({
      ...result,
      caseStrength: session.caseStrength,
      witnessTurn: session.witnessTurn,
      maxWitnessTurns: session.maxWitnessTurns,
    })
  }),
)

// ─── POST /api/game/:id/verdict ─────────────────────────────────────────────

gameRouter.post(
  '/:id/verdict',
  asyncHandler(async (req, res) => {
    const session = requireSession(req.params.id)
    const body = (req.body ?? {}) as Record<string, unknown>

    if (typeof body.charges !== 'boolean') {
      throw badRequest('"charges" must be a boolean.')
    }

    const interrogationDone = session.interrogationTurn >= session.maxInterrogationTurns
    const witnessDone = session.witnessTurn >= session.maxWitnessTurns
    if (!session.ending && !(interrogationDone && witnessDone)) {
      throw conflict("The interrogation/witness phase isn't finished yet.")
    }

    const ending = resolveVerdict(session, body.charges)

    res.json({ ending, caseStrength: session.caseStrength })
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
