// Single mutable client state object. No framework — every mutation here is
// followed by exactly one render(state) call from main.js.

export const state = {
  sessionId: null,
  phase: 'setup', // setup | briefing | interrogation | witness | verdict | breakdown
  publicCase: null,
  caseStrength: 15,
  previousCaseStrength: 15,
  interrogationTurn: 0,
  maxInterrogationTurns: 6,
  witnessTurn: 0,
  maxWitnessTurns: 2,
  ending: null,
  interrogationTranscript: [], // { speaker: 'detective'|'suspect', text, demeanor? }
  witnessTranscript: [],
  presentedEvidenceIds: new Set(),
  evidenceToggled: new Set(), // staged, not yet sent
  lastInvigilatorReasoning: null,
  lastWitnessReasoning: null,
  thinking: false, // true while an interrogate/witness request is in flight
  breakdown: null,
  error: null, // { message, retry: () => Promise<void> } | null
  openAccordions: new Set(),
  caseFileVisible: false,
}

export function resetForNewCase() {
  state.sessionId = null
  state.phase = 'setup'
  state.publicCase = null
  state.caseStrength = 15
  state.previousCaseStrength = 15
  state.interrogationTurn = 0
  state.witnessTurn = 0
  state.ending = null
  state.interrogationTranscript = []
  state.witnessTranscript = []
  state.presentedEvidenceIds = new Set()
  state.evidenceToggled = new Set()
  state.lastInvigilatorReasoning = null
  state.lastWitnessReasoning = null
  state.thinking = false
  state.breakdown = null
  state.error = null
  state.openAccordions = new Set()
  state.caseFileVisible = false
}
