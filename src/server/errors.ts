/**
 * API error handling — a typed ApiError thrown from route handlers, caught
 * by app.ts's centralised error middleware, turned into a clean
 * { error: { code, message } } JSON body instead of a raw stack trace.
 */

import type { NextFunction, Request, Response } from 'express'
import { isAbortError } from '../engine/timeouts'

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.status = status
    this.code = code
  }
}

export function notFoundSession(sessionId: string): ApiError {
  return new ApiError(
    404,
    'SESSION_NOT_FOUND',
    `No session found for id "${sessionId}". It may have expired.`,
  )
}

/** Shared-state backend (Redis) failed. Generic on purpose — the cause is logged, never sent. */
export function storeUnavailable(): ApiError {
  return new ApiError(503, 'STORE_UNAVAILABLE', 'The game service is temporarily unavailable. Please try again in a moment.')
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, 'BAD_REQUEST', message)
}

export function conflict(message: string): ApiError {
  return new ApiError(409, 'CONFLICT', message)
}

export function budgetExceeded(message: string): ApiError {
  return new ApiError(429, 'BUDGET_EXCEEDED', message)
}

/**
 * Wraps a persona-agent model failure (interrogateSuspect/interrogateWitness)
 * as a clean upstream error. The provider's message is NEVER sent to the
 * player: it can carry request details, account/billing info or key fragments.
 * The route logs the real cause server-side (see `turn_failed` in
 * routes/game.ts); the player gets one fixed friendly sentence. The original
 * error rides along as `cause` (never serialised) so the route can log it.
 */
export function upstreamModelError(err: unknown): ApiError {
  // A call we gave up on (timeout / request deadline) is not a provider fault:
  // say so, and tell the player the turn was not used (nothing was saved).
  if (isAbortError(err)) {
    return new ApiError(
      504,
      'MODEL_TIMEOUT',
      'The suspect took too long to answer. Your turn was not used, so please try again.',
      err,
    )
  }
  return new ApiError(
    502,
    'MODEL_REQUEST_FAILED',
    'The suspect could not answer right now. Your turn was not used, so please try again in a moment.',
    err,
  )
}

/** Wraps an async route handler so a rejected promise reaches the error middleware instead of hanging the request. */
export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next)
  }
}
