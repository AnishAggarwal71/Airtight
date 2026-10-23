/**
 * API error handling — a typed ApiError thrown from route handlers, caught
 * by app.ts's centralised error middleware, turned into a clean
 * { error: { code, message } } JSON body instead of a raw stack trace.
 */

import type { NextFunction, Request, Response } from 'express'

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
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
 * Wraps a persona-agent model failure (interrogateSuspect/interrogateWitness —
 * these throw on failure with no retry, unlike the invigilator) as a clean
 * upstream error. adjudicate.ts/witness.ts already prefix their errors with
 * "Suspect/Witness model request failed: ..." so the message is already
 * safe to show the player as-is.
 */
export function upstreamModelError(err: unknown): ApiError {
  const message = err instanceof Error ? err.message : String(err)
  return new ApiError(502, 'MODEL_REQUEST_FAILED', message)
}

/** Wraps an async route handler so a rejected promise reaches the error middleware instead of hanging the request. */
export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next)
  }
}
