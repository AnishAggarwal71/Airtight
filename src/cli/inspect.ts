#!/usr/bin/env tsx
/**
 * Case file inspector.
 *
 *   npx tsx src/cli/inspect.ts                      # random seed, random crime
 *   npx tsx src/cli/inspect.ts mallard-7719 arson   # a specific case
 *   npx tsx src/cli/inspect.ts --public mallard-7719 homicide
 *
 * --public shows only what the browser would receive, which is the quickest
 * way to confirm nothing sensitive is leaking through toPublicCase().
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
}

const args = process.argv.slice(2)
const publicOnly = args.includes('--public')
const positional = args.filter((a) => !a.startsWith('--'))

const seed = positional[0] ?? randomSeed()
const crime = (positional[1] as CrimeType) ?? 'homicide'

const valid: CrimeType[] = ['homicide', 'arson', 'embezzlement']
if (!valid.includes(crime)) {
  console.error(`Unknown crime "${crime}". Expected one of: ${valid.join(', ')}`)
  process.exit(1)
}

const file = generate({ seed, crime })

if (publicOnly) {
  console.log(C.bold('\n── WHAT THE CLIENT RECEIVES ───────────────────────\n'))
  console.log(JSON.stringify(toPublicCase(file), null, 2))
  console.log()
  process.exit(0)
}

const rule = (label: string) =>
  console.log(C.bold(`\n── ${label} ${'─'.repeat(Math.max(0, 50 - label.length))}\n`))

console.log(C.bold(`\n  AIRTIGHT  ${C.dim(`${seed} · ${CRIME_LABELS[crime]} · ${file.templateId}`)}`))

rule('THE ROOM')
console.log(`  ${C.bold(file.detective.rank + ' ' + file.detective.name)} interviewing ${C.bold(file.suspect.name)}, ${file.suspect.occupation}`)
console.log(`  Victim:   ${file.victim.name} — ${file.victim.relationship}`)
console.log(`  Scene:    ${file.location}`)
console.log(`  Window:   ${file.window.start} – ${file.window.end}`)

rule('OPENER')
console.log(`  ${C.cyan('"' + file.opener + '"')}`)

rule(C.red('GROUND TRUTH — never leaves the server'))
for (const b of file.truth) {
  console.log(`  ${C.dim(b.time.padEnd(7))} ${b.fact}`)
}

rule('EVIDENCE')
for (const e of file.evidence) {
  const tag = e.state === 'revealed' ? C.green('REVEALED') : C.dim('latent  ')
  console.log(`  ${tag} ${C.bold(e.id)} ${C.dim(`[${e.type}, w${e.weight}]`)}`)
  console.log(`           ${e.claim}`)
  console.log(`           ${C.yellow('crack:')} ${C.dim(e.vulnerability)}`)
  console.log()
}

rule('WITNESSES')
for (const w of file.witnesses) {
  const tag = w.accurate ? C.green('reliable  ') : C.red('unreliable')
  console.log(`  ${tag} ${C.bold(w.name)} ${C.dim(`(${w.relationship})`)}`)
  console.log(`             ${w.claim}`)
  if (w.flaw) console.log(`             ${C.yellow('flaw:')} ${C.dim(w.flaw)}`)
}

rule(C.red('FATAL FACT'))
console.log(`  ${file.fatalFact}`)

const revealed = file.evidence.filter((e) => e.state === 'revealed').length
console.log(
  C.dim(`\n  ${file.evidence.length} evidence items · ${revealed} revealed · ${file.evidence.length - revealed} latent\n`),
)
