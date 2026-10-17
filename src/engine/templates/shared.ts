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
  'Arjun', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Divya', 'Karan', 'Neha',
  'Aditya', 'Pooja', 'Rahul', 'Sneha', 'Varun', 'Kavya', 'Siddharth', 'Riya',
  'Nikhil', 'Shreya', 'Amit', 'Isha', 'Rajesh', 'Meera', 'Sanjay', 'Nisha',
  'Vivek', 'Anjali', 'Suresh', 'Deepa', 'Manish', 'Lakshmi', 'Arvind', 'Kriti',
  'Harish', 'Swati', 'Gaurav', 'Tanvi', 'Ashok', 'Radha', 'Naveen', 'Simran',
] as const

const LAST_NAMES = [
  'Sharma', 'Verma', 'Iyer', 'Nair', 'Reddy', 'Gupta', 'Menon', 'Rao',
  'Mehta', 'Kapoor', 'Chatterjee', 'Bose', 'Pillai', 'Desai', 'Joshi', 'Agarwal',
  'Krishnan', 'Pillay', 'Khanna', 'Malhotra', 'Chawla', 'Bhatt', 'Shetty', 'Varma',
  'Nambiar', 'Subramaniam', 'Banerjee', 'Mukherjee', 'Patel', 'Trivedi', 'Hegde',
  'Chandran', 'Rangan', 'Kulkarni', 'Suri',
] as const

export function fullName(r: Rng): string {
  return `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`
}

const MALE_FIRST_NAMES = [
  'Arjun', 'Rohan', 'Vikram', 'Karan', 'Aditya', 'Rahul', 'Varun', 'Siddharth',
  'Nikhil', 'Amit', 'Rajesh', 'Sanjay', 'Vivek', 'Suresh', 'Manish', 'Arvind',
  'Harish', 'Gaurav', 'Ashok', 'Naveen',
] as const

const FEMALE_FIRST_NAMES = [
  'Priya', 'Ananya', 'Divya', 'Neha', 'Pooja', 'Sneha', 'Kavya', 'Riya',
  'Shreya', 'Isha', 'Meera', 'Nisha', 'Anjali', 'Deepa', 'Lakshmi', 'Kriti',
  'Swati', 'Tanvi', 'Radha', 'Simran',
] as const

export function namedPerson(r: Rng): { name: string; pronoun: 'he' | 'she' } {
  const isMale = r.chance(0.5)
  const first = r.pick(isMale ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES)
  return { name: `${first} ${r.pick(LAST_NAMES)}`, pronoun: isMale ? 'he' : 'she' }
}

export const DETECTIVE_NAMES: DetectiveIdentity[] = [
  { name: 'Aisha Khan', rank: 'Inspector' },
  { name: 'Rohit Kulkarni', rank: 'Sub-Inspector' },
  { name: 'Priya Chandran', rank: 'Inspector' },
  { name: 'Marcus D\'Souza', rank: 'Deputy Commissioner' },
  { name: 'Fiona Pinto', rank: 'Sub-Inspector' },
  { name: 'Tanvi Nair', rank: 'Inspector' },
  { name: 'Grace Fernandes', rank: 'Sub-Inspector' },
  { name: 'Owen Kurian', rank: 'Inspector' },
]
