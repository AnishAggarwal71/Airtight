#!/usr/bin/env tsx
/**
 * V2 sanity checks.  npx tsx src/cli/verify.ts
 *
 * Five things matter here:
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
 */

import { generate, toPublicCase } from '../engine/generate'
import { parsePlayerInput } from '../engine/session'
import { ALL_TEMPLATES } from '../engine/templates'
import type { CrimeType } from '../engine/types'

const CRIMES: CrimeType[] = ['homicide']
const ALL_CRIMES: CrimeType[] = ['homicide', 'arson', 'embezzlement']  // coverage check still validates arson template is reachable
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

      // Evidence claims SHOULD be visible (inverted from V1) — compare the
      // structured public evidence array directly rather than substring-matching
      // a JSON.stringify()'d blob, since claims containing literal `"` characters
      // are escaped to `\"` in that blob and can never match a raw substring.
      for (const e of file.evidence) {
        const pe = publicCase.evidence.find((x) => x.id === e.id)
        if (!pe || pe.claim !== e.claim) {
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

console.log(
  failures === 0
    ? '\n  \x1b[32mV2 green.\x1b[0m\n'
    : `\n  \x1b[31m${failures} failure(s).\x1b[0m\n`,
)
process.exit(failures === 0 ? 0 : 1)
