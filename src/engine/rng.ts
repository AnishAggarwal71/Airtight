/**
 * Deterministic seeded RNG.
 *
 * This is load-bearing. The server regenerates the full case file from the seed
 * on every single turn, so generation MUST be pure and reproducible — same seed,
 * byte-identical case file, forever. It is also what makes the eval harness
 * possible: a fixed seed is a fixed scenario to test against.
 */

/** cyrb128 — string to four 32-bit seeds. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ]
}

/** sfc32 — fast, well-distributed 32-bit PRNG. */
function sfc32(a: number, b: number, c: number, d: number) {
  return function (): number {
    a |= 0
    b |= 0
    c |= 0
    d |= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

export class Rng {
  private next: () => number

  constructor(seed: string) {
    const [a, b, c, d] = cyrb128(seed)
    this.next = sfc32(a, b, c, d)
    // Discard the first few to avoid correlation between similar seeds.
    for (let i = 0; i < 12; i++) this.next()
  }

  /** Float in [0, 1). */
  float(): number {
    return this.next()
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** Random element. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick() on empty array')
    return arr[Math.floor(this.next() * arr.length)]
  }

  /** n distinct elements, order randomised. */
  sample<T>(arr: readonly T[], n: number): T[] {
    return this.shuffle(arr).slice(0, Math.min(n, arr.length))
  }

  /** Fisher–Yates, non-mutating. */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p
  }
}

/** Human-readable seeds: `mallard-7719`. Shareable, typeable, memorable. */
const SEED_WORDS = [
  'mallard', 'cobalt', 'thistle', 'harrow', 'vellum', 'quarry', 'pelican',
  'rosin', 'lantern', 'brackish', 'meridian', 'tallow', 'cinder', 'gable',
  'wicker', 'plinth', 'ferrous', 'aspen', 'kestrel', 'marrow', 'sable',
  'drift', 'copperhead', 'juniper', 'fathom', 'grist', 'halyard', 'ember',
] as const

export function randomSeed(): string {
  const word = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)]
  const num = 1000 + Math.floor(Math.random() * 9000)
  return `${word}-${num}`
}

/** Pad a number to a clock string, e.g. hhmm(22, 7) -> "22:07". */
export function hhmm(h: number, m: number): string {
  const hh = ((h % 24) + 24) % 24
  return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Add minutes to a "HH:MM" string, wrapping at midnight. */
export function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + mins
  return hhmm(Math.floor(total / 60), ((total % 60) + 60) % 60)
}
