/**
 * Per-IP rate limiting — stops one visitor flooding the API.
 *
 * Why: the spend cap (budget.ts) bounds money, but a script can still burn the
 * whole daily budget in minutes and lock every real player out, and create
 * unlimited games. Limits are per client IP and per "bucket":
 *   create  POST /api/game                     10 / hour
 *   turn    POST /:id/interrogate + /witness   40 / 10 min (ONE shared bucket, so
 *           alternating the two routes cannot double the allowance)
 *   read    GET  /:id and /:id/breakdown       120 / minute
 *
 * Two implementations behind one `RateLimiter` interface:
 *   - Upstash `@upstash/ratelimit` sliding window (shared across serverless
 *     instances) when Redis credentials are set.
 *   - An in-process sliding-window log locally and in tests.
 *
 * Failure policy: FAIL OPEN. If the limiter backend errors we log it and let the
 * request through, because the hard backstops (spend cap, per-session lock,
 * turn limits — all fail-closed) still bound cost and abuse. Failing closed here
 * would turn a Redis blip into a full outage for reads as well.
 *
 * Inputs:  env (UPSTASH_REDIS_REST_URL/_TOKEN or KV_REST_API_URL/_TOKEN, VERCEL).
 * Outputs: createRateLimiter(), clientIp(), rateLimit(bucket) middleware.
 */

import type { NextFunction, Request, Response } from 'express'
import net from 'node:net'
import { ApiError } from './errors'

export type Bucket = 'create' | 'turn' | 'read'

export type BucketLimit = { limit: number; windowSeconds: number }

/** Current ceilings — change these numbers to retune. */
export const RATE_LIMITS: Record<Bucket, BucketLimit> = {
  create: { limit: 10, windowSeconds: 60 * 60 },
  turn: { limit: 40, windowSeconds: 10 * 60 },
  read: { limit: 120, windowSeconds: 60 },
}

/** Result of one check: allowed, or refused with how long until a retry can succeed. */
export type RateResult = { ok: true } | { ok: false; retryAfterSeconds: number }

export interface RateLimiter {
  /** Counts one hit for `key` (an IP) in `bucket` and says whether it is allowed. */
  check(bucket: Bucket, key: string): Promise<RateResult>
}

/** A limiter that allows everything. For tests of unrelated behaviour only; never used by createApp's default. */
export const unlimitedRateLimiter: RateLimiter = { check: async () => ({ ok: true }) }

/**
 * In-process sliding-window log. Exact (no fixed-window burst at the boundary).
 * `now` is injectable so tests can move time without sleeping. Not shared
 * across processes, so it is for local dev and tests only.
 */
export function createMemoryRateLimiter(
  now: () => number = Date.now,
  limits: Record<Bucket, BucketLimit> = RATE_LIMITS,
): RateLimiter {
  const hits = new Map<string, number[]>()
  return {
    async check(bucket, key) {
      const { limit, windowSeconds } = limits[bucket]
      const windowMs = windowSeconds * 1000
      const t = now()
      const mapKey = `${bucket}:${key}`
      const recent = (hits.get(mapKey) ?? []).filter((ts) => ts > t - windowMs)
      if (recent.length >= limit) {
        hits.set(mapKey, recent)
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000)) }
      }
      recent.push(t)
      hits.set(mapKey, recent)
      // Opportunistic sweep so a long-lived dev server cannot grow without bound.
      if (hits.size > 5000) {
        for (const [k, v] of hits) {
          const w = k.startsWith('turn:') ? limits.turn : k.startsWith('create:') ? limits.create : limits.read
          if (v.every((ts) => ts <= t - w.windowSeconds * 1000)) hits.delete(k)
        }
      }
      return { ok: true }
    },
  }
}

/**
 * Upstash-backed limiter. Both packages are imported lazily so they are only
 * needed when real credentials are set (same pattern as the Redis Store).
 * One Ratelimit instance per bucket, created on first use and reused.
 */
export function createUpstashRateLimiter(
  url: string,
  token: string,
  limits: Record<Bucket, BucketLimit> = RATE_LIMITS,
): RateLimiter {
  const instances = new Map<Bucket, Promise<{ limit(key: string): Promise<{ success: boolean; reset: number }> }>>()
  const load = (bucket: Bucket) => {
    let p = instances.get(bucket)
    if (!p) {
      p = (async () => {
        const [{ Ratelimit }, { Redis }] = await Promise.all([import('@upstash/ratelimit'), import('@upstash/redis')])
        const { limit, windowSeconds } = limits[bucket]
        return new Ratelimit({
          redis: new Redis({ url, token }),
          limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
          prefix: `rl:${bucket}`,
          analytics: false,
        })
      })()
      instances.set(bucket, p)
    }
    return p
  }
  return {
    async check(bucket, key) {
      const rl = await load(bucket)
      const res = await rl.limit(key)
      if (res.success) return { ok: true }
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)) }
    },
  }
}

/** Picks the limiter for this process from env: Upstash when credentials exist, else in-memory. */
export function createRateLimiter(env: NodeJS.ProcessEnv = process.env): RateLimiter {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN
  if (url && token) return createUpstashRateLimiter(url, token)
  return createMemoryRateLimiter()
}

/**
 * Normalises an IP string to a rate-limit key. IPv4 is kept as is; an
 * IPv4-mapped IPv6 address (::ffff:1.2.3.4) becomes the IPv4; any other IPv6
 * address is reduced to its /64 prefix, because one subscriber is routinely
 * handed a whole /64 and could otherwise rotate through 2^64 addresses to dodge
 * the limit. Returns null if the string is not an IP.
 */
export function normalizeIp(raw: string): string | null {
  let ip = raw.trim()
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'))
  ip = ip.split('%')[0] // strip an IPv6 zone id
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (mapped) ip = mapped[1]
  if (net.isIPv4(ip)) return ip
  if (net.isIPv6(ip) && !ip.includes('.')) {
    const [head, tail = ''] = ip.split('::')
    const headParts = head ? head.split(':') : []
    const tailParts = ip.includes('::') ? (tail ? tail.split(':') : []) : []
    const groups = ip.includes('::')
      ? [...headParts, ...Array(8 - headParts.length - tailParts.length).fill('0'), ...tailParts]
      : headParts
    return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`
  }
  return null
}

/**
 * The client IP to rate-limit on.
 * On Vercel, `x-vercel-forwarded-for` is set (and overwritten) by Vercel's edge,
 * so a client cannot forge it; `x-real-ip` is the fallback. Everywhere else the
 * forwarding headers are client-controlled, so they are IGNORED and the socket
 * address is used — otherwise anyone could pick a fresh "IP" per request.
 * If no usable address is found the key is 'unknown' (one shared bucket: safe,
 * if blunt).
 */
export function clientIp(
  req: Pick<Request, 'headers' | 'socket'>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const header = (name: string) => {
    const v = req.headers[name]
    return (Array.isArray(v) ? v[0] : v)?.split(',')[0]
  }
  const raw = env.VERCEL
    ? (header('x-vercel-forwarded-for') ?? header('x-real-ip'))
    : req.socket?.remoteAddress
  return (raw && normalizeIp(raw)) || 'unknown'
}

/** 429 with a friendly message; Retry-After is set by the middleware. */
function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(
    429,
    'RATE_LIMITED',
    `You're going a little fast. Please wait about ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'} and try again.`,
  )
}

/**
 * Express middleware factory. Put it FIRST on a route (before validation, the
 * session lock and the spend reservation) so a throttled request costs nothing.
 * The limiter comes from `app.locals.rateLimiter` (set in createApp).
 */
export function rateLimit(bucket: Bucket) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const limiter = req.app.locals.rateLimiter as RateLimiter
    let result: RateResult
    try {
      result = await limiter.check(bucket, clientIp(req))
    } catch (err) {
      console.error(
        JSON.stringify({ evt: 'ratelimit_error', bucket, msg: err instanceof Error ? err.message : String(err) }),
      )
      next() // fail open — see the file header
      return
    }
    if (result.ok) {
      next()
      return
    }
    res.setHeader('Retry-After', String(result.retryAfterSeconds))
    next(rateLimited(result.retryAfterSeconds))
  }
}
