#!/usr/bin/env tsx
/**
 * M2 eval harness — contradiction-detection precision/recall.
 *
 * npm run eval
 *
 * Each case (src/eval/cases.ts) plants one earlier claim directly into the
 * ledger and makes a single live adjudicate() call with a test answer that
 * either does or doesn't contradict it. This isolates the adjudicator's
 * contradiction judgment from scoring/session state instead of running full
 * playthroughs. Requires a model API key in .env.local, same as `npm run play`.
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { generate } from '../engine/generate'
import { adjudicate, type AdjudicateInput } from '../engine/adjudicate'
import { EVAL_CASES } from '../eval/cases'
import type { Claim, TokenUsage } from '../engine/types'

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
}

type CaseResult = {
  id: string
  category: string
  expected: boolean
  predicted: boolean
  correct: boolean
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.OPENAI_API_KEY && !process.env.XAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    console.error(C.red('\n  No model API key found. Add one to .env.local (see .env.example).\n'))
    process.exit(1)
  }

  console.log()
  console.log(`  ${C.bold('AIRTIGHT — M2 eval')} ${C.dim(`${EVAL_CASES.length} cases, contradiction detection`)}`)
  console.log()

  const results: CaseResult[] = []
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }

  let first = true
  for (const c of EVAL_CASES) {
    // Gemini's free tier caps at 15 req/min for this model — space calls out
    // so a 17-case run doesn't trip 429s and silently fall back to defaults.
    if (!first) await new Promise((resolve) => setTimeout(resolve, 4500))
    first = false

    const caseFile = generate({ seed: c.seed, crime: c.crime, templateId: c.templateId })
    const plantedClaim: Claim = { id: 'c1', text: c.plantedClaim, turn: 1, checkable: true }

    const input: AdjudicateInput = {
      caseFile,
      turn: 2,
      maxTurns: 7,
      phase: 'mid',
      playerAnswer: c.testAnswer,
      claims: [plantedClaim],
      evidenceHint: null,
      bluffAuthorized: false,
    }

    const { adjudication, usage: turnUsage } = await adjudicate(input)
    usage.inputTokens += turnUsage.inputTokens
    usage.outputTokens += turnUsage.outputTokens
    usage.cacheCreationTokens += turnUsage.cacheCreationTokens
    usage.cacheReadTokens += turnUsage.cacheReadTokens

    const predicted = adjudication.contradictions.some((ctr) => ctr.againstClaimId === 'c1')
    const correct = predicted === c.expectContradiction
    results.push({ id: c.id, category: c.category, expected: c.expectContradiction, predicted, correct })

    const status = correct ? C.green('ok  ') : C.red('FAIL')
    const line = `  ${status} ${c.id.padEnd(30)} expected ${String(c.expectContradiction).padEnd(5)} got ${String(predicted).padEnd(5)} ${C.dim(`[${c.category}]`)}`
    console.log(line)
    if (!correct) {
      console.log(`       ${C.dim(c.note)}`)
      if (adjudication.contradictions.length > 0) {
        console.log(`       ${C.dim(`model said: ${JSON.stringify(adjudication.contradictions)}`)}`)
      }
    }
  }

  // Confusion matrix
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const r of results) {
    if (r.expected && r.predicted) tp++
    else if (!r.expected && r.predicted) fp++
    else if (r.expected && !r.predicted) fn++
    else tn++
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  const accuracy = (tp + tn) / results.length

  console.log()
  console.log(` ${'─'.repeat(56)}`)
  console.log(`  ${C.bold('RESULTS')}`)
  console.log(`  TP ${tp}   FP ${fp}   FN ${fn}   TN ${tn}`)
  console.log(`  Precision ${(precision * 100).toFixed(0)}%   Recall ${(recall * 100).toFixed(0)}%   F1 ${(f1 * 100).toFixed(0)}%   Accuracy ${(accuracy * 100).toFixed(0)}%`)
  console.log()

  // Token counts only — cost-per-token varies by provider (see adjudicate.ts's
  // MODEL), so a dollar estimate here would be wrong as soon as MODEL changes.
  console.log(`  ${C.dim(`${usage.inputTokens} input / ${usage.outputTokens} output tokens this run`)}`)
  console.log()

  const failed = results.filter((r) => !r.correct)
  if (failed.length > 0) {
    console.log(`  ${C.yellow(`${failed.length} case(s) failed — see FAIL lines above.`)}`)
    console.log()
    process.exitCode = 1
  }
}

main()
