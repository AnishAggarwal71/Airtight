/**
 * Shared request-validation constants and helpers for the web API.
 *
 * These mirror the limits already enforced client-side in src/cli/play.ts —
 * duplicated here deliberately. The server must never trust the client for
 * length limits, since a browser request can bypass any front-end check.
 *
 * Validators throw badRequest() (an ApiError), not a plain Error — the
 * centralised error middleware in app.ts only maps ApiError to its own
 * status code; anything else falls through to a generic 500.
 */

import { badRequest } from './errors'

export const MAX_QUESTION_LENGTH = 300

/** Trims and validates a free-text question/input field. Returns the trimmed string. */
export function validateQuestionInput(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw badRequest(`"${fieldName}" must be a string.`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw badRequest(`"${fieldName}" must not be empty.`)
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    throw badRequest(`"${fieldName}" must be ${MAX_QUESTION_LENGTH} characters or fewer.`)
  }
  return trimmed
}
