/**
 * BYOK ("bring your own key") — lets a player pay for their own game with an
 * Anthropic key instead of drawing on the shared daily budget.
 *
 * How the key travels: the browser sends it in the `X-Anthropic-Key` request
 * header on game requests. The server uses it for that one request and forgets
 * it. It is never written to the store, a transcript, a log line or a response.
 * The only trace is a `byok: true` flag on the stored session.
 *
 * Why the key never leaks through logs or transcripts: readApiKey() only
 * accepts keys of the exact shape `sk-ant-[A-Za-z0-9_-]+`, and the existing
 * redaction (log.ts redactSecrets) already replaces anything of that shape. So
 * no per-request redaction list is needed, and a provider error that echoes the
 * key is scrubbed like any other.
 *
 * Inputs:  an Express request (header) and, in tests, an injected model factory.
 * Outputs: a validated key string, a per-request LanguageModel, and a test for
 *          "the provider rejected this key".
 */

import type { Request } from 'express'
import type { LanguageModel } from 'ai'
import { modelForApiKey } from '../engine/adjudicate'
import { ApiError } from './errors'

/** Header the browser puts the key in. Express lower-cases header names. */
export const API_KEY_HEADER = 'x-anthropic-key'

/** Anthropic keys are `sk-ant-` plus URL-safe characters; the length bounds only reject junk. */
const API_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,300}$/

/** Test seam: builds a model from a key. Defaults to the real Anthropic provider. */
export type ModelForKey = (apiKey: string) => LanguageModel

/** Fixed player-facing text; never includes the key or the provider's wording. */
export const INVALID_KEY_MESSAGE =
  'Anthropic rejected the API key you provided. Check the key (and that it has credit), or clear it to play on the shared budget.'

/**
 * 401: the key is missing, malformed, or the provider refused it. Nothing about
 * the key is echoed. `cause` (the provider error) rides along unserialised so
 * the route can log the real reason, scrubbed.
 */
export function invalidApiKey(message: string = INVALID_KEY_MESSAGE, cause?: unknown): ApiError {
  return new ApiError(401, 'INVALID_API_KEY', message, cause)
}

/**
 * Returns the player's key from the request header, or undefined if none was
 * sent. Throws a 401 `INVALID_API_KEY` if one was sent but is malformed (also
 * covers repeated headers, which Node joins with ", "). The key is never
 * echoed back.
 */
export function readApiKey(req: Request): string | undefined {
  const raw = req.headers[API_KEY_HEADER]
  if (raw === undefined) return undefined
  const key = (Array.isArray(raw) ? raw.join(',') : raw).trim()
  if (key === '') return undefined
  if (!API_KEY_PATTERN.test(key)) {
    throw invalidApiKey('That does not look like an Anthropic API key (it should start with "sk-ant-"). Check it, or clear it to play on the shared budget.')
  }
  return key
}

/** Builds this request's model: the injected test factory if any, else the real provider. */
export function modelFromKey(req: Request, apiKey: string): LanguageModel {
  const factory = req.app.locals.modelForKey as ModelForKey | undefined
  return (factory ?? modelForApiKey)(apiKey)
}

/**
 * True if `err` (or anything in its `cause` chain) is a provider response that
 * means "this credential is not accepted": HTTP 401 or 403. The AI SDK's
 * APICallError carries `statusCode`; the engine wraps it with the original as
 * `cause`, so the chain is walked (same approach as isAbortError).
 */
export function isAuthRejection(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    if (typeof e !== 'object') return false
    const status = (e as { statusCode?: unknown }).statusCode
    if (status === 401 || status === 403) return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}
