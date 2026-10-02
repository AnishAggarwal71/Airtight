import { Rng } from './rng'
import type { CaseFile, CrimeType, DetectiveEvidence, PublicCase } from './types'
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
  templateId?: string
  locality?: string
}

export function generate({ seed, crime, templateId, locality }: GenerateOptions): CaseFile {
  const r = new Rng(`${seed}::${crime}`)

  const pool = TEMPLATES[crime]
  if (!pool?.length) throw new Error(`No templates for crime type: ${crime}`)

  const eligible = templateId ? pool.filter((t) => t.id === templateId) : pool
  if (templateId && eligible.length === 0) {
    throw new Error(`Unknown template "${templateId}" for crime ${crime}`)
  }

  const template = r.pick(eligible)
  const detective = r.pick(DETECTIVE_NAMES)
  const built = template.build(r, detective, locality?.trim() || undefined)

  // All evidence starts unpresented — the player sees claims upfront but
  // must explicitly deploy each item during interrogation.
  const evidence: DetectiveEvidence[] = built.evidence.map((e) => ({
    id: e.id,
    type: e.type,
    claim: e.claim,
    presented: false,
    vulnerability: e.vulnerability,
    linkedBeats: e.linkedBeats,
  }))

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
    witness: built.witness,
    fatalFact: built.fatalFact,
    suspectPersona: built.suspectPersona,
    detectiveBriefing: built.detectiveBriefing,
  }
}

/**
 * Strip the case file down to what the player-detective is allowed to see.
 *
 * V2 security boundary is INVERTED from V1: the player now sees evidence
 * upfront (they need it to interrogate), but the suspect's strategy — persona,
 * cover story, breaking points, guilty knowledge, evidence vulnerabilities —
 * stays hidden. The truth timeline and fatal fact are also hidden (revealed
 * only in the post-game breakdown).
 */
export function toPublicCase(file: CaseFile): PublicCase {
  return {
    seed: file.seed,
    crime: file.crime,
    suspect: file.suspect,
    victim: file.victim,
    location: file.location,
    window: file.window,
    briefing: file.detectiveBriefing,
    evidence: file.evidence.map((e) => ({
      id: e.id,
      type: e.type,
      claim: e.claim,
      presented: e.presented,
    })),
    witness: {
      name: file.witness.name,
      relationship: file.witness.relationship,
    },
  }
}
