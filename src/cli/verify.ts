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
import { buildBreakdown } from '../server/breakdown'
import { BUDGET_CONFIG, dayKey, reserveSpend } from '../server/budget'
import { setModel } from '../engine/adjudicate'
import { MockLanguageModelV4 } from 'ai/test'
import { mkdtemp } from 'node:fs/promises'
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

    // ── Scripted fake model ────────────────────────────────────────────
    // Which call is it? Tell by the structured-output schema the SDK sends.
    const USAGE = {
      inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 200, text: 200, reasoning: 0 },
    }
    const PER_CALL_MICROS = 1000 * 1 + 200 * 5 // $1/M in, $5/M out => 2000 micro-dollars
    const calls = { suspect: 0, invigilator: 0 }
    let gate: Promise<void> = Promise.resolve()
    let failKind: 'suspect' | 'invigilator' | null = null
    setModel(
      new MockLanguageModelV4({
        doGenerate: async (options) => {
          const schema = JSON.stringify(options.responseFormat ?? {})
          const isInvigilator = schema.includes('guiltyKnowledgeLeak')
          if (isInvigilator) calls.invigilator++
          else calls.suspect++
          if (!isInvigilator) await gate
          if (failKind === (isInvigilator ? 'invigilator' : 'suspect')) throw new Error('fake model outage')
          const object = isInvigilator
            ? {
                reasoning: 'ok',
                signals: { contradictions: [], guiltyKnowledgeLeak: null, evidenceHandling: [], demeanorShift: false },
              }
            : { dialogue: 'I was at home.', claims: [{ text: 'The suspect was at home.', checkable: true }], demeanor: 'calm' }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(object) }],
            finishReason: { unified: 'stop' as const, raw: undefined },
            usage: USAGE,
            warnings: [],
          }
        },
      }),
    )
    const resetCalls = () => {
      calls.suspect = 0
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
      const srv = createApp({ store }).listen(0)
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
      gate = new Promise<void>((r) => (release = r))
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
      gate = Promise.resolve()
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
      failKind = 'suspect'
      const res = await post(base, `/api/game/${sid}/interrogate`, { input: 'Where were you?' })
      failKind = null
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
      failKind = 'invigilator'
      const res = await post(base, `/api/game/${sid}/interrogate`, { input: 'Where were you?' })
      failKind = null
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

console.log(
  failures === 0
    ? '\n  \x1b[32mV2 green.\x1b[0m\n'
    : `\n  \x1b[31m${failures} failure(s).\x1b[0m\n`,
)
process.exit(failures === 0 ? 0 : 1)
