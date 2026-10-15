import { state, resetForNewCase } from './state.js'
import * as api from './api.js'
import { buildPlayerInput } from './evidence.js'
import { render } from './render.js'

const SESSION_STORAGE_KEY = 'airtight-session-id'

function paint() {
  render(state)
}

function setError(message, retry) {
  state.error = { message, retry }
  paint()
}

function clearError() {
  state.error = null
  paint()
}

// ─── Setup → create session ─────────────────────────────────────────────────

document.getElementById('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const seed = document.getElementById('seed-input').value.trim()
  await createSession(seed)
})

async function createSession(seed) {
  clearError()
  try {
    const result = await api.createGame(seed || undefined)
    resetForNewCase()
    state.sessionId = result.sessionId
    state.publicCase = result.publicCase
    state.caseStrength = result.caseStrength
    state.previousCaseStrength = result.caseStrength
    state.maxInterrogationTurns = result.maxInterrogationTurns
    state.maxWitnessTurns = result.maxWitnessTurns
    state.phase = 'briefing'
    sessionStorage.setItem(SESSION_STORAGE_KEY, state.sessionId)
    paint()
  } catch (err) {
    setError(err.message, () => createSession(seed))
  }
}

// ─── Briefing → interrogation ───────────────────────────────────────────────

document.getElementById('to-interrogation-btn').addEventListener('click', () => {
  state.phase = 'interrogation'
  paint()
})

// ─── Evidence chip staging (interrogation only, no network call) ───────────

document.getElementById('interrogation-evidence-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-evidence-id]')
  if (!btn || btn.disabled) return
  const id = btn.dataset.evidenceId
  if (state.evidenceToggled.has(id)) {
    state.evidenceToggled.delete(id)
  } else {
    state.evidenceToggled.add(id)
  }
  paint()
})

// ─── Interrogation submit ───────────────────────────────────────────────────

document.getElementById('interrogation-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('interrogation-input')
  const question = input.value.trim()
  if (!question) return
  const evidenceIds = [...state.evidenceToggled]
  await submitInterrogation(evidenceIds, question, input)
})

async function submitInterrogation(evidenceIds, question, inputEl) {
  clearError()
  state.thinking = true
  paint()

  const playerInput = buildPlayerInput(evidenceIds, question)

  try {
    const result = await api.interrogate(state.sessionId, playerInput)

    state.interrogationTranscript.push({ speaker: 'detective', text: question })
    state.interrogationTranscript.push({
      speaker: 'suspect',
      text: result.suspectDialogue,
      demeanor: result.suspectDemeanor,
    })

    for (const id of result.presentedEvidenceIds) state.presentedEvidenceIds.add(id)
    state.evidenceToggled.clear()

    state.previousCaseStrength = state.caseStrength
    state.caseStrength = result.caseStrength
    state.interrogationTurn = result.interrogationTurn
    state.lastInvigilatorReasoning = result.invigilatorReasoning
    state.ending = result.ending

    if (inputEl) inputEl.value = ''
    state.thinking = false

    if (state.ending) {
      state.phase = 'verdict'
    }
    paint()
  } catch (err) {
    state.thinking = false
    setError(err.message, () => submitInterrogation(evidenceIds, question, inputEl))
  }
}

// ─── Interrogation → witness ────────────────────────────────────────────────

document.getElementById('to-witness-btn').addEventListener('click', () => {
  state.phase = 'witness'
  paint()
})

// ─── Witness submit ──────────────────────────────────────────────────────────

document.getElementById('witness-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('witness-input')
  const question = input.value.trim()
  if (!question) return
  await submitWitness(question, input)
})

async function submitWitness(question, inputEl) {
  clearError()
  state.thinking = true
  paint()

  try {
    const result = await api.askWitness(state.sessionId, question)

    state.witnessTranscript.push({ speaker: 'detective', text: question })
    state.witnessTranscript.push({
      speaker: 'witness',
      text: result.witnessDialogue,
      demeanor: result.witnessDemeanor,
    })

    state.previousCaseStrength = state.caseStrength
    state.caseStrength = result.caseStrength
    state.witnessTurn = result.witnessTurn
    state.lastWitnessReasoning = result.invigilatorReasoning
    state.ending = result.ending

    if (inputEl) inputEl.value = ''
    state.thinking = false

    if (state.ending) {
      state.phase = 'verdict'
    }
    paint()
  } catch (err) {
    state.thinking = false
    setError(err.message, () => submitWitness(question, inputEl))
  }
}

// ─── Witness → verdict ───────────────────────────────────────────────────────

document.getElementById('to-verdict-btn').addEventListener('click', () => {
  state.phase = 'verdict'
  paint()
})

// ─── Verdict ──────────────────────────────────────────────────────────────────

document.getElementById('charge-btn').addEventListener('click', () => submitVerdict(true))
document.getElementById('release-btn').addEventListener('click', () => submitVerdict(false))

async function submitVerdict(charges) {
  clearError()
  try {
    const result = await api.submitVerdict(state.sessionId, charges)
    state.ending = result.ending
    state.caseStrength = result.caseStrength
    paint()
  } catch (err) {
    setError(err.message, () => submitVerdict(charges))
  }
}

document.getElementById('to-breakdown-btn').addEventListener('click', async () => {
  clearError()
  try {
    state.breakdown = await api.getBreakdown(state.sessionId)
    state.phase = 'breakdown'
    paint()
  } catch (err) {
    setError(err.message, () => document.getElementById('to-breakdown-btn').click())
  }
})

// ─── Breakdown accordion (event-delegated) ───────────────────────────────────

document.getElementById('breakdown-content').addEventListener('click', (e) => {
  const header = e.target.closest('[data-accordion-key]')
  if (!header) return
  const key = header.dataset.accordionKey
  if (state.openAccordions.has(key)) {
    state.openAccordions.delete(key)
  } else {
    state.openAccordions.add(key)
  }
  paint()
})

document.getElementById('restart-btn').addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_STORAGE_KEY)
  resetForNewCase()
  paint()
})

// ─── Case File overlay (client-side-only, view-only) ────────────────────────

function toggleCaseFile(visible) {
  state.caseFileVisible = visible
  paint()
}

document.getElementById('case-file-btn').addEventListener('click', () => toggleCaseFile(true))
document.getElementById('case-file-btn-witness').addEventListener('click', () => toggleCaseFile(true))
document.getElementById('case-file-close-btn').addEventListener('click', () => toggleCaseFile(false))

// ─── Error banner retry ──────────────────────────────────────────────────────

document.getElementById('error-retry-btn').addEventListener('click', () => {
  const retry = state.error?.retry
  clearError()
  if (retry) retry()
})

// ─── Reconnect on load ───────────────────────────────────────────────────────

async function tryReconnect() {
  const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY)
  if (!sessionId) {
    paint()
    return
  }
  try {
    const result = await api.getGame(sessionId)
    state.sessionId = sessionId
    state.publicCase = result.publicCase
    state.caseStrength = result.caseStrength
    state.previousCaseStrength = result.caseStrength
    state.maxInterrogationTurns = result.maxInterrogationTurns
    state.maxWitnessTurns = result.maxWitnessTurns
    state.interrogationTurn = result.interrogationTurn
    state.witnessTurn = result.witnessTurn
    state.ending = result.ending
    state.phase = result.ending ? 'verdict' : result.phase === 'briefing' ? 'briefing' : result.phase

    // The reconnect endpoint returns one flat transcript; split it back into
    // interrogation vs. witness messages by speaker (detective lines appear
    // in both, suspect/witness lines are unambiguous).
    state.interrogationTranscript = []
    state.witnessTranscript = []
    let inWitnessPhase = false
    for (const entry of result.transcript) {
      if (entry.speaker === 'witness') inWitnessPhase = true
      const target = inWitnessPhase ? state.witnessTranscript : state.interrogationTranscript
      target.push(entry)
    }

    for (const item of result.publicCase.evidence) {
      if (item.presented) state.presentedEvidenceIds.add(item.id)
    }

    paint()
  } catch {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
    paint()
  }
}

tryReconnect()
