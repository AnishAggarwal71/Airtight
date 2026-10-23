/**
 * Upstash Redis implementation of Store. Only imported lazily by store.ts so
 * the @upstash/redis package is needed only when real credentials are set.
 *
 * The client JSON-serialises values on set and parses them on get, so objects
 * round-trip as plain data. Keys expire via Redis EX, so no sweeper is needed.
 *
 * reserve()/adjust() run as Lua scripts: Redis executes a script as one
 * uninterrupted unit, which is what makes the spend cap safe when many
 * serverless instances reserve at the same instant.
 */

import { Redis } from '@upstash/redis'
import type { CounterLimit, ReserveResult, Store } from './store'

/**
 * Check-all-then-increment-all across N counters.
 * KEYS[i] = counter i. ARGV[1] = amount; ARGV[2i] = cap of counter i; ARGV[2i+1] = its TTL seconds.
 * Returns 0 on success, or the 1-based index of the first counter that would exceed its cap
 * (in which case nothing was changed). A missing key reads as false in Lua, hence `or '0'`.
 */
const RESERVE_LUA = `
local amount = tonumber(ARGV[1])
for i = 1, #KEYS do
  local cur = tonumber(redis.call('GET', KEYS[i]) or '0')
  if cur + amount > tonumber(ARGV[2 * i]) then
    return i
  end
end
for i = 1, #KEYS do
  redis.call('INCRBY', KEYS[i], amount)
  redis.call('EXPIRE', KEYS[i], tonumber(ARGV[2 * i + 1]))
end
return 0
`

/** KEYS[1] += ARGV[1] (may be negative) and refresh the TTL (ARGV[2] seconds) in one step. */
const ADJUST_LUA = `
local v = redis.call('INCRBY', KEYS[1], tonumber(ARGV[1]))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return v
`

/** Builds a Store over the Upstash REST client for the given database. */
export function createUpstashStore(url: string, token: string): Store {
  const redis = new Redis({ url, token })
  return {
    async getJson(key) {
      return (await redis.get(key)) ?? null
    },
    async setJson(key, value, ttlSeconds) {
      await redis.set(key, value, { ex: ttlSeconds })
    },
    async del(key) {
      await redis.del(key)
    },
    async reserve(limits: CounterLimit[], amount: number): Promise<ReserveResult> {
      const args = [String(amount)]
      for (const l of limits) args.push(String(l.cap), String(l.ttlSeconds))
      const blockedIndex = Number(
        await redis.eval(
          RESERVE_LUA,
          limits.map((l) => l.key),
          args,
        ),
      )
      return blockedIndex === 0 ? { ok: true } : { ok: false, blockedKey: limits[blockedIndex - 1].key }
    },
    async adjust(key, delta, ttlSeconds) {
      await redis.eval(ADJUST_LUA, [key], [String(delta), String(ttlSeconds)])
    },
  }
}
