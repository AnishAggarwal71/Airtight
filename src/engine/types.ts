/**
 * AIRTIGHT V2 — core domain types.
 *
 * The player is the detective. The AI plays the suspect (and witnesses).
 * The CaseFile is the hidden ground truth — regenerated server-side from the
 * seed on every request, never serialised to the client in full. The client
 * receives a PublicCase that shows evidence but hides the suspect's strategy.
 */

export type CrimeType = 'homicide' | 'arson' | 'embezzlement'

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

/** A piece of evidence the player-detective can deploy during interrogation. */
export type DetectiveEvidence = {
  id: string
  type: EvidenceType
  /** What the detective knows — shown to the player upfront. */
  claim: string
  /** Whether this item has been formally presented to the suspect yet. */
  presented: boolean
  /** Hidden: the crack in this evidence the suspect can exploit. Never shown during play. */
  vulnerability: string
  /** Hidden: which truth beats this evidence connects to. */
  linkedBeats: string[]
}

/** Suspect NPC personality and strategy — NEVER shown to the player. */
export type SuspectPersona = {
  /** How they behave under questioning — tone, mannerisms, default posture. */
  personality: string
  /** The lie they've prepared — their version of events. */
  coverStory: string
  /** Topics or evidence that make them nervous and may cause them to slip. */
  breakingPoints: string[]
  /** Things they know but shouldn't if they were innocent. */
  guiltyKnowledge: string[]
}

/** What the player-detective reads at the start of the case. */
export type DetectiveBriefing = {
  victimSummary: string
  suspectSummary: string
  sceneSummary: string
  evidenceSummary: string
}

/** Witness NPC profile — name and relationship shown to the player, strategy hidden. */
export type WitnessProfile = {
  id: string
  name: string
  relationship: string
  /** Hidden: how they behave when questioned. */
  personality: string
  /** Hidden: what they actually saw or know — the boundary of their testimony. */
  knowledgeBoundary: string
  /** Hidden: where their honest account differs from the suspect's cover story. */
  suspectContradictions: string[]
}

/** The full hidden case — regenerated from the seed, never sent to the client. */
export type CaseFile = {
  seed: string
  crime: CrimeType
  templateId: string
  suspect: { name: string; occupation: string }
  victim: { name: string; relationship: string }
  location: string
  window: { start: string; end: string }
  truth: TimelineBeat[]
  evidence: DetectiveEvidence[]
  witness: WitnessProfile
  fatalFact: string
  suspectPersona: SuspectPersona
  detectiveBriefing: DetectiveBriefing
}

/** Everything the client is allowed to see — evidence shown, strategy hidden. */
export type PublicCase = {
  seed: string
  crime: CrimeType
  suspect: { name: string; occupation: string }
  victim: { name: string; relationship: string }
  location: string
  window: { start: string; end: string }
  briefing: DetectiveBriefing
  evidence: { id: string; type: EvidenceType; claim: string; presented: boolean }[]
  witness: { name: string; relationship: string }
}

export const CRIME_LABELS: Record<CrimeType, string> = {
  homicide: 'Homicide',
  arson: 'Arson',
  embezzlement: 'Embezzlement',
}

export const CRIME_BLURBS: Record<CrimeType, string> = {
  homicide:
    'A body, a timeline, and a suspect who has had all night to rehearse.',
  arson:
    'Technical evidence that sounds conclusive and is anything but. Every item has a crack.',
  embezzlement:
    'Coming in Phase 2.',
}

// ─── Adjudicator response types ─────────────────────────────────────────────

/** A normalised assertion from the suspect, extracted each turn for the ledger. */
export type Claim = {
  id: string
  text: string
  turn: number
  checkable: boolean
}

/** Accumulated token usage across all model calls in a session. */
export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

/** The AI suspect's structured response. */
export type SuspectResponse = {
  dialogue: string
  claims: { text: string; checkable: boolean }[]
  evidenceResponse: {
    evidenceId: string
    strategy: 'deny' | 'explain_away' | 'deflect' | 'partial_admit'
    quality: 0 | 1 | 2 | 3
  } | null
  selfContradiction: {
    againstClaimId: string
    quotedEarlier: string
    quotedNow: string
    severity: 'minor' | 'major'
  } | null
  demeanor: 'calm' | 'nervous' | 'defensive' | 'aggressive' | 'evasive'
  inadvertentReveal: boolean
}

/** The AI witness's structured response. */
export type WitnessResponse = {
  dialogue: string
  claims: { text: string; checkable: boolean }[]
  suspectContradiction: {
    againstClaimId: string
    witnessVersion: string
    suspectVersion: string
  } | null
  demeanor: 'cooperative' | 'reluctant' | 'nervous' | 'confused'
}

export type Ending = 'CHARGED_STRONG' | 'CHARGED_WEAK' | 'RELEASED'

export type GamePhase = 'briefing' | 'interrogation' | 'witness' | 'verdict'

// ─── Session types ──────────────────────────────────────────────────────────

export type InterrogationDetail = {
  turn: number
  playerQuestion: string
  presentedEvidenceId: string | null
  suspectResponse: SuspectResponse
  caseStrengthBefore: number
  caseStrengthAfter: number
}

export type WitnessDetail = {
  turn: number
  playerQuestion: string
  witnessResponse: WitnessResponse
  caseStrengthBefore: number
  caseStrengthAfter: number
}

export type GameSession = {
  seed: string
  crime: CrimeType
  phase: GamePhase
  interrogationTurn: number
  maxInterrogationTurns: number
  witnessTurn: number
  maxWitnessTurns: number
  caseFile: CaseFile
  suspectClaims: Claim[]
  witnessClaims: Claim[]
  caseStrength: number
  caseStrengthHistory: number[]
  ending: Ending | null
  usage: TokenUsage
  interrogationDetails: InterrogationDetail[]
  witnessDetails: WitnessDetail[]
}
