#!/usr/bin/env tsx
/**
 * M0 sanity checks.  npx tsx src/cli/verify.ts
 *
 * Three things matter here and they're all load-bearing for later milestones:
 *
 *   1. DETERMINISM — the server regenerates the case file from the seed on
 *      every turn instead of storing it. If generation isn't pure, the game
 *      desynchronises mid-session and the evals mean nothing.
 *   2. LEAK-SAFETY — toPublicCase() is a security boundary. If a vulnerability
 *      or a truth beat reaches the browser, the game is solved in devtools.
 *   3. TEMPLATE INTEGRITY — every template must produce well-formed evidence
 *      with unique ids, all starting latent (nothing is revealed at game
 *      start — the player doesn't know what the police have).
 */

import { generate, toPublicCase } from '../engine/generate'
import { ALL_TEMPLATES } from '../engine/templates'
import type { CrimeType } from '../engine/types'

const CRIMES: CrimeType[] = ['homicide', 'arson', 'embezzlement']
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
  if (stable) pass('generate() is deterministic across 60 seed/crime pairs')
}

// 2. Leak-safety
{
  let clean = true
  for (const seed of SEEDS) {
    for (const crime of CRIMES) {
      const file = generate({ seed, crime })
      const pub = JSON.stringify(toPublicCase(file))

      for (const beat of file.truth) {
        if (pub.includes(beat.fact)) {
          fail(`truth beat leaked into public case (${seed}/${crime})`)
          clean = false
        }
      }
      for (const e of file.evidence) {
        if (pub.includes(e.vulnerability)) {
          fail(`vulnerability for ${e.id} leaked (${seed}/${crime})`)
          clean = false
        }
        if (e.state === 'latent' && pub.includes(e.claim)) {
          fail(`latent evidence ${e.id} leaked (${seed}/${crime})`)
          clean = false
        }
      }
      if (pub.includes(file.fatalFact)) {
        fail(`fatalFact leaked (${seed}/${crime})`)
        clean = false
      }
      for (const w of file.witnesses) {
        if (w.flaw && pub.includes(w.flaw)) {
          fail(`witness flaw leaked (${seed}/${crime})`)
          clean = false
        }
      }
    }
  }
  if (clean) pass('toPublicCase() leaks no truth, vulnerabilities or latent evidence')
}

// 3. Template integrity
{
  let sound = true
  for (const seed of SEEDS) {
    for (const crime of CRIMES) {
      const f = generate({ seed, crime })

      const ids = f.evidence.map((e) => e.id)
      if (new Set(ids).size !== ids.length) {
        fail(`duplicate evidence ids in ${f.templateId}`)
        sound = false
      }
      if (f.evidence.length < 6) {
        fail(`${f.templateId} has only ${f.evidence.length} evidence items`)
        sound = false
      }
      const revealed = f.evidence.filter((e) => e.state !== 'latent').length
      if (revealed !== 0) {
        fail(`${f.templateId} reveals ${revealed} items at start (want 0 — nothing is shown until the detective raises it)`)
        sound = false
      }
      for (const e of f.evidence) {
        if (!e.vulnerability?.trim()) {
          fail(`${f.templateId}/${e.id} has no vulnerability`)
          sound = false
        }
        if (e.baseWeight < 20 || e.baseWeight > 90) {
          fail(`${f.templateId}/${e.id} baseWeight ${e.baseWeight} out of range`)
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
      if (f.truth.length < 4) {
        fail(`${f.templateId} has a ${f.truth.length}-beat timeline (want 4+)`)
        sound = false
      }
      if (!f.opener?.trim() || !f.fatalFact?.trim()) {
        fail(`${f.templateId} missing opener or fatalFact`)
        sound = false
      }
    }
  }
  if (sound) pass('all templates produce well-formed case files')
}

// 4. Coverage — every template should actually be reachable
{
  const seen = new Set<string>()
  for (let i = 0; i < 400; i++) {
    for (const crime of CRIMES) {
      seen.add(generate({ seed: `cover-${i}`, crime }).templateId)
    }
  }
  const missing = ALL_TEMPLATES.filter((t) => !seen.has(t.id)).map((t) => t.id)
  if (missing.length) fail(`unreachable templates: ${missing.join(', ')}`)
  else pass(`all ${ALL_TEMPLATES.length} templates reachable`)
}

// 5. Variance — the same template shouldn't produce the same case twice
{
  const byTemplate = new Map<string, Set<string>>()
  for (let i = 0; i < 120; i++) {
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

console.log(
  failures === 0
    ? '\n  \x1b[32mM0 green.\x1b[0m\n'
    : `\n  \x1b[31m${failures} failure(s).\x1b[0m\n`,
)
process.exit(failures === 0 ? 0 : 1)
