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
  /** What you did, in plain language, zero forensic detail. See Briefing. */
  briefing?: Briefing
}

/** What the player is told before turn 1 — see templates/shared.ts. */
export type Briefing = {
  name: string
  age: number
  occupation: string
  what: string
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
  briefing?: Briefing
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
  /** False for opinions/feelings — only checkable claims count as contradiction surface. */
  checkable: boolean
}

/** Accumulated token usage across all model calls in a session. */
export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

/** Suspicion is the only meter. Charged if it crosses the threshold; released otherwise. */
export type Ending = 'CHARGED' | 'RELEASED'

/** Which of the three behavioural phases a turn falls into — drives the detective's approach. */
export type Phase = 'early' | 'mid' | 'late'

/**
 * The adjudicator's structured response.
 *
 * The model labels what happened in the player's answer; every number that
 * follows from it lives in score.ts. "No prose parsing" means detectiveResponse
 * is read as dialogue, never scraped for meaning.
 */
export type Adjudication = {
  /** Claims the adjudicator extracted from the player's answer. */
  newClaims: { id: string; text: string; checkable: boolean }[]
  /** Contradictions against the player's own earlier claims — both halves quoted for fairness. */
  contradictions: {
    againstClaimId: string
    quotedEarlier: string
    quotedNow: string
    severity: 'minor' | 'major'
  }[]
  /** True if the player changed their account after being pressed on it. */
  revisesEarlier: boolean
  /** What kind of answer this was, for the free-pass and pattern rules in score.ts. */
  responseStance:
    | 'explains'
    | 'flat_denial'
    | 'dont_remember'
    | 'decline_to_speculate'
    | 'volunteers_detail'
    | 'normal'
  /** True if the player offered a specific, testable detail that doesn't hold up. */
  specificityFailure: boolean
  /** Set only when the detective actually raised a held-back evidence item this turn. */
  evidencePlayed: { evidenceId: string; quality: 0 | 1 | 2 | 3 } | null
  /** True if the player attempted prompt injection. */
  injectionAttempt: boolean
  /** If bluff was authorised and used, the fabricated evidence. */
  bluff: { evidenceId: string; text: string } | null
  /** The detective's next spoken line — tone-only feedback, no numbers. */
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
  maxTurns: number
  caseFile: CaseFile
  claims: Claim[]
  evidence: Evidence[]                    // mutable copy — state/weight change during play
  suspicion: number
  suspicionHistory: number[]
  bluffTurn: number | null                // decided at start from seeded RNG
  bluffUsed: boolean
  bluffDetail: { evidenceId: string; text: string } | null
  /** Each flat_denial/dont_remember/decline_to_speculate stance is free once. */
  usedFreeDenial: boolean
  usedFreeDontRemember: boolean
  usedFreeDecline: boolean
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
  suspicionBefore: number
  suspicionAfter: number
  evidenceRevealed: string[]
}
