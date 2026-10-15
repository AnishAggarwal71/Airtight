// The only module that touches the DOM. main.js mutates state then calls
// render(state) once; this derives the full UI from state every time rather
// than hand-rolling incremental DOM patches.

function el(id) {
  return document.getElementById(id)
}

function csBarClass(cs) {
  if (cs >= 65) return 'high'
  if (cs >= 40) return 'mid'
  return ''
}

function renderCaseStrength(state) {
  const fill = el('cs-bar-fill')
  fill.style.width = `${Math.max(0, Math.min(100, state.caseStrength))}%`
  fill.className = `cs-bar-fill ${csBarClass(state.caseStrength)}`
  el('cs-value').textContent = String(state.caseStrength)

  const delta = state.caseStrength - state.previousCaseStrength
  const flash = el('cs-flash')
  if (delta !== 0) {
    flash.textContent = delta > 0 ? `+${delta}` : String(delta)
    flash.className = `cs-flash ${delta > 0 ? 'show-up' : 'show-down'}`
    // Re-trigger the animation by forcing a reflow-restart next frame.
    requestAnimationFrame(() => {
      flash.classList.remove('show-up', 'show-down')
      requestAnimationFrame(() => {
        flash.classList.add(delta > 0 ? 'show-up' : 'show-down')
      })
    })
  }
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function renderBriefing(state) {
  const pc = state.publicCase
  if (!pc) return
  el('briefing-victim').textContent = `${pc.victim.name} (${pc.victim.relationship})`
  el('briefing-suspect').textContent = `${pc.suspect.name} (${pc.suspect.occupation})`
  el('briefing-location').textContent = pc.location
  el('briefing-window').textContent = `${pc.window.start} – ${pc.window.end}`
  el('briefing-witness').textContent = `${pc.witness.name} (${pc.witness.relationship})`
  el('briefing-victim-summary').textContent = pc.briefing.victimSummary
  el('briefing-suspect-summary').textContent = pc.briefing.suspectSummary
  el('briefing-scene-summary').textContent = pc.briefing.sceneSummary
  el('briefing-crime-summary').textContent = pc.briefing.crimeSummary
  el('briefing-evidence-summary').textContent = pc.briefing.evidenceSummary

  renderEvidenceList('briefing-evidence-list', pc.evidence)

  el('suspect-name').textContent = pc.suspect.name
  el('witness-name').textContent = pc.witness.name
}

function renderEvidenceList(containerId, evidence) {
  const list = el(containerId)
  list.innerHTML = ''
  evidence.forEach((item, index) => {
    const li = document.createElement('li')
    li.innerHTML = `<span class="evidence-number">#${index + 1}</span> <span class="evidence-type">${capitalize(item.type)}:</span> ${item.claim}`
    list.appendChild(li)
  })
}

function renderCaseFile(state) {
  const pc = state.publicCase
  if (!pc) return
  el('case-file-victim').textContent = `${pc.victim.name} (${pc.victim.relationship})`
  el('case-file-suspect').textContent = `${pc.suspect.name} (${pc.suspect.occupation})`
  el('case-file-location').textContent = pc.location
  el('case-file-window').textContent = `${pc.window.start} – ${pc.window.end}`
  el('case-file-witness').textContent = `${pc.witness.name} (${pc.witness.relationship})`
  el('case-file-victim-summary').textContent = pc.briefing.victimSummary
  el('case-file-suspect-summary').textContent = pc.briefing.suspectSummary
  el('case-file-scene-summary').textContent = pc.briefing.sceneSummary
  el('case-file-crime-summary').textContent = pc.briefing.crimeSummary
  el('case-file-evidence-summary').textContent = pc.briefing.evidenceSummary
  renderEvidenceList('case-file-evidence-list', pc.evidence)

  el('case-file-overlay').classList.toggle('hidden', !state.caseFileVisible)
}

function renderEvidenceChips(state, containerId) {
  const container = el(containerId)
  container.innerHTML = ''
  if (!state.publicCase) return
  for (const item of state.publicCase.evidence) {
    const presented = state.presentedEvidenceIds.has(item.id)
    const staged = state.evidenceToggled.has(item.id)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `evidence-chip${staged ? ' staged' : ''}${presented ? ' presented' : ''}`
    btn.dataset.evidenceId = item.id
    btn.disabled = presented
    btn.innerHTML = `<span class="evidence-type">${capitalize(item.type)}:</span> ${item.claim}`
    container.appendChild(btn)
  }
}

function demeanorBadge(demeanor) {
  return `<span class="demeanor-badge ${demeanor}">${demeanor}</span>`
}

function renderTranscript(containerId, entries) {
  const container = el(containerId)
  container.innerHTML = ''
  for (const entry of entries) {
    const msg = document.createElement('div')
    msg.className = `message ${entry.speaker}`
    const speakerLabel = entry.speaker === 'detective' ? 'You' : entry.speaker
    const badge = entry.demeanor ? demeanorBadge(entry.demeanor) : ''
    msg.innerHTML = `<div class="message-speaker">${speakerLabel}${badge}</div><div>${escapeHtml(entry.text)}</div>`
    container.appendChild(msg)
  }
  container.scrollTop = container.scrollHeight
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function renderInterrogation(state) {
  el('interrogation-turn-count').textContent = String(state.interrogationTurn)
  el('interrogation-turn-max').textContent = String(state.maxInterrogationTurns)
  renderTranscript('interrogation-transcript', state.interrogationTranscript)
  renderEvidenceChips(state, 'interrogation-evidence-list')

  el('interrogation-thinking').classList.toggle('hidden', !state.thinking)
  const reasoningEl = el('interrogation-reasoning')
  if (state.lastInvigilatorReasoning) {
    reasoningEl.textContent = state.lastInvigilatorReasoning
    reasoningEl.classList.remove('hidden')
  } else {
    reasoningEl.classList.add('hidden')
  }

  const done = state.interrogationTurn >= state.maxInterrogationTurns
  el('to-witness-btn').classList.toggle('hidden', !!state.ending)
  el('interrogation-form').classList.toggle('hidden', done || !!state.ending)

  const submitBtn = el('interrogation-submit')
  submitBtn.disabled = state.thinking
}

function renderWitness(state) {
  el('witness-turn-count').textContent = String(state.witnessTurn)
  el('witness-turn-max').textContent = String(state.maxWitnessTurns)
  renderTranscript('witness-transcript', state.witnessTranscript)

  el('witness-thinking').classList.toggle('hidden', !state.thinking)
  const reasoningEl = el('witness-reasoning')
  if (state.lastWitnessReasoning) {
    reasoningEl.textContent = state.lastWitnessReasoning
    reasoningEl.classList.remove('hidden')
  } else {
    reasoningEl.classList.add('hidden')
  }

  const done = state.witnessTurn >= state.maxWitnessTurns
  el('to-verdict-btn').classList.toggle('hidden', !done && !state.ending)
  el('witness-form').classList.toggle('hidden', done || !!state.ending)

  el('witness-submit').disabled = state.thinking
}

function renderVerdict(state) {
  el('verdict-case-strength').textContent = String(state.caseStrength)
  const alreadyResolved = !!state.ending
  el('verdict-choice').classList.toggle('hidden', alreadyResolved)
  const resultEl = el('verdict-result')
  resultEl.classList.toggle('hidden', !alreadyResolved)
  if (alreadyResolved) {
    const label = el('verdict-result-label')
    label.textContent = state.ending.replace('_', ' ')
    label.className = `verdict-result-label ${state.ending}`
  }
}

function renderBreakdown(state) {
  const content = el('breakdown-content')
  if (!state.breakdown) {
    content.innerHTML = ''
    return
  }
  const b = state.breakdown
  content.innerHTML = ''

  content.appendChild(
    accordionCard(
      state,
      'truth',
      'Truth Timeline',
      b.truth.map((beat) => `<div class="claim-item">${beat.time} — ${escapeHtml(beat.fact)}</div>`).join(''),
    ),
  )

  content.appendChild(
    accordionCard(
      state,
      'fatal-fact',
      'Fatal Fact',
      `<div class="claim-item">${escapeHtml(b.fatalFact)}</div>`,
    ),
  )

  if (b.turningPoint) {
    content.appendChild(
      accordionCard(
        state,
        'turning-point',
        'Turning Point',
        `<div class="claim-item">Turn ${b.turningPoint.turn}: "${escapeHtml(b.turningPoint.playerQuestion)}" — Case Strength ${b.turningPoint.caseStrengthBefore} → ${b.turningPoint.caseStrengthAfter}</div>`,
      ),
    )
  }

  content.appendChild(
    accordionCard(
      state,
      'persona',
      'Suspect Strategy (revealed)',
      `<div class="claim-item">Personality: ${escapeHtml(b.suspectPersona.personality)}</div>
       <div class="claim-item">Cover story: ${escapeHtml(b.suspectPersona.coverStory)}</div>
       <div class="claim-item">Breaking points: ${b.suspectPersona.breakingPoints.map(escapeHtml).join(', ')}</div>
       <div class="claim-item">Guilty knowledge: ${b.suspectPersona.guiltyKnowledge.map(escapeHtml).join(', ')}</div>`,
    ),
  )

  content.appendChild(
    accordionCard(
      state,
      'evidence',
      'Evidence Vulnerabilities',
      b.evidence
        .map(
          (e) =>
            `<div class="claim-item">${e.claim}<br><span class="contradiction-tag">${escapeHtml(e.vulnerability)}</span></div>`,
        )
        .join(''),
    ),
  )

  const contradictedIds = new Set(b.contradictedClaimIds)
  content.appendChild(
    accordionCard(
      state,
      'suspect-claims',
      'Suspect Claim Ledger',
      b.suspectClaims
        .map(
          (c) =>
            `<div class="claim-item${contradictedIds.has(c.id) ? ' contradicted' : ''}">[${c.id}] ${escapeHtml(c.text)}${contradictedIds.has(c.id) ? '<span class="contradiction-tag">CONTRADICTED</span>' : ''}</div>`,
        )
        .join(''),
    ),
  )

  content.appendChild(
    accordionCard(
      state,
      'witness-claims',
      'Witness Claim Ledger',
      b.witnessClaims.map((c) => `<div class="claim-item">[${c.id}] ${escapeHtml(c.text)}</div>`).join(''),
    ),
  )

  content.appendChild(
    accordionCard(
      state,
      'usage',
      'Token Usage',
      `<div class="claim-item">Input: ${b.usage.inputTokens} · Output: ${b.usage.outputTokens} · Cache created: ${b.usage.cacheCreationTokens} · Cache read: ${b.usage.cacheReadTokens}</div>`,
    ),
  )
}

function accordionCard(state, key, title, bodyHtml) {
  const open = state.openAccordions.has(key)
  const card = document.createElement('div')
  card.className = `accordion-card${open ? ' open' : ''}`
  card.innerHTML = `
    <button type="button" class="accordion-header" data-accordion-key="${key}">
      <span>${title}</span><span>${open ? '−' : '+'}</span>
    </button>
    <div class="accordion-body">${bodyHtml}</div>
  `
  return card
}

function renderError(state) {
  const banner = el('error-banner')
  if (state.error) {
    el('error-message').textContent = state.error.message
    banner.classList.remove('hidden')
  } else {
    banner.classList.add('hidden')
  }
}

export function render(state) {
  document.body.dataset.phase = state.phase
  renderCaseStrength(state)
  renderBriefing(state)
  renderInterrogation(state)
  renderWitness(state)
  renderVerdict(state)
  renderBreakdown(state)
  renderError(state)
  renderCaseFile(state)
}
