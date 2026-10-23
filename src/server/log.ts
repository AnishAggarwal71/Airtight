/**
 * Server logging — one JSON object per line, secrets scrubbed.
 *
 * Why: provider and Redis error messages can contain URLs, tokens or even the
 * API key, and Vercel keeps logs where more people can read them than can read
 * the env vars. Every server log line therefore goes through logEvent(), which
 * (a) emits a single line of JSON (greppable, one event per line) and (b)
 * removes known secret values and key-shaped strings from every string field.
 *
 * Inputs:  an event name plus flat fields.
 * Outputs: one line on stdout (info) or stderr (error) shaped
 *          {"evt":"<name>", ...fields}. `evt` is always the first key.
 *
 * Never log: the API key, SESSION_SECRET, Redis tokens, request bodies, or the
 * hidden case (truth, persona). The seed is logged ONLY by `session_created`,
 * which exists on purpose so a case can be replayed.
 */

/** Env vars whose VALUES must never appear in a log line. */
const SECRET_ENV_NAMES = [
  'ANTHROPIC_API_KEY',
  'SESSION_SECRET',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_TOKEN',
  'KV_REST_API_READ_ONLY_TOKEN',
]

const MAX_FIELD_CHARS = 500

/**
 * Replaces secrets in `text` with "[redacted]": the exact values of the secret
 * env vars (when 8+ chars, so an empty/short value cannot blank the whole line),
 * Anthropic-style keys, bearer tokens, and credentials embedded in URLs.
 * Also caps length so a huge provider payload cannot flood the log.
 */
export function scrub(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text
  for (const name of SECRET_ENV_NAMES) {
    const v = env[name]
    if (v && v.length >= 8) out = out.split(v).join('[redacted]')
  }
  out = out
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1[redacted]@')
  return out.length > MAX_FIELD_CHARS ? `${out.slice(0, MAX_FIELD_CHARS)}...` : out
}

/** A short, scrubbed description of any thrown value (message only, never a stack). */
export function describeError(err: unknown): string {
  return scrub(err instanceof Error ? `${err.name}: ${err.message}` : String(err))
}

type LogFields = Record<string, string | number | boolean | null | undefined>

function emit(level: 'info' | 'error', evt: string, fields: LogFields): void {
  const clean: Record<string, unknown> = { evt }
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    clean[k] = typeof v === 'string' ? scrub(v) : v
  }
  const line = JSON.stringify(clean)
  if (level === 'error') console.error(line)
  else console.log(line)
}

/** Logs an informational event as one JSON line on stdout. */
export function logEvent(evt: string, fields: LogFields = {}): void {
  emit('info', evt, fields)
}

/** Logs a failure as one JSON line on stderr. */
export function logError(evt: string, fields: LogFields = {}): void {
  emit('error', evt, fields)
}
