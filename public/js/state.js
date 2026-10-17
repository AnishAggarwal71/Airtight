// Single mutable client state object. No framework — every mutation here is
// followed by exactly one render(state) call from main.js.
//
// phase: setup | briefing | interrogation | ended
// Witness questions share the interrogation transcript/composer per
// DESIGN.md §5 ("witness questions use the same structure... in the same
// transcript") rather than being a separate screen.

export const state = {
  sessionId: null,
  phase: 'setup',
  publicCase: null,
  caseStrength: 15,
  previousCaseStrength: 15,
  lastDelta: 0,
  lastVerdictType: null, // 'contradiction' | 'slip' | 'tell' | 'weak_answer' | 'no_change' | null
  interrogationTurn: 0,
  maxInterrogationTurns: 6,
  witnessTurn: 0,
  maxWitnessTurns: 2,
  witnessAvailable: false,
  witnessUsed: false,
  witnessPulsed: false, // true once the one-time unlock pulse has played
  witnessMode: false, // true while the composer is in witness-questioning mode
  ending: null,
  // One entry per turn (suspect or witness): { speaker, question, presentedEvidence: [{id,name}],
  //   answerText, demeanor, verdict: {type, reason} | null, delta, isWitness }
  transcript: [],
  evidenceStaged: null, // id of the single staged exhibit tag, or null
  thinking: false, // true while an interrogate/witness request is in flight
  error: null, // { message, retry: () => Promise<void> } | null
  breakdown: null, // BreakdownResponse from GET /:id/breakdown, fetched only once state.ending is set
  reviewerExpanded: false, // whether the "How the judge scored this" <details> is open
}

export function resetForNewCase() {
  state.sessionId = null
  state.phase = 'setup'
  state.publicCase = null
  state.caseStrength = 15
  state.previousCaseStrength = 15
  state.lastDelta = 0
  state.lastVerdictType = null
  state.interrogationTurn = 0
  state.witnessTurn = 0
  state.witnessAvailable = false
  state.witnessUsed = false
  state.witnessPulsed = false
  state.witnessMode = false
  state.ending = null
  state.transcript = []
  state.evidenceStaged = null
  state.thinking = false
  state.error = null
  state.breakdown = null
  state.reviewerExpanded = false
}
