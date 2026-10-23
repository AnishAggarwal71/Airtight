/**
 * Express app factory — static front end + /api/game routes + centralised
 * error handling. Separated from index.ts so the app can be constructed
 * without binding a port; index.ts stays a pure bootstrap script.
 */

import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import path from 'node:path'
import { gameRouter } from './routes/game'
import { ApiError } from './errors'
import { describeError, logError } from './log'
import type { TurnTimeouts } from '../engine/timeouts'
import { createRateLimiter, type RateLimiter } from './ratelimit'
import { assertSeedConfig } from './seed'
import { createStore, type Store } from './store'

const PUBLIC_DIR = path.join(import.meta.dirname, '../../public')

export type AppOptions = {
  /** Shared-state backend. Defaults to createStore() (Upstash from env, MemoryStore locally). */
  store?: Store
  /** Per-IP limiter. Defaults to createRateLimiter() (Upstash from env, in-memory locally). */
  rateLimiter?: RateLimiter
  /** Overrides for the model-call time limits (src/engine/timeouts.ts). Tests use short values; production uses the defaults. */
  turnTimeouts?: Partial<TurnTimeouts>
}

export function createApp(options: AppOptions = {}): Express {
  // Fail fast on a misconfigured Vercel deploy (missing SESSION_SECRET / Redis).
  assertSeedConfig()
  const app = express()

  // Routes reach the store through app.locals (see storeOf in routes/game.ts)
  // so the router stays a module-level constant while tests inject their own.
  app.locals.store = options.store ?? createStore()
  // Same pattern for the per-IP limiter (see rateLimit() in ratelimit.ts).
  app.locals.rateLimiter = options.rateLimiter ?? createRateLimiter()
  app.locals.turnTimeouts = options.turnTimeouts

  app.use(express.json({ limit: '32kb' }))
  app.use(express.static(PUBLIC_DIR))

  app.use('/api/game', gameRouter)

  // Single page, no client-side router — explicit root route for clarity,
  // even though express.static would already serve index.html for "/".
  app.get('/', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'))
  })

  // Unknown API routes 404 cleanly instead of falling through to a static-file 404.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route.' } })
  })

  // Centralised error handler. In order:
  //  1. ApiError -> its own status and message.
  //  2. body-parser errors (malformed JSON, body too large, bad charset) carry
  //     a `type` and a 4xx `status`; they become a plain JSON 400/413 instead of
  //     falling through to a 500 (which would also log them as server faults).
  //  3. anything else -> logged server-side (scrubbed, no stack) and surfaced
  //     as a generic 500. Raw error text or stacks never reach the client.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } })
      return
    }
    const parseErr = err as { type?: string; status?: number }
    if (typeof parseErr?.type === 'string' && parseErr.type.startsWith('entity.')) {
      if (parseErr.type === 'entity.too.large') {
        res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' } })
      } else {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'The request could not be read. Please send valid JSON.' } })
      }
      return
    }
    logError('unhandled_error', { method: req.method, path: req.path.replace(/[0-9a-f-]{36}/gi, ':id'), err: describeError(err) })
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.' } })
  })

  return app
}
