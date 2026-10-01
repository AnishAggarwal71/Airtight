#!/usr/bin/env tsx
/**
 * Case file inspector — V2 detective mode.
 *
 *   npx tsx src/cli/inspect.ts                      # random seed, random crime
 *   npx tsx src/cli/inspect.ts mallard-7719 arson   # a specific case
 *   npx tsx src/cli/inspect.ts --public mallard-7719 homicide
 *
 * --public shows only what the player-detective would receive, which is the
 * quickest way to confirm nothing strategic is leaking through toPublicCase().
 */

import { generate, toPublicCase } from '../engine/generate'
import { randomSeed } from '../engine/rng'
import type { CrimeType } from '../engine/types'
import { CRIME_LABELS } from '../engine/types'

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
}

const args = process.argv.slice(2)
const publicOnly = args.includes('--public')
const positional = args.filter((a) => !a.startsWith('--'))

const seed = positional[0] ?? randomSeed()
const crime = (positional[1] as CrimeType) ?? 'homicide'

const valid: CrimeType[] = ['homicide', 'arson']
if (!valid.includes(crime)) {
  console.error(`Unknown crime "${crime}". Expected one of: ${valid.join(', ')}`)
  process.exit(1)
}

const file = generate({ seed, crime })

if (publicOnly) {
  console.log(C.bold('\n── WHAT THE PLAYER-DETECTIVE RECEIVES ────────────\n'))
  console.log(JSON.stringify(toPublicCase(file), null, 2))
  console.log()
  process.exit(0)
}

const rule = (label: string) =>
  console.log(C.bold(`\n── ${label} ${'─'.repeat(Math.max(0, 50 - label.length))}\n`))

console.log(C.bold(`\n  AIRTIGHT  ${C.dim(`${seed} · ${CRIME_LABELS[crime]} · ${file.templateId}`)}`))

rule('THE CASE')
console.log(`  Suspect:  ${C.bold(file.suspect.name)}, ${file.suspect.occupation}`)
console.log(`  Victim:   ${file.victim.name} — ${file.victim.relationship}`)
console.log(`  Scene:    ${file.location}`)
console.log(`  Window:   ${file.window.start} – ${file.window.end}`)

rule('DETECTIVE BRIEFING')
console.log(`  Victim:   ${file.detectiveBriefing.victimSummary}`)
console.log(`  Suspect:  ${file.detectiveBriefing.suspectSummary}`)
console.log(`  Scene:    ${file.detectiveBriefing.sceneSummary}`)
console.log(`  Evidence: ${file.detectiveBriefing.evidenceSummary}`)

rule(C.red('GROUND TRUTH — never leaves the server'))
for (const b of file.truth) {
  console.log(`  ${C.dim(b.time.padEnd(7))} ${b.fact}`)
}

rule('EVIDENCE (all visible to player)')
for (const e of file.evidence) {
  const status = e.presented ? C.green('presented') : C.dim('available')
  console.log(`  ${status} ${C.bold(e.id)} ${C.dim(`[${e.type}]`)}`)
  console.log(`           ${e.claim}`)
  console.log(`           ${C.yellow('vulnerability:')} ${C.dim(e.vulnerability)}`)
  console.log(`           ${C.dim(`linked beats: ${e.linkedBeats.join(', ')}`)}`)
  console.log()
}

rule('WITNESS')
const w = file.witness
console.log(`  ${C.bold(w.name)} ${C.dim(`(${w.relationship})`)}`)
console.log(`  ${C.dim('Personality:')} ${w.personality}`)
console.log(`  ${C.dim('Knows:')} ${w.knowledgeBoundary}`)
console.log(`  ${C.dim('Can contradict:')}`)
for (const c of w.suspectContradictions) {
  console.log(`    - ${c}`)
}

rule(C.magenta('SUSPECT PERSONA — hidden from player'))
console.log(`  ${C.dim('Personality:')} ${file.suspectPersona.personality}`)
console.log(`  ${C.dim('Cover story:')} ${file.suspectPersona.coverStory}`)
console.log(`  ${C.dim('Breaking points:')}`)
for (const bp of file.suspectPersona.breakingPoints) {
  console.log(`    - ${bp}`)
}
console.log(`  ${C.dim('Guilty knowledge:')}`)
for (const gk of file.suspectPersona.guiltyKnowledge) {
  console.log(`    - ${gk}`)
}

rule(C.red('FATAL FACT'))
console.log(`  ${file.fatalFact}`)

const presented = file.evidence.filter((e) => e.presented).length
console.log(
  C.dim(`\n  ${file.evidence.length} evidence items · ${presented} presented · ${file.evidence.length - presented} available\n`),
)
