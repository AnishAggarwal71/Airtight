#!/usr/bin/env tsx
/**
 * V2 sanity checks.  npx tsx src/cli/verify.ts
 *
 * Seven things matter here:
 *
 *   1. DETERMINISM — generate() must stay pure. The server regenerates the case
 *      file from the seed on every turn instead of storing it.
 *   2. LEAK-SAFETY — toPublicCase() hides the suspect's strategy (persona,
 *      cover story, breaking points, guilty knowledge, evidence vulnerabilities,
 *      truth timeline, fatal fact, witness personality/knowledge).
 *   3. TEMPLATE INTEGRITY — every template must produce well-formed evidence
 *      with unique ids, a witness, a suspect persona, and a detective briefing.
 *   4. COVERAGE — every template should be reachable from generation.
 *   5. VARIANCE — the same template should produce different cases from
 *      different seeds.
 *   6. VERDICT-REASON LEAK-SAFETY — deriveVerdictReason() (src/server/verdict.ts)
 *      must never echo invigilator free-text, since that text is written by a
 *      model with full hidden-case context and could carry any of it.
 *   7. BREAKDOWN-ROUTE LOCK — GET /api/game/:id/breakdown (src/server/routes/
 *      game.ts) must refuse (403/409) until session.ending is set. It is the
 *      one route allowed to return the cover story and true timeline; if it
 *      answered mid-game, a player could open dev tools and read the answers
 *      straight off the wire. No API key needed — this only creates a session
 *      and reads the refusal, no model call involved.
 */

import { generate, toPublicCase } from '../engine/generate'
import { parsePlayerInput, createSession } from '../engine/session'
import { ALL_TEMPLATES } from '../engine/templates'
import type { CrimeType, InvigilatorSuspectResponse, InvigilatorWitnessResponse } from '../engine/types'
import { deriveSuspectVerdictType, deriveWitnessVerdictType, deriveVerdictReason } from '../server/verdict'
import { createApp } from '../server/app'
import { assertSeedConfig, chooseSeed, deriveSeed } from '../server/seed'
import { MemoryStore, createStore, type Store } from '../server/store'
import { getSession, saveSession, SESSION_TTL_SECONDS } from '../server/sessions'
import { withSessionLock, SESSION_LOCK_TTL_MS } from '../server/lock'
import { buildBreakdown } from '../server/breakdown'
import { BUDGET_CONFIG, dayKey, reserveSpend } from '../server/budget'
import { setModel } from '../engine/adjudicate'
import {
  clientIp,
  createMemoryRateLimiter,
  normalizeIp,
  unlimitedRateLimiter,
  type RateLimiter,
} from '../server/ratelimit'
import { MockLanguageModelV4 } from 'ai/test'
import { describeError, scrub } from '../server/log'
import { MAX_TRANSCRIPT_ENTRIES, TRANSCRIPT_TTL_SECONDS, readTranscript, recordTranscript } from '../server/transcripts'
import { mkdtemp, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const CRIMES: CrimeType[] = ['homicide']
const ALL_CRIMES: CrimeType[] = ['homicide', 'embezzlement']
const SEEDS = Array.from({ length: 60 }, (_, i) => `verify-${i}`)

let failures = 0
const fail = (msg: string) => {
  console.log(`  \x1b[31mFAIL\x1b[0m ${msg}`)
  failures++
}
const pass = (msg: string) => console.log(`  \x1b[32mok\x1b[0m   ${msg}`)

// 1. Determinism
{
  let stable = true
  for (const seed of SEEDS.slice(0, 20)) {
    for (const crime of CRIMES) {
      const a = JSON.stringify(generate({ seed, crime }))
      const b = JSON.stringify(generate({ seed, crime }))
      if (a !== b) {
        fail(`generate() not deterministic for ${seed}/${crime}`)
        stable = false
      }
    }
  }
  if (stable) pass('generate() is deterministic across 40 seed/crime pairs')

  // Beats are authored in narrative order (opportunity -> ... -> exit), but
  // some templates' windows cross midnight — compare elapsed minutes since
  // window.start (wrapping forward) rather than raw "HH:MM" strings, which
  // sort wrong across the midnight boundary (e.g. "23:57" >= "00:12").
  // One template (overdose) has a legitimate prequel beat days before
  // window.start (an early prescription refill) — order-checking starts
  // from the first beat whose time equals window.start, so that beat is
  // exempt without weakening the check for anything inside the window.
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
  }
  let timelineOrderValid = true
  for (const seed of SEEDS) {
    const file = generate({ seed, crime: 'homicide' })
    const startMinutes = toMinutes(file.window.start)
    const windowStartIndex = file.truth.findIndex((beat) => beat.time === file.window.start)
    let prevElapsed = -1
    for (const beat of file.truth.slice(Math.max(windowStartIndex, 0))) {
      const elapsed = (toMinutes(beat.time) - startMinutes + 1440) % 1440
      if (elapsed < prevElapsed) {
        fail(`${file.templateId} truth beat ${beat.id} precedes an earlier beat (${seed})`)
        timelineOrderValid = false
        break
      }
      prevElapsed = elapsed
    }
  }
  if (timelineOrderValid) pass('homicide truth timelines stay in chronological order, including midnight-crossing windows')

  const evidence = generate({ seed: 'verify-evidence-input', crime: 'homicide' }).evidence
  evidence[1].presented = true
  const parsed = parsePlayerInput('PRESENT e1, e2, e3: Explain these records.', evidence)
  if (
    parsed.question !== 'Explain these records.'
    || parsed.presentedEvidenceIds.join(',') !== 'e1,e3'
    || parsed.rejectedEvidenceIds.join(',') !== 'e2'
  ) {
    fail('multiple evidence input does not accept unused items and reject used items correctly')
  } else {
    pass('multiple evidence input parses lists and rejects already-presented items')
  }
}

// 2. Leak-safety — V2 inverted boundary: hide suspect strategy, show evidence
{
  let clean = true
  for (const seed of SEEDS) {
    for (const crime of CRIMES) {
      const file = generate({ seed, crime })
      const publicCase = toPublicCase(file)
      const pub = JSON.stringify(publicCase)

      // Truth timeline must stay hidden
      for (const beat of file.truth) {
        if (pub.includes(beat.fact)) {
          fail(`truth beat leaked into public case (${seed}/${crime})`)
          clean = false
        }
      }

      // Evidence vulnerabilities must stay hidden
      for (const e of file.evidence) {
        if (pub.includes(e.vulnerability)) {
          fail(`vulnerability for ${e.id} leaked (${seed}/${crime})`)
          clean = false
        }
      }

      // Fatal fact must stay hidden
      if (pub.includes(file.fatalFact)) {
        fail(`fatalFact leaked (${seed}/${crime})`)
        clean = false
      }

      // Suspect strategy must stay hidden
      if (pub.includes(file.suspectPersona.coverStory)) {
        fail(`suspect cover story leaked (${seed}/${crime})`)
        clean = false
      }
      if (pub.includes(file.suspectPersona.personality)) {
        fail(`suspect personality leaked (${seed}/${crime})`)
        clean = false
      }
      for (const gk of file.suspectPersona.guiltyKnowledge) {
        if (pub.includes(gk)) {
          fail(`guilty knowledge leaked (${seed}/${crime})`)
          clean = false
        }
      }

      // Witness hidden fields must stay hidden
      if (pub.includes(file.witness.personality)) {
        fail(`witness personality leaked (${seed}/${crime})`)
        clean = false
      }
      if (pub.includes(file.witness.knowledgeBoundary)) {
        fail(`witness knowledge boundary leaked (${seed}/${crime})`)
        clean = false
      }

      // crimeSummary must stay hidden (M14)
      if (pub.includes(file.detectiveBriefing.crimeSummary)) {
        fail(`crimeSummary leaked into public case (${seed}/${crime})`)
        clean = false
      }

      // Evidence claims SHOULD be visible (inverted from V1) — compare the
      // structured public evidence array directly rather than substring-matching
      // a JSON.stringify()'d blob, since claims containing literal `"` characters
      // are escaped to `\"` in that blob and can never match a raw substring.
      for (const e of file.evidence) {
        const pe = publicCase.evidence.find((x) => x.id === e.id)
        if (!pe || pe.description !== e.claim) {
          fail(`evidence ${e.id} claim not visible in public case (${seed}/${crime})`)
          clean = false
        }
      }
    }
  }
  if (clean) pass('toPublicCase() hides strategy, shows evidence — inverted boundary correct')
}

// 3. Template integrity
{
  let sound = true
  for (const seed of SEEDS) {
    for (const crime of CRIMES) {
      const f = generate({ seed, crime })

      // Evidence: unique IDs, 4-5 items, all unpresented
      const ids = f.evidence.map((e) => e.id)
      if (new Set(ids).size !== ids.length) {
        fail(`duplicate evidence ids in ${f.templateId}`)
        sound = false
      }
      if (f.evidence.length < 4 || f.evidence.length > 5) {
        fail(`${f.templateId} has ${f.evidence.length} evidence items (want 4-5)`)
        sound = false
      }
      const presented = f.evidence.filter((e) => e.presented).length
      if (presented !== 0) {
        fail(`${f.templateId} has ${presented} pre-presented items (want 0)`)
        sound = false
      }
      for (const e of f.evidence) {
        if (!e.vulnerability?.trim()) {
          fail(`${f.templateId}/${e.id} has no vulnerability`)
          sound = false
        }
        if (!e.linkedBeats?.length) {
          fail(`${f.templateId}/${e.id} has no linked beats`)
          sound = false
        }
        const beatIds = new Set(f.truth.map((b) => b.id))
        for (const b of e.linkedBeats) {
          if (!beatIds.has(b)) {
            fail(`${f.templateId}/${e.id} links unknown beat ${b}`)
            sound = false
          }
        }
      }

      // Truth: at least 4 beats
      if (f.truth.length < 4) {
        fail(`${f.templateId} has a ${f.truth.length}-beat timeline (want 4+)`)
        sound = false
      }

      // Fatal fact
      if (!f.fatalFact?.trim()) {
        fail(`${f.templateId} missing fatalFact`)
        sound = false
      }

      // Suspect persona
      if (!f.suspectPersona?.personality?.trim()) {
        fail(`${f.templateId} missing suspect personality`)
        sound = false
      }
      if (!f.suspectPersona?.coverStory?.trim()) {
        fail(`${f.templateId} missing suspect cover story`)
        sound = false
      }
      if (!f.suspectPersona?.breakingPoints?.length) {
        fail(`${f.templateId} missing suspect breaking points`)
        sound = false
      }
      if (!f.suspectPersona?.guiltyKnowledge?.length) {
        fail(`${f.templateId} missing suspect guilty knowledge`)
        sound = false
      }

      // Detective briefing
      if (!f.detectiveBriefing?.victimSummary?.trim()) {
        fail(`${f.templateId} missing detective briefing victimSummary`)
        sound = false
      }
      if (!f.detectiveBriefing?.evidenceSummary?.trim()) {
        fail(`${f.templateId} missing detective briefing evidenceSummary`)
        sound = false
      }

      // Witness
      if (!f.witness?.name?.trim()) {
        fail(`${f.templateId} missing witness name`)
        sound = false
      }
      if (!f.witness?.personality?.trim()) {
        fail(`${f.templateId} missing witness personality`)
        sound = false
      }
      if (!f.witness?.knowledgeBoundary?.trim()) {
        fail(`${f.templateId} missing witness knowledge boundary`)
        sound = false
      }
      if (!f.witness?.suspectContradictions?.length) {
        fail(`${f.templateId} missing witness suspect contradictions`)
        sound = false
      }
    }
  }
  if (sound) pass('all templates produce well-formed V2 case files')
}

// 4. Coverage — every template should be reachable
{
  const seen = new Set<string>()
  for (let i = 0; i < 400; i++) {
    for (const crime of ALL_CRIMES) {
      try {
        seen.add(generate({ seed: `cover-${i}`, crime }).templateId)
      } catch {
        // embezzlement has no templates — expected
      }
    }
  }
  const activeTemplates = ALL_TEMPLATES.filter((t) => t.crime !== 'embezzlement')
  const missing = activeTemplates.filter((t) => !seen.has(t.id)).map((t) => t.id)
  if (missing.length) fail(`unreachable templates: ${missing.join(', ')}`)
  else pass(`all ${activeTemplates.length} active templates reachable`)
}

// 5. Variance — the same template shouldn't produce the same case twice
// 400 draws (not 120) so that splitting across 10 homicide templates still
// gives each one enough samples to clear the distinct-fingerprint floor —
// at 120 draws, ~12 land per template on average, too tight a margin against
// a floor of 10 distinct fingerprints.
{
  const byTemplate = new Map<string, Set<string>>()
  for (let i = 0; i < 400; i++) {
    for (const crime of CRIMES) {
      const f = generate({ seed: `var-${i}`, crime })
      const fingerprint = `${f.suspect.name}|${f.victim.name}|${f.window.start}`
      if (!byTemplate.has(f.templateId)) byTemplate.set(f.templateId, new Set())
      byTemplate.get(f.templateId)!.add(fingerprint)
    }
  }
  let varied = true
  for (const [id, prints] of byTemplate) {
    if (prints.size < 10) {
      fail(`${id} only produced ${prints.size} distinct cases`)
      varied = false
    }
  }
  if (varied) pass('slot randomisation produces high variance within each template')
}

// 6. Verdict-reason leak-safety — deriveVerdictReason() must be structurally
// incapable of echoing invigilator free-text (reasoning/description), since
// those fields are written by a model with full hidden-case context.
{
  const SENTINEL_TRUTH = 'SENTINEL_TRUE_TIMELINE_FACT_xyz'
  const SENTINEL_CLAIM = 'SENTINEL_CLAIM_LEDGER_TEXT_xyz'
  const SENTINEL_COVER = 'SENTINEL_COVER_STORY_TEXT_xyz'

  const fakeSuspectSignals: InvigilatorSuspectResponse['signals'] = {
    contradictions: [
      { againstClaimId: 'c1', description: `${SENTINEL_CLAIM} contradicts ${SENTINEL_TRUTH}`, severity: 'major' },
    ],
    guiltyKnowledgeLeak: { description: `${SENTINEL_COVER} slipped through` },
    evidenceHandling: [{ evidenceId: 'e1', quality: 0, description: SENTINEL_TRUTH }],
    demeanorShift: true,
  }
  const fakeWitnessSignals: InvigilatorWitnessResponse['signals'] = {
    suspectContradiction: { againstClaimId: 'c1', description: `${SENTINEL_CLAIM} vs ${SENTINEL_COVER}` },
  }

  const sentinels = [SENTINEL_TRUTH, SENTINEL_CLAIM, SENTINEL_COVER]
  let safe = true

  const suspectType = deriveSuspectVerdictType(fakeSuspectSignals)
  const suspectReason = deriveVerdictReason(suspectType, {
    question: 'Where were you that night?',
    presentedEvidenceDescriptions: [SENTINEL_TRUTH],
  })
  for (const s of sentinels) {
    if (suspectReason.includes(s)) {
      fail(`deriveVerdictReason() leaked sentinel "${s}" via suspect signals`)
      safe = false
    }
  }

  const witnessType = deriveWitnessVerdictType(fakeWitnessSignals)
  const witnessReason = deriveVerdictReason(witnessType, {
    question: 'Did you see anyone else that evening?',
    presentedEvidenceDescriptions: [],
  })
  for (const s of sentinels) {
    if (witnessReason.includes(s)) {
      fail(`deriveVerdictReason() leaked sentinel "${s}" via witness signals`)
      safe = false
    }
  }

  if (safe) pass('deriveVerdictReason() never echoes invigilator free-text (claim ledger, truth, cover story)')
}

// 7. Breakdown-route lock — GET /:id/breakdown must refuse until session.ending
// is set. This is the one route allowed to return the cover story and the
// true timeline; answering mid-game would let a player read the answers
// straight off the wire via dev tools. Spins up a real Express app on an
// ephemeral port (no API key, no model call — only session creation and a
// read of the refusal) and tears it down when done.
await (async () => {
  const app = createApp()
  const server = app.listen(0)
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`

  try {
    const createRes = await fetch(`${base}/api/game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!createRes.ok) {
      fail(`breakdown-lock check could not create a session (status ${createRes.status})`)
      return
    }
    const { sessionId } = (await createRes.json()) as { sessionId: string }

    const breakdownRes = await fetch(`${base}/api/game/${sessionId}/breakdown`)
    const body = (await breakdownRes.json()) as { error?: { message?: string } }

    if (breakdownRes.status !== 403 && breakdownRes.status !== 409) {
      fail(`GET /:id/breakdown returned ${breakdownRes.status} mid-game (want 403 or 409) — hidden case data may be exposed before the game ends`)
      return
    }
    if (!body.error?.message) {
      fail('GET /:id/breakdown refused mid-game but returned no error message')
      return
    }
    pass(`GET /:id/breakdown refuses mid-game (${breakdownRes.status}) — cover story and truth timeline stay server-side`)
  } catch (err) {
    fail(`breakdown-lock check threw: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    server.close()
  }
})()

// 8. Seed never leaves the server. The seed regenerates the whole hidden case,
// so no HTTP response body or header may contain it (raw or derived), and a
// client-supplied seed/templateId must be ignored unless ALLOW_CLIENT_SEED=1
// on a non-production deploy. No API key or model call: only session
// creation, reads, and error paths are exercised; the breakdown DTO is built
// directly from a resolved session since a real ending needs model calls.
await (async () => {
  const savedEnv = { ...process.env }
  const savedLog = console.log
  const logLines: string[] = []

  // Pass-through hook: structured server log lines ({"evt":...}) are recorded
  // for the seed lookup; everything else (including this script's own
  // pass/fail output) still prints.
  console.log = (...args: unknown[]) => {
    const first = typeof args[0] === 'string' ? args[0] : ''
    if (args.length === 1 && first.startsWith('{"evt"')) logLines.push(first)
    else savedLog(...args)
  }
  const restore = () => {
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
    Object.assign(process.env, savedEnv)
    console.log = savedLog
  }
  const loggedSeed = (sid: string): string | undefined => {
    for (const line of logLines) {
      try {
        const rec = JSON.parse(line) as { evt?: string; sid?: string; seed?: string }
        if (rec.evt === 'session_created' && rec.sid === sid) return rec.seed
      } catch {
        /* not a JSON log line */
      }
    }
    return undefined
  }

  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined
  try {
    process.env.PLAYTEST_LOGS_DIR = await mkdtemp(path.join(os.tmpdir(), 'airtight-verify-'))
    delete process.env.ALLOW_CLIENT_SEED
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    process.env.SESSION_SECRET = 'verify-secret-verify-secret-verify-secret'

    // Pure-function policy checks.
    const d1 = deriveSeed('k'.repeat(40), 'raw-seed')
    if (d1 === 'raw-seed' || d1 !== deriveSeed('k'.repeat(40), 'raw-seed') || d1 === deriveSeed('j'.repeat(40), 'raw-seed')) {
      fail('deriveSeed() must be a deterministic keyed hash (differs from raw and across secrets)')
      return
    }
    if (deriveSeed(undefined, 'raw-seed') !== 'raw-seed') {
      fail('deriveSeed() without a secret must be the identity so the CLI stays reproducible')
      return
    }
    let threw = false
    try {
      assertSeedConfig({ VERCEL: '1', SESSION_SECRET: 'short' } as NodeJS.ProcessEnv)
    } catch {
      threw = true
    }
    if (!threw) {
      fail('assertSeedConfig() must reject a missing/short SESSION_SECRET on Vercel')
      return
    }
    assertSeedConfig({ VERCEL: '1', SESSION_SECRET: 'x'.repeat(32) } as NodeJS.ProcessEnv)
    assertSeedConfig({} as NodeJS.ProcessEnv)

    const pinBody = { seed: 'client-pinned-seed', templateId: 'no-such-template' }
    const ignored = chooseSeed(pinBody, { SESSION_SECRET: undefined } as NodeJS.ProcessEnv)
    if (ignored.seed === 'client-pinned-seed' || ignored.templateId !== undefined) {
      fail('chooseSeed() honoured a client seed/templateId without ALLOW_CLIENT_SEED=1')
      return
    }
    const prodFlag = chooseSeed(pinBody, { ALLOW_CLIENT_SEED: '1', VERCEL_ENV: 'production' } as NodeJS.ProcessEnv)
    if (prodFlag.seed === 'client-pinned-seed') {
      fail('chooseSeed() honoured a client seed on VERCEL_ENV=production even with the dev flag')
      return
    }
    const pinned = chooseSeed({ seed: 'client-pinned-seed' }, { ALLOW_CLIENT_SEED: '1' } as NodeJS.ProcessEnv)
    if (pinned.seed !== 'client-pinned-seed') {
      fail('chooseSeed() ignored a client seed with ALLOW_CLIENT_SEED=1 (dev replay broken)')
      return
    }

    // HTTP-level leak scan.
    const app = createApp()
    server = app.listen(0)
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`

    /** Fetches and returns status plus the full wire text (headers + body) for seed scanning. */
    const wire = async (url: string, init?: RequestInit) => {
      const res = await fetch(url, init)
      const bodyText = await res.text()
      const headerText = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')
      return { status: res.status, text: `${headerText}\n${bodyText}`, body: bodyText }
    }
    const post = (url: string, payload: unknown) =>
      wire(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

    const leaks: string[] = []
    const scan = (label: string, text: string, seeds: string[]) => {
      if (/"seed"\s*:/.test(text)) leaks.push(`${label}: response has a "seed" key`)
      for (const s of seeds) if (s && text.includes(s)) leaks.push(`${label}: response contains the seed value`)
    }

    // Sessions created with client seed fields present but the flag OFF.
    for (let i = 0; i < 3; i++) {
      const created = await post(`${base}/api/game`, pinBody)
      if (created.status !== 201) {
        fail(`seed-leak check: create returned ${created.status} (client seed fields must be ignored, not rejected)`)
        return
      }
      const sid = (JSON.parse(created.body) as { sessionId: string }).sessionId
      const seed = loggedSeed(sid)
      if (!seed) {
        fail('seed-leak check: server did not log the derived seed (session_created) for replay')
        return
      }
      if (seed === 'client-pinned-seed') {
        fail('client-supplied seed was used with ALLOW_CLIENT_SEED unset')
        return
      }
      const seeds = [seed, 'client-pinned-seed']
      scan('POST /api/game', created.text, seeds)
      scan('GET /:id', (await wire(`${base}/api/game/${sid}`)).text, seeds)
      scan('GET /:id/breakdown (mid-game 409)', (await wire(`${base}/api/game/${sid}/breakdown`)).text, seeds)
      scan('POST /:id/interrogate (bad input 400)', (await post(`${base}/api/game/${sid}/interrogate`, {})).text, seeds)
      scan('GET unknown id (404)', (await wire(`${base}/api/game/not-a-session`)).text, seeds)
    }

    // Breakdown DTO, built from a resolved session (the endpoint needs model calls to reach one).
    for (const seed of ['verify-bd-1', 'verify-bd-2']) {
      const s = createSession(seed, 'homicide')
      s.ending = 'CHARGED_WEAK'
      scan('breakdown DTO', JSON.stringify(buildBreakdown(s)), [seed])
    }

    // Public case: same check straight from toPublicCase().
    for (const seed of SEEDS.slice(0, 20)) {
      scan('toPublicCase()', JSON.stringify(toPublicCase(generate({ seed, crime: 'homicide' }))), [seed])
    }

    // Dev flag ON: the pinned seed is honoured and reproduces the same case.
    process.env.ALLOW_CLIENT_SEED = '1'
    const pinnedRes = await post(`${base}/api/game`, { seed: 'dev-pin-1' })
    const pinnedSid = (JSON.parse(pinnedRes.body) as { sessionId: string }).sessionId
    const pinnedLogged = loggedSeed(pinnedSid)
    delete process.env.ALLOW_CLIENT_SEED
    if (pinnedLogged === undefined) {
      fail('seed-leak check: no session_created log with ALLOW_CLIENT_SEED=1')
      return
    }
    // SESSION_SECRET is set here, so the stored seed is the keyed hash of the pinned seed.
    if (pinnedLogged !== deriveSeed('verify-secret-verify-secret-verify-secret', 'dev-pin-1')) {
      fail('ALLOW_CLIENT_SEED=1 did not honour the pinned seed')
      return
    }
    scan('POST /api/game (flag on)', pinnedRes.text, ['dev-pin-1', pinnedLogged])

    if (leaks.length > 0) {
      for (const l of leaks) fail(`seed leaked — ${l}`)
      return
    }
    pass('no response body or header contains a seed (create/reconnect/refusals/breakdown); client seeds ignored without ALLOW_CLIENT_SEED')
  } catch (err) {
    fail(`seed-leak check threw: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    restore()
    server?.close()
  }
})()

// 9. Session persistence over the Store. Sessions must live in the shared
// store (Redis in production), not in process memory: two separate app
// instances sharing one store must see the same session (the serverless
// case), saved changes must round-trip, TTL expiry must read as "not found",
// and a failing store must surface a generic 503 that leaks nothing. Uses
// MemoryStore behind the same interface as Upstash, so this proves the
// protocol, not Redis itself. No API key or model call.
await (async () => {
  const savedEnv = { ...process.env }
  const savedErr = console.error
  const errLines: string[] = []
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = []
  try {
    process.env.PLAYTEST_LOGS_DIR = await mkdtemp(path.join(os.tmpdir(), 'airtight-verify-'))
    delete process.env.VERCEL
    delete process.env.ALLOW_CLIENT_SEED

    // MemoryStore semantics: JSON copy on write and read, TTL via injected clock.
    let clock = 1_000_000
    const mem = new MemoryStore(() => clock)
    const original = { n: 1, nested: { a: [1, 2] } }
    await mem.setJson('k', original, 10)
    original.nested.a.push(3)
    const read1 = (await mem.getJson('k')) as typeof original
    if (read1.nested.a.length !== 2) {
      fail('MemoryStore stored a live reference; it must snapshot as JSON like Redis does')
      return
    }
    read1.n = 99
    if (((await mem.getJson('k')) as typeof original).n !== 1) {
      fail('MemoryStore returned a shared object; reads must be private copies')
      return
    }
    clock += 9_999
    if ((await mem.getJson('k')) === null) {
      fail('MemoryStore expired a key before its TTL')
      return
    }
    clock += 2
    if ((await mem.getJson('k')) !== null) {
      fail('MemoryStore returned a key after its TTL')
      return
    }

    // Two app instances, one shared store (what two Vercel function instances look like).
    const shared = new MemoryStore(() => clock)
    const appA = createApp({ store: shared })
    const appB = createApp({ store: shared })
    const sA = appA.listen(0)
    const sB = appB.listen(0)
    servers.push(sA, sB)
    const urlA = `http://127.0.0.1:${(sA.address() as { port: number }).port}`
    const urlB = `http://127.0.0.1:${(sB.address() as { port: number }).port}`

    const created = await fetch(`${urlA}/api/game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (created.status !== 201) {
      fail(`session persistence check: create returned ${created.status}`)
      return
    }
    const { sessionId, publicCase } = (await created.json()) as { sessionId: string; publicCase: { caseNumber: string } }

    const viaB = await fetch(`${urlB}/api/game/${sessionId}`)
    const viaBBody = (await viaB.json()) as { publicCase?: { caseNumber: string } }
    if (viaB.status !== 200 || viaBBody.publicCase?.caseNumber !== publicCase.caseNumber) {
      fail('a session created on one app instance was not readable from another sharing the store')
      return
    }

    // saveSession round-trip: mutate the private copy, nothing persists until saved.
    const loaded = await getSession(shared, sessionId)
    if (!loaded) {
      fail('getSession() could not load a freshly created session')
      return
    }
    loaded.session.caseStrength = 42
    const stillOld = await getSession(shared, sessionId)
    if (stillOld?.session.caseStrength === 42) {
      fail('mutating a loaded session changed the stored one before saveSession()')
      return
    }
    await saveSession(shared, sessionId, loaded)
    if ((await getSession(shared, sessionId))?.session.caseStrength !== 42) {
      fail('saveSession() did not persist the change')
      return
    }

    // Malformed and unknown ids read as 404 and never reach the store.
    let storeTouched = false
    const spy: Store = {
      getJson: async () => {
        storeTouched = true
        return null
      },
      setJson: async () => {},
      del: async () => {},
      reserve: async () => ({ ok: true }),
      adjust: async () => {},
      acquireLock: async () => true,
      releaseLock: async () => {},
      setJsonIfRev: async () => true,
      appendList: async () => {},
      getList: async () => [],
    }
    if ((await getSession(spy, '../../etc/passwd')) !== undefined || storeTouched) {
      fail('a malformed session id reached the store (must be rejected by the id pattern first)')
      return
    }
    const unknown = await fetch(`${urlA}/api/game/00000000-0000-4000-8000-000000000000`)
    if (unknown.status !== 404) {
      fail(`unknown session id returned ${unknown.status}, want 404`)
      return
    }

    // TTL: an idle session expires and reads as not found.
    clock += SESSION_TTL_SECONDS * 1000 + 1
    const expired = await fetch(`${urlB}/api/game/${sessionId}`)
    if (expired.status !== 404) {
      fail(`an expired session returned ${expired.status}, want 404`)
      return
    }

    // Store outage: generic 503, backend detail only in the server log.
    const MARKER = 'SECRET-REDIS-URL-https://leak.example/token=abc123'
    const broken: Store = {
      getJson: async () => {
        throw new Error(MARKER)
      },
      setJson: async () => {
        throw new Error(MARKER)
      },
      del: async () => {},
      reserve: async () => {
        throw new Error(MARKER)
      },
      adjust: async () => {
        throw new Error(MARKER)
      },
      acquireLock: async () => {
        throw new Error(MARKER)
      },
      releaseLock: async () => {
        throw new Error(MARKER)
      },
      setJsonIfRev: async () => {
        throw new Error(MARKER)
      },
      appendList: async () => {
        throw new Error(MARKER)
      },
      getList: async () => {
        throw new Error(MARKER)
      },
    }
    console.error = (...args: unknown[]) => {
      errLines.push(args.map(String).join(' '))
    }
    const sBroken = createApp({ store: broken }).listen(0)
    servers.push(sBroken)
    const urlBroken = `http://127.0.0.1:${(sBroken.address() as { port: number }).port}`
    const down1 = await fetch(`${urlBroken}/api/game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const down2 = await fetch(`${urlBroken}/api/game/00000000-0000-4000-8000-000000000000`)
    const downText = (await down1.text()) + (await down2.text())
    console.error = savedErr
    if (down1.status !== 503 || down2.status !== 503) {
      fail(`store outage returned ${down1.status}/${down2.status}, want 503/503`)
      return
    }
    if (downText.includes(MARKER) || downText.includes('leak.example')) {
      fail('a store failure leaked backend detail into the HTTP response')
      return
    }
    if (!errLines.some((l) => l.includes(MARKER))) {
      fail('a store failure was not logged server-side (needed to diagnose outages)')
      return
    }

    // Boot guard: Vercel without Redis credentials must refuse to start.
    let bootRefused = false
    try {
      createStore({ VERCEL: '1' } as NodeJS.ProcessEnv)
    } catch {
      bootRefused = true
    }
    if (!bootRefused) {
      fail('createStore() must throw on Vercel when Redis credentials are missing')
      return
    }
    if (!(createStore({} as NodeJS.ProcessEnv) instanceof MemoryStore)) {
      fail('createStore() without credentials must fall back to MemoryStore locally')
      return
    }

    pass('sessions persist in the shared store across app instances; TTL expiry, id validation, and store-outage 503 (no leak) hold')
  } catch (err) {
    fail(`session persistence check threw: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    console.error = savedErr
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
    Object.assign(process.env, savedEnv)
    for (const s of servers) s.close()
  }
})()

/**
 * Scripted fake model for the route-level checks (no API key). Installs itself
 * via setModel(); callers MUST setModel(null) in a finally. It tells the four
 * call types apart by the structured-output schema the SDK sends, answers each
 * with a valid zero-signal object, and reports fixed token usage so cost is
 * measurable. Knobs: `gate` holds every persona call until resolved, and
 * `failKind` makes that call type throw. `calls` counts model calls by type.
 */
const FAKE_USAGE = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 200, text: 200, reasoning: 0 },
}
/** Micro-dollars one fake call costs at Haiku 4.5 pricing ($1/M in, $5/M out). */
const FAKE_CALL_MICROS = 1000 * 1 + 200 * 5
function installFakeModel() {
  const fm = {
    calls: { suspect: 0, witness: 0, invigilator: 0 },
    gate: Promise.resolve() as Promise<void>,
    failKind: null as 'suspect' | 'witness' | 'invigilator' | null,
    // Calls of this kind never answer; they end only when the SDK aborts them (timeout / deadline).
    hangKind: null as 'suspect' | 'witness' | 'invigilator' | null,
    // Text of the error thrown when failKind matches (lets a check plant secrets in it).
    failMessage: 'fake model outage',
  }
  setModel(
    new MockLanguageModelV4({
      doGenerate: async (options) => {
        const schema = JSON.stringify(options.responseFormat ?? {})
        const kind: 'suspect' | 'witness' | 'invigilator' =
          schema.includes('guiltyKnowledgeLeak') || schema.includes('suspectContradiction')
            ? 'invigilator'
            : schema.includes('cooperative')
              ? 'witness'
              : 'suspect'
        fm.calls[kind]++
        if (kind !== 'invigilator') await fm.gate
        if (fm.hangKind === kind) {
          const sig = options.abortSignal
          await new Promise<void>((_, reject) => {
            // No signal passed = nothing can cancel this call. Fail after 4s (longer than every cap the check uses) so the check reports it instead of hanging.
            if (!sig) return void setTimeout(() => reject(new Error('fake model: no abort signal was passed')), 4000)
            if (sig.aborted) return reject(sig.reason)
            sig.addEventListener('abort', () => reject(sig.reason), { once: true })
          })
        }
        if (fm.failKind === kind) throw new Error(fm.failMessage)
        const object =
          kind === 'invigilator'
            ? schema.includes('suspectContradiction')
              ? { reasoning: 'ok', signals: { suspectContradiction: null } }
              : {
                  reasoning: 'ok',
                  signals: { contradictions: [], guiltyKnowledgeLeak: null, evidenceHandling: [], demeanorShift: false },
                }
            : {
                dialogue: 'I was at home.',
                claims: [{ text: 'The speaker was at home.', checkable: true }],
                demeanor: kind === 'witness' ? 'cooperative' : 'calm',
              }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(object) }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: FAKE_USAGE,
          warnings: [],
        }
      },
    }),
  )
  return fm
}

// 10. Spend cap is atomic and fails closed. Real route code runs whole turns
// against a scripted fake model (no API key). Proves: N parallel turns across
// many sessions admit exactly as many as the daily cap has room for (the rest
// get 429 BEFORE any model call and consume no turn); the per-session cap
// holds and a refused reservation changes no counter; a daily-cap hit blocks
// new games with a friendly message; a store outage refuses the turn (503)
// without calling the model; a failed persona call is charged only the small
// fixed amount; an invigilator failure is charged the full reservation.
// Uses MemoryStore, so this proves the reserve/settle protocol, not Redis
// atomicity (that is the Lua script's job).
await (async () => {
  const savedEnv = { ...process.env }
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = []
  const origLog = console.log
  const origErr = console.error
  try {
    process.env.PLAYTEST_LOGS_DIR = await mkdtemp(path.join(os.tmpdir(), 'airtight-verify-'))
    delete process.env.VERCEL
    delete process.env.ALLOW_CLIENT_SEED
    delete process.env.MAX_DAILY_SPEND_USD
    // Session-creation log lines are noise here; keep every other line.
    console.log = (...a: unknown[]) => {
      if (!String(a[0]).startsWith('{"evt"')) origLog(...a)
    }
    console.error = () => {}

    const fm = installFakeModel()
    const PER_CALL_MICROS = FAKE_CALL_MICROS
    const calls = fm.calls
    const resetCalls = () => {
      calls.suspect = 0
      calls.witness = 0
      calls.invigilator = 0
    }

    const post = (base: string, route: string, body: unknown = {}) =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const newGame = async (base: string) => ((await (await post(base, '/api/game')).json()) as { sessionId: string }).sessionId
    const counter = async (store: Store, key: string) => Number((await store.getJson(key)) ?? 0)
    const serve = (store: Store) => {
      const srv = createApp({ store, rateLimiter: unlimitedRateLimiter }).listen(0)
      servers.push(srv)
      return `http://127.0.0.1:${(srv.address() as { port: number }).port}`
    }
    const TURN = BUDGET_CONFIG.turnReserveUsd * 1_000_000 // 40000

    // ── A. Parallel turns across 10 sessions, daily cap = exactly 3 reservations ──
    {
      const store = new MemoryStore()
      const base = serve(store)
      process.env.MAX_DAILY_SPEND_USD = String((TURN * 3) / 1_000_000)
      const ids: string[] = []
      for (let i = 0; i < 10; i++) ids.push(await newGame(base))

      // Hold every admitted turn inside the model until all refusals have
      // returned, so no early settle can free budget mid-test.
      let release!: () => void
      fm.gate = new Promise<void>((r) => (release = r))
      resetCalls()
      let refused = 0
      const results = ids.map((id) =>
        post(base, `/api/game/${id}/interrogate`, { input: 'Where were you?' }).then((r) => {
          if (r.status === 429) refused++
          return r
        }),
      )
      const deadline = Date.now() + 5000
      while (refused < 7 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5))
      release()
      const statuses = (await Promise.all(results)).map((r) => r.status).sort()
      fm.gate = Promise.resolve()
      const okCount = statuses.filter((s) => s === 200).length
      const tooMany = statuses.filter((s) => s === 429).length
      if (okCount !== 3 || tooMany !== 7) {
        fail(`10 parallel turns with room for 3: got ${okCount}x200 and ${tooMany}x429 (${statuses.join(',')}); want exactly 3 and 7`)
        return
      }
      if (calls.suspect !== 3) {
        fail(`refused turns still reached the model: ${calls.suspect} persona calls, want 3`)
        return
      }
      // Admitted turns settle from the 40000 reservation down to their real cost.
      const spent = await counter(store, dayKey(new Date()))
      if (spent !== 3 * 2 * PER_CALL_MICROS) {
        fail(`daily counter after settle is ${spent}, want ${3 * 2 * PER_CALL_MICROS} (3 turns x 2 calls)`)
        return
      }
      // A refused turn must not have moved the session's turn counter.
      let advanced = 0
      for (const id of ids) {
        const g = (await (await fetch(`${base}/api/game/${id}`)).json()) as { interrogationTurn: number }
        advanced += g.interrogationTurn
      }
      if (advanced !== 3) {
        fail(`${advanced} sessions advanced a turn, want 3 (refused turns must not consume turns)`)
        return
      }
      delete process.env.MAX_DAILY_SPEND_USD
    }

    // ── B. Per-session cap, all-or-nothing ──────────────────────────────
    {
      const store = new MemoryStore()
      const sid = '11111111-1111-4111-8111-111111111111'
      const maxTurns = Math.floor((BUDGET_CONFIG.maxSessionSpendUsd * 1_000_000) / TURN) // 12
      for (let i = 0; i < maxTurns; i++) await reserveSpend(store, sid)
      const dayBefore = await counter(store, dayKey(new Date()))
      let code = ''
      try {
        await reserveSpend(store, sid)
      } catch (e) {
        code = (e as { code?: string }).code ?? ''
      }
      if (code !== 'BUDGET_EXCEEDED') {
        fail(`reservation ${maxTurns + 1} on one session was not refused (code "${code}")`)
        return
      }
      if ((await counter(store, dayKey(new Date()))) !== dayBefore) {
        fail('a refused reservation still incremented the daily counter (must be all-or-nothing)')
        return
      }
    }

    // ── C. Daily cap exhausted: new games get the friendly message ───────
    {
      const store = new MemoryStore()
      const base = serve(store)
      process.env.MAX_DAILY_SPEND_USD = '1'
      await store.setJson(dayKey(new Date()), 1_000_000 - TURN + 1, 3600)
      const res = await post(base, '/api/game')
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      if (res.status !== 429 || body.error?.code !== 'BUDGET_EXCEEDED' || !/resting/i.test(body.error?.message ?? '')) {
        fail(`new game with the daily budget spent returned ${res.status} ${JSON.stringify(body)}, want 429 "resting for today"`)
        return
      }
      await store.setJson(dayKey(new Date()), 1_000_000 - TURN, 3600)
      if ((await post(base, '/api/game')).status !== 201) {
        fail('new game was refused although exactly one turn of budget remains')
        return
      }
      delete process.env.MAX_DAILY_SPEND_USD
    }

    // ── D. Store outage fails closed: 503 and the model is never called ──
    {
      const inner = new MemoryStore()
      let reserveDown = false
      const flaky: Store = {
        getJson: (k) => inner.getJson(k),
        setJson: (k, v, t) => inner.setJson(k, v, t),
        del: (k) => inner.del(k),
        reserve: (l, a) => (reserveDown ? Promise.reject(new Error('SECRET-REDIS-DOWN')) : inner.reserve(l, a)),
        adjust: (k, d, t) => inner.adjust(k, d, t),
        acquireLock: (k, token, ttl) => inner.acquireLock(k, token, ttl),
        releaseLock: (k, token) => inner.releaseLock(k, token),
        setJsonIfRev: (k, rev, v, ttl) => inner.setJsonIfRev(k, rev, v, ttl),
        appendList: (k, v, t, m) => inner.appendList(k, v, t, m),
        getList: (k) => inner.getList(k),
      }
      const base = serve(flaky)
      const sid = await newGame(base)
      reserveDown = true
      resetCalls()
      const res = await post(base, `/api/game/${sid}/interrogate`, { input: 'Where were you?' })
      const text = await res.text()
      if (res.status !== 503 || text.includes('SECRET-REDIS-DOWN')) {
        fail(`turn with the spend store down returned ${res.status} (leak: ${text.includes('SECRET-REDIS-DOWN')}), want a clean 503`)
        return
      }
      if (calls.suspect + calls.invigilator !== 0) {
        fail('a paid model call was made although the spend could not be reserved')
        return
      }
    }

    // ── E. Failed persona call: charged only the small fixed amount ──────
    {
      const store = new MemoryStore()
      const base = serve(store)
      const sid = await newGame(base)
      fm.failKind = 'suspect'
      const res = await post(base, `/api/game/${sid}/interrogate`, { input: 'Where were you?' })
      fm.failKind = null
      const charged = await counter(store, dayKey(new Date()))
      const want = BUDGET_CONFIG.failedTurnChargeUsd * 1_000_000
      if (res.status !== 502 || charged !== want) {
        fail(`failed persona turn: status ${res.status}, charged ${charged}; want 502 and ${want}`)
        return
      }
    }

    // ── F. Invigilator failure: charged the full reservation ─────────────
    {
      const store = new MemoryStore()
      const base = serve(store)
      const sid = await newGame(base)
      fm.failKind = 'invigilator'
      const res = await post(base, `/api/game/${sid}/interrogate`, { input: 'Where were you?' })
      fm.failKind = null
      const charged = await counter(store, dayKey(new Date()))
      if (res.status !== 200 || charged !== TURN) {
        fail(`invigilator-failure turn: status ${res.status}, charged ${charged}; want 200 and ${TURN}`)
        return
      }
    }

    pass('spend cap: parallel turns admit exactly the budget (rest 429, no model call, no turn used); per-session cap, daily-cap game block, fail-closed 503, and failed-turn charges hold')
  } catch (err) {
    fail(`spend cap check threw: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    console.log = origLog
    console.error = origErr
    setModel(null)
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
    Object.assign(process.env, savedEnv)
    for (const sv of servers) sv.close()
  }
})()

// 11. Turn-limit race. Parallel requests at ONE session must not exceed the
// turn limits or lose updates. Proves: a per-session lock admits one request
// at a time (the rest get 409 before any reservation or model call); hammering
// one session with parallel suspect+witness requests accepts exactly 6 suspect
// and 2 witness turns; the lock is released after success AND failure (the
// next request is never a spurious 409); a stale write is refused by the
// revision compare-and-set (the backstop if a lock expires mid-request); an
// expired holder cannot release a newer holder's lock; and a lock-store outage
// fails closed (503, no model call). MemoryStore again: this proves the
// protocol; Lua/NX atomicity on Redis is Redis's guarantee.
await (async () => {
  const savedEnv = { ...process.env }
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = []
  const origLog = console.log
  const origErr = console.error
  try {
    process.env.PLAYTEST_LOGS_DIR = await mkdtemp(path.join(os.tmpdir(), 'airtight-verify-'))
    delete process.env.VERCEL
    delete process.env.ALLOW_CLIENT_SEED
    delete process.env.MAX_DAILY_SPEND_USD
    console.log = (...a: unknown[]) => {
      if (!String(a[0]).startsWith('{"evt"')) origLog(...a)
    }
    console.error = () => {}
    const fm = installFakeModel()
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const post = (base: string, route: string, body: unknown = {}) =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const serve = (store: Store) => {
      const srv = createApp({ store, rateLimiter: unlimitedRateLimiter }).listen(0)
      servers.push(srv)
      return `http://127.0.0.1:${(srv.address() as { port: number }).port}`
    }
    const newGame = async (base: string) => ((await (await post(base, '/api/game')).json()) as { sessionId: string }).sessionId
    const turnOf = async (store: Store, sid: string) => {
      const st = await getSession(store, sid)
      return { suspect: st?.session.interrogationTurn ?? -1, witness: st?.session.witnessTurn ?? -1 }
    }
    const Q = { input: 'Where were you?' }
    const W = { question: 'What did you see?' }

    // ── A. Held lock: concurrent requests on one session, one admitted ──
    {
      const store = new MemoryStore()
      const base = serve(store)
      const sid = await newGame(base)
      let release!: () => void
      fm.gate = new Promise<void>((r) => (release = r))
      const results = Array.from({ length: 8 }, () => post(base, `/api/game/${sid}/interrogate`, Q))
      const deadline = Date.now() + 5000
      while (fm.calls.suspect < 1 && Date.now() < deadline) await sleep(5)
      await sleep(50) // let the losers reach the lock and get refused
      release()
      const statuses = (await Promise.all(results)).map((r) => r.status).sort()
      fm.gate = Promise.resolve()
      const ok = statuses.filter((x) => x === 200).length
      const conflicts = statuses.filter((x) => x === 409).length
      if (ok !== 1 || conflicts !== 7) {
        fail(`8 parallel turns on one session: got ${ok}x200 and ${conflicts}x409 (${statuses.join(',')}); want 1 and 7`)
        return
      }
      if (fm.calls.suspect !== 1) {
        fail(`${fm.calls.suspect} persona calls for 8 parallel requests on one session, want 1 (losers must not spend)`)
        return
      }
      const t = await turnOf(store, sid)
      if (t.suspect !== 1) {
        fail(`session advanced ${t.suspect} turns, want 1`)
        return
      }
    }

    // ── B. Hammer one session: exactly 6 suspect + 2 witness turns ──────
    {
      const store = new MemoryStore()
      const base = serve(store)
      const sid = await newGame(base)
      // Unlock the witness (needs Case Strength above the threshold) by editing the stored copy.
      const st = await getSession(store, sid)
      if (!st) {
        fail('could not load the session to unlock the witness')
        return
      }
      st.session.caseStrength = 60
      await saveSession(store, sid, st)
      for (const k of Object.keys(fm.calls) as (keyof typeof fm.calls)[]) fm.calls[k] = 0

      let suspectOk = 0
      let witnessOk = 0
      const run = async (route: 'interrogate' | 'witness') => {
        const r = await post(base, `/api/game/${sid}/${route}`, route === 'interrogate' ? Q : W)
        if (r.status === 200) route === 'interrogate' ? suspectOk++ : witnessOk++
        else if (r.status !== 409) throw new Error(`${route} returned ${r.status}, want 200 or 409`)
      }
      // Wave 1 is witness-only so the witness is opened before the suspect turns run out
      // (a finished suspect phase with the witness unopened ends the game).
      await Promise.all(Array.from({ length: 6 }, () => run('witness')))
      for (let wave = 0; wave < 60; wave++) {
        const g = (await (await fetch(`${base}/api/game/${sid}`)).json()) as { ending: string | null }
        if (g.ending) break
        await Promise.all([
          ...Array.from({ length: 6 }, () => run('interrogate')),
          ...Array.from({ length: 6 }, () => run('witness')),
        ])
      }
      if (suspectOk !== 6 || witnessOk !== 2) {
        fail(`hammering one session accepted ${suspectOk} suspect and ${witnessOk} witness turns, want exactly 6 and 2`)
        return
      }
      const seen = { ...fm.calls } // a copy: the earlier `calls.suspect !== 1` guard narrows the live property's type
      if (seen.suspect !== 6 || seen.witness !== 2) {
        fail(`model saw ${seen.suspect} suspect and ${seen.witness} witness persona calls, want 6 and 2`)
        return
      }
      const t = await turnOf(store, sid)
      if (t.suspect !== 6 || t.witness !== 2) {
        fail(`stored session has ${t.suspect}/${t.witness} turns, want 6/2`)
        return
      }
    }

    // ── C. Lock released after success AND after a failed turn ──────────
    {
      const store = new MemoryStore()
      const base = serve(store)
      const sid = await newGame(base)
      for (let i = 0; i < 2; i++) {
        const r = await post(base, `/api/game/${sid}/interrogate`, Q)
        if (r.status !== 200) {
          fail(`sequential turn ${i + 1} returned ${r.status}, want 200 (lock must be released before the response)`)
          return
        }
      }
      fm.failKind = 'suspect'
      const failed = await post(base, `/api/game/${sid}/interrogate`, Q)
      fm.failKind = null
      const after = await post(base, `/api/game/${sid}/interrogate`, Q)
      if (failed.status !== 502 || after.status !== 200) {
        fail(`after a failed turn: failed=${failed.status} (want 502), next=${after.status} (want 200, not a stuck-lock 409)`)
        return
      }
    }

    // ── D. Stale write refused (lock expired mid-request backstop) ──────
    {
      // End to end: request 1 is in flight, its lock vanishes (as if the TTL ran out),
      // request 2 gets in. Both finish; only the first save may win.
      const store = new MemoryStore()
      const base = serve(store)
      const sid = await newGame(base)
      for (const k of Object.keys(fm.calls) as (keyof typeof fm.calls)[]) fm.calls[k] = 0
      let release!: () => void
      fm.gate = new Promise<void>((r) => (release = r))
      const first = post(base, `/api/game/${sid}/interrogate`, Q)
      let deadline = Date.now() + 5000
      while (fm.calls.suspect < 1 && Date.now() < deadline) await sleep(5)
      await store.del(`lock:${sid}`)
      const second = post(base, `/api/game/${sid}/interrogate`, Q)
      deadline = Date.now() + 5000
      while (fm.calls.suspect < 2 && Date.now() < deadline) await sleep(5)
      release()
      const statuses = [(await first).status, (await second).status].sort()
      fm.gate = Promise.resolve()
      const t = await turnOf(store, sid)
      if (statuses.join(',') !== '200,409' || t.suspect !== 1) {
        fail(`stale-write race: statuses ${statuses.join(',')}, stored turns ${t.suspect}; want 200,409 and 1 turn`)
        return
      }
      // Unit level: two copies loaded at the same revision; the second save must be refused untouched.
      const a = await getSession(store, sid)
      const b = await getSession(store, sid)
      if (!a || !b) {
        fail('could not reload the session')
        return
      }
      a.session.caseStrength = 41
      await saveSession(store, sid, a)
      b.session.caseStrength = 99
      let code = 0
      try {
        await saveSession(store, sid, b)
      } catch (e) {
        code = (e as { status?: number }).status ?? 0
      }
      const final = await getSession(store, sid)
      if (code !== 409 || final?.session.caseStrength !== 41) {
        fail(`stale save: status ${code}, stored caseStrength ${final?.session.caseStrength}; want 409 and 41 (first writer wins)`)
        return
      }
    }

    // ── E. An expired holder cannot release a newer holder's lock ───────
    {
      let clock = 1_000_000
      const store = new MemoryStore(() => clock)
      const key = 'lock:test'
      if (!(await store.acquireLock(key, 'holder-1', SESSION_LOCK_TTL_MS))) {
        fail('first acquire of a free lock failed')
        return
      }
      if (await store.acquireLock(key, 'holder-2', SESSION_LOCK_TTL_MS)) {
        fail('a held lock was acquired a second time')
        return
      }
      clock += SESSION_LOCK_TTL_MS + 1
      if (!(await store.acquireLock(key, 'holder-2', SESSION_LOCK_TTL_MS))) {
        fail('an expired lock could not be re-acquired')
        return
      }
      await store.releaseLock(key, 'holder-1') // late release from the dead holder
      if (await store.acquireLock(key, 'holder-3', SESSION_LOCK_TTL_MS)) {
        fail('a stale holder released a lock now owned by someone else')
        return
      }
      if (SESSION_LOCK_TTL_MS <= 60_000) {
        fail('lock TTL must exceed the 60s function limit (vercel.json maxDuration)')
        return
      }
    }

    // ── F. Lock store down: fail closed (503), no model call, no id-to-key injection ──
    {
      const inner = new MemoryStore()
      let lockDown = false
      let locksTouched = 0
      const flaky: Store = {
        getJson: (k) => inner.getJson(k),
        setJson: (k, v, t) => inner.setJson(k, v, t),
        del: (k) => inner.del(k),
        reserve: (l, a) => inner.reserve(l, a),
        adjust: (k, d, t) => inner.adjust(k, d, t),
        acquireLock: (k, tok, ms) => {
          locksTouched++
          return lockDown ? Promise.reject(new Error('SECRET-LOCK-DOWN')) : inner.acquireLock(k, tok, ms)
        },
        releaseLock: (k, tok) => inner.releaseLock(k, tok),
        setJsonIfRev: (k, r, v, t) => inner.setJsonIfRev(k, r, v, t),
        appendList: (k, v, t, m) => inner.appendList(k, v, t, m),
        getList: (k) => inner.getList(k),
      }
      const base = serve(flaky)
      const sid = await newGame(base)
      lockDown = true
      for (const k of Object.keys(fm.calls) as (keyof typeof fm.calls)[]) fm.calls[k] = 0
      const res = await post(base, `/api/game/${sid}/interrogate`, Q)
      const text = await res.text()
      if (res.status !== 503 || text.includes('SECRET-LOCK-DOWN')) {
        fail(`turn with the lock store down returned ${res.status} (leak: ${text.includes('SECRET-LOCK-DOWN')}), want a clean 503`)
        return
      }
      if (fm.calls.suspect + fm.calls.invigilator !== 0) {
        fail('a paid model call was made without holding the session lock')
        return
      }
      locksTouched = 0
      let code = 0
      try {
        await withSessionLock(flaky, '../../etc/passwd', async () => 'ran')
      } catch (e) {
        code = (e as { status?: number }).status ?? 0
      }
      if (code !== 404 || locksTouched !== 0) {
        fail(`malformed session id under lock: status ${code}, store touched ${locksTouched}x; want 404 and 0`)
        return
      }
    }

    pass('turn race: one request per session at a time (rest 409, no spend); parallel hammering accepts exactly 6 suspect + 2 witness turns; lock freed after success/failure; stale writes refused; fail-closed 503')
  } catch (err) {
    fail(`turn race check threw: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    console.log = origLog
    console.error = origErr
    setModel(null)
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
    Object.assign(process.env, savedEnv)
    for (const sv of servers) sv.close()
  }
})()

// 12. Failed-turn rollback. A turn whose PERSONA call fails must leave the
// stored session byte-identical: the engine mutates the session before that
// call (turn counter, phase, evidence.presented, witnessUsed), so anything that
// persisted those mutations would burn a turn or an evidence item for free. A
// failed INVIGILATOR call is different: it commits a zero-delta turn. The route
// has no manual rollback; it works because the loaded session is a private copy
// that is saved only after success. MemoryStore, fake model, no API key.
await (async () => {
  const savedEnv = { ...process.env }
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = []
  const origLog = console.log
  const origErr = console.error
  try {
    process.env.PLAYTEST_LOGS_DIR = await mkdtemp(path.join(os.tmpdir(), 'airtight-verify-'))
    delete process.env.VERCEL
    delete process.env.ALLOW_CLIENT_SEED
    delete process.env.MAX_DAILY_SPEND_USD
    console.log = (...a: unknown[]) => {
      if (!String(a[0]).startsWith('{"evt"')) origLog(...a)
    }
    console.error = () => {}
    const fm = installFakeModel()
    const post = (base: string, route: string, body: unknown = {}) =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const store = new MemoryStore()
    const srv = createApp({ store, rateLimiter: unlimitedRateLimiter }).listen(0)
    servers.push(srv)
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
    const newGame = async () => ((await (await post(base, '/api/game')).json()) as { sessionId: string }).sessionId
    // Raw stored text: comparing it proves "byte-identical", including rev and every nested field.
    const rawOf = async (sid: string) => JSON.stringify(await store.getJson(`sess:${sid}`))

    // ── A. Suspect persona failure on PRESENT e1: nothing persists ──────
    {
      const sid = await newGame()
      const before = await rawOf(sid)
      fm.failKind = 'suspect'
      const res = await post(base, `/api/game/${sid}/interrogate`, { input: 'PRESENT e1: Explain this.' })
      fm.failKind = null
      const after = await rawOf(sid)
      const st = await getSession(store, sid)
      if (res.status !== 502) {
        fail(`failed persona call returned ${res.status}, want 502`)
        return
      }
      if (after !== before) {
        fail('a failed persona call changed the stored session (must be byte-identical)')
        return
      }
      if (st?.session.caseFile.evidence.find((e) => e.id === 'e1')?.presented !== false || st.session.interrogationTurn !== 0) {
        fail('failed PRESENT e1 left e1 presented or advanced the turn counter')
        return
      }
      const retry = await post(base, `/api/game/${sid}/interrogate`, { input: 'PRESENT e1: Explain this.' })
      const st2 = await getSession(store, sid)
      if (retry.status !== 200 || st2?.session.caseFile.evidence.find((e) => e.id === 'e1')?.presented !== true) {
        fail(`retry after a failed PRESENT: status ${retry.status}, e1 presented ${st2?.session.caseFile.evidence.find((e) => e.id === 'e1')?.presented}; want 200 and true (item not burned)`)
        return
      }
    }

    // ── B. Witness persona failure: nothing persists (witnessUsed, phase, turn) ──
    {
      const sid = await newGame()
      const st = await getSession(store, sid)
      if (!st) {
        fail('could not load the session to unlock the witness')
        return
      }
      st.session.caseStrength = 60
      await saveSession(store, sid, st)
      const before = await rawOf(sid)
      fm.failKind = 'witness'
      const res = await post(base, `/api/game/${sid}/witness`, { question: 'What did you see?' })
      fm.failKind = null
      const after = await rawOf(sid)
      if (res.status !== 502 || after !== before) {
        fail(`failed witness call: status ${res.status}, stored session changed ${after !== before}; want 502 and unchanged`)
        return
      }
      const retry = await post(base, `/api/game/${sid}/witness`, { question: 'What did you see?' })
      if (retry.status !== 200) {
        fail(`witness retry after a failure returned ${retry.status}, want 200`)
        return
      }
    }

    // ── C. Invigilator failure still commits a zero-delta turn ──────────
    {
      const sid = await newGame()
      fm.failKind = 'invigilator'
      const res = await post(base, `/api/game/${sid}/interrogate`, { input: 'PRESENT e2: Explain this.' })
      fm.failKind = null
      const body = (await res.json()) as { caseStrengthDelta?: number }
      const st = await getSession(store, sid)
      if (
        res.status !== 200 ||
        body.caseStrengthDelta !== 0 ||
        st?.session.interrogationTurn !== 1 ||
        st.session.caseFile.evidence.find((e) => e.id === 'e2')?.presented !== true
      ) {
        fail(`invigilator failure: status ${res.status}, delta ${body.caseStrengthDelta}, turn ${st?.session.interrogationTurn}; want 200, 0 and 1 with e2 presented`)
        return
      }
    }

    pass('failed-turn rollback: a failed persona call (suspect or witness) leaves the stored session byte-identical and the evidence item unspent; an invigilator failure commits a zero-delta turn')
  } catch (err) {
    fail(`failed-turn rollback check threw: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    console.log = origLog
    console.error = origErr
    setModel(null)
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
    Object.assign(process.env, savedEnv)
    for (const sv of servers) sv.close()
  }
})()

// 13. Per-IP rate limiting. Proves: the client IP is read from the right place
// (Vercel's own header on Vercel, the socket locally — a spoofed
// X-Forwarded-For must NOT buy a fresh bucket; IPv6 is keyed by /64); the
// sliding window refuses the N+1th hit with a Retry-After, forgives it after the
// window, and keeps IPs and buckets apart; at route level a throttled request
// gets 429 RATE_LIMITED BEFORE any lock, spend reservation or model call, the
// two turn routes share one bucket, and a limiter outage fails open. Memory
// limiter with an injected clock; the Upstash sliding window is Upstash's code.
await (async () => {
  const savedEnv = { ...process.env }
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = []
  const origLog = console.log
  const origErr = console.error
  try {
    process.env.PLAYTEST_LOGS_DIR = await mkdtemp(path.join(os.tmpdir(), 'airtight-verify-'))
    delete process.env.VERCEL
    delete process.env.ALLOW_CLIENT_SEED
    delete process.env.MAX_DAILY_SPEND_USD
    console.log = (...a: unknown[]) => {
      if (!String(a[0]).startsWith('{"evt"')) origLog(...a)
    }
    console.error = () => {}

    // ── A. Which IP counts ──────────────────────────────────────────────
    {
      const sock = (addr: string) => ({ remoteAddress: addr }) as never
      const req = (headers: Record<string, string>, addr = '10.0.0.9') => ({ headers, socket: sock(addr) })
      const local = {} as NodeJS.ProcessEnv
      const vercel = { VERCEL: '1' } as NodeJS.ProcessEnv
      const cases: [string, string, string][] = [
        ['local ignores a spoofed x-forwarded-for', clientIp(req({ 'x-forwarded-for': '1.2.3.4' }), local), '10.0.0.9'],
        ['local ignores a spoofed x-vercel-forwarded-for', clientIp(req({ 'x-vercel-forwarded-for': '1.2.3.4' }), local), '10.0.0.9'],
        ['vercel uses x-vercel-forwarded-for', clientIp(req({ 'x-vercel-forwarded-for': '1.2.3.4' }), vercel), '1.2.3.4'],
        ['vercel takes the first of a list', clientIp(req({ 'x-vercel-forwarded-for': '1.2.3.4, 5.6.7.8' }), vercel), '1.2.3.4'],
        ['vercel falls back to x-real-ip', clientIp(req({ 'x-real-ip': '9.9.9.9' }), vercel), '9.9.9.9'],
        ['vercel with no usable header is one shared bucket', clientIp(req({}), vercel), 'unknown'],
        ['garbage header is not trusted', clientIp(req({ 'x-vercel-forwarded-for': 'not-an-ip' }), vercel), 'unknown'],
        ['ipv4-mapped ipv6 becomes the ipv4', clientIp(req({}, '::ffff:7.7.7.7'), local), '7.7.7.7'],
        ['ipv6 keyed by /64 (a)', normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd') ?? '', '2001:db8:1:2::/64'],
        ['ipv6 keyed by /64 (b, same subnet)', normalizeIp('2001:db8:1:2::1') ?? '', '2001:db8:1:2::/64'],
        ['ipv6 /64 differs across subnets', normalizeIp('2001:db8:1:3::1') ?? '', '2001:db8:1:3::/64'],
      ]
      for (const [name, got, want] of cases) {
        if (got !== want) {
          fail(`client IP: ${name}: got "${got}", want "${want}"`)
          return
        }
      }
    }

    // ── B. Sliding window semantics ─────────────────────────────────────
    const tiny = {
      create: { limit: 3, windowSeconds: 3600 },
      turn: { limit: 2, windowSeconds: 600 },
      read: { limit: 2, windowSeconds: 60 },
    }
    {
      let clock = 1_000_000
      const rl = createMemoryRateLimiter(() => clock, tiny)
      const hit = async (b: 'create' | 'turn' | 'read', ip: string) => rl.check(b, ip)
      for (let i = 0; i < 2; i++) if (!(await hit('turn', 'a')).ok) return fail('turn hit within the limit was refused')
      const over = await hit('turn', 'a')
      if (over.ok || over.retryAfterSeconds < 1 || over.retryAfterSeconds > 600) {
        return fail(`3rd turn hit: ${JSON.stringify(over)}; want refused with 1..600s retry`)
      }
      if (!(await hit('turn', 'b')).ok) return fail('a different IP shared another IP\'s bucket')
      if (!(await hit('read', 'a')).ok) return fail('the read bucket shared the turn bucket')
      clock += 601_000
      if (!(await hit('turn', 'a')).ok) return fail('turn hits were not forgiven after the window')
    }

    // ── C. Route level ──────────────────────────────────────────────────
    const fm = installFakeModel()
    const store = new MemoryStore()
    let clock = 5_000_000
    const rl = createMemoryRateLimiter(() => clock, tiny)
    const srv = createApp({ store, rateLimiter: rl }).listen(0)
    servers.push(srv)
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
    // A new X-Forwarded-For each time: if it bought a fresh bucket, the limit below would never trip.
    let spoof = 0
    const call = (method: string, route: string, body?: unknown) =>
      fetch(`${base}${route}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${++spoof}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = await call('POST', '/api/game', {})
      if (r.status !== 201 && r.status !== 200) return fail(`create ${i + 1} within the limit returned ${r.status}`)
      ids.push(((await r.json()) as { sessionId: string }).sessionId)
    }
    const blockedCreate = await call('POST', '/api/game', {})
    const blockedBody = (await blockedCreate.json()) as { error?: { code?: string; message?: string } }
    const retry = Number(blockedCreate.headers.get('retry-after'))
    if (
      blockedCreate.status !== 429 ||
      blockedBody.error?.code !== 'RATE_LIMITED' ||
      !Number.isInteger(retry) ||
      retry < 1
    ) {
      return fail(`4th create: status ${blockedCreate.status}, code ${blockedBody.error?.code}, Retry-After ${retry}; want 429 RATE_LIMITED with Retry-After >= 1 (and a spoofed X-Forwarded-For must not help)`)
    }
    if (!blockedBody.error?.message || /undefined|\[object/.test(blockedBody.error.message)) {
      return fail('rate-limit message is not a clean sentence')
    }

    // turn routes share ONE bucket, and a throttled turn costs nothing
    const sid = ids[0]
    const t1 = await call('POST', `/api/game/${sid}/interrogate`, { input: 'Where were you?' })
    const t2 = await call('POST', `/api/game/${sid}/witness`, { question: 'What did you see?' }) // counts even though the witness is still locked (409)
    const spendBefore = await store.getJson(dayKey(new Date()))
    const callsBefore = { ...fm.calls }
    const t3 = await call('POST', `/api/game/${sid}/interrogate`, { input: 'Where were you?' })
    const spendAfter = await store.getJson(dayKey(new Date()))
    const callsAfter = { ...fm.calls }
    if (t1.status !== 200 || t2.status !== 409 || t3.status !== 429) {
      return fail(`shared turn bucket: statuses ${t1.status}/${t2.status}/${t3.status}; want 200/409/429`)
    }
    if (spendAfter !== spendBefore || JSON.stringify(callsAfter) !== JSON.stringify(callsBefore)) {
      return fail('a rate-limited turn reserved spend or called the model')
    }
    if ((await getSession(store, sid))?.session.interrogationTurn !== 1) {
      return fail('a rate-limited turn changed the session')
    }

    // read bucket, then recovery once the window passes
    const g = [await call('GET', `/api/game/${sid}`), await call('GET', `/api/game/${sid}`), await call('GET', `/api/game/${sid}`)]
    if (g[0].status !== 200 || g[1].status !== 200 || g[2].status !== 429) {
      return fail(`read bucket: ${g.map((x) => x.status).join('/')}; want 200/200/429`)
    }
    clock += 601_000
    const again = await call('POST', `/api/game/${sid}/interrogate`, { input: 'Walk me through it again.' })
    if (again.status !== 200) return fail(`turn after the window passed returned ${again.status}, want 200`)

    // ── D. Limiter outage fails open ────────────────────────────────────
    {
      const broken: RateLimiter = { check: () => Promise.reject(new Error('SECRET-RL-DOWN')) }
      const s2 = createApp({ store: new MemoryStore(), rateLimiter: broken }).listen(0)
      servers.push(s2)
      const b2 = `http://127.0.0.1:${(s2.address() as { port: number }).port}`
      const r = await fetch(`${b2}/api/game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const text = await r.text()
      if ((r.status !== 200 && r.status !== 201) || text.includes('SECRET-RL-DOWN')) {
        return fail(`create with the limiter down: status ${r.status}, leak ${text.includes('SECRET-RL-DOWN')}; want it to fail open`)
      }
    }

    // sanity: the unlimited limiter used by the heavy checks really is unlimited
    for (let i = 0; i < 200; i++) if (!(await unlimitedRateLimiter.check('turn', 'x')).ok) return fail('unlimitedRateLimiter refused')

    pass('rate limits: IP read from the trusted header only (spoofed X-Forwarded-For ignored, IPv6 by /64); sliding window with Retry-After; throttled requests cost nothing (no lock, spend or model call); turn routes share a bucket; limiter outage fails open')
  } catch (err) {
    fail(`rate limit check threw: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    console.log = origLog
    console.error = origErr
    setModel(null)
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
    Object.assign(process.env, savedEnv)
    for (const sv of servers) sv.close()
  }
})()

// 14. Timeouts. A hung model call must not hang the request. Proves, with a
// fake model that never answers and short injected limits: a hung PERSONA call
// ends within its cap as a 504 MODEL_TIMEOUT, leaves the stored session
// byte-identical, releases the lock (the retry works) and charges only the small
// failed-turn amount; a hung INVIGILATOR commits a zero-delta turn after its
// per-attempt cap (3 attempts); the request-wide deadline cuts the invigilator
// retries short (1 attempt) and still returns the turn; a timeout error never
// echoes provider text. MemoryStore, no API key.
await (async () => {
  const savedEnv = { ...process.env }
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = []
  const origLog = console.log
  const origErr = console.error
  try {
    process.env.PLAYTEST_LOGS_DIR = await mkdtemp(path.join(os.tmpdir(), 'airtight-verify-'))
    delete process.env.VERCEL
    delete process.env.ALLOW_CLIENT_SEED
    delete process.env.MAX_DAILY_SPEND_USD
    console.log = (...a: unknown[]) => {
      if (!String(a[0]).startsWith('{"evt"')) origLog(...a)
    }
    console.error = () => {}
    const fm = installFakeModel()
    const post = (base: string, route: string, body: unknown = {}) =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const store = new MemoryStore()
    const start = (turnTimeouts: { requestMs: number; personaMs: number; invigilatorAttemptMs: number }) => {
      const srv = createApp({ store, rateLimiter: unlimitedRateLimiter, turnTimeouts }).listen(0)
      servers.push(srv)
      return `http://127.0.0.1:${(srv.address() as { port: number }).port}`
    }
    const newGame = async (base: string) => ((await (await post(base, '/api/game')).json()) as { sessionId: string }).sessionId
    const rawOf = async (sid: string) => JSON.stringify(await store.getJson(`sess:${sid}`))
    const spentOf = async (sid: string) => Number(await store.getJson(`spend:sess:${sid}`)) || 0

    // ── A. Persona cap: hung suspect call -> 504 within the cap, nothing saved ──
    {
      const base = start({ requestMs: 5000, personaMs: 200, invigilatorAttemptMs: 5000 })
      const sid = await newGame(base)
      const before = await rawOf(sid)
      fm.hangKind = 'suspect'
      const t0 = Date.now()
      const res = await post(base, `/api/game/${sid}/interrogate`, { input: 'PRESENT e1: Explain this.' })
      const took = Date.now() - t0
      fm.hangKind = null
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      if (res.status !== 504 || body.error?.code !== 'MODEL_TIMEOUT') {
        fail(`hung persona call: status ${res.status}, code ${body.error?.code}; want 504 MODEL_TIMEOUT`)
        return
      }
      if (took > 2500) {
        fail(`hung persona call took ${took}ms with a 200ms cap`)
        return
      }
      if ((await rawOf(sid)) !== before) {
        fail('a timed-out persona call changed the stored session (must be byte-identical)')
        return
      }
      if ((await spentOf(sid)) !== 3000) {
        fail(`timed-out turn was charged ${await spentOf(sid)} micro-dollars, want the 3000 failed-turn amount`)
        return
      }
      const retry = await post(base, `/api/game/${sid}/interrogate`, { input: 'PRESENT e1: Explain this.' })
      if (retry.status !== 200) {
        fail(`retry after a timeout returned ${retry.status}, want 200 (lock must be released, evidence unspent)`)
        return
      }
    }

    // ── B. Request deadline beats a longer persona cap ──────────────────
    {
      const base = start({ requestMs: 200, personaMs: 5000, invigilatorAttemptMs: 5000 })
      const sid = await newGame(base)
      fm.hangKind = 'witness'
      const st = await getSession(store, sid)
      if (!st) {
        fail('could not load the session to unlock the witness')
        return
      }
      st.session.caseStrength = 60
      await saveSession(store, sid, st)
      const before = await rawOf(sid)
      const t0 = Date.now()
      const res = await post(base, `/api/game/${sid}/witness`, { question: 'What did you see?' })
      const took = Date.now() - t0
      fm.hangKind = null
      if (res.status !== 504 || took > 2500 || (await rawOf(sid)) !== before) {
        fail(`witness past the request deadline: status ${res.status}, ${took}ms, unchanged ${(await rawOf(sid)) === before}; want 504, fast, unchanged`)
        return
      }
    }

    // ── C. Hung invigilator: per-attempt cap, 3 attempts, zero-delta turn ──
    {
      const base = start({ requestMs: 5000, personaMs: 5000, invigilatorAttemptMs: 150 })
      const sid = await newGame(base)
      fm.calls.invigilator = 0
      fm.hangKind = 'invigilator'
      const t0 = Date.now()
      const res = await post(base, `/api/game/${sid}/interrogate`, { input: 'Where were you?' })
      const took = Date.now() - t0
      fm.hangKind = null
      const body = (await res.json()) as { caseStrengthDelta?: number }
      const st = await getSession(store, sid)
      if (res.status !== 200 || body.caseStrengthDelta !== 0 || st?.session.interrogationTurn !== 1) {
        fail(`hung invigilator: status ${res.status}, delta ${body.caseStrengthDelta}, turn ${st?.session.interrogationTurn}; want 200, 0, 1`)
        return
      }
      if (fm.calls.invigilator !== 3 || took > 3500) {
        fail(`hung invigilator: ${fm.calls.invigilator} attempts in ${took}ms; want 3 attempts, each cut at 150ms`)
        return
      }
    }

    // ── D. Request deadline stops invigilator retries ───────────────────
    {
      const base = start({ requestMs: 600, personaMs: 5000, invigilatorAttemptMs: 5000 })
      const sid = await newGame(base)
      fm.calls.invigilator = 0
      fm.hangKind = 'invigilator'
      const t0 = Date.now()
      const res = await post(base, `/api/game/${sid}/interrogate`, { input: 'Where were you?' })
      const took = Date.now() - t0
      fm.hangKind = null
      const body = (await res.json()) as { caseStrengthDelta?: number }
      if (res.status !== 200 || body.caseStrengthDelta !== 0 || fm.calls.invigilator !== 1 || took > 3000) {
        fail(`deadline during invigilator: status ${res.status}, delta ${body.caseStrengthDelta}, ${fm.calls.invigilator} attempts, ${took}ms; want 200, 0, exactly 1 attempt`)
        return
      }
    }

    pass('timeouts: a hung persona call ends at its cap as 504 MODEL_TIMEOUT with the session byte-identical, the lock released and only the small failed-turn charge; the request deadline overrides a longer cap; a hung invigilator is cut per attempt and commits a zero-delta turn; the deadline stops further invigilator retries')
  } catch (err) {
    fail(`timeout check threw: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    console.log = origLog
    console.error = origErr
    setModel(null)
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
    Object.assign(process.env, savedEnv)
    for (const sv of servers) sv.close()
  }
})()

// 15. Error and log hygiene. Proves: a failed model call never echoes provider
// text to the player (fixed friendly sentence, 502); the real cause IS logged
// server-side as one JSON line with sid/phase/turn; secrets planted in the
// error (API key, Bearer token, URL credentials) are redacted from every log
// line; an invigilator fallback is logged with kind/turn/attempts; malformed
// JSON is a 400 and an oversized body a 413 (never a 500, no stack or file
// paths in the body); scrub() handles env values, key shapes and short values.
await (async () => {
  const savedEnv = { ...process.env }
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = []
  const origLog = console.log
  const origErr = console.error
  const lines: string[] = []
  // fail()/pass() print with console.log, which this check captures; restore it first.
  const restore = () => {
    console.log = origLog
    console.error = origErr
  }
  const failOut = (msg: string) => {
    restore()
    fail(msg)
  }
  try {
    process.env.PLAYTEST_LOGS_DIR = await mkdtemp(path.join(os.tmpdir(), 'airtight-verify-'))
    delete process.env.VERCEL
    delete process.env.ALLOW_CLIENT_SEED
    delete process.env.MAX_DAILY_SPEND_USD
    const KEY = 'sk-ant-api03-SECRETSECRETSECRET1234'
    process.env.ANTHROPIC_API_KEY = KEY
    process.env.SESSION_SECRET = 'verify-session-secret-0123456789abcdef'
    // Capture every server log line instead of printing it.
    console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '))
    console.error = (...a: unknown[]) => void lines.push(a.map(String).join(' '))

    // ── scrub(): the pure part ───────────────────────────────────────────
    {
      const env = { ANTHROPIC_API_KEY: 'envkey-VALUE-12345', SESSION_SECRET: 'short' } as NodeJS.ProcessEnv
      const cases: Array<[string, string, (out: string) => boolean]> = [
        ['env value', 'bad key envkey-VALUE-12345 here', (o) => !o.includes('envkey-VALUE-12345') && o.includes('[redacted]')],
        ['sk-ant shape', 'x sk-ant-api03-abcDEF_123-xyz y', (o) => !o.includes('abcDEF')],
        ['bearer', 'Authorization: Bearer abc.def-123', (o) => !o.includes('abc.def-123')],
        ['url credentials', 'GET https://user:pass123@host.example/x', (o) => !o.includes('pass123') && o.includes('host.example')],
        ['short secret value is not used to blank text', 'the word short stays', (o) => o === 'the word short stays'],
        ['length cap', 'a'.repeat(5000), (o) => o.length < 600],
      ]
      for (const [name, input, ok] of cases) {
        const out = scrub(input, env)
        if (!ok(out)) {
          origErr(`scrub case "${name}" failed: ${out.slice(0, 120)}`)
          failOut(`scrub(): ${name}`)
          return
        }
      }
    }

    const fm = installFakeModel()
    const post = (base: string, route: string, body: unknown = {}) =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const store = new MemoryStore()
    const srv = createApp({ store, rateLimiter: unlimitedRateLimiter }).listen(0)
    servers.push(srv)
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
    const newGame = async () => ((await (await post(base, '/api/game')).json()) as { sessionId: string }).sessionId
    const parsed = () => lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Record<string, unknown>)

    // ── A. Persona failure: nothing from the provider reaches the player ──
    {
      const sid = await newGame()
      lines.length = 0
      fm.failKind = 'suspect'
      fm.failMessage = `401 invalid x-api-key ${KEY} at https://bob:hunter2pw@api.anthropic.com/v1 Authorization: Bearer tok_abc123XYZ`
      const res = await post(base, `/api/game/${sid}/interrogate`, { input: 'Where were you?' })
      fm.failKind = null
      const text = await res.text()
      const body = JSON.parse(text) as { error?: { code?: string; message?: string } }
      if (res.status !== 502 || body.error?.code !== 'MODEL_REQUEST_FAILED') {
        failOut(`failed persona call: status ${res.status}, code ${body.error?.code}; want 502 MODEL_REQUEST_FAILED`)
        return
      }
      for (const bad of [KEY, 'hunter2pw', 'tok_abc123XYZ', 'x-api-key', 'anthropic', 'Suspect model request failed']) {
        if (text.includes(bad)) {
          failOut(`502 body leaked provider text: "${bad}"`)
          return
        }
      }
      const all = lines.join('\n')
      for (const bad of [KEY, 'hunter2pw', 'tok_abc123XYZ']) {
        if (all.includes(bad)) {
          failOut(`a log line contains a secret: "${bad}"`)
          return
        }
      }
      const tf = parsed().find((l) => l.evt === 'turn_failed')
      if (!tf || tf.sid !== sid || tf.phase !== 'interrogation' || tf.turn !== 1 || !String(tf.err).includes('[redacted]')) {
        failOut(`turn_failed log line missing or wrong: ${JSON.stringify(tf)}`)
        return
      }
    }

    // ── B. Invigilator fallback is logged ─────────────────────────────────
    {
      const sid = await newGame()
      lines.length = 0
      fm.failKind = 'invigilator'
      fm.failMessage = `judge down ${KEY}`
      const res = await post(base, `/api/game/${sid}/interrogate`, { input: 'Where were you?' })
      fm.failKind = null
      const fb = parsed().find((l) => l.evt === 'invigilator_fallback')
      if (
        res.status !== 200 ||
        !fb ||
        fb.sid !== sid ||
        fb.kind !== 'suspect' ||
        fb.turn !== 1 ||
        fb.attempts !== 3 ||
        lines.join('\n').includes(KEY)
      ) {
        failOut(`invigilator fallback: status ${res.status}, log ${JSON.stringify(fb)}; want sid/kind=suspect/turn=1/attempts=3 and no key`)
        return
      }
    }

    // ── C. Body-parser errors are 400 / 413, not 500, and leak nothing ────
    {
      lines.length = 0
      const bad = await fetch(`${base}/api/game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"input": ' })
      const badText = await bad.text()
      const big = await fetch(`${base}/api/game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(40_000) }) })
      const bigText = await big.text()
      if (bad.status !== 400 || big.status !== 413) {
        failOut(`malformed JSON gave ${bad.status}, oversized body gave ${big.status}; want 400 and 413`)
        return
      }
      for (const t of [badText, bigText]) {
        if (/SyntaxError|node_modules|\bat\s|\.ts:|\.js:|Unexpected/.test(t) || JSON.parse(t).error?.code === undefined) {
          failOut(`body-parser error body leaks internals or is not {error:{code}}: ${t.slice(0, 120)}`)
          return
        }
      }
      if (parsed().some((l) => l.evt === 'unhandled_error')) {
        failOut('a client body error was logged as an unhandled server error')
        return
      }
    }

    // ── D. Every server log line is single-line JSON ──────────────────────
    if (lines.some((l) => !l.startsWith('{') || l.includes('\n'))) {
      failOut(`a server log line is not one JSON object: ${lines.find((l) => !l.startsWith('{'))?.slice(0, 120)}`)
      return
    }
    void describeError

    restore()
    pass('error/log hygiene: a failed model call returns one fixed friendly 502 with no provider text; the real cause is logged as one JSON line with sid/phase/turn; planted secrets (API key, Bearer, URL credentials) are redacted from every log; invigilator fallbacks are logged (kind/turn/attempts); malformed JSON is 400 and oversized 413 with no internals')
  } catch (err) {
    console.log = origLog
    console.error = origErr
    failOut(`error/log hygiene check threw: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    console.log = origLog
    console.error = origErr
    setModel(null)
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
    Object.assign(process.env, savedEnv)
    for (const sv of servers) sv.close()
  }
})()

// 16. Transcripts live in the store, not on disk. Proves: a played game leaves
// session -> turn_started -> exchange entries in order under tx:<sid>; a failed
// turn adds a turn_failed entry whose text is redacted; secrets typed by the
// player or thrown by the provider never reach the stored entries; the list
// expires 14 days after the last write; the list is capped; TRANSCRIPTS=off
// stores nothing and the game still works; a transcript write failure never
// fails the turn; and no file is written to disk.
await (async () => {
  const savedEnv = { ...process.env }
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = []
  const origLog = console.log
  const origErr = console.error
  const restore = () => {
    console.log = origLog
    console.error = origErr
  }
  const failOut = (msg: string) => {
    restore()
    fail(msg)
  }
  try {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), 'airtight-verify-'))
    process.env.PLAYTEST_LOGS_DIR = logsDir
    delete process.env.VERCEL
    delete process.env.ALLOW_CLIENT_SEED
    delete process.env.TRANSCRIPTS
    const KEY = 'sk-ant-api03-TRANSCRIPTSECRET9876'
    process.env.ANTHROPIC_API_KEY = KEY
    process.env.SESSION_SECRET = 'verify-session-secret-0123456789abcdef'
    console.log = () => {}
    console.error = () => {}

    const fm = installFakeModel()
    let clock = 1_000_000
    const inner = new MemoryStore(() => clock)
    let appendDown = false
    const store: Store = {
      getJson: (k) => inner.getJson(k),
      setJson: (k, v, t) => inner.setJson(k, v, t),
      del: (k) => inner.del(k),
      reserve: (l, a) => inner.reserve(l, a),
      adjust: (k, d, t) => inner.adjust(k, d, t),
      acquireLock: (k, tok, ms) => inner.acquireLock(k, tok, ms),
      releaseLock: (k, tok) => inner.releaseLock(k, tok),
      setJsonIfRev: (k, r, v, t) => inner.setJsonIfRev(k, r, v, t),
      appendList: (k, v, t, m) => (appendDown ? Promise.reject(new Error('SECRET-APPEND-DOWN')) : inner.appendList(k, v, t, m)),
      getList: (k) => inner.getList(k),
    }
    const srv = createApp({ store, rateLimiter: unlimitedRateLimiter }).listen(0)
    servers.push(srv)
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
    const post = (route: string, body: unknown = {}) =>
      fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const newGame = async () => ((await (await post('/api/game')).json()) as { sessionId: string }).sessionId
    const types = async (sid: string) => ((await readTranscript(store, sid)) as Array<{ type: string }>).map((e) => e.type)

    // ── A. A normal game leaves an ordered transcript ──────────────────────
    const sid = await newGame()
    const r1 = await post(`/api/game/${sid}/interrogate`, { input: `Where were you? my key is ${KEY}` })
    const r2 = await post(`/api/game/${sid}/interrogate`, { input: 'Tell me again.' })
    if (r1.status !== 200 || r2.status !== 200) {
      failOut(`setup turns failed: ${r1.status}, ${r2.status}`)
      return
    }
    const got = await types(sid)
    const want = ['session', 'turn_started', 'exchange', 'turn_started', 'exchange']
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failOut(`transcript order: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
      return
    }

    // ── B. A failed turn is recorded, with redacted error text ─────────────
    fm.failKind = 'suspect'
    fm.failMessage = `provider said no ${KEY} https://u:pw99xyz@host.example/x`
    const rf = await post(`/api/game/${sid}/interrogate`, { input: 'One more.' })
    fm.failKind = null
    if (rf.status !== 502) {
      failOut(`failed turn status ${rf.status}, want 502`)
      return
    }
    const entries = (await readTranscript(store, sid)) as Array<Record<string, unknown>>
    const failed = entries.find((e) => e.type === 'turn_failed') as { error?: { message?: string } } | undefined
    if (!failed || !failed.error?.message?.includes('[redacted]')) {
      failOut(`turn_failed entry missing or not redacted: ${JSON.stringify(failed)}`)
      return
    }

    // ── C. No secret anywhere in the stored transcript ─────────────────────
    const blob = JSON.stringify(entries)
    for (const bad of [KEY, 'pw99xyz', process.env.SESSION_SECRET as string]) {
      if (blob.includes(bad)) {
        failOut(`stored transcript contains a secret: "${bad.slice(0, 12)}..."`)
        return
      }
    }

    // ── D. 14-day expiry, measured from the last write ─────────────────────
    if (TRANSCRIPT_TTL_SECONDS !== 14 * 24 * 3600) {
      failOut(`TRANSCRIPT_TTL_SECONDS is ${TRANSCRIPT_TTL_SECONDS}, want 14 days`)
      return
    }
    clock += (14 * 24 * 3600 - 60) * 1000
    const before = (await readTranscript(store, sid)).length
    clock += 120 * 1000
    const after = (await readTranscript(store, sid)).length
    if (before === 0 || after !== 0) {
      failOut(`transcript expiry: ${before} entries at day 14 minus 1 min, ${after} at day 14 plus 1 min; want >0 then 0`)
      return
    }

    // ── E. The list is capped ──────────────────────────────────────────────
    {
      const capSid = '11111111-1111-4111-8111-111111111111'
      for (let i = 0; i < MAX_TRANSCRIPT_ENTRIES + 25; i++) await recordTranscript(store, capSid, { type: 'exchange', i })
      const list = (await readTranscript(store, capSid)) as Array<{ i: number }>
      if (list.length !== MAX_TRANSCRIPT_ENTRIES || list[list.length - 1].i !== MAX_TRANSCRIPT_ENTRIES + 24) {
        failOut(`cap: kept ${list.length} entries (last i=${list[list.length - 1]?.i}); want ${MAX_TRANSCRIPT_ENTRIES} newest`)
        return
      }
    }

    // ── F. A transcript write failure never fails the turn ─────────────────
    {
      const sid2 = await newGame()
      appendDown = true
      const res = await post(`/api/game/${sid2}/interrogate`, { input: 'Where were you?' })
      appendDown = false
      if (res.status !== 200) {
        failOut(`turn with a broken transcript write returned ${res.status}, want 200`)
        return
      }
    }

    // ── G. TRANSCRIPTS=off records nothing; the game still works ───────────
    {
      process.env.TRANSCRIPTS = 'off'
      const sid3 = await newGame()
      const res = await post(`/api/game/${sid3}/interrogate`, { input: 'Where were you?' })
      const len = (await readTranscript(store, sid3)).length
      delete process.env.TRANSCRIPTS
      if (res.status !== 200 || len !== 0) {
        failOut(`TRANSCRIPTS=off: status ${res.status}, ${len} entries stored; want 200 and 0`)
        return
      }
    }

    // ── H. Nothing was written to disk ─────────────────────────────────────
    const files = await readdir(logsDir)
    if (files.length > 0) {
      failOut(`server wrote ${files.length} file(s) to the logs dir: ${files[0]}`)
      return
    }

    restore()
    pass('transcripts in the store: ordered session/turn_started/exchange entries under tx:<sid>; failed turns recorded with redacted text; no secret (typed by the player or thrown by the provider) is stored; 14-day expiry; capped length; a broken write never fails a turn; TRANSCRIPTS=off stores nothing; no file written to disk')
  } catch (err) {
    failOut(`transcript check threw: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    restore()
    setModel(null)
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
    Object.assign(process.env, savedEnv)
    for (const sv of servers) sv.close()
  }
})()

// 17. BYOK: a player's own Anthropic key. Proves: the key is used for the turn
// but appears nowhere (no response body or header, no log line, no stored
// session, no transcript); BYOK games and turns never touch the shared daily
// counter or the shared model, and keep working when the shared budget is
// spent; the per-session cap still applies; a BYOK session with no key sent, a
// malformed key, and a provider-rejected key each give a friendly 401 that
// does not echo the key or the provider text, use no turn, and charge nothing;
// and a key header on a normal (non-BYOK) game is ignored.
await (async () => {
  const savedEnv = { ...process.env }
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = []
  const origLog = console.log
  const origErr = console.error
  const logged: string[] = []
  const restore = () => {
    console.log = origLog
    console.error = origErr
  }
  const failOut = (msg: string) => {
    restore()
    fail(msg)
  }
  try {
    process.env.PLAYTEST_LOGS_DIR = await mkdtemp(path.join(os.tmpdir(), 'airtight-verify-'))
    delete process.env.VERCEL
    delete process.env.ALLOW_CLIENT_SEED
    delete process.env.MAX_DAILY_SPEND_USD
    delete process.env.TRANSCRIPTS
    process.env.SESSION_SECRET = 'verify-session-secret-0123456789abcdef'
    console.log = (...a: unknown[]) => void logged.push(a.map(String).join(' '))
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '))

    const KEY = 'sk-ant-api03-BYOKSENTINEL0123456789ABCDEF'
    const REJECTED = 'sk-ant-api03-REJECTEDKEY0123456789ABCDEF'
    const fm = installFakeModel() // the SHARED model; BYOK turns must never reach it
    const keysSeen: string[] = []
    // Stand-in for the real per-key Anthropic provider: answers like the shared
    // fake, but throws a 401 (with the key in its message, as a provider might) for REJECTED.
    const modelForKey = (apiKey: string) =>
      new MockLanguageModelV4({
        doGenerate: async (options) => {
          keysSeen.push(apiKey)
          if (apiKey === REJECTED) {
            throw Object.assign(new Error(`invalid x-api-key: ${apiKey}`), { statusCode: 401 })
          }
          const schema = JSON.stringify(options.responseFormat ?? {})
          const object = schema.includes('guiltyKnowledgeLeak')
            ? { reasoning: 'ok', signals: { contradictions: [], guiltyKnowledgeLeak: null, evidenceHandling: [], demeanorShift: false } }
            : schema.includes('suspectContradiction')
              ? { reasoning: 'ok', signals: { suspectContradiction: null } }
              : { dialogue: 'I was at home.', claims: [{ text: 'The speaker was at home.', checkable: true }], demeanor: 'calm' }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(object) }],
            finishReason: { unified: 'stop' as const, raw: undefined },
            usage: FAKE_USAGE,
            warnings: [],
          }
        },
      })

    const store = new MemoryStore()
    const srv = createApp({ store, rateLimiter: unlimitedRateLimiter, modelForKey }).listen(0)
    servers.push(srv)
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
    const post = (route: string, body: unknown = {}, key?: string) =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Anthropic-Key': key } : {}) },
        body: JSON.stringify(body),
      })
    const counter = async (k: string) => Number((await store.getJson(k)) ?? 0)
    const dayNow = () => counter(dayKey(new Date()))
    const shared = () => fm.calls.suspect + fm.calls.witness + fm.calls.invigilator
    const newByok = async (key: string = KEY) => {
      const res = await post('/api/game', {}, key)
      return { res, body: (await res.clone().json()) as { sessionId: string; byok?: boolean } }
    }

    // ── A. A BYOK game and turn: works, uses the player's model, never the shared one ──
    const created = await newByok()
    if (created.res.status !== 201 || created.body.byok !== true) {
      failOut(`BYOK create: status ${created.res.status}, byok=${created.body.byok}; want 201 and true`)
      return
    }
    const sid = created.body.sessionId
    const t1 = await post(`/api/game/${sid}/interrogate`, { input: 'Where were you?' }, KEY)
    const t1Text = await t1.clone().text()
    if (t1.status !== 200) {
      failOut(`BYOK turn returned ${t1.status}: ${t1Text.slice(0, 120)}`)
      return
    }
    if (!keysSeen.includes(KEY) || shared() !== 0) {
      failOut(`BYOK turn: key reached the model=${keysSeen.includes(KEY)}, shared-model calls=${shared()}; want true and 0`)
      return
    }
    if ((await dayNow()) !== 0) {
      failOut(`BYOK turn changed the shared daily counter to ${await dayNow()}; want it untouched`)
      return
    }
    if ((await counter(`spend:sess:${sid}`)) <= 0) {
      failOut('BYOK turn left the per-session counter at 0; the per-session cap would never apply')
      return
    }

    // ── B. The key is nowhere: responses, headers, logs, stored session, transcript ──
    const reconnect = await fetch(`${base}/api/game/${sid}`, { headers: { 'X-Anthropic-Key': KEY } })
    const surfaces: Array<[string, string]> = [
      ['create response', JSON.stringify(created.body) + JSON.stringify([...created.res.headers])],
      ['turn response', t1Text + JSON.stringify([...t1.headers])],
      ['reconnect response', (await reconnect.clone().text()) + JSON.stringify([...reconnect.headers])],
      ['stored session', JSON.stringify(await store.getJson(`sess:${sid}`))],
      ['transcript', JSON.stringify(await readTranscript(store, sid))],
    ]
    const stored = (await store.getJson(`sess:${sid}`)) as { byok?: boolean }
    if (stored.byok !== true) {
      failOut('stored session does not carry the byok flag')
      return
    }

    // ── C. BYOK keeps working when the shared daily budget is spent; a normal game does not ──
    process.env.MAX_DAILY_SPEND_USD = '0.005'
    const plain = await post('/api/game')
    const byokWhenSpent = await newByok()
    delete process.env.MAX_DAILY_SPEND_USD
    if (plain.status !== 429 || byokWhenSpent.res.status !== 201) {
      failOut(`shared budget spent: normal create ${plain.status} (want 429), BYOK create ${byokWhenSpent.res.status} (want 201)`)
      return
    }

    // ── D. The per-session cap still applies to BYOK ───────────────────────
    {
      const cap = await newByok()
      const csid = cap.body.sessionId
      const full = BUDGET_CONFIG.maxSessionSpendUsd * 1_000_000
      await store.setJson(`spend:sess:${csid}`, full - BUDGET_CONFIG.turnReserveUsd * 1_000_000 + 1, 3600)
      const before = keysSeen.length
      const res = await post(`/api/game/${csid}/interrogate`, { input: 'Where were you?' }, KEY)
      const code = ((await res.json()) as { error?: { code?: string } }).error?.code
      if (res.status !== 429 || code !== 'BUDGET_EXCEEDED' || keysSeen.length !== before) {
        failOut(`BYOK session cap: status ${res.status} code ${code}, model calls ${keysSeen.length - before}; want 429 BUDGET_EXCEEDED and 0`)
        return
      }
    }

    // ── E. Missing, malformed and provider-rejected keys: friendly 401, nothing used or charged ──
    {
      const bad = await newByok()
      const bsid = bad.body.sessionId
      const sentinelText = 'x-api-key'
      const attempts: Array<[string, Response]> = [
        ['no key on a BYOK session', await post(`/api/game/${bsid}/interrogate`, { input: 'Hi.' })],
        ['rejected key', await post(`/api/game/${bsid}/interrogate`, { input: 'Hi.' }, REJECTED)],
        ['malformed key on turn', await post(`/api/game/${bsid}/interrogate`, { input: 'Hi.' }, 'not-a-key')],
        ['malformed key on create', await post('/api/game', {}, 'Bearer sk-ant-short')],
      ]
      for (const [label, res] of attempts) {
        const text = await res.text()
        const code = (JSON.parse(text) as { error?: { code?: string } }).error?.code
        if (res.status !== 401 || code !== 'INVALID_API_KEY') {
          failOut(`${label}: status ${res.status} code ${code}; want 401 INVALID_API_KEY`)
          return
        }
        if (text.includes(REJECTED) || text.includes('sk-ant-short') || text.includes(sentinelText)) {
          failOut(`${label}: response echoes the key or the provider's text: ${text}`)
          return
        }
      }
      const g = (await (await fetch(`${base}/api/game/${bsid}`)).json()) as { interrogationTurn: number }
      if (g.interrogationTurn !== 0) {
        failOut(`a refused key used up ${g.interrogationTurn} turn(s); want 0`)
        return
      }
      if ((await counter(`spend:sess:${bsid}`)) !== 0) {
        failOut(`a refused key was charged ${await counter(`spend:sess:${bsid}`)} micro-dollars; want 0`)
        return
      }
      surfaces.push(['rejected-key transcript', JSON.stringify(await readTranscript(store, bsid))])
    }

    // ── F. A key header on a NORMAL game is ignored: the shared model and budget are used ──
    {
      const g = (await (await post('/api/game')).json()) as { sessionId: string }
      const before = keysSeen.length
      const res = await post(`/api/game/${g.sessionId}/interrogate`, { input: 'Where were you?' }, KEY)
      if (res.status !== 200 || shared() === 0 || keysSeen.length !== before) {
        failOut(`key on a normal game: status ${res.status}, shared calls ${shared()}, key-model calls ${keysSeen.length - before}; want 200, >0, 0`)
        return
      }
    }

    // ── B (continued). Scan every surface and every captured log line for the keys ──
    surfaces.push(['log output', logged.join('\n')])
    for (const [label, text] of surfaces) {
      for (const secret of [KEY, REJECTED]) {
        if (text.includes(secret)) {
          failOut(`${label} contains the API key "${secret.slice(0, 18)}..."`)
          return
        }
      }
    }

    restore()
    pass('BYOK: a player key is used for the turn and appears nowhere (responses, headers, logs, stored session, transcript); BYOK games and turns never touch the shared daily counter or shared model and still work when the shared budget is spent; the per-session cap still applies; a missing, malformed or provider-rejected key gives a friendly 401 that echoes nothing, uses no turn and charges nothing; a key header on a normal game is ignored')
  } catch (err) {
    failOut(`BYOK check threw: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    restore()
    setModel(null)
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
    Object.assign(process.env, savedEnv)
    for (const sv of servers) sv.close()
  }
})()

console.log(
  failures === 0
    ? '\n  \x1b[32mV2 green.\x1b[0m\n'
    : `\n  \x1b[31m${failures} failure(s).\x1b[0m\n`,
)
process.exit(failures === 0 ? 0 : 1)
