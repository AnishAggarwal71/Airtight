#!/usr/bin/env tsx
/**
 * AIRTIGHT — interactive terminal interrogation.
 *
 *   npm run play                          # random seed, crime picker
 *   npm run play -- mallard-7719 arson    # specific case
 *
 * Twelve rounds (or fifteen if Suspicion >= 90). Three endings. Zero UI until M3
 * — tuning against a CLI is several times faster than tuning through a browser.
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })  // project convention: keys live in .env.local
dotenv.config()                        // fallback to .env if present
import * as readline from 'node:readline'
import { randomSeed } from '../engine/rng'
import { createSession, playTurn } from '../engine/session'
import { SCORING_CONFIG } from '../engine/score'
import type { CrimeType, GameSession, Ending, Evidence, TurnDetail } from '../engine/types'
import { CRIME_LABELS, CRIME_BLURBS } from '../engine/types'

// ─── ANSI helpers (same pattern as inspect.ts) ───────────────────────────────

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_ANSWER_LENGTH = 300
const BAR_WIDTH = 20
const CRIMES: CrimeType[] = ['homicide', 'arson', 'embezzlement']

// ─── Rendering helpers ───────────────────────────────────────────────────────

/** Render a meter bar with colour thresholds. */
function meterBar(value: number, label: string, warnAt: number, dangerAt: number): string {
  const filled = Math.round((value / 100) * BAR_WIDTH)
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
  let coloured: string
  if (value >= dangerAt) coloured = C.red(bar)
  else if (value >= warnAt) coloured = C.yellow(bar)
  else coloured = C.green(bar)
  const padded = label.padEnd(16)
  return `  ${padded}[${coloured}]  ${String(value).padStart(3)}/100`
}

/** Render the turn header, meters, and evidence table. */
function renderTurnDisplay(
  session: GameSession,
  detectiveResponse: string,
  newlyRevealed: Set<string>,
): void {
  const divider = '═'.repeat(56)
  const thinDivider = '─'.repeat(56)
  console.log()
  console.log(` ${divider}`)
  console.log(`  ${C.bold('AIRTIGHT')}          Turn ${session.turn} of ${session.maxTurns}        ${C.dim(session.seed)}`)
  console.log(` ${thinDivider}`)

  // Meters: CS is bad when high, Suspicion is bad when high
  console.log(meterBar(session.caseStrength, 'Case Strength', 50, 80))
  console.log(meterBar(session.suspicion, 'Suspicion', 60, 90))
  console.log(` ${thinDivider}`)

  // Evidence table — only revealed/explained items
  const visible = session.evidence.filter((e) => e.state !== 'latent')
  if (visible.length > 0) {
    console.log()
    console.log(`  ${C.bold('EVIDENCE ON THE TABLE:')}`)
    for (const e of visible) {
      const tag = newlyRevealed.has(e.id) ? C.red('NEW') + ' — ' : ''
      const stateTag = e.state === 'explained' ? C.green(' [explained]') : ''
      console.log(`  ${C.dim(`[${e.id}]`)} ${tag}${e.claim}${stateTag}`)
    }
  }

  // Detective's response
  console.log()
  const det = session.caseFile.detective
  console.log(`  ${C.bold(`${det.rank} ${det.name}`)}:`)
  console.log(`  ${C.cyan('"' + detectiveResponse + '"')}`)
  console.log()
}

/** Render the ending banner. */
function renderEnding(ending: Ending, session: GameSession): void {
  const divider = '═'.repeat(56)
  console.log()
  console.log(` ${divider}`)

  switch (ending) {
    case 'CHARGED':
      console.log(`  ${C.red(C.bold('CHARGED'))}`)
      console.log(`  The detective built a chargeable case. You're done.`)
      break
    case 'RELEASED':
      console.log(`  ${C.green(C.bold('RELEASED'))}`)
      console.log(`  You survived ${session.turn} rounds. The detective couldn't`)
      console.log(`  build a chargeable case. You walk.`)
      break
    case 'HELD_48_HOURS':
      console.log(`  ${C.yellow(C.bold('HELD FOR 48 HOURS'))}`)
      console.log(`  Not enough to charge, too much to release. You'll be back`)
      console.log(`  in this room in two days.`)
      break
  }

  console.log(` ${divider}`)
}

// ─── Post-game breakdown ─────────────────────────────────────────────────────

function renderBreakdown(session: GameSession): void {
  const divider = '─'.repeat(56)
  console.log()
  console.log(`  ${C.bold('POST-GAME BREAKDOWN')}`)
  console.log(` ${divider}`)

  // 1. Final meters
  console.log(`  Case Strength: ${session.caseStrength}/100   Suspicion: ${session.suspicion}/100`)
  console.log(`  Turns played: ${session.turn}/${session.maxTurns}`)
  if (session.extended) {
    console.log(`  ${C.yellow('Interrogation extended +3 rounds (Suspicion hit 90)')}`)
  }
  console.log()

  // 2. Turning point — largest CS jump
  if (session.turnDetails.length > 0) {
    let turningPoint: TurnDetail | null = null
    let maxDelta = 0
    for (const td of session.turnDetails) {
      const delta = Math.abs(td.caseStrengthAfter - td.caseStrengthBefore)
      if (delta > maxDelta) {
        maxDelta = delta
        turningPoint = td
      }
    }
    if (turningPoint && maxDelta > 0) {
      const direction = turningPoint.caseStrengthAfter > turningPoint.caseStrengthBefore
        ? C.red(`+${maxDelta}`)
        : C.green(`-${maxDelta}`)
      console.log(`  ${C.bold('THE MOMENT IT TURNED')}`)
      console.log(`  Turn ${turningPoint.turn}: Case Strength ${direction} (${turningPoint.caseStrengthBefore} → ${turningPoint.caseStrengthAfter})`)
      console.log(`  You said: ${C.dim('"' + turningPoint.playerAnswer.slice(0, 120) + '"')}`)
      console.log()
    }
  }

  // 3. Meter trajectory (ASCII sparkline)
  if (session.caseStrengthHistory.length > 0) {
    console.log(`  ${C.bold('METER TRAJECTORY')}`)
    console.log(`  CS:  ${sparkline(session.caseStrengthHistory)}`)
    console.log(`  Sus: ${sparkline(session.suspicionHistory)}`)
    console.log()
  }

  // 4. Evidence table
  console.log(`  ${C.bold('EVIDENCE BREAKDOWN')}`)
  for (const e of session.evidence) {
    const original = session.caseFile.evidence.find((ce) => ce.id === e.id)!
    const delta = e.weight - original.baseWeight
    const deltaStr = delta === 0
      ? C.dim(' ±0')
      : delta > 0 ? C.red(`+${delta}`) : C.green(`${delta}`)
    const stateTag = e.state === 'latent' ? C.dim('[never revealed]') : `[${e.state}]`
    console.log(`  ${C.dim(e.id)} ${stateTag} ${original.baseWeight} → ${e.weight} (${deltaStr})`)
    console.log(`    ${C.dim(e.claim.slice(0, 80))}`)
    console.log(`    ${C.yellow('vulnerability:')} ${C.dim(e.vulnerability.slice(0, 100))}`)
    console.log()
  }

  // 5. Annotated claim ledger
  if (session.claims.length > 0) {
    console.log(`  ${C.bold('CLAIM LEDGER')}`)
    for (const claim of session.claims) {
      // Check if this claim was involved in a contradiction
      const contradictions = session.turnDetails
        .flatMap((td) => td.adjudication.contradictions)
        .filter((c) => c.against === claim.id)
      const tags: string[] = []
      for (const c of contradictions) {
        tags.push(c.severity === 'major' ? C.red('[MAJOR CONTRADICTION]') : C.yellow('[minor contradiction]'))
      }
      console.log(`  ${claim.id} (turn ${claim.turn}): "${claim.text}" ${tags.join(' ')}`)
    }
    console.log()
  }

  // 6. Bluff reveal
  if (session.bluffUsed && session.bluffDetail) {
    console.log(`  ${C.magenta(C.bold('[BLUFF]'))} Turn ${session.bluffTurn}`)
    console.log(`  The detective fabricated: "${session.bluffDetail.text}"`)
    console.log(`  ${C.dim('(Denying this flat would have cost nothing.)')}`)
    console.log()
  } else if (session.bluffTurn !== null && !session.bluffUsed) {
    console.log(`  ${C.dim('A bluff was scheduled for turn ' + session.bluffTurn + ' but the detective chose not to use it.')}`)
    console.log()
  }

  // 7. Vulnerabilities never found
  const missed = session.evidence.filter((e) => {
    const bestExplanation = Math.max(
      0,
      ...session.turnDetails
        .flatMap((td) => td.adjudication.explains)
        .filter((ex) => ex.evidenceId === e.id)
        .map((ex) => ex.quality),
    )
    return e.state !== 'latent' && bestExplanation < 2
  })
  if (missed.length > 0) {
    console.log(`  ${C.bold('WHAT YOU MISSED')}`)
    for (const e of missed) {
      console.log(`  ${C.dim(e.id)} ${e.claim.slice(0, 60)}...`)
      console.log(`    ${C.yellow('The crack was:')} ${e.vulnerability}`)
    }
    console.log()
  }

  // 8. Token cost summary
  renderCostSummary(session)
}

function sparkline(values: number[]): string {
  const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
  const max = Math.max(...values, 1)
  return values.map((v) => chars[Math.min(7, Math.floor((v / max) * 7.99))]).join('')
}

function renderCostSummary(session: GameSession): void {
  const u = session.usage
  const inputCost = (u.inputTokens * 1.0) / 1_000_000
  const outputCost = (u.outputTokens * 5.0) / 1_000_000
  const cacheCost = (u.cacheCreationTokens * 1.25) / 1_000_000
  const cacheReadCost = (u.cacheReadTokens * 0.1) / 1_000_000
  const total = inputCost + outputCost + cacheCost + cacheReadCost

  const divider = '─'.repeat(56)
  console.log(` ${divider}`)
  console.log(`  ${C.bold('COST SUMMARY')} ${C.dim('(Gemini 2.0 Flash)')}`)
  console.log(`  Input tokens:       ${String(u.inputTokens).padStart(8)}    $${inputCost.toFixed(4)}`)
  console.log(`  Output tokens:      ${String(u.outputTokens).padStart(8)}    $${outputCost.toFixed(4)}`)
  console.log(`  Cache creation:     ${String(u.cacheCreationTokens).padStart(8)}    $${cacheCost.toFixed(4)}`)
  console.log(`  Cache reads:        ${String(u.cacheReadTokens).padStart(8)}    $${cacheReadCost.toFixed(4)}`)
  console.log(`  ${'─'.repeat(38)}`)
  console.log(`  ${C.bold('Total:')}                            ${C.bold('$' + total.toFixed(4))}`)
  console.log(` ${divider}`)
}

// ─── Input helpers ───────────────────────────────────────────────────────────

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve))
}

/** Show crime picker with blurbs and return the chosen type. */
async function pickCrime(rl: readline.Interface): Promise<CrimeType> {
  console.log()
  console.log(`  ${C.bold('CHOOSE YOUR CRIME:')}`)
  console.log()
  for (let i = 0; i < CRIMES.length; i++) {
    console.log(`  ${C.bold(String(i + 1))}. ${C.bold(CRIME_LABELS[CRIMES[i]])}`)
    console.log(`     ${C.dim(CRIME_BLURBS[CRIMES[i]])}`)
  }
  console.log()

  while (true) {
    const answer = await ask(rl, '  Pick (1–3): ')
    const n = parseInt(answer.trim(), 10)
    if (n >= 1 && n <= 3) return CRIMES[n - 1]
    console.log(`  ${C.red('Enter 1, 2, or 3.')}`)
  }
}

// ─── Main game loop ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Check for API key (support multiple providers)
  const hasKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    || process.env.ANTHROPIC_API_KEY
    || process.env.OPENAI_API_KEY
  if (!hasKey) {
    console.error(C.red('\n  Missing API key.'))
    console.error('  Create a .env.local file with one of:')
    console.error('    GOOGLE_GENERATIVE_AI_API_KEY=...')
    console.error('    ANTHROPIC_API_KEY=sk-ant-...')
    console.error('    OPENAI_API_KEY=sk-...\n')
    process.exit(1)
  }

  const rl = createPrompt()

  // Parse CLI args
  const args = process.argv.slice(2)
  const seed = args[0] ?? randomSeed()
  let crime: CrimeType

  if (args[1] && CRIMES.includes(args[1] as CrimeType)) {
    crime = args[1] as CrimeType
  } else if (args[1]) {
    console.error(C.red(`\n  Unknown crime "${args[1]}". Expected: ${CRIMES.join(', ')}\n`))
    process.exit(1)
  } else {
    crime = await pickCrime(rl)
  }

  // Initialise session
  const session = createSession(seed, crime)
  const det = session.caseFile.detective

  // Intro
  console.log()
  console.log(`  ${C.bold('AIRTIGHT')} ${C.dim(`${seed} · ${CRIME_LABELS[crime]}`)}`)
  console.log()
  console.log(`  You are ${C.bold(session.caseFile.suspect.name)}, ${session.caseFile.suspect.occupation}.`)
  console.log(`  You did it. Now talk your way out.`)
  console.log()
  console.log(`  ${C.dim('Type your answers. /quit to exit. /status to re-display meters.')}`)
  console.log(`  ${C.dim(`Max ${MAX_ANSWER_LENGTH} characters per answer.`)}`)

  // Game loop
  let lastDetectiveResponse = session.caseFile.opener
  const newlyRevealed = new Set<string>()

  while (!session.ending && session.turn < session.maxTurns) {
    // Render current state
    renderTurnDisplay(session, lastDetectiveResponse, newlyRevealed)
    newlyRevealed.clear()

    // Get player input
    let answer = ''
    while (true) {
      const raw = await ask(rl, '  > ')
      const trimmed = raw.trim()

      if (trimmed === '/quit') {
        console.log(C.dim('\n  Ending session early.\n'))
        session.ending = session.turn > 0 ? 'HELD_48_HOURS' : null
        rl.close()
        if (session.turnDetails.length > 0) renderBreakdown(session)
        process.exit(0)
      }

      if (trimmed === '/status') {
        console.log(meterBar(session.caseStrength, 'Case Strength', 50, 80))
        console.log(meterBar(session.suspicion, 'Suspicion', 60, 90))
        continue
      }

      if (trimmed.length === 0) {
        console.log(C.dim('  (say something — or /quit to leave)'))
        continue
      }

      if (trimmed.length > MAX_ANSWER_LENGTH) {
        console.log(C.yellow(`  Too long (${trimmed.length}/${MAX_ANSWER_LENGTH}). Try again.`))
        continue
      }

      answer = trimmed
      break
    }

    // Play the turn
    console.log(C.dim('\n  Thinking...\n'))
    const result = await playTurn(session, answer)

    // Track newly revealed evidence
    for (const id of result.evidenceRevealed) {
      newlyRevealed.add(id)
    }

    // Extension notice
    if (result.justExtended) {
      console.log(C.red(C.bold('  ── The interrogation has been extended. ──')))
      console.log(C.red(`  Suspicion hit 90. ${SCORING_CONFIG.extensionRounds} more rounds.`))
    }

    // Store the detective's response for next turn's display
    lastDetectiveResponse = result.detectiveResponse

    // Check ending
    if (result.ending) {
      renderTurnDisplay(session, lastDetectiveResponse, newlyRevealed)
      renderEnding(result.ending, session)
      break
    }
  }

  // If we ran out of turns without a mid-game ending, check now
  if (!session.ending && session.turn >= session.maxTurns) {
    const ending = session.caseStrength < SCORING_CONFIG.releasedCeiling
      ? 'RELEASED' as const
      : 'HELD_48_HOURS' as const
    session.ending = ending
    session.endTurn = session.turn
    renderEnding(ending, session)
  }

  // Post-game breakdown
  renderBreakdown(session)

  rl.close()
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error(C.red('\n  Fatal error:'), err)
  process.exit(1)
})
