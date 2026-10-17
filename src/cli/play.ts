#!/usr/bin/env tsx
/**
 * AIRTIGHT V3 — interactive terminal interrogation (detective mode).
 *
 *   npm run play                          # random seed, homicide
 *   npm run play -- mallard-7719          # specific seed
 *   npm run play -- test-seed-1 homicide  # explicit crime arg (only homicide active)
 *
 * Two-agent flow per turn:
 *   1. Persona agent generates suspect/witness dialogue
 *   2. Invigilator agent judges the dialogue and returns scoring signals
 *
 * Phases: briefing -> interrogation (6 turns, witness callable mid-game once
 * Case Strength clears the unlock threshold) -> breakdown. There is no
 * separate verdict step — the ending is resolved purely from Case Strength
 * and turn exhaustion (see docs/decisions.md, 2026-10-15, ending reframe).
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()
import * as readline from 'node:readline'
import {
  appendTranscriptExchange,
  appendTranscriptSessionEnd,
  appendTranscriptTurnFailed,
  appendTranscriptTurnStarted,
  createTranscriptLog,
} from './transcript'
import { randomSeed } from '../engine/rng'
import { toPublicCase } from '../engine/generate'
import { SCORING_CONFIG } from '../engine/score'
import {
  createSession,
  parsePlayerInput,
  playInterrogationTurn,
  playWitnessTurn,
  isWitnessAvailable,
} from '../engine/session'
import type { CrimeType, GameSession, Ending, SuspectResponse } from '../engine/types'
import { CRIME_LABELS } from '../engine/types'

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

// ─── Rendering helpers ──────────────────────────────────────────────────────

function renderCaseStrength(value: number, delta: number): void {
  const filled = Math.round((value / 100) * BAR_WIDTH)
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)

  let coloured: string
  if (value >= 65) coloured = C.green(bar)
  else if (value >= 40) coloured = C.yellow(bar)
  else coloured = C.dim(bar)

  let deltaStr: string
  if (delta > 0) deltaStr = C.green(` (+${delta})`)
  else if (delta < 0) deltaStr = C.red(` (${delta})`)
  else deltaStr = C.dim(' (+0)')

  console.log(`  ${C.bold('Case Strength')}  [${coloured}]  ${String(value).padStart(3)}/100${deltaStr}`)

  if (value >= 80) {
    console.log(`  ${C.green(C.bold('>> CASE STRONG ENOUGH TO CHARGE'))}`)
  } else if (value >= 65) {
    console.log(`  ${C.yellow('> Getting close — keep pressing.')}`)
  }
  console.log()
}

function renderDemeanor(demeanor: SuspectResponse['demeanor']): string {
  const indicators: Record<SuspectResponse['demeanor'], string> = {
    calm: C.dim('[calm]'),
    nervous: C.yellow('[nervous]'),
    defensive: C.yellow('[defensive]'),
    aggressive: C.red('[aggressive]'),
    evasive: C.magenta('[evasive]'),
  }
  return indicators[demeanor] ?? C.dim(`[${demeanor}]`)
}

function renderEvidenceTable(session: GameSession): void {
  const pub = toPublicCase(session.caseFile)
  console.log(`  ${C.bold('YOUR EVIDENCE:')}`)
  for (const e of pub.evidence) {
    const status = e.presented ? C.dim('[presented]') : C.green('[available] ')
    console.log(`  ${C.bold(e.id)} ${status} ${C.dim(`[${e.type}]`)} ${e.claim.slice(0, 80)}`)
  }
  console.log()
  console.log(`  ${C.dim('Present one: PRESENT e3: question  |  Multiple: PRESENT e1,e3: question')}`)
  console.log()
}

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
      console.log(`  ${C.yellow(C.bold('CHARGED — QUALIFIED CASE'))}`)
      console.log(`  Case Strength ended at ${session.caseStrength}. Not airtight, but enough to charge.`)
      console.log(`  ${session.caseFile.suspect.name} goes to trial on a case with real holes in it.`)
      break
    case 'RELEASED':
      console.log(`  ${C.red(C.bold('RELEASED'))}`)
      console.log(`  Case Strength ended at ${session.caseStrength} — not enough to charge.`)
      console.log(`  ${C.red(`${session.caseFile.suspect.name} walks. The detective failed to build the case.`)}`)
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

  // 2. The truth
  console.log(`  ${C.red(C.bold('THE TRUTH'))}`)
  for (const beat of session.caseFile.truth) {
    console.log(`  ${C.dim(beat.time.padEnd(7))} ${beat.fact}`)
  }
  console.log()
  console.log(`  ${C.red('Fatal fact:')} ${session.caseFile.fatalFact}`)
  console.log()

  // 3. Turning point
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
      console.log(`  Interrogation turn ${turningTurn}: Case Strength ${direction} (${detail.caseStrengthBefore} -> ${detail.caseStrengthAfter})`)
      console.log(`  You asked: ${C.dim('"' + detail.playerQuestion.slice(0, 120) + '"')}`)
      console.log()
    }
  }

  // 4. Case Strength trajectory
  if (session.caseStrengthHistory.length > 1) {
    console.log(`  ${C.bold('CASE STRENGTH OVER TIME')}`)
    console.log(`  ${sparkline(session.caseStrengthHistory)}`)
    console.log()
  }

  // 5. Invigilator per-turn analysis
  if (session.interrogationDetails.length > 0) {
    console.log(`  ${C.bold('INVIGILATOR ANALYSIS — INTERROGATION')}`)
    for (const d of session.interrogationDetails) {
      const delta = d.caseStrengthAfter - d.caseStrengthBefore
      const deltaStr = delta > 0 ? C.green(`+${delta}`) : delta < 0 ? C.red(`${delta}`) : C.dim('+0')
      console.log(`  ${C.bold(`Turn ${d.turn}`)} (${deltaStr}) — "${C.dim(d.playerQuestion.slice(0, 80))}"`)

      if (d.invigilatorResponse) {
        const inv = d.invigilatorResponse
        console.log(`    ${C.dim(inv.reasoning)}`)

        for (const c of inv.signals.contradictions) {
          console.log(`    ${C.red(`[CONTRADICTION ${c.severity}]`)} vs ${c.againstClaimId}: ${c.description}`)
        }
        if (inv.signals.guiltyKnowledgeLeak) {
          console.log(`    ${C.red('[GUILTY KNOWLEDGE LEAK]')} ${inv.signals.guiltyKnowledgeLeak.description}`)
        }
        for (const eh of inv.signals.evidenceHandling) {
          const qualityLabel = ['terrible lie', 'weak deflection', 'plausible', 'airtight'][eh.quality]
          console.log(`    ${C.yellow(`[${eh.evidenceId}]`)} quality ${eh.quality} (${qualityLabel}): ${C.dim(eh.description)}`)
        }
        if (inv.signals.demeanorShift) {
          console.log(`    ${C.yellow('[DEMEANOR SHIFT]')} suspect showed visible change under pressure`)
        }
      } else {
        console.log(`    ${C.dim('(invigilator evaluation not available for this turn)')}`)
      }
      console.log()
    }
  }

  // 6. Invigilator per-turn analysis — witness
  if (session.witnessDetails.length > 0) {
    console.log(`  ${C.bold('INVIGILATOR ANALYSIS — WITNESS')}`)
    for (const d of session.witnessDetails) {
      const delta = d.caseStrengthAfter - d.caseStrengthBefore
      const deltaStr = delta > 0 ? C.green(`+${delta}`) : delta < 0 ? C.red(`${delta}`) : C.dim('+0')
      console.log(`  ${C.bold(`Turn ${d.turn}`)} (${deltaStr}) — "${C.dim(d.playerQuestion.slice(0, 80))}"`)

      if (d.invigilatorResponse) {
        console.log(`    ${C.dim(d.invigilatorResponse.reasoning)}`)
        if (d.invigilatorResponse.signals.suspectContradiction) {
          const sc = d.invigilatorResponse.signals.suspectContradiction
          console.log(`    ${C.green('[WITNESS CONTRADICTS SUSPECT]')} vs ${sc.againstClaimId}: ${sc.description}`)
        }
      } else {
        console.log(`    ${C.dim('(invigilator evaluation not available for this turn)')}`)
      }
      console.log()
    }
  }

  // 7. Suspect's cover story revealed
  console.log(`  ${C.bold('THE SUSPECT\'S STRATEGY')}`)
  console.log(`  ${C.dim('Cover story:')} ${session.caseFile.suspectPersona.coverStory}`)
  console.log(`  ${C.dim('Breaking points:')} ${session.caseFile.suspectPersona.breakingPoints.join(', ')}`)
  console.log(`  ${C.dim('Guilty knowledge:')}`)
  for (const gk of session.caseFile.suspectPersona.guiltyKnowledge) {
    console.log(`    - ${gk}`)
  }
  console.log()

  // 8. Evidence breakdown
  console.log(`  ${C.bold('EVIDENCE BREAKDOWN')}`)
  for (const e of session.caseFile.evidence) {
    const status = e.presented ? C.green('[presented]') : C.dim('[never used]')
    console.log(`  ${C.dim(e.id)} ${status} ${e.claim.slice(0, 80)}`)
    console.log(`    ${C.yellow('vulnerability:')} ${C.dim(e.vulnerability)}`)

    // Find invigilator quality rating for this evidence
    const turnDetail = session.interrogationDetails.find(
      (d) => d.invigilatorResponse?.signals.evidenceHandling.some((eh) => eh.evidenceId === e.id),
    )
    if (turnDetail?.invigilatorResponse) {
      const eh = turnDetail.invigilatorResponse.signals.evidenceHandling.find((h) => h.evidenceId === e.id)
      if (eh) {
        const qualityLabel = ['terrible lie', 'weak deflection', 'plausible', 'airtight'][eh.quality]
        console.log(`    ${C.dim(`Invigilator rated: quality ${eh.quality} (${qualityLabel})`)}`)
      }
    }
  }
  console.log()

  // 9. Suspect claim ledger
  if (session.suspectClaims.length > 0) {
    console.log(`  ${C.bold('SUSPECT CLAIM LEDGER')}`)

    // Collect all claim IDs that were flagged as contradicted by the invigilator
    const contradictedIds = new Set<string>()
    for (const d of session.interrogationDetails) {
      if (d.invigilatorResponse) {
        for (const c of d.invigilatorResponse.signals.contradictions) {
          contradictedIds.add(c.againstClaimId)
        }
      }
    }

    for (const claim of session.suspectClaims) {
      const tag = contradictedIds.has(claim.id) ? C.red(' [CONTRADICTED]') : ''
      console.log(`  ${claim.id} (turn ${claim.turn}): "${claim.text}"${tag}`)
    }
    console.log()
  }

  // 10. Witness claim ledger
  if (session.witnessClaims.length > 0) {
    console.log(`  ${C.bold('WITNESS CLAIM LEDGER')}`)
    for (const claim of session.witnessClaims) {
      console.log(`  ${claim.id} (turn ${claim.turn}): "${claim.text}"`)
    }
    console.log()
  }

  // 11. Token cost summary
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
  console.log(`  ${C.bold('TOKEN USAGE')} ${C.dim('(claude-haiku-4-5 — see adjudicate.ts MODEL)')}`)
  console.log(`  Input tokens:       ${String(u.inputTokens).padStart(8)}`)
  console.log(`  Output tokens:      ${String(u.outputTokens).padStart(8)}`)
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

// ─── Witness session (one-time, mid-game) ──────────────────────────────────

/**
 * Runs the witness's two questions as a one-time interrupt of the
 * interrogation. Called from the interrogation loop via /witness, once
 * isWitnessAvailable() is true. Mutates session in place; sets
 * session.ending if the witness's testimony pushes Case Strength to
 * CHARGED_STRONG, same as an interrogation turn would.
 */
async function runWitnessSession(
  session: GameSession,
  rl: readline.Interface,
  transcriptPath: string,
  divider: string,
  witness: { name: string; relationship: string },
): Promise<void> {
  console.log()
  console.log(` ${divider}`)
  console.log(`  ${C.bold('WITNESS INTERVIEW')} — ${witness.name} (${witness.relationship})`)
  console.log(` ${divider}`)
  console.log()
  console.log(`  ${C.dim(`You have ${session.maxWitnessTurns} questions for this witness. This is a one-time session.`)}`)
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
        await appendTranscriptSessionEnd(transcriptPath, {
          type: 'session_end',
          finalCaseStrength: session.caseStrength,
          ending: session.ending,
        })
        renderBreakdown(session)
        process.exit(0)
      }

      if (trimmed === '/status') {
        renderCaseStrength(session.caseStrength, 0)
        continue
      }

      if (trimmed.length === 0) {
        console.log(C.dim('  (ask a question, or /quit)'))
        continue
      }

      if (trimmed.length > MAX_QUESTION_LENGTH) {
        console.log(C.yellow(`  Too long (${trimmed.length}/${MAX_QUESTION_LENGTH}). Try again.`))
        continue
      }

      question = trimmed
      break
    }

    const witnessTurn = session.witnessTurn + 1
    await appendTranscriptTurnStarted(transcriptPath, {
      type: 'turn_started',
      phase: 'witness',
      turn: witnessTurn,
      detectiveInput: question,
      detectiveMessage: question,
      aiRole: 'witness',
    })
    console.log(C.dim('\n  Thinking...\n'))
    let result
    try {
      result = await playWitnessTurn(session, question)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      await appendTranscriptTurnFailed(
        transcriptPath,
        {
          type: 'turn_failed',
          phase: 'witness',
          turn: witnessTurn,
          aiRole: 'witness',
          error: { name: error.name, message: error.message },
        },
        [process.env.ANTHROPIC_API_KEY ?? ''],
      )
      throw err
    }
    const witnessDetail = session.witnessDetails[session.witnessDetails.length - 1]
    await appendTranscriptExchange(transcriptPath, {
      type: 'exchange',
      phase: 'witness',
      turn: session.witnessTurn,
      detectiveMessage: question,
      aiRole: 'witness',
      aiMessage: result.witnessDialogue,
      invigilatorSignals: witnessDetail?.invigilatorResponse?.signals ?? null,
      caseStrengthDelta: result.caseStrengthDelta,
      caseStrengthAfter: session.caseStrength,
    })

    // Show the witness's response
    console.log(`  ${C.bold(witness.name)} ${C.dim(`[${result.witnessDemeanor}]`)}:`)
    console.log(`  ${C.cyan('"' + result.witnessDialogue + '"')}`)
    console.log()

    // Show case strength update
    renderCaseStrength(session.caseStrength, result.caseStrengthDelta)

    // Show invigilator reasoning
    if (result.invigilatorFailed) {
      console.log(`  ${C.yellow('[Invigilator] Evaluation failed — no score change this turn.')}`)
      console.log()
    } else if (result.invigilatorReasoning) {
      console.log(`  ${C.dim(`[Invigilator] ${result.invigilatorReasoning}`)}`)
      console.log()
    }

    if (result.ending) {
      renderEnding(result.ending, session)
      break
    }
  }

  console.log(` ${divider}`)
  console.log(`  ${C.dim('Back to the interrogation.')}`)
  console.log(` ${divider}`)
  console.log()
}

// ─── Main game loop ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!anthropicApiKey) {
    console.error(C.red('\n  Missing API key.'))
    console.error('  Put your Anthropic key in .env.local as: ANTHROPIC_API_KEY=sk-ant-...\n')
    process.exit(1)
  }

  const rl = createPrompt()

  // Parse CLI args: [seed] [crime] [templateId]
  const args = process.argv.slice(2)
  const seed = args[0] ?? randomSeed()
  const crime: CrimeType = 'homicide'
  const templateId = args[2]

  // Validate crime arg if provided
  if (args[1] && args[1] !== 'homicide') {
    console.error(C.red(`\n  Only homicide is available in this version.\n`))
    process.exit(1)
  }

  // Initialise session
  let session: ReturnType<typeof createSession>
  try {
    session = createSession(seed, crime, undefined, templateId)
  } catch (err) {
    console.error(C.red(`\n  ${(err as Error).message}\n`))
    process.exit(1)
  }

  const transcriptPath = await createTranscriptLog(seed, crime)

  // ── Phase 1: Briefing ──────────────────────────────────────────────────
  const divider = '═'.repeat(56)
  console.log()
  console.log(` ${divider}`)
  console.log(`  ${C.bold('AIRTIGHT')} ${C.dim(`${seed} · ${CRIME_LABELS[crime]}`)}`)
  console.log(` ${divider}`)
  console.log()
  console.log(`  ${C.dim(`Transcript: ${transcriptPath}`)}`)
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

  renderEvidenceTable(session)

  const witness = session.caseFile.witness
  console.log(`  ${C.bold('WITNESS AVAILABLE:')} ${witness.name} — ${witness.relationship}`)
  console.log(`  ${C.dim(`(Call the witness any time with /witness, once Case Strength exceeds ${SCORING_CONFIG.witnessUnlockThreshold} — 2 questions, one-time only)`)}`)
  console.log()

  renderCaseStrength(session.caseStrength, 0)

  console.log(`  ${C.dim('Commands: type a question, PRESENT e3: question, PRESENT e1,e3: question, /witness, /evidence, /status, /quit')}`)
  console.log(`  ${C.dim(`Max ${MAX_QUESTION_LENGTH} characters per question.`)}`)
  console.log()

  // ── Phase 2: Interrogation (witness callable mid-game via /witness) ────
  console.log(` ${divider}`)
  console.log(`  ${C.bold('INTERROGATION')} — ${session.caseFile.suspect.name}`)
  console.log(` ${divider}`)
  console.log()

  while (!session.ending && session.interrogationTurn < session.maxInterrogationTurns) {
    const turnLabel = `Turn ${session.interrogationTurn + 1}/${session.maxInterrogationTurns}`
    let question = ''
    let callWitness = false

    while (true) {
      const raw = await ask(rl, `  ${C.dim(turnLabel)} > `)
      const trimmed = raw.trim()

      if (trimmed === '/quit') {
        console.log(C.dim('\n  Ending session early.\n'))
        rl.close()
        await appendTranscriptSessionEnd(transcriptPath, {
          type: 'session_end',
          finalCaseStrength: session.caseStrength,
          ending: session.ending,
        })
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

      if (trimmed === '/witness') {
        if (!isWitnessAvailable(session)) {
          console.log(
            session.witnessUsed
              ? C.yellow('  The witness has already been questioned — that one-time session is closed.')
              : C.yellow(`  Not yet — the witness unlocks once Case Strength exceeds ${SCORING_CONFIG.witnessUnlockThreshold} (currently ${session.caseStrength}).`),
          )
          continue
        }
        callWitness = true
        break
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

    if (callWitness) {
      await runWitnessSession(session, rl, transcriptPath, divider, witness)
      continue
    }

    const parsedInput = parsePlayerInput(question, session.caseFile.evidence)
    if (parsedInput.rejectedEvidenceIds.length > 0) {
      console.log(C.yellow(`  Not presented (unknown or already used): ${parsedInput.rejectedEvidenceIds.join(', ')}`))
      console.log()
    }

    // Play the turn
    const interrogationTurn = session.interrogationTurn + 1
    await appendTranscriptTurnStarted(transcriptPath, {
      type: 'turn_started',
      phase: 'interrogation',
      turn: interrogationTurn,
      detectiveInput: question,
      detectiveMessage: parsedInput.question,
      aiRole: 'suspect',
      ...(parsedInput.presentedEvidenceIds.length > 0
        ? { presentedEvidenceIds: parsedInput.presentedEvidenceIds }
        : {}),
      ...(parsedInput.rejectedEvidenceIds.length > 0
        ? { rejectedEvidenceIds: parsedInput.rejectedEvidenceIds }
        : {}),
    })
    console.log(C.dim('\n  Thinking...\n'))
    let result
    try {
      result = await playInterrogationTurn(session, question)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      await appendTranscriptTurnFailed(
        transcriptPath,
        {
          type: 'turn_failed',
          phase: 'interrogation',
          turn: interrogationTurn,
          aiRole: 'suspect',
          error: { name: error.name, message: error.message },
        },
        [process.env.ANTHROPIC_API_KEY ?? ''],
      )
      throw err
    }
    const interrogationDetail = session.interrogationDetails[session.interrogationDetails.length - 1]
    await appendTranscriptExchange(transcriptPath, {
      type: 'exchange',
      phase: 'interrogation',
      turn: session.interrogationTurn,
      detectiveMessage: question,
      aiRole: 'suspect',
      aiMessage: result.suspectDialogue,
      ...(result.presentedEvidenceIds.length > 0
        ? { presentedEvidenceIds: result.presentedEvidenceIds }
        : {}),
      invigilatorSignals: interrogationDetail?.invigilatorResponse?.signals ?? null,
      caseStrengthDelta: result.caseStrengthDelta,
      caseStrengthAfter: session.caseStrength,
    })

    // Show the suspect's response
    console.log(`  ${C.bold(session.caseFile.suspect.name)} ${renderDemeanor(result.suspectDemeanor)}:`)
    console.log(`  ${C.cyan('"' + result.suspectDialogue + '"')}`)
    console.log()

    // Show case strength update
    renderCaseStrength(session.caseStrength, result.caseStrengthDelta)

    // Show invigilator reasoning
    if (result.invigilatorFailed) {
      console.log(`  ${C.yellow('[Invigilator] Evaluation failed — no score change this turn.')}`)
      console.log()
    } else if (result.invigilatorReasoning) {
      console.log(`  ${C.dim(`[Invigilator] ${result.invigilatorReasoning}`)}`)
      console.log()
    }

    // Show what evidence was presented
    if (result.presentedEvidenceIds.length > 0) {
      console.log(`  ${C.dim(`Evidence presented: ${result.presentedEvidenceIds.join(', ')}.`)}`)
      console.log()
    }

    // Announce witness unlock the moment it happens
    if (!session.witnessUsed && isWitnessAvailable(session) && session.interrogationTurn < session.maxInterrogationTurns) {
      console.log(`  ${C.green(`>> The witness is now available. Type /witness to call them in.`)}`)
      console.log()
    }

    // Check ending
    if (result.ending) {
      renderEnding(result.ending, session)
      break
    }
  }

  // checkEnding() resolves CHARGED_STRONG/CHARGED_WEAK/RELEASED purely from
  // Case Strength and turn exhaustion (see docs/decisions.md, 2026-10-15,
  // ending reframe) — by the time the loop above exits, session.ending is
  // always set and already rendered (inline above, or inside
  // runWitnessSession below), so there is no separate verdict step here.

  await appendTranscriptSessionEnd(transcriptPath, {
    type: 'session_end',
    finalCaseStrength: session.caseStrength,
    ending: session.ending,
  })

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
