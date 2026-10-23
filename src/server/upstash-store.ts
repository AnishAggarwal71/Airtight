/**
 * Upstash Redis implementation of Store. Only imported lazily by store.ts so
 * the @upstash/redis package is needed only when real credentials are set.
 *
 * The client JSON-serialises values on set and parses them on get, so objects
 * round-trip as plain data. Keys expire via Redis EX, so no sweeper is needed.
 */

import { Redis } from '@upstash/redis'
import type { Store } from './store'

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
  }
}
