#!/usr/bin/env tsx
/**
 * Eval harness CLI — runs invigilator accuracy tests and automated gameplay.
 *
 * Usage:
 *   npm run eval                     # Layer 1 only (no games)
 *   npm run eval -- --games 10       # Layer 1 + 10 automated games
 *   npm run eval -- --games 50       # Layer 1 + 50 automated games (full run)
 *   npm run eval -- --layer2-only 5  # Skip Layer 1, just run 5 games
 *
 * Results are written to eval-results/ as timestamped JSON files.
 * That directory is gitignored — results are ephemeral, not committed.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'

// Load env before any engine imports (provider factories read keys eagerly)
dotenv.config({ path: '.env.local' })
dotenv.config()

import { runLayer1, runLayer2 } from '../eval/detective'
import type { EvalReport } from '../eval/types'

// ─── ANSI helpers ───────────────────────────────────────────────────────────

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
}

// ─── Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getFlag(name: string): number | null {
  const idx = args.indexOf(name)
  if (idx === -1) return null
  const val = parseInt(args[idx + 1], 10)
  if (isNaN(val) || val < 1) {
    console.error(`${name} requires a positive integer`)
    process.exit(1)
  }
  return val
}

const gameCount = getFlag('--games')
const layer2Only = getFlag('--layer2-only')

if (layer2Only !== null && gameCount !== null) {
  console.error('Cannot use both --games and --layer2-only')
  process.exit(1)
}

// ─── API key check ──────────────────────────────────────────────────────────

const hasKey = !!process.env.ANTHROPIC_API_KEY?.trim()
if (!hasKey) {
  console.error(
    '\n  No API key found. Set ANTHROPIC_API_KEY in .env.local.\n' +
    '  See .env.example for the minimal setup.\n',
  )
  process.exit(1)
}

// ─── Progress printer ───────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(msg)
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(C.bold('\n  AIRTIGHT Eval Harness\n'))

  const startTime = Date.now()

  // ── Layer 1: Invigilator accuracy ───────────────────────────────────────
  let layer1: Awaited<ReturnType<typeof runLayer1>> | null = null

  if (layer2Only === null) {
    layer1 = await runLayer1(log)

    console.log('')
    console.log(C.bold('  Layer 1 Results:'))
    console.log(`    Cases:     ${layer1.passed}/${layer1.total} passed`)
    console.log(`    Precision: ${formatPercent(layer1.precision)}`)
    console.log(`    Recall:    ${formatPercent(layer1.recall)}`)

    // Per-category breakdown
    const byCategory = new Map<string, { passed: number; total: number }>()
    for (const r of layer1.results) {
      const cat = EVAL_CASES_BY_ID.get(r.caseId)?.category ?? 'unknown'
      const entry = byCategory.get(cat) ?? { passed: 0, total: 0 }
      entry.total++
      if (r.passed) entry.passed++
      byCategory.set(cat, entry)
    }
    console.log('')
    console.log(C.bold('  By category:'))
    for (const [cat, { passed, total }] of byCategory) {
      const icon = passed === total ? C.green('✓') : C.red('✗')
      console.log(`    ${icon} ${cat.padEnd(20)} ${passed}/${total}`)
    }
  }

  // ── Layer 2: Automated gameplay ─────────────────────────────────────────
  let layer2: Awaited<ReturnType<typeof runLayer2>> | null = null
  const numGames = layer2Only ?? gameCount

  if (numGames !== null) {
    const l2 = (await runLayer2(numGames, log))!
    layer2 = l2

    console.log('')
    console.log(C.bold('  Layer 2 Results:'))
    console.log(`    Games:     ${l2.gamesCompleted}/${l2.gamesRequested} completed`)
    if (l2.gamesAbandoned > 0) {
      console.log(`    Abandoned: ${C.red(String(l2.gamesAbandoned))}`)
    }
    console.log(`    Endings:   ${formatEndingDist(l2.endingDistribution)}`)
    console.log(`    Case Strength: mean=${l2.caseStrength.mean} median=${l2.caseStrength.median} range=[${l2.caseStrength.min}, ${l2.caseStrength.max}]`)

    console.log('')
    console.log(C.bold('  Signal frequency (per game):'))
    for (const [key, val] of Object.entries(l2.signalFrequency)) {
      console.log(`    ${key.padEnd(32)} ${val}`)
    }
  }

  // ── Write report ────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  const modelName = 'claude-haiku-4-5'

  const report: EvalReport = {
    timestamp: new Date().toISOString(),
    model: modelName,
    layer1: layer1 ?? { total: 0, passed: 0, precision: 0, recall: 0, results: [] },
    layer2,
  }

  const outDir = path.resolve(process.cwd(), 'eval-results')
  await mkdir(outDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = path.join(outDir, `eval-${timestamp}.json`)
  await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8')

  console.log('')
  console.log(C.dim(`  Report: ${outPath}`))
  console.log(C.dim(`  Elapsed: ${elapsed}s`))
  console.log('')
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Import the case list for ID lookups without re-importing at top level. */
import { EVAL_CASES } from '../eval/cases'
const EVAL_CASES_BY_ID = new Map(EVAL_CASES.map((c) => [c.id, c]))

function formatPercent(ratio: number): string {
  const pct = Math.round(ratio * 100)
  if (pct >= 80) return C.green(`${pct}%`)
  if (pct >= 60) return C.yellow(`${pct}%`)
  return C.red(`${pct}%`)
}

function formatEndingDist(dist: Record<string, number>): string {
  return Object.entries(dist)
    .map(([ending, count]) => {
      const label = ending === 'CHARGED_STRONG' ? C.green(ending)
        : ending === 'CHARGED_WEAK' ? C.yellow(ending)
        : C.red(ending)
      return `${label}=${count}`
    })
    .join('  ')
}

// ─── Run ────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('\n  Fatal error:', err)
  process.exit(1)
})
