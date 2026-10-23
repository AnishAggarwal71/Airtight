/**
 * Key-value store abstraction for all server state that must survive across
 * serverless invocations (sessions now; spend counters, locks, rate limits
 * and transcripts in later hardening steps).
 *
 * Why: Vercel runs the app as short-lived function instances with no shared
 * memory or disk, so a module-level Map (the old sessions.ts) loses every
 * game between requests. Redis (Upstash) is the shared state; MemoryStore is
 * the local-dev / test stand-in behind the same interface.
 *
 * Inputs:  env vars — UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or
 *          the Vercel Marketplace names KV_REST_API_URL + KV_REST_API_TOKEN.
 * Outputs: a Store. With no credentials: MemoryStore locally, and a hard
 *          error on Vercel (an in-memory store there would silently lose
 *          sessions and defeat every cap that depends on shared state).
 */

/** One counter a reservation must fit under: `cap` is the maximum allowed total after the increment. */
export type CounterLimit = { key: string; cap: number; ttlSeconds: number }

/** Outcome of Store.reserve(): ok, or the key of the first limit that would have been exceeded. */
export type ReserveResult = { ok: true } | { ok: false; blockedKey: string }

/** Minimal async KV interface. Values are JSON-serialisable and round-trip as copies. */
export interface Store {
  /** Returns the stored value, or null if absent/expired. */
  getJson(key: string): Promise<unknown | null>
  /** Stores a JSON value that expires `ttlSeconds` after this write. */
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>
  del(key: string): Promise<void>
  /**
   * Atomically adds `amount` (a non-negative integer) to EVERY counter in
   * `limits`, but only if all of them would stay at or under their cap.
   * All-or-nothing: if any limit would be exceeded, no counter changes and
   * the first offending key is returned. Each counter's TTL is refreshed on
   * success. Atomicity is the point — a read-then-write check from separate
   * serverless instances would let parallel requests all pass the same check.
   * Counter values read back through getJson() as numbers.
   */
  reserve(limits: CounterLimit[], amount: number): Promise<ReserveResult>
  /** Atomically adds `delta` (may be negative) to one counter and refreshes its TTL. */
  adjust(key: string, delta: number, ttlSeconds: number): Promise<void>
}

/**
 * In-process store with TTL. Values are held as JSON strings and re-parsed
 * on read so callers get a fresh copy, exactly like a network store — a
 * shared object reference would let tests pass on mutations that Redis would
 * never persist. Expiry is checked lazily on read; the clock is injectable
 * so tests can advance time without sleeping.
 *
 * reserve()/adjust() are atomic here only because JS is single-threaded and
 * they contain no await between their read and write; the Upstash
 * implementation gets the same guarantee from a Lua script. Tests against
 * this class therefore prove the protocol, not Redis itself.
 */
export class MemoryStore implements Store {
  private entries = new Map<string, { json: string; expiresAt: number }>()

  constructor(private now: () => number = Date.now) {}

  async getJson(key: string): Promise<unknown | null> {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key)
      return null
    }
    return JSON.parse(entry.json)
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { json: JSON.stringify(value), expiresAt: this.now() + ttlSeconds * 1000 })
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key)
  }

  /** Current value of a counter key (0 when absent or expired). Synchronous so reserve() stays atomic. */
  private counter(key: string): number {
    const entry = this.entries.get(key)
    if (!entry || this.now() >= entry.expiresAt) return 0
    return Number(JSON.parse(entry.json))
  }

  private writeCounter(key: string, value: number, ttlSeconds: number): void {
    this.entries.set(key, { json: JSON.stringify(value), expiresAt: this.now() + ttlSeconds * 1000 })
  }

  async reserve(limits: CounterLimit[], amount: number): Promise<ReserveResult> {
    for (const l of limits) {
      if (this.counter(l.key) + amount > l.cap) return { ok: false, blockedKey: l.key }
    }
    for (const l of limits) this.writeCounter(l.key, this.counter(l.key) + amount, l.ttlSeconds)
    return { ok: true }
  }

  async adjust(key: string, delta: number, ttlSeconds: number): Promise<void> {
    this.writeCounter(key, this.counter(key) + delta, ttlSeconds)
  }
}

/**
 * Upstash-backed store that loads @upstash/redis on first use. Lazy so that
 * local dev and `npm run verify` never need the package or credentials; the
 * literal specifier keeps it visible to Vercel's file tracing.
 */
class LazyUpstashStore implements Store {
  private inner: Promise<Store> | undefined

  constructor(
    private url: string,
    private token: string,
  ) {}

  private load(): Promise<Store> {
    this.inner ??= import('./upstash-store').then((m) => m.createUpstashStore(this.url, this.token))
    return this.inner
  }

  async getJson(key: string): Promise<unknown | null> {
    return (await this.load()).getJson(key)
  }
  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    return (await this.load()).setJson(key, value, ttlSeconds)
  }
  async del(key: string): Promise<void> {
    return (await this.load()).del(key)
  }
  async reserve(limits: CounterLimit[], amount: number): Promise<ReserveResult> {
    return (await this.load()).reserve(limits, amount)
  }
  async adjust(key: string, delta: number, ttlSeconds: number): Promise<void> {
    return (await this.load()).adjust(key, delta, ttlSeconds)
  }
}

/**
 * Picks the store for this process from env. Credentials present: Upstash.
 * Absent: MemoryStore locally, throw on Vercel (fail at boot, not mid-game).
 */
export function createStore(env: NodeJS.ProcessEnv = process.env): Store {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN
  if (url && token) return new LazyUpstashStore(url, token)
  if (env.VERCEL) {
    throw new Error(
      'Redis credentials missing on Vercel: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN) by connecting Upstash in the Vercel dashboard.',
    )
  }
  return new MemoryStore()
}
