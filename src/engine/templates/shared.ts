import type { Rng } from '../rng'
import type {
  CrimeType,
  DetectiveBriefing,
  EvidenceType,
  SuspectPersona,
  TimelineBeat,
} from '../types'

/**
 * Shared contract and helpers for crime templates.
 *
 * A template describes one interrogation scenario: fixed narrative shape,
 * randomised slots (names, times, amounts). `build()` is called with a seeded
 * Rng and must be pure — same Rng draw sequence, same output — since generate()
 * relies on it for determinism.
 */

export type DetectiveIdentity = { name: string; rank: string }

/** Evidence as authored by a template — generate() adds `presented: false`. */
export type TemplateEvidence = {
  id: string
  type: EvidenceType
  claim: string
  vulnerability: string
  linkedBeats: string[]
}

/** Witness as authored by a template. */
export type TemplateWitness = {
  id: string
  name: string
  relationship: string
  personality: string
  knowledgeBoundary: string
  suspectContradictions: string[]
}

export type TemplateBuild = {
  suspect: { name: string; occupation: string; pronoun: 'he' | 'she' }
  victim: { name: string; relationship: string }
  location: string
  window: { start: string; end: string }
  truth: TimelineBeat[]
  evidence: TemplateEvidence[]
  witness: TemplateWitness
  fatalFact: string
  suspectPersona: SuspectPersona
  detectiveBriefing: DetectiveBriefing
}

export type Template = {
  id: string
  crime: CrimeType
  title: string
  build: (r: Rng, detective: DetectiveIdentity) => TemplateBuild
}

/** Build a timeline from `[id, time, fact]` tuples, in narrative order. */
export function beats(...rows: [string, string, string][]): TimelineBeat[] {
  return rows.map(([id, time, fact]) => ({ id, time, fact }))
}

const FIRST_NAMES = [
  'James', 'Emma', 'Oliver', 'Olivia', 'Thomas', 'Charlotte', 'Daniel', 'Sophie',
  'Michael', 'Hannah', 'Edward', 'Laura', 'William', 'Rebecca', 'Henry', 'Catherine',
  'Jack', 'Alice', 'David', 'Victoria', 'Peter', 'Elizabeth', 'Andrew', 'Emily',
  'Richard', 'Rachel', 'Matthew', 'Amy', 'Christopher', 'Claire', 'Mark', 'Lucy',
  'Paul', 'Sarah', 'Simon', 'Jessica', 'Robert', 'Megan', 'Nicholas', 'Karen',
] as const

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Taylor', 'Davies', 'Wilson', 'Evans',
  'Thomas', 'Roberts', 'Walker', 'Wright', 'Thompson', 'White', 'Edwards', 'Green',
  'Hughes', 'Harris', 'Clarke', 'Hall', 'Baker', 'Mitchell', 'Turner', 'Carter',
  'Phillips', 'Parker', 'Collins', 'Stewart', 'Morris', 'Rogers', 'Reed', 'Cook',
  'Bell', 'Murphy', 'Cox',
] as const

export function fullName(r: Rng): string {
  return `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`
}

const MALE_FIRST_NAMES = [
  'James', 'Oliver', 'Thomas', 'Daniel', 'Michael', 'Edward', 'William', 'Henry',
  'Jack', 'David', 'Peter', 'Andrew', 'Richard', 'Matthew', 'Christopher', 'Mark',
  'Paul', 'Simon', 'Robert', 'Nicholas',
] as const

const FEMALE_FIRST_NAMES = [
  'Emma', 'Olivia', 'Charlotte', 'Sophie', 'Hannah', 'Laura', 'Rebecca', 'Catherine',
  'Alice', 'Victoria', 'Elizabeth', 'Emily', 'Rachel', 'Amy', 'Claire', 'Lucy',
  'Sarah', 'Jessica', 'Megan', 'Karen',
] as const

export function namedPerson(r: Rng): { name: string; pronoun: 'he' | 'she' } {
  const isMale = r.chance(0.5)
  const first = r.pick(isMale ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES)
  return { name: `${first} ${r.pick(LAST_NAMES)}`, pronoun: isMale ? 'he' : 'she' }
}

export const DETECTIVE_NAMES: DetectiveIdentity[] = [
  { name: 'Sarah Mitchell', rank: 'Detective Inspector' },
  { name: 'James Carter', rank: 'Detective Sergeant' },
  { name: 'Emily Hughes', rank: 'Detective Inspector' },
  { name: 'Mark Turner', rank: 'Detective Chief Inspector' },
  { name: 'Laura Bennett', rank: 'Detective Sergeant' },
  { name: 'Daniel Walsh', rank: 'Detective Inspector' },
  { name: 'Grace Thompson', rank: 'Detective Sergeant' },
  { name: 'Owen Richards', rank: 'Detective Inspector' },
]
