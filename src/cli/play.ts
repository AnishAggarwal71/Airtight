#!/usr/bin/env tsx
/**
 * AIRTIGHT — interactive terminal interrogation.
 *
 *   npm run play                          # random seed, crime picker
 *   npm run play -- mallard-7719 arson    # specific case
 *
 * 7 rounds. Collect → Probe → Confront/Corner arc. Suspicion bar visible
 * after each answer — the player sees the meter move but never the score
 * breakdown until the post-game reveal.
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })  // project convention: keys live in .env.local
dotenv.config()                        // fallback to .env if present
import * as readline from 'node:readline'
import { randomSeed } from '../engine/rng'
import { createSession, playTurn } from '../engine/session'
import type { CrimeType, GameSession, Ending, TurnDetail } from '../engine/types'
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

/** Render a meter bar with colour thresholds — used only in the post-game breakdown. */
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

/**
 * Render the turn header and the detective's line. No meters, no evidence
 * table — the player knows what they did, not what the police have, and
 * feedback is tone only. Evidence surfaces inside detectiveResponse itself.
 */
function renderTurnDisplay(session: GameSession, detectiveResponse: string): void {
  const divider = '═'.repeat(56)
  console.log()
  console.log(` ${divider}`)
  console.log(`  ${C.bold('AIRTIGHT')}          Turn ${session.turn} of ${session.maxTurns}        ${C.dim(session.seed)}`)
  console.log(` ${divider}`)

  const det = session.caseFile.detective
  console.log(`  ${C.bold(`${det.rank} ${det.name}`)}:`)
  console.log(`  ${C.cyan('"' + detectiveResponse + '"')}`)
  console.log()
}

/**
 * Render the live suspicion bar after an answer lands. The player sees the
 * bar move and the delta — that uncertainty-then-reveal loop is the core
 * dopamine mechanic. Color thresholds: green < 40, yellow 40-64, red 65+.
 */
function renderLiveSuspicion(session: GameSession, delta: number): void {
  const value = session.suspicion
  const filled = Math.round((value / 100) * BAR_WIDTH)
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)

  let coloured: string
  if (value >= 65) coloured = C.red(bar)
  else if (value >= 40) coloured = C.yellow(bar)
  else coloured = C.green(bar)

  // Delta display: +15 in red, -8 in green, 0 in dim
  let deltaStr: string
  if (delta > 0) deltaStr = C.red(` (+${delta})`)
  else if (delta < 0) deltaStr = C.green(` (${delta})`)
  else deltaStr = C.dim(' (+0)')

  console.log(`  ${C.bold('Suspicion')}  [${coloured}]  ${String(value).padStart(3)}/100${deltaStr}`)

  // Warn when the threshold is close
  if (value >= 65 && value < 80) {
    console.log(`  ${C.red('▲ You are close to being charged.')}`)
  } else if (value >= 80) {
    console.log(`  ${C.red(C.bold('▲▲ CHARGED'))}`)
  }
  console.log()
}

/** Render the ending banner. CHARGED can happen on any turn; RELEASED only at the end. */
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
      console.log(`  You survived ${session.turn} rounds. Insufficient evidence.`)
      console.log(`  You're free to go.`)
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

  // 1. Final meter — the only time it's ever shown
  console.log(meterBar(session.suspicion, 'Suspicion', 50, 75))
  console.log(`  Turns played: ${session.turn}/${session.maxTurns}`)
  console.log()

  // 2. Turning point — largest Suspicion jump
  if (session.turnDetails.length > 0) {
    let turningPoint: TurnDetail | null = null
    let maxDelta = 0
    for (const td of session.turnDetails) {
      const delta = Math.abs(td.suspicionAfter - td.suspicionBefore)
      if (delta > maxDelta) {
        maxDelta = delta
        turningPoint = td
      }
    }
    if (turningPoint && maxDelta > 0) {
      const direction = turningPoint.suspicionAfter > turningPoint.suspicionBefore
        ? C.red(`+${maxDelta}`)
        : C.green(`-${maxDelta}`)
      console.log(`  ${C.bold('THE MOMENT IT TURNED')}`)
      console.log(`  Turn ${turningPoint.turn}: Suspicion ${direction} (${turningPoint.suspicionBefore} → ${turningPoint.suspicionAfter})`)
      console.log(`  You said: ${C.dim('"' + turningPoint.playerAnswer.slice(0, 120) + '"')}`)
      console.log()
    }
  }

  // 3. Meter trajectory (ASCII sparkline)
  if (session.suspicionHistory.length > 0) {
    console.log(`  ${C.bold('SUSPICION OVER TIME')}`)
    console.log(`  ${sparkline(session.suspicionHistory)}`)
    console.log()
  }

  // 4. Evidence breakdown — what was ever played, and what never came up
  console.log(`  ${C.bold('EVIDENCE BREAKDOWN')}`)
  for (const e of session.evidence) {
    const stateTag = e.state === 'latent' ? C.dim('[never raised]') : `[${e.state}]`
    console.log(`  ${C.dim(e.id)} ${stateTag} ${e.claim.slice(0, 90)}`)
    if (e.state !== 'latent') {
      console.log(`    ${C.yellow('vulnerability:')} ${C.dim(e.vulnerability.slice(0, 100))}`)
    }
  }
  console.log()

  // 5. Annotated claim ledger
  if (session.claims.length > 0) {
    console.log(`  ${C.bold('CLAIM LEDGER')}`)
    for (const claim of session.claims) {
      const contradictions = session.turnDetails
        .flatMap((td) => td.adjudication.contradictions)
        .filter((c) => c.againstClaimId === claim.id)
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
    const bestQuality = Math.max(
      0,
      ...session.turnDetails
        .map((td) => td.adjudication.evidencePlayed)
        .filter((ep) => ep && ep.evidenceId === e.id)
        .map((ep) => ep!.quality),
    )
    return e.state !== 'latent' && bestQuality < 2
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
  // Rates below are the old Gemini 2.0 Flash pricing, kept as a rough
  // placeholder after the model swap to 3.5 Flash Lite — re-check against
  // the current rate card before trusting these dollar figures.
  const inputCost = (u.inputTokens * 1.0) / 1_000_000
  const outputCost = (u.outputTokens * 5.0) / 1_000_000
  const cacheCost = (u.cacheCreationTokens * 1.25) / 1_000_000
  const cacheReadCost = (u.cacheReadTokens * 0.1) / 1_000_000
  const total = inputCost + outputCost + cacheCost + cacheReadCost

  const divider = '─'.repeat(56)
  console.log(` ${divider}`)
  console.log(`  ${C.bold('COST SUMMARY')} ${C.dim('(Gemini 3.5 Flash Lite — rates approximate)')}`)
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

  // Parse CLI args: [seed] [crime] [templateId]
  // templateId forces a specific scenario (e.g. "homicide-stairwell") while
  // still varying names/times/amounts from the seed — useful for beta-testing
  // one rewritten template against many playthroughs.
  const args = process.argv.slice(2)
  const seed = args[0] ?? randomSeed()
  const templateId = args[2]
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
  let session: ReturnType<typeof createSession>
  try {
    session = createSession(seed, crime, undefined, templateId)
  } catch (err) {
    console.error(C.red(`\n  ${(err as Error).message}\n`))
    process.exit(1)
  }

  // Intro
  console.log()
  console.log(`  ${C.bold('AIRTIGHT')} ${C.dim(`${seed} · ${CRIME_LABELS[crime]}`)}`)
  console.log()

  const briefing = session.caseFile.briefing
  if (briefing) {
    console.log(`  You're ${C.bold(briefing.name)}, ${briefing.age}, ${briefing.occupation}.`)
    console.log()
    console.log(`  ${briefing.what}`)
  } else {
    console.log(`  You are ${C.bold(session.caseFile.suspect.name)}, ${session.caseFile.suspect.occupation}.`)
    console.log(`  You did it. Now talk your way out.`)
  }
  console.log()
  console.log(`  ${C.dim('Type your answers. /quit to exit.')}`)
  console.log(`  ${C.dim(`Max ${MAX_ANSWER_LENGTH} characters per answer.`)}`)

  // Show initial suspicion — you're already a suspect, never presumed clean
  console.log()
  renderLiveSuspicion(session, 0)

  // Show the opener before the loop — this is the detective's first line
  {
    const det = session.caseFile.detective
    const divider = '═'.repeat(56)
    console.log(` ${divider}`)
    console.log(`  ${C.bold('AIRTIGHT')}          Turn 1 of ${session.maxTurns}        ${C.dim(session.seed)}`)
    console.log(` ${divider}`)
    console.log(`  ${C.bold(`${det.rank} ${det.name}`)}:`)
    console.log(`  ${C.cyan('"' + session.caseFile.opener + '"')}`)
    console.log()
  }

  // Game loop — each iteration: player answers → model reacts → suspicion bar
  while (!session.ending && session.turn < session.maxTurns) {
    // Get player input
    let answer = ''
    while (true) {
      const raw = await ask(rl, '  > ')
      const trimmed = raw.trim()

      if (trimmed === '/quit') {
        console.log(C.dim('\n  Ending session early.\n'))
        rl.close()
        if (session.turnDetails.length > 0) renderBreakdown(session)
        process.exit(0)
      }

      if (trimmed === '/status') {
        renderLiveSuspicion(session, 0)
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

    // Show the suspicion bar after the answer lands — the reveal moment
    const lastDetail = session.turnDetails[session.turnDetails.length - 1]
    const delta = lastDetail ? lastDetail.suspicionAfter - lastDetail.suspicionBefore : 0
    renderLiveSuspicion(session, delta)

    // Show the detective's reaction (which contains the next question)
    renderTurnDisplay(session, result.detectiveResponse)

    // Check ending
    if (result.ending) {
      renderEnding(result.ending, session)
      break
    }
  }

  // If we ran out of turns without a mid-game ending, check now
  if (!session.ending && session.turn >= session.maxTurns) {
    session.ending = 'RELEASED'
    session.endTurn = session.turn
    renderEnding('RELEASED', session)
  }

  // Post-game breakdown
  renderBreakdown(session)

  rl.close()
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch((err) => {
  // A closed stdin (Ctrl+D, or piped input reaching EOF) surfaces as this
  // readline error — it's not a game bug, just an ended input stream, so
  // exit quietly instead of dumping a stack trace.
  if ((err as { code?: string })?.code === 'ERR_USE_AFTER_CLOSE') {
    console.log(C.dim('\n  Input closed — ending session.\n'))
    process.exit(0)
  }
  console.error(C.red('\n  Fatal error:'), err)
  process.exit(1)
})
