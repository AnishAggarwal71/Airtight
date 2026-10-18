/**
 * Automated detective — hardcoded question scripts + full-game runner.
 *
 * Layer 1: feeds hand-crafted eval cases through the invigilator and compares
 *          its structured signals against human-labeled expected signals.
 * Layer 2: runs N full games using a scripted detective (fixed questions +
 *          evidence presentation order) and collects aggregate statistics.
 *
 * Both layers share the same model/provider configured in adjudicate.ts.
 */

import { generate } from '../engine/generate'
import {
  evaluateSuspectTurn,
  buildInvigilatorSystemPrompt,
  type EvaluateSuspectInput,
} from '../engine/invigilator'
import {
  createSession,
  playInterrogationTurn,
  playWitnessTurn,
  isWitnessAvailable,
} from '../engine/session'
import { SCORING_CONFIG } from '../engine/score'
import type {
  Claim,
  Ending,
  InvigilatorSuspectResponse,
} from '../engine/types'
import type { EvalCase, EvalResult, GameResult, EvalReport } from './types'
import { EVAL_CASES } from './cases'

// ─── Layer 1: Invigilator accuracy ──────────────────────────────────────────

/**
 * Compare actual invigilator signals to hand-labeled expected signals.
 * Returns a per-case pass/fail with details for the report.
 */
function compareSignals(
  evalCase: EvalCase,
  actual: InvigilatorSuspectResponse,
): { passed: boolean; details: string[] } {
  const details: string[] = []
  let passed = true

  // ── Guilty knowledge leak ───────────────────────────────────────────────
  const actualGK = actual.signals.guiltyKnowledgeLeak !== null
  if (actualGK !== evalCase.expectedSignals.guiltyKnowledgeLeak) {
    details.push(
      `guiltyKnowledgeLeak: expected ${evalCase.expectedSignals.guiltyKnowledgeLeak}, got ${actualGK}`,
    )
    passed = false
  }

  // ── Contradictions ──────────────────────────────────────────────────────
  const expectedContra = evalCase.expectedSignals.contradictions
  const actualContra = actual.signals.contradictions

  // Check recall: every expected contradiction should be found
  for (const exp of expectedContra) {
    const found = actualContra.some(
      (a) => a.againstClaimId === exp.againstClaimId,
    )
    if (!found) {
      details.push(
        `contradiction missed: expected against ${exp.againstClaimId} (${exp.severity})`,
      )
      passed = false
    }
  }

  // Check precision: no spurious contradictions
  const expectedClaimIds = new Set(expectedContra.map((e) => e.againstClaimId))
  for (const act of actualContra) {
    if (!expectedClaimIds.has(act.againstClaimId)) {
      details.push(
        `spurious contradiction: flagged ${act.againstClaimId} (${act.severity}), not expected`,
      )
      passed = false
    }
  }

  // ── Evidence handling quality ───────────────────────────────────────────
  for (const [evidenceId, expectedQuality] of Object.entries(
    evalCase.expectedSignals.evidenceQuality,
  )) {
    const actualEntry = actual.signals.evidenceHandling.find(
      (eh) => eh.evidenceId === evidenceId,
    )
    if (!actualEntry) {
      details.push(
        `evidenceHandling missing: expected ${evidenceId} quality=${expectedQuality}`,
      )
      passed = false
    } else if (Math.abs(actualEntry.quality - expectedQuality) > 1) {
      // Allow ±1 tolerance — quality is a judgment call
      details.push(
        `evidenceHandling ${evidenceId}: expected ~${expectedQuality}, got ${actualEntry.quality}`,
      )
      passed = false
    }
  }

  // ── Demeanor shift ──────────────────────────────────────────────────────
  if (actual.signals.demeanorShift !== evalCase.expectedSignals.demeanorShift) {
    details.push(
      `demeanorShift: expected ${evalCase.expectedSignals.demeanorShift}, got ${actual.signals.demeanorShift}`,
    )
    passed = false
  }

  return { passed, details }
}

/**
 * Run one eval case: build the context for the invigilator, call it, and
 * compare signals against the hand-labeled expectations.
 */
export async function runEvalCase(
  evalCase: EvalCase,
  onProgress?: (msg: string) => void,
): Promise<EvalResult> {
  const caseFile = generate({ seed: evalCase.seed, crime: 'homicide' })

  // Build prior claims in ledger format
  const suspectClaims: Claim[] = evalCase.priorClaims.map((pc) => ({
    id: pc.id,
    text: pc.text,
    turn: pc.turn,
    checkable: pc.checkable,
  }))

  // Resolve presented evidence from the case file (with full vulnerability for the judge)
  const presentedEvidence = caseFile.evidence.filter((e) =>
    evalCase.presentedEvidenceIds.includes(e.id),
  )

  const evalInput: EvaluateSuspectInput = {
    caseFile,
    turn: evalCase.turnNumber,
    maxTurns: SCORING_CONFIG.maxInterrogationTurns,
    playerQuestion: evalCase.playerQuestion,
    suspectDialogue: evalCase.suspectDialogue,
    presentedEvidence,
    suspectClaims,
    previousDemeanor: evalCase.previousDemeanor,
  }

  onProgress?.(`  Running ${evalCase.id}...`)

  try {
    const { response } = await evaluateSuspectTurn(evalInput)

    const { passed, details } = compareSignals(evalCase, response)

    return {
      caseId: evalCase.id,
      passed,
      expected: evalCase.expectedSignals,
      actual: {
        contradictions: response.signals.contradictions.map((c) => ({
          againstClaimId: c.againstClaimId,
          severity: c.severity,
        })),
        guiltyKnowledgeLeak: response.signals.guiltyKnowledgeLeak !== null,
        evidenceQuality: Object.fromEntries(
          response.signals.evidenceHandling.map((eh) => [eh.evidenceId, eh.quality]),
        ),
        demeanorShift: response.signals.demeanorShift,
      },
      reasoning: response.reasoning + (details.length > 0 ? `\n  Mismatches: ${details.join('; ')}` : ''),
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      caseId: evalCase.id,
      passed: false,
      expected: evalCase.expectedSignals,
      actual: {
        contradictions: [],
        guiltyKnowledgeLeak: false,
        evidenceQuality: {},
        demeanorShift: false,
      },
      reasoning: `Invigilator call failed: ${detail}`,
    }
  }
}

/**
 * Run all 18 eval cases and compute precision/recall.
 */
export async function runLayer1(
  onProgress?: (msg: string) => void,
): Promise<EvalReport['layer1']> {
  onProgress?.('\n── Layer 1: Invigilator Accuracy ──────────────────────')
  onProgress?.(`  ${EVAL_CASES.length} cases\n`)

  const results: EvalResult[] = []
  for (const evalCase of EVAL_CASES) {
    const result = await runEvalCase(evalCase, onProgress)
    results.push(result)
    const icon = result.passed ? '✓' : '✗'
    onProgress?.(`  ${icon} ${result.caseId} — ${result.passed ? 'PASS' : 'FAIL'}`)
  }

  // Precision/recall over all signal dimensions combined
  const { truePositives, falsePositives, falseNegatives } = computePrecisionRecall(results)
  const precision = truePositives + falsePositives === 0
    ? 1
    : truePositives / (truePositives + falsePositives)
  const recall = truePositives + falseNegatives === 0
    ? 1
    : truePositives / (truePositives + falseNegatives)

  return {
    total: EVAL_CASES.length,
    passed: results.filter((r) => r.passed).length,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    results,
  }
}

/**
 * Count TP/FP/FN across all signal dimensions for precision/recall.
 * A "positive" is any signal that fires (contradiction, GK leak, demeanor shift).
 * Evidence quality uses a ±1 tolerance band.
 */
function computePrecisionRecall(results: EvalResult[]): {
  truePositives: number
  falsePositives: number
  falseNegatives: number
} {
  let tp = 0
  let fp = 0
  let fn = 0

  for (const r of results) {
    const ec = EVAL_CASES.find((c) => c.id === r.caseId)!

    // Guilty knowledge leak (binary)
    if (ec.expectedSignals.guiltyKnowledgeLeak && r.actual.guiltyKnowledgeLeak) tp++
    else if (!ec.expectedSignals.guiltyKnowledgeLeak && r.actual.guiltyKnowledgeLeak) fp++
    else if (ec.expectedSignals.guiltyKnowledgeLeak && !r.actual.guiltyKnowledgeLeak) fn++

    // Contradictions (per claim ID)
    const expectedClaimIds = new Set(ec.expectedSignals.contradictions.map((c) => c.againstClaimId))
    const actualClaimIds = new Set(r.actual.contradictions.map((c) => c.againstClaimId))
    for (const id of expectedClaimIds) {
      if (actualClaimIds.has(id)) tp++
      else fn++
    }
    for (const id of actualClaimIds) {
      if (!expectedClaimIds.has(id)) fp++
    }

    // Demeanor shift (binary)
    if (ec.expectedSignals.demeanorShift && r.actual.demeanorShift) tp++
    else if (!ec.expectedSignals.demeanorShift && r.actual.demeanorShift) fp++
    else if (ec.expectedSignals.demeanorShift && !r.actual.demeanorShift) fn++
  }

  return { truePositives: tp, falsePositives: fp, falseNegatives: fn }
}

// ─── Layer 2: Automated gameplay ────────────────────────────────────────────

/**
 * Hardcoded detective script — 6 interrogation questions with evidence
 * presentation, then 2 witness questions. Designed to hit the main evidence
 * items and push the suspect on the key pressure points.
 */
const DETECTIVE_SCRIPT = {
  interrogation: [
    // Turn 1: open-ended, establish baseline claims
    'Can you walk me through your entire evening? Start from when you arrived at the building.',
    // Turn 2: press on the relationship and motive (present debt evidence)
    'PRESENT e4: The victim owed you a significant amount of money. Tell me about that.',
    // Turn 3: press on timeline (present wifi evidence)
    'PRESENT e3: Your phone was connected to the building wifi much later than you say you left. Explain that.',
    // Turn 4: press on exit route (present key card evidence)
    'PRESENT e1: Your key card was used at the bin store exit. You said you left through the front.',
    // Turn 5: press on cause of death (present pathology evidence)
    'PRESENT e2: The pathologist says the head injury is inconsistent with a fall. What do you say to that?',
    // Turn 6: final pressure (present remaining evidence — typically e5)
    'PRESENT e5: A bottle from the victim\'s wine rack is missing and your prints are on the rack. Where is it?',
  ],
  witness: [
    // Witness Q1: general — what did they see/hear?
    'What did you see or hear that evening? Anything unusual?',
    // Witness Q2: probe suspect's claims specifically
    'The suspect says they left before half past and everything was friendly. Does that match what you saw?',
  ],
} as const

/**
 * Run one full automated game and return aggregate statistics.
 *
 * The witness is now a one-time, gated interrupt rather than a fixed phase
 * (see docs/decisions.md, 2026-10-15, witness-timing change): the script
 * calls it as soon as it unlocks (Case Strength exceeds
 * SCORING_CONFIG.witnessUnlockThreshold) between interrogation turns, not
 * unconditionally after all six. If Case Strength never clears the
 * threshold, the witness is skipped entirely and the game resolves off the
 * six suspect turns alone — this will shift the previously-reported Layer 2
 * numbers (6/10 CHARGED_STRONG, mean CS 77), since those were produced by a
 * runner that always spent both witness questions regardless of gating.
 */
export async function runOneGame(
  seed: string,
  onProgress?: (msg: string) => void,
): Promise<GameResult> {
  const startTime = Date.now()

  try {
    const session = createSession(seed, 'homicide', SCORING_CONFIG)

    const perTurnDeltas: number[] = []
    const signalCounts = {
      contradictions: 0,
      guiltyKnowledgeLeaks: 0,
      demeanorShifts: 0,
      witnessContradictions: 0,
    }

    // Spends the one-time witness session, if it's unlocked and unused.
    // Returns the ending if the witness pushed Case Strength to CHARGED_STRONG.
    const tryWitness = async (): Promise<Ending | null> => {
      if (session.witnessUsed || !isWitnessAvailable(session)) return null
      for (let i = 0; i < DETECTIVE_SCRIPT.witness.length; i++) {
        const question = DETECTIVE_SCRIPT.witness[i]
        onProgress?.(`    Witness ${i + 1}/2: ${question.slice(0, 60)}...`)

        const result = await playWitnessTurn(session, question)
        perTurnDeltas.push(result.caseStrengthDelta)

        const detail = session.witnessDetails[session.witnessDetails.length - 1]
        if (detail?.invigilatorResponse?.signals?.suspectContradiction) {
          signalCounts.witnessContradictions++
        }

        if (result.ending === 'CHARGED_STRONG') {
          onProgress?.(`    CHARGED_STRONG after witness ${i + 1} (CS: ${session.caseStrength})`)
          return result.ending
        }
      }
      return null
    }

    // ── Interrogation phase, with the witness interleaved as soon as it unlocks ──
    for (let i = 0; i < DETECTIVE_SCRIPT.interrogation.length; i++) {
      const question = DETECTIVE_SCRIPT.interrogation[i]
      onProgress?.(`    Turn ${i + 1}/6: ${question.slice(0, 60)}...`)

      const result = await playInterrogationTurn(session, question)
      perTurnDeltas.push(result.caseStrengthDelta)

      // Count signals from this turn's invigilator response
      const detail = session.interrogationDetails[session.interrogationDetails.length - 1]
      if (detail?.invigilatorResponse) {
        const sig = detail.invigilatorResponse.signals
        signalCounts.contradictions += sig.contradictions.length
        if (sig.guiltyKnowledgeLeak) signalCounts.guiltyKnowledgeLeaks++
        if (sig.demeanorShift) signalCounts.demeanorShifts++
      }

      // Early exit if CHARGED_STRONG
      if (result.ending === 'CHARGED_STRONG') {
        onProgress?.(`    CHARGED_STRONG at turn ${i + 1} (CS: ${session.caseStrength})`)
        return buildGameResult(session, seed, true, perTurnDeltas, signalCounts)
      }

      const witnessEnding = await tryWitness()
      if (witnessEnding) {
        return buildGameResult(session, seed, true, perTurnDeltas, signalCounts)
      }
    }

    // Interrogation is exhausted. If the witness unlocked only on the final
    // turn, session.ending is already resolved (CHARGED_WEAK/RELEASED) by
    // checkEnding's turn-exhaustion check before this line runs — the one-time
    // witness window has to be used between turns, not after the budget
    // is spent. Only reachable here with session.ending still null if the
    // interrogation loop somehow exits without exhausting turns, so this is
    // a no-op in practice; kept for defensiveness against future script changes.
    if (!session.ending) {
      await tryWitness()
    }

    return buildGameResult(session, seed, true, perTurnDeltas, signalCounts)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    onProgress?.(`    ERROR: ${detail}`)
    return {
      seed,
      completed: false,
      finalCaseStrength: 0,
      ending: null,
      turns: 0,
      signalCounts: {
        contradictions: 0,
        guiltyKnowledgeLeaks: 0,
        demeanorShifts: 0,
        witnessContradictions: 0,
      },
      perTurnDeltas: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      error: detail,
    }
  }
}

/** Package a completed session into a GameResult. */
function buildGameResult(
  session: import('../engine/types').GameSession,
  seed: string,
  completed: boolean,
  perTurnDeltas: number[],
  signalCounts: GameResult['signalCounts'],
): GameResult {
  return {
    seed,
    completed,
    finalCaseStrength: session.caseStrength,
    ending: session.ending,
    turns: session.interrogationTurn + session.witnessTurn,
    signalCounts,
    perTurnDeltas,
    tokenUsage: {
      inputTokens: session.usage.inputTokens,
      outputTokens: session.usage.outputTokens,
      cacheCreationTokens: session.usage.cacheCreationTokens,
      cacheReadTokens: session.usage.cacheReadTokens,
    },
  }
}

/**
 * Run N automated games with different seeds and return aggregate stats.
 */
export async function runLayer2(
  gameCount: number,
  onProgress?: (msg: string) => void,
): Promise<NonNullable<EvalReport['layer2']>> {
  onProgress?.(`\n── Layer 2: Automated Gameplay (${gameCount} games) ────────────`)

  const games: GameResult[] = []

  for (let i = 0; i < gameCount; i++) {
    const seed = `eval-game-${i}-${Date.now()}`
    onProgress?.(`\n  Game ${i + 1}/${gameCount} [${seed}]`)

    const result = await runOneGame(seed, onProgress)
    games.push(result)
  }

  // ── Aggregate statistics ──────────────────────────────────────────────
  const completed = games.filter((g) => g.completed)
  const abandoned = games.filter((g) => !g.completed)

  const endingDist: Record<string, number> = {}
  for (const g of completed) {
    const e = g.ending ?? 'UNKNOWN'
    endingDist[e] = (endingDist[e] ?? 0) + 1
  }

  const strengths = completed.map((g) => g.finalCaseStrength).sort((a, b) => a - b)
  const mean = strengths.length > 0
    ? Math.round(strengths.reduce((s, v) => s + v, 0) / strengths.length)
    : 0
  const median = strengths.length > 0
    ? strengths[Math.floor(strengths.length / 2)]
    : 0

  // Signal frequency: average signals per completed game
  const signalFreq: Record<string, number> = {}
  if (completed.length > 0) {
    const totals = { contradictions: 0, guiltyKnowledgeLeaks: 0, demeanorShifts: 0, witnessContradictions: 0 }
    for (const g of completed) {
      totals.contradictions += g.signalCounts.contradictions
      totals.guiltyKnowledgeLeaks += g.signalCounts.guiltyKnowledgeLeaks
      totals.demeanorShifts += g.signalCounts.demeanorShifts
      totals.witnessContradictions += g.signalCounts.witnessContradictions
    }
    signalFreq['contradictions/game'] = Math.round((totals.contradictions / completed.length) * 100) / 100
    signalFreq['guiltyKnowledgeLeaks/game'] = Math.round((totals.guiltyKnowledgeLeaks / completed.length) * 100) / 100
    signalFreq['demeanorShifts/game'] = Math.round((totals.demeanorShifts / completed.length) * 100) / 100
    signalFreq['witnessContradictions/game'] = Math.round((totals.witnessContradictions / completed.length) * 100) / 100
  }

  return {
    gamesRequested: gameCount,
    gamesCompleted: completed.length,
    gamesAbandoned: abandoned.length,
    endingDistribution: endingDist,
    caseStrength: {
      mean,
      median,
      min: strengths[0] ?? 0,
      max: strengths[strengths.length - 1] ?? 0,
    },
    signalFrequency: signalFreq,
    games,
  }
}
