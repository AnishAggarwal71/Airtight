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

/**
 * Lock acquire/release go through Lua (not the client's set()) so the stored
 * token is the raw string we pass, with no client-side JSON encoding that the
 * compare-and-delete could then fail to match.
 * ACQUIRE: KEYS[1] = lock, ARGV[1] = token, ARGV[2] = ttl ms. Returns 'OK' or false (nil).
 */
const ACQUIRE_LOCK_LUA = `
return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', tonumber(ARGV[2]))
`

/** Deletes KEYS[1] only if it still holds ARGV[1]. */
const RELEASE_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

/**
 * Compare-and-set on the JSON blob's numeric "rev" field.
 * KEYS[1] = key, ARGV[1] = expected rev, ARGV[2] = new JSON text, ARGV[3] = ttl seconds.
 * A missing key, undecodable value or missing rev all count as rev 0.
 * Returns 1 if written, 0 if the revision did not match.
 */
const SET_IF_REV_LUA = `
local cur = redis.call('GET', KEYS[1])
local rev = 0
if cur then
  local ok, decoded = pcall(cjson.decode, cur)
  if ok and type(decoded) == 'table' and type(decoded.rev) == 'number' then
    rev = decoded.rev
  end
end
if rev ~= tonumber(ARGV[1]) then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
return 1
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
    async acquireLock(key, token, ttlMs) {
      return (await redis.eval(ACQUIRE_LOCK_LUA, [key], [token, String(ttlMs)])) === 'OK'
    },
    async releaseLock(key, token) {
      await redis.eval(RELEASE_LOCK_LUA, [key], [token])
    },
    async setJsonIfRev(key, expectedRev, value, ttlSeconds) {
      const written = await redis.eval(
        SET_IF_REV_LUA,
        [key],
        [String(expectedRev), JSON.stringify(value), String(ttlSeconds)],
      )
      return Number(written) === 1
    },
  }
}
