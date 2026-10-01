#!/usr/bin/env tsx
/**
 * AIRTIGHT V2 — interactive terminal interrogation (detective mode).
 *
 *   npm run play                          # random seed, crime picker
 *   npm run play -- mallard-7719 arson    # specific case
 *
 * Three-phase flow:
 *   1. Briefing — read the case, see your evidence
 *   2. Interrogation (6 turns) — question the suspect, optionally present evidence
 *   3. Witness (2 turns) — question the witness
 *   4. Verdict — charge or release
 *   5. Post-game breakdown — truth revealed, ledger annotated
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })  // project convention: keys live in .env.local
dotenv.config()                        // fallback to .env if present
import * as readline from 'node:readline'
import { randomSeed } from '../engine/rng'
import { toPublicCase } from '../engine/generate'
import {
  createSession,
  playInterrogationTurn,
  playWitnessTurn,
  resolveVerdict,
} from '../engine/session'
import type { CrimeType, GameSession, Ending, SuspectResponse } from '../engine/types'
import { CRIME_LABELS, CRIME_BLURBS } from '../engine/types'

// ─── ANSI helpers ───────────────────────────────────────────────────────────

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_QUESTION_LENGTH = 300
const BAR_WIDTH = 20
const CRIMES: CrimeType[] = ['homicide', 'arson']  // embezzlement deferred to Phase 2

// ─── Rendering helpers ──────────────────────────────────────────────────────

/** Case Strength bar — green is progress toward charging, visible to the player. */
function renderCaseStrength(value: number, delta: number): void {
  const filled = Math.round((value / 100) * BAR_WIDTH)
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)

  // Color: low = dim, medium = yellow, high = green (high is good for the detective!)
  let coloured: string
  if (value >= 65) coloured = C.green(bar)
  else if (value >= 40) coloured = C.yellow(bar)
  else coloured = C.dim(bar)

  // Delta display
  let deltaStr: string
  if (delta > 0) deltaStr = C.green(` (+${delta})`)
  else if (delta < 0) deltaStr = C.red(` (${delta})`)
  else deltaStr = C.dim(' (+0)')

  console.log(`  ${C.bold('Case Strength')}  [${coloured}]  ${String(value).padStart(3)}/100${deltaStr}`)

  if (value >= 80) {
    console.log(`  ${C.green(C.bold('▲▲ CASE STRONG ENOUGH TO CHARGE'))}`)
  } else if (value >= 65) {
    console.log(`  ${C.yellow('▲ Getting close — keep pressing.')}`)
  }
  console.log()
}

/** Render a demeanor indicator for the suspect. */
function renderDemeanor(demeanor: SuspectResponse['demeanor']): string {
  const indicators: Record<SuspectResponse['demeanor'], string> = {
    calm: C.dim('😐 calm'),
    nervous: C.yellow('😰 nervous'),
    defensive: C.yellow('🛡️ defensive'),
    aggressive: C.red('😡 aggressive'),
    evasive: C.magenta('👀 evasive'),
  }
  return indicators[demeanor] ?? C.dim(demeanor)
}

/** Show evidence table — what the detective has to work with. */
function renderEvidenceTable(session: GameSession): void {
  const pub = toPublicCase(session.caseFile)
  console.log(`  ${C.bold('YOUR EVIDENCE:')}`)
  for (const e of pub.evidence) {
    const status = e.presented ? C.dim('[presented]') : C.green('[available] ')
    console.log(`  ${C.bold(e.id)} ${status} ${C.dim(`[${e.type}]`)} ${e.claim.slice(0, 80)}`)
  }
  console.log()
  console.log(`  ${C.dim('To present evidence: PRESENT e3: Your question here')}`)
  console.log()
}

/** Render the ending banner. */
function renderEnding(ending: Ending, session: GameSession): void {
  const divider = '═'.repeat(56)
  console.log()
  console.log(` ${divider}`)

  switch (ending) {
    case 'CHARGED_STRONG':
      console.log(`  ${C.green(C.bold('CHARGED — STRONG CASE'))}`)
      console.log(`  Case Strength hit ${session.caseStrength}. The evidence speaks for itself.`)
      console.log(`  ${session.caseFile.suspect.name} is going away.`)
      break
    case 'CHARGED_WEAK':
      console.log(`  ${C.yellow(C.bold('CHARGED — GAMBLE PAID OFF'))}`)
      console.log(`  Case Strength was only ${session.caseStrength}, but you charged anyway.`)
      console.log(`  The suspect was guilty — your instinct was right.`)
      break
    case 'RELEASED':
      console.log(`  ${C.red(C.bold('RELEASED'))}`)
      console.log(`  You released ${session.caseFile.suspect.name}.`)
      console.log(`  ${C.red('They were guilty. They walked free.')}`)
      break
  }

  console.log(` ${divider}`)
}

// ─── Post-game breakdown ────────────────────────────────────────────────────

function renderBreakdown(session: GameSession): void {
  const divider = '─'.repeat(56)
  console.log()
  console.log(`  ${C.bold('POST-GAME BREAKDOWN')}`)
  console.log(` ${divider}`)

  // 1. Final Case Strength
  console.log()
  renderCaseStrength(session.caseStrength, 0)
  console.log(`  Interrogation turns: ${session.interrogationTurn}/${session.maxInterrogationTurns}`)
  console.log(`  Witness turns: ${session.witnessTurn}/${session.maxWitnessTurns}`)
  console.log()

  // 2. The truth — what actually happened
  console.log(`  ${C.red(C.bold('THE TRUTH'))}`)
  for (const beat of session.caseFile.truth) {
    console.log(`  ${C.dim(beat.time.padEnd(7))} ${beat.fact}`)
  }
  console.log()
  console.log(`  ${C.red('Fatal fact:')} ${session.caseFile.fatalFact}`)
  console.log()

  // 3. Turning point — largest Case Strength jump
  if (session.interrogationDetails.length > 0) {
    let turningTurn = 0
    let maxDelta = 0
    for (const d of session.interrogationDetails) {
      const delta = Math.abs(d.caseStrengthAfter - d.caseStrengthBefore)
      if (delta > maxDelta) {
        maxDelta = delta
        turningTurn = d.turn
      }
    }
    if (maxDelta > 0) {
      const detail = session.interrogationDetails.find((d) => d.turn === turningTurn)!
      const direction = detail.caseStrengthAfter > detail.caseStrengthBefore
        ? C.green(`+${maxDelta}`)
        : C.red(`-${maxDelta}`)
      console.log(`  ${C.bold('THE MOMENT IT TURNED')}`)
      console.log(`  Interrogation turn ${turningTurn}: Case Strength ${direction} (${detail.caseStrengthBefore} → ${detail.caseStrengthAfter})`)
      console.log(`  You asked: ${C.dim('"' + detail.playerQuestion.slice(0, 120) + '"')}`)
      console.log()
    }
  }

  // 4. Case Strength trajectory (ASCII sparkline)
  if (session.caseStrengthHistory.length > 1) {
    console.log(`  ${C.bold('CASE STRENGTH OVER TIME')}`)
    console.log(`  ${sparkline(session.caseStrengthHistory)}`)
    console.log()
  }

  // 5. Suspect's cover story revealed
  console.log(`  ${C.bold('THE SUSPECT\'S STRATEGY')}`)
  console.log(`  ${C.dim('Cover story:')} ${session.caseFile.suspectPersona.coverStory}`)
  console.log(`  ${C.dim('Breaking points:')} ${session.caseFile.suspectPersona.breakingPoints.join(', ')}`)
  console.log(`  ${C.dim('Guilty knowledge:')}`)
  for (const gk of session.caseFile.suspectPersona.guiltyKnowledge) {
    console.log(`    - ${gk}`)
  }
  console.log()

  // 6. Evidence breakdown — what was presented and what was missed
  console.log(`  ${C.bold('EVIDENCE BREAKDOWN')}`)
  for (const e of session.caseFile.evidence) {
    const status = e.presented ? C.green('[presented]') : C.dim('[never used]')
    console.log(`  ${C.dim(e.id)} ${status} ${e.claim.slice(0, 80)}`)
    console.log(`    ${C.yellow('vulnerability:')} ${C.dim(e.vulnerability)}`)

    // Find how the suspect responded to this evidence
    const responseDetail = session.interrogationDetails.find(
      (d) => d.suspectResponse.evidenceResponse?.evidenceId === e.id,
    )
    if (responseDetail) {
      const er = responseDetail.suspectResponse.evidenceResponse!
      const qualityLabel = ['terrible lie', 'weak deflection', 'plausible', 'airtight'][er.quality]
      console.log(`    ${C.dim(`Suspect used: ${er.strategy} (quality ${er.quality} — ${qualityLabel})`)}`)
    }
  }
  console.log()

  // 7. Annotated suspect claim ledger
  if (session.suspectClaims.length > 0) {
    console.log(`  ${C.bold('SUSPECT CLAIM LEDGER')}`)
    for (const claim of session.suspectClaims) {
      // Find contradictions against this claim
      const contradicted = session.interrogationDetails.some(
        (d) => d.suspectResponse.selfContradiction?.againstClaimId === claim.id,
      )
      const tag = contradicted ? C.red(' [CONTRADICTED]') : ''
      console.log(`  ${claim.id} (turn ${claim.turn}): "${claim.text}"${tag}`)
    }
    console.log()
  }

  // 8. Witness claim ledger
  if (session.witnessClaims.length > 0) {
    console.log(`  ${C.bold('WITNESS CLAIM LEDGER')}`)
    for (const claim of session.witnessClaims) {
      console.log(`  ${claim.id} (turn ${claim.turn}): "${claim.text}"`)
    }
    console.log()
  }

  // 9. Token cost summary
  renderCostSummary(session)
}

function sparkline(values: number[]): string {
  const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
  const max = Math.max(...values, 1)
  return values.map((v) => chars[Math.min(7, Math.floor((v / max) * 7.99))]).join('')
}

function renderCostSummary(session: GameSession): void {
  const u = session.usage
  const divider = '─'.repeat(56)
  console.log(` ${divider}`)
  console.log(`  ${C.bold('TOKEN USAGE')} ${C.dim('(cost depends on provider — see adjudicate.ts MODEL)')}`)
  console.log(`  Input tokens:       ${String(u.inputTokens).padStart(8)}`)
  console.log(`  Output tokens:      ${String(u.outputTokens).padStart(8)}`)
  console.log(`  Cache creation:     ${String(u.cacheCreationTokens).padStart(8)}`)
  console.log(`  Cache reads:        ${String(u.cacheReadTokens).padStart(8)}`)
  console.log(` ${divider}`)
}

// ─── Input helpers ──────────────────────────────────────────────────────────

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve))
}

/** Show crime picker and return the chosen type. */
async function pickCrime(rl: readline.Interface): Promise<CrimeType> {
  console.log()
  console.log(`  ${C.bold('CHOOSE YOUR CASE:')}`)
  console.log()
  for (let i = 0; i < CRIMES.length; i++) {
    console.log(`  ${C.bold(String(i + 1))}. ${C.bold(CRIME_LABELS[CRIMES[i]])}`)
    console.log(`     ${C.dim(CRIME_BLURBS[CRIMES[i]])}`)
  }
  console.log()

  while (true) {
    const answer = await ask(rl, `  Pick (1–${CRIMES.length}): `)
    const n = parseInt(answer.trim(), 10)
    if (n >= 1 && n <= CRIMES.length) return CRIMES[n - 1]
    console.log(`  ${C.red(`Enter 1–${CRIMES.length}.`)}`)
  }
}

// ─── Main game loop ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Check for API key (support multiple providers)
  const hasKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    || process.env.ANTHROPIC_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.XAI_API_KEY
    || process.env.OPENROUTER_API_KEY
  if (!hasKey) {
    console.error(C.red('\n  Missing API key.'))
    console.error('  Create a .env.local file with one of:')
    console.error('    XAI_API_KEY=...')
    console.error('    GOOGLE_GENERATIVE_AI_API_KEY=...')
    console.error('    ANTHROPIC_API_KEY=sk-ant-...')
    console.error('    OPENAI_API_KEY=sk-...')
    console.error('    OPENROUTER_API_KEY=...\n')
    process.exit(1)
  }

  const rl = createPrompt()

  // Parse CLI args: [seed] [crime] [templateId]
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

  // ── Phase 1: Briefing ──────────────────────────────────────────────────
  const divider = '═'.repeat(56)
  console.log()
  console.log(` ${divider}`)
  console.log(`  ${C.bold('AIRTIGHT')} ${C.dim(`${seed} · ${CRIME_LABELS[crime]}`)}`)
  console.log(` ${divider}`)
  console.log()

  const briefing = session.caseFile.detectiveBriefing
  console.log(`  ${C.bold('CASE BRIEFING')}`)
  console.log()
  console.log(`  ${C.bold('Victim:')} ${briefing.victimSummary}`)
  console.log(`  ${C.bold('Suspect:')} ${briefing.suspectSummary}`)
  console.log(`  ${C.bold('Scene:')} ${briefing.sceneSummary}`)
  console.log()
  console.log(`  ${C.cyan(briefing.evidenceSummary)}`)
  console.log()

  // Show evidence table
  renderEvidenceTable(session)

  // Show witness info
  const witness = session.caseFile.witness
  console.log(`  ${C.bold('WITNESS AVAILABLE:')} ${witness.name} — ${witness.relationship}`)
  console.log(`  ${C.dim('(You can question the witness after the interrogation — 2 questions max)')}`)
  console.log()

  // Initial case strength
  renderCaseStrength(session.caseStrength, 0)

  console.log(`  ${C.dim('Commands: type a question, PRESENT e3: question, /evidence, /status, /quit')}`)
  console.log(`  ${C.dim(`Max ${MAX_QUESTION_LENGTH} characters per question.`)}`)
  console.log()

  // ── Phase 2: Interrogation ─────────────────────────────────────────────
  console.log(` ${divider}`)
  console.log(`  ${C.bold('INTERROGATION')} — ${session.caseFile.suspect.name}`)
  console.log(` ${divider}`)
  console.log()

  while (!session.ending && session.interrogationTurn < session.maxInterrogationTurns) {
    const turnLabel = `Turn ${session.interrogationTurn + 1}/${session.maxInterrogationTurns}`
    let question = ''

    while (true) {
      const raw = await ask(rl, `  ${C.dim(turnLabel)} > `)
      const trimmed = raw.trim()

      if (trimmed === '/quit') {
        console.log(C.dim('\n  Ending session early.\n'))
        rl.close()
        if (session.interrogationDetails.length > 0) renderBreakdown(session)
        process.exit(0)
      }

      if (trimmed === '/status') {
        renderCaseStrength(session.caseStrength, 0)
        continue
      }

      if (trimmed === '/evidence') {
        renderEvidenceTable(session)
        continue
      }

      if (trimmed.length === 0) {
        console.log(C.dim('  (ask a question — or /quit to leave)'))
        continue
      }

      if (trimmed.length > MAX_QUESTION_LENGTH) {
        console.log(C.yellow(`  Too long (${trimmed.length}/${MAX_QUESTION_LENGTH}). Try again.`))
        continue
      }

      question = trimmed
      break
    }

    // Play the turn
    console.log(C.dim('\n  Thinking...\n'))
    const result = await playInterrogationTurn(session, question)

    // Show the suspect's response
    console.log(`  ${C.bold(session.caseFile.suspect.name)} ${renderDemeanor(result.suspectDemeanor)}:`)
    console.log(`  ${C.cyan('"' + result.suspectDialogue + '"')}`)
    console.log()

    // Show case strength update
    renderCaseStrength(session.caseStrength, result.caseStrengthDelta)

    // Show what evidence was presented
    if (result.presentedEvidenceId) {
      console.log(`  ${C.dim(`Evidence ${result.presentedEvidenceId} presented.`)}`)
      console.log()
    }

    // Check ending
    if (result.ending) {
      renderEnding(result.ending, session)
      break
    }
  }

  // ── Phase 3: Witness ───────────────────────────────────────────────────
  if (!session.ending) {
    console.log()
    console.log(` ${divider}`)
    console.log(`  ${C.bold('WITNESS INTERVIEW')} — ${witness.name} (${witness.relationship})`)
    console.log(` ${divider}`)
    console.log()
    console.log(`  ${C.dim(`You have ${session.maxWitnessTurns} questions for this witness.`)}`)
    console.log()

    while (!session.ending && session.witnessTurn < session.maxWitnessTurns) {
      const turnLabel = `Q${session.witnessTurn + 1}/${session.maxWitnessTurns}`
      let question = ''

      while (true) {
        const raw = await ask(rl, `  ${C.dim(turnLabel)} > `)
        const trimmed = raw.trim()

        if (trimmed === '/quit') {
          console.log(C.dim('\n  Ending session early.\n'))
          rl.close()
          renderBreakdown(session)
          process.exit(0)
        }

        if (trimmed === '/skip') {
          console.log(C.dim('  Skipping remaining witness questions.'))
          // Force out of the witness loop
          session.witnessTurn = session.maxWitnessTurns
          question = ''
          break
        }

        if (trimmed === '/status') {
          renderCaseStrength(session.caseStrength, 0)
          continue
        }

        if (trimmed.length === 0) {
          console.log(C.dim('  (ask a question, /skip to move on, or /quit)'))
          continue
        }

        if (trimmed.length > MAX_QUESTION_LENGTH) {
          console.log(C.yellow(`  Too long (${trimmed.length}/${MAX_QUESTION_LENGTH}). Try again.`))
          continue
        }

        question = trimmed
        break
      }

      // /skip sets question to '' and advances witnessTurn — break out
      if (!question) break

      console.log(C.dim('\n  Thinking...\n'))
      const result = await playWitnessTurn(session, question)

      // Show the witness's response
      console.log(`  ${C.bold(witness.name)} ${C.dim(`(${result.witnessDemeanor})`)}:`)
      console.log(`  ${C.cyan('"' + result.witnessDialogue + '"')}`)
      console.log()

      // Show case strength update
      renderCaseStrength(session.caseStrength, result.caseStrengthDelta)

      if (result.ending) {
        renderEnding(result.ending, session)
        break
      }
    }
  }

  // ── Phase 4: Verdict ──────────────────────────────────────────────────
  if (!session.ending) {
    console.log()
    console.log(` ${divider}`)
    console.log(`  ${C.bold('VERDICT')}`)
    console.log(` ${divider}`)
    console.log()
    console.log(`  Case Strength: ${session.caseStrength}/100`)
    console.log()

    if (session.caseStrength >= 80) {
      // Should have been caught earlier, but just in case
      const ending = resolveVerdict(session, true)
      renderEnding(ending, session)
    } else {
      console.log(`  ${C.yellow('Your case isn\'t strong enough for a guaranteed conviction.')}`)
      console.log(`  ${C.bold('Do you charge the suspect anyway, or release them?')}`)
      console.log()
      console.log(`  ${C.bold('1.')} ${C.green('CHARGE')} — gamble that they\'re guilty`)
      console.log(`  ${C.bold('2.')} ${C.red('RELEASE')} — let them go`)
      console.log()

      while (true) {
        const answer = await ask(rl, '  Your decision (1 or 2): ')
        const n = parseInt(answer.trim(), 10)
        if (n === 1) {
          const ending = resolveVerdict(session, true)
          renderEnding(ending, session)
          break
        }
        if (n === 2) {
          const ending = resolveVerdict(session, false)
          renderEnding(ending, session)
          break
        }
        console.log(`  ${C.red('Enter 1 or 2.')}`)
      }
    }
  }

  // Post-game breakdown
  renderBreakdown(session)

  rl.close()
}

// ─── Run ────────────────────────────────────────────────────────────────────

main().catch((err) => {
  if ((err as { code?: string })?.code === 'ERR_USE_AFTER_CLOSE') {
    console.log(C.dim('\n  Input closed — ending session.\n'))
    process.exit(0)
  }
  console.error(C.red('\n  Fatal error:'), err)
  process.exit(1)
})
