import type { Rng } from '../rng'
import type { CrimeType, Evidence, TimelineBeat, Witness } from '../types'

/**
 * Shared contract and helpers for crime templates.
 *
 * A template describes one interrogation scenario: fixed narrative shape,
 * randomised slots (names, times, amounts). `build()` is called with a seeded
 * Rng and must be pure — same Rng draw sequence, same output — since generate()
 * relies on it for determinism.
 */

/** The interviewing detective's identity — randomised per case, fixed for the session. */
export type DetectiveIdentity = { name: string; rank: string }

/**
 * Evidence as authored by a template. `anchor` marks evidence that always
 * starts revealed (the reason the suspect is in the room) — generate() strips
 * it before returning the real Evidence and derives `weight`/`state` instead.
 */
export type TemplateEvidence = Omit<Evidence, 'weight' | 'state'> & {
  anchor?: boolean
}

export type TemplateBuild = {
  suspect: { name: string; occupation: string }
  victim: { name: string; relationship: string }
  location: string
  window: { start: string; end: string }
  truth: TimelineBeat[]
  evidence: TemplateEvidence[]
  witnesses: Witness[]
  fatalFact: string
  opener: string
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
  'Michael', 'Sarah', 'David', 'Emma', 'James', 'Olivia', 'Daniel', 'Sophie',
  'Robert', 'Chloe', 'Andrew', 'Hannah', 'Mark', 'Rebecca', 'Paul', 'Laura',
  'Christopher', 'Charlotte', 'Simon', 'Amelia', 'Thomas', 'Grace', 'Richard',
  'Lucy', 'Adam', 'Megan', 'Peter', 'Katie', 'Stephen', 'Jessica', 'Neil',
  'Zoe', 'Craig', 'Natalie', 'Ian', 'Rachel', 'Gary', 'Louise', 'Kevin', 'Amy',
] as const

const LAST_NAMES = [
  'Whitfield', 'Okafor', 'Marsh', 'Delaney', 'Pemberton', 'Voss', 'Ainsley',
  'Corcoran', 'Hollis', 'Fenwick', 'Bramwell', 'Sadowski', 'Trent', 'Kaczmarek',
  'Ellery', 'Duffield', 'Northcote', 'Regis', 'Wickham', 'Osei', 'Callaghan',
  'Petrie', 'Alderton', 'Yusuf', 'Marchetti', 'Sheahan', 'Blackwood', 'Nazari',
  'Farrow', 'Kimura', 'Redgrave', 'Onyeka', 'Stavros', 'Linton', 'Bellamy',
] as const

/** A random "First Last" name, distinct enough across a small cast that collisions are rare. */
export function fullName(r: Rng): string {
  return `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`
}

/** Detective identities — one is drawn per case and stays fixed for the session. */
export const DETECTIVE_NAMES: DetectiveIdentity[] = [
  { name: 'Aisha Okonkwo', rank: 'Detective Inspector' },
  { name: 'Callum Reid', rank: 'Detective Sergeant' },
  { name: 'Priya Chandran', rank: 'Detective Inspector' },
  { name: 'Marcus Devlin', rank: 'Detective Chief Inspector' },
  { name: 'Fiona Blackwell', rank: 'Detective Sergeant' },
  { name: 'Tomasz Nowak', rank: 'Detective Inspector' },
  { name: 'Grace Ellery', rank: 'Detective Sergeant' },
  { name: 'Owen Kavanagh', rank: 'Detective Inspector' },
]
