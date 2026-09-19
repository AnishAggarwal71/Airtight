/**
 * AIRTIGHT — core domain types.
 *
 * The CaseFile is the hidden ground truth. It is regenerated server-side from
 * the seed on every request and must never be serialised to the client in full.
 * The client only ever receives a PublicCase.
 */

export type CrimeType = 'homicide' | 'arson' | 'embezzlement'

/** A beat of what actually happened. Never shown to the player. */
export type TimelineBeat = {
  id: string
  time: string
  fact: string
}

export type EvidenceType =
  | 'physical'
  | 'witness'
  | 'digital'
  | 'financial'
  | 'circumstantial'

export type EvidenceState = 'latent' | 'revealed' | 'explained' | 'corroborated'

export type Evidence = {
  id: string
  type: EvidenceType
  /** Shown to the player once revealed. */
  claim: string
  /** Current weight, 0–100. Mutated by the scoring engine. */
  weight: number
  baseWeight: number
  state: EvidenceState
  /** Timeline beats this evidence points at. */
  linkedBeats: string[]
  /**
   * The crack in this evidence. Never shown during play — revealed in the
   * post-game breakdown. If a player's explanation lands near this, the
   * adjudicator scores it high and the weight drops hard.
   */
  vulnerability: string
}

export type Witness = {
  id: string
  name: string
  relationship: string
  claim: string
  /** Inaccurate witnesses are exploitable — that's the point of them. */
  accurate: boolean
  flaw?: string
}

export type CaseFile = {
  seed: string
  crime: CrimeType
  templateId: string
  suspect: { name: string; occupation: string }
  victim: { name: string; relationship: string }
  location: string
  window: { start: string; end: string }
  truth: TimelineBeat[]
  evidence: Evidence[]
  witnesses: Witness[]
  /** What the detective is building toward. Drives question strategy. */
  fatalFact: string
  detective: { name: string; rank: string }
  opener: string
}

/** Everything the client is allowed to know at the start of a session. */
export type PublicCase = {
  seed: string
  crime: CrimeType
  suspect: { name: string; occupation: string }
  victim: { name: string; relationship: string }
  location: string
  window: { start: string; end: string }
  detective: { name: string; rank: string }
  opener: string
  evidence: { id: string; type: EvidenceType; claim: string }[]
}

export const CRIME_LABELS: Record<CrimeType, string> = {
  homicide: 'Homicide',
  arson: 'Arson',
  embezzlement: 'Embezzlement',
}

export const CRIME_BLURBS: Record<CrimeType, string> = {
  homicide:
    'A body, a timeline, and a relationship the detective will pull apart thread by thread.',
  arson:
    'Technical evidence that sounds conclusive and is anything but. Everything here is arguable.',
  embezzlement:
    'A paper crime. No alibi will save you — only an explanation for the paper.',
}

// ─── M1: Adjudicator, scoring, and session types ────────────────────────────

/** A normalised player assertion, extracted by the adjudicator each turn. */
export type Claim = {
  id: string       // "c1", "c2", ... sequential
  text: string     // normalised assertion (1–2 sentences)
  turn: number
}

/** Accumulated token usage across all model calls in a session. */
export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

export type Ending = 'CHARGED' | 'RELEASED' | 'HELD_48_HOURS'

/**
 * The adjudicator's structured response — matches PRD §5.4 exactly.
 *
 * All judgment scales are 0–3 integers. Small discrete scales are dramatically
 * more stable across calls than 1–10 or 1–100. The detective's spoken response
 * is a string field inside this structure — the invariant is "no prose parsing,"
 * not "no prose."
 */
export type Adjudication = {
  /** Claims the adjudicator extracted from the player's answer. */
  newClaims: { id: string; text: string }[]
  /** Contradictions detected against prior claims or evidence. */
  contradictions: {
    against: string                       // claim id ("c3") or evidence id ("e2")
    kind: 'claim' | 'evidence'
    severity: 'minor' | 'major'
    note: string                          // brief explanation for breakdown
  }[]
  /** Evidence the player addressed, with explanation quality. */
  explains: { evidenceId: string; quality: 0 | 1 | 2 | 3 }[]
  /** How evasive the answer was. 0 = direct, 3 = silence/refusal. */
  evasion: 0 | 1 | 2 | 3
  /** How plausible the answer was. 0 = implausible, 3 = compelling. */
  plausibility: 0 | 1 | 2 | 3
  /** True if the player attempted prompt injection. */
  injectionAttempt: boolean
  /** Model suggests which latent evidence to surface (on major contradiction). */
  evidenceToReveal: string | null
  /** If bluff was authorised and used, the fabricated evidence. */
  bluff: { evidenceId: string; text: string } | null
  /** The detective's next spoken line — game dialogue. */
  detectiveResponse: string
}

/**
 * Full mutable game state for one session. Created once at game start,
 * updated each turn by the session orchestrator.
 */
export type GameSession = {
  seed: string
  crime: CrimeType
  turn: number
  maxTurns: number                        // 12 normally; 15 if Suspicion >= 90
  caseFile: CaseFile
  claims: Claim[]
  evidence: Evidence[]                    // mutable copy — weights change during play
  caseStrength: number
  suspicion: number
  contradictionPenalty: number            // running total, adds to Case Strength
  caseStrengthHistory: number[]           // per-turn snapshots for breakdown
  suspicionHistory: number[]
  bluffTurn: number | null                // decided at start from seeded RNG
  bluffUsed: boolean
  bluffDetail: { evidenceId: string; text: string } | null
  extended: boolean                       // true once Suspicion >= 90 triggers +3 rounds
  ending: Ending | null
  endTurn: number | null
  usage: TokenUsage                       // accumulated across all turns
  turnDetails: TurnDetail[]
}

/** Per-turn record for the post-game breakdown. Zero model calls to render. */
export type TurnDetail = {
  turn: number
  playerAnswer: string
  adjudication: Adjudication
  caseStrengthBefore: number
  caseStrengthAfter: number
  suspicionBefore: number
  suspicionAfter: number
  evidenceRevealed: string[]
  evidenceWeightChanges: Array<{
    evidenceId: string
    oldWeight: number
    newWeight: number
  }>
}
