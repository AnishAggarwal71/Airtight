/**
 * Express app factory — static front end + /api/game routes + centralised
 * error handling. Separated from index.ts so the app can be constructed
 * without binding a port; index.ts stays a pure bootstrap script.
 */

import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import path from 'node:path'
import { gameRouter } from './routes/game'
import { ApiError } from './errors'
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

  // Centralised error handler — ApiError becomes a clean JSON body with its
  // own status; anything else is logged server-side and surfaced as a
  // generic 500 (never a raw stack trace to the client).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } })
      return
    }
    console.error('Unhandled server error:', err)
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.' } })
  })

  return app
}
