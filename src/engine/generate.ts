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
  /** Force a specific template (e.g. for beta-testing one scenario against varied seeds). Omit for the normal random pick. */
  templateId?: string
}

export function generate({ seed, crime, templateId }: GenerateOptions): CaseFile {
  const r = new Rng(`${seed}::${crime}`)

  const pool = TEMPLATES[crime]
  if (!pool?.length) throw new Error(`No templates for crime type: ${crime}`)

  const eligible = templateId ? pool.filter((t) => t.id === templateId) : pool
  if (templateId && eligible.length === 0) {
    throw new Error(`Unknown template "${templateId}" for crime ${crime}`)
  }

  const template = r.pick(eligible)
  const detective = r.pick(DETECTIVE_NAMES)
  const built = template.build(r, detective)

  // Nothing starts revealed. The player knows what they did, not what the
  // police have — every item surfaces only when the detective plays it
  // during the interrogation (see score.ts's pickEvidenceToPlay).
  const evidence: Evidence[] = built.evidence.map((e) => {
    const { anchor, ...rest } = e
    return {
      ...rest,
      weight: e.baseWeight,
      state: 'latent',
    }
  })

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
    briefing: built.briefing,
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
    briefing: file.briefing,
    evidence: file.evidence
      .filter((e) => e.state !== 'latent')
      .map((e) => ({ id: e.id, type: e.type, claim: e.claim })),
  }
}
