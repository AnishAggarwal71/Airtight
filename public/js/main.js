import { state, resetForNewCase } from './state.js'
import * as api from './api.js'
import { buildPlayerInput } from './evidence.js'
import { render } from './render.js'

const SESSION_STORAGE_KEY = 'airtight-session-id'
const CHAR_LIMIT = 300

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
    state.witnessAvailable = result.witnessAvailable
    state.witnessUsed = result.witnessUsed
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

document.getElementById('restart-btn-briefing').addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_STORAGE_KEY)
  resetForNewCase()
  paint()
})

// ─── Evidence tray staging (one at a time, no network call) ───────────────

document.getElementById('evidence-tray').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-evidence-id]')
  if (!btn || btn.disabled) return
  const id = btn.dataset.evidenceId
  state.evidenceStaged = state.evidenceStaged === id ? null : id
  paint()
})

// ─── Interrogation submit ───────────────────────────────────────────────────

document.getElementById('interrogation-input').addEventListener('input', () => {
  paint()
})

document.getElementById('interrogation-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    document.getElementById('interrogation-form').requestSubmit()
  }
})

document.getElementById('interrogation-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('interrogation-input')
  const question = input.value.trim()
  if (!question) return
  if (state.witnessMode) {
    await submitWitness(question, input)
    return
  }
  const evidenceIds = state.evidenceStaged ? [state.evidenceStaged] : []
  await submitInterrogation(evidenceIds, question, input)
})

async function submitInterrogation(evidenceIds, question, inputEl) {
  clearError()
  state.thinking = true
  paint()

  const playerInput = buildPlayerInput(evidenceIds, question)

  try {
    const result = await api.interrogate(state.sessionId, playerInput)
    applyTurnResult(result, question, false)
    if (inputEl) inputEl.value = ''
    state.thinking = false
    if (state.ending) state.phase = 'ended'
    paint()
  } catch (err) {
    state.thinking = false
    setError(err.message, () => submitInterrogation(evidenceIds, question, inputEl))
  }
}

function applyTurnResult(result, question, isWitness) {
  const presentedEvidence = isWitness
    ? []
    : (result.presentedEvidenceIds || [])
        .map((id) => state.publicCase.evidence.find((e) => e.id === id))
        .filter(Boolean)
        .map((e) => ({ id: e.id, name: e.name }))

  for (const e of presentedEvidence) {
    const item = state.publicCase.evidence.find((x) => x.id === e.id)
    if (item) item.presented = true
  }
  if (!isWitness) state.evidenceStaged = null

  state.transcript.push({
    speaker: 'detective',
    question,
    presentedEvidence,
    answerText: isWitness ? result.witnessDialogue : result.suspectDialogue,
    demeanor: isWitness ? result.witnessDemeanor : result.suspectDemeanor,
    verdict: result.verdict || null,
    delta: result.caseStrengthDelta || 0,
    isWitness,
  })

  state.previousCaseStrength = state.caseStrength
  state.caseStrength = result.caseStrength
  state.lastDelta = result.caseStrengthDelta || 0
  state.lastVerdictType = result.verdict ? result.verdict.type : null

  if (isWitness) {
    state.witnessTurn = result.witnessTurn
    state.witnessUsed = result.witnessUsed
  } else {
    state.interrogationTurn = result.interrogationTurn
    state.witnessAvailable = result.witnessAvailable
  }
  state.ending = result.ending
}

// ─── Witness (folded into the interrogation composer) ──────────────────────
// Calling the witness switches the shared composer into witness mode rather
// than popping a separate input — the evidence tray is for the suspect only,
// so it's disabled while in this mode (render.js handles the visual state).

document.getElementById('witness-btn').addEventListener('click', () => {
  if (!state.witnessAvailable || state.witnessUsed || state.thinking || state.witnessMode) return
  state.witnessMode = true
  paint()
  document.getElementById('interrogation-input').focus()
})

async function submitWitness(question, inputEl) {
  clearError()
  state.thinking = true
  paint()

  try {
    const result = await api.askWitness(state.sessionId, question)
    applyTurnResult(result, question, true)
    if (inputEl) inputEl.value = ''
    state.thinking = false
    // Exactly two witness questions per session — once both are used (or the
    // session ends), the composer switches back to questioning the suspect.
    if (state.witnessTurn >= state.maxWitnessTurns || state.ending) {
      state.witnessMode = false
    }
    if (state.ending) state.phase = 'ended'
    paint()
  } catch (err) {
    state.thinking = false
    setError(err.message, () => submitWitness(question, inputEl))
  }
}

// ─── Reveal ──────────────────────────────────────────────────────────────────

document.getElementById('to-reveal-btn').addEventListener('click', async () => {
  state.phase = 'ended'
  paint()
  await loadBreakdown()
})

async function loadBreakdown() {
  try {
    state.breakdown = await api.getBreakdown(state.sessionId)
    paint()
  } catch (err) {
    setError(err.message, loadBreakdown)
  }
}

document.getElementById('restart-btn').addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_STORAGE_KEY)
  resetForNewCase()
  paint()
})

document.getElementById('reveal-reviewer-toggle').addEventListener('click', () => {
  state.reviewerExpanded = !state.reviewerExpanded
  paint()
})

// ─── Transcript-inline error retry (event-delegated: the button is rebuilt
// on every render, so a direct listener would be lost each paint) ──────────

document.getElementById('transcript').addEventListener('click', (e) => {
  if (!e.target.closest('#transcript-retry-btn')) return
  const retry = state.error?.retry
  clearError()
  if (retry) retry()
})

// ─── Setup-phase error banner retry ──────────────────────────────────────────

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
    state.witnessAvailable = result.witnessAvailable
    state.witnessUsed = result.witnessUsed
    state.ending = result.ending
    state.phase = result.ending ? 'ended' : result.phase === 'briefing' ? 'briefing' : 'interrogation'

    state.transcript = []
    let inWitnessPhase = false
    let pendingQuestion = null
    for (const entry of result.transcript) {
      if (entry.speaker === 'witness') inWitnessPhase = true
      if (entry.speaker === 'detective') {
        pendingQuestion = entry.text
      } else {
        state.transcript.push({
          speaker: 'detective',
          question: pendingQuestion || '',
          presentedEvidence: [],
          answerText: entry.text,
          demeanor: entry.demeanor,
          verdict: null,
          delta: 0,
          isWitness: inWitnessPhase,
        })
        pendingQuestion = null
      }
    }

    paint()
    if (state.ending) await loadBreakdown()
  } catch {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
    paint()
  }
}

tryReconnect()
