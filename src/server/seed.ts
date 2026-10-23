/**
 * Server-side seed policy — decides which seed a new session uses, and keeps
 * that seed away from the client.
 *
 * Why this exists: the seed fully determines the case (suspect, truth
 * timeline, fatal fact, evidence vulnerabilities). Returning it to the
 * browser would let a player run `npm run case <seed>` and read the answers,
 * and accepting a client-chosen seed would let them replay known cases. So:
 *
 *   - The server picks the seed (128 bits from crypto.randomBytes).
 *   - If SESSION_SECRET is set, the stored seed is HMAC-SHA256(secret, raw),
 *     so even a leaked log line of the raw seed could not be turned into the
 *     case without the secret. With no secret (local CLI / dev) the derived
 *     seed IS the raw seed, so `npm run case <seed> homicide` reproduces any
 *     case from a log line with no secret needed.
 *   - Derivation happens HERE, outside generate(), so generate() stays pure
 *     (CLAUDE.md invariant #1). generate() only ever sees the final seed.
 *   - Client-supplied seed/templateId are honoured only when the dev flag
 *     ALLOW_CLIENT_SEED=1 is set and the deploy is not Vercel production.
 *
 * The derived seed is logged server-side (session_created) for replay and
 * debugging and must never appear in any HTTP response — verify.ts check #8
 * enforces this.
 */

import crypto from 'node:crypto'
import { badRequest } from './errors'

/** Result of seed selection for one new session. */
export type SeedChoice = {
  /** Final seed handed to createSession()/generate(). Server-side only. */
  seed: string
  /** Template pin; only ever set when client seeds are allowed. */
  templateId?: string
}

const MAX_CLIENT_SEED_LENGTH = 100
const MIN_SECRET_LENGTH = 32
const DERIVED_SEED_HEX_CHARS = 32 // 128 bits

/**
 * Whether the request body may pin the seed/template. Read from the env at
 * call time (not module load) so tests can flip it. Never true on Vercel
 * production, even if the flag was set there by mistake.
 */
export function isClientSeedAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALLOW_CLIENT_SEED === '1' && env.VERCEL_ENV !== 'production'
}

/**
 * Derives the stored seed from a raw seed. With no secret this is the
 * identity (CLI reproducibility); with a secret it is a keyed one-way hash.
 */
export function deriveSeed(secret: string | undefined, raw: string): string {
  if (!secret) return raw
  return crypto.createHmac('sha256', secret).update(raw).digest('hex').slice(0, DERIVED_SEED_HEX_CHARS)
}

/**
 * Chooses the seed (and optional template pin) for a new session from the
 * POST /api/game body. Throws a 400 only for an over-long client seed, and
 * only when client seeds are allowed; otherwise client fields are ignored.
 */
export function chooseSeed(
  body: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): SeedChoice {
  let raw: string | undefined
  let templateId: string | undefined

  if (isClientSeedAllowed(env)) {
    if (typeof body.seed === 'string' && body.seed.trim().length > 0) {
      raw = body.seed.trim()
      if (raw.length > MAX_CLIENT_SEED_LENGTH) {
        throw badRequest(`Seed must be at most ${MAX_CLIENT_SEED_LENGTH} characters.`)
      }
    }
    if (typeof body.templateId === 'string') templateId = body.templateId
  }

  raw ??= crypto.randomBytes(16).toString('hex')
  return { seed: deriveSeed(env.SESSION_SECRET || undefined, raw), templateId }
}

/**
 * Refuses to boot a Vercel deployment without a strong SESSION_SECRET.
 * Without it the "derived" seed would equal the raw seed, silently dropping
 * the keyed-hash protection in the one environment that needs it. No-op
 * outside Vercel so local dev and the CLI need no secret.
 */
export function assertSeedConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.VERCEL) return
  if ((env.SESSION_SECRET ?? '').length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be set to a random string of at least ${MIN_SECRET_LENGTH} characters on Vercel (e.g. \`openssl rand -hex 32\`).`,
    )
  }
}
