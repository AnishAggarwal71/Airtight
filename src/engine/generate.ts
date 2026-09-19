import { Rng } from './rng'
import type { CaseFile, CrimeType, Evidence, PublicCase } from './types'
import { TEMPLATES } from './templates'
import { DETECTIVE_NAMES } from './templates/shared'

/**
 * Scenario generation — deterministic, no model call, no network.
 *
 * Three reasons this is not an LLM call:
 *   1. It's free, which is the single biggest lever on cost per playthrough.
 *   2. It's instant — no loading spinner between "start" and the first question.
 *   3. It's reproducible, which is the only reason the eval harness can exist.
 *      A fixed seed is a fixed scenario to test the adjudicator against.
 *
 * generate() MUST stay pure. The server regenerates the case file from the seed
 * on every turn rather than storing it, so any impurity here desynchronises the
 * game mid-session.
 */

export type GenerateOptions = {
  seed: string
  crime: CrimeType
}

export function generate({ seed, crime }: GenerateOptions): CaseFile {
  const r = new Rng(`${seed}::${crime}`)

  const pool = TEMPLATES[crime]
  if (!pool?.length) throw new Error(`No templates for crime type: ${crime}`)

  const template = r.pick(pool)
  const detective = r.pick(DETECTIVE_NAMES)
  const built = template.build(r, detective)

  // Anchors always start revealed — they're the reason you're in the room.
  // One or two more open at random so the same template doesn't always present
  // the same face, then everything else stays latent and surfaces when the
  // player contradicts themselves.
  const anchors = built.evidence.filter((e) => e.anchor)
  const rest = built.evidence.filter((e) => !e.anchor)
  const extraRevealed = new Set(
    r.sample(rest, r.int(0, 1)).map((e) => e.id),
  )

  const evidence: Evidence[] = built.evidence.map((e) => {
    const { anchor, ...rest } = e
    const revealed = Boolean(anchor) || extraRevealed.has(e.id)
    return {
      ...rest,
      weight: e.baseWeight,
      state: revealed ? 'revealed' : 'latent',
    }
  })

  if (anchors.length === 0) {
    throw new Error(`Template ${template.id} has no anchor evidence`)
  }

  return {
    seed,
    crime,
    templateId: template.id,
    suspect: built.suspect,
    victim: built.victim,
    location: built.location,
    window: built.window,
    truth: built.truth,
    evidence,
    witnesses: built.witnesses,
    fatalFact: built.fatalFact,
    detective: { name: detective.name, rank: detective.rank },
    opener: built.opener,
  }
}

/**
 * Strip the case file down to what the browser is allowed to know.
 *
 * This function is a security boundary. Everything it drops — the truth
 * timeline, vulnerabilities, latent evidence, witness flaws, the fatal fact —
 * is the game. If any of it reaches the client, the game is over before it
 * starts. Never serialise a CaseFile to a response; always route through here.
 */
export function toPublicCase(file: CaseFile): PublicCase {
  return {
    seed: file.seed,
    crime: file.crime,
    suspect: file.suspect,
    victim: file.victim,
    location: file.location,
    window: file.window,
    detective: file.detective,
    opener: file.opener,
    evidence: file.evidence
      .filter((e) => e.state !== 'latent')
      .map((e) => ({ id: e.id, type: e.type, claim: e.claim })),
  }
}
