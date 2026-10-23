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
import { buildBreakdown } from '../server/breakdown'
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

console.log(
  failures === 0
    ? '\n  \x1b[32mV2 green.\x1b[0m\n'
    : `\n  \x1b[31m${failures} failure(s).\x1b[0m\n`,
)
process.exit(failures === 0 ? 0 : 1)
