import type { CrimeType } from '../engine/types'

/**
 * One eval case: a fixed scenario, a single planted earlier claim, and a
 * test answer that either does or doesn't contradict it. Isolates the
 * adjudicator's contradiction-detection judgment from scoring and session
 * state — see src/cli/eval.ts for the runner.
 */
export type EvalCase = {
  id: string
  /** Short label for the results table, e.g. "direct negation". */
  category: string
  seed: string
  crime: CrimeType
  templateId: string
  /** The earlier claim, already normalised as the adjudicator would phrase it. */
  plantedClaim: string
  /** The player's answer this turn. */
  testAnswer: string
  expectContradiction: boolean
  /** Why this case is labeled the way it is — printed alongside a failure. */
  note: string
}
