// The only module that touches the DOM. main.js mutates state then calls
// render(state) once; this derives the full UI from state every time rather
// than hand-rolling incremental DOM patches.

function el(id) {
  return document.getElementById(id)
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// ─── Evidence-type icons ────────────────────────────────────────────────────
// Inline stroke SVGs, 1.6px stroke, no emoji, per DESIGN.md §3/§4. The engine
// has 5 evidence types; DESIGN.md names 4 (fingerprint/phone/box/document) —
// witness gets its own icon (an eye) since it isn't covered by the spec.

const EVIDENCE_ICONS = {
  physical: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3c-3 0-5.5 2-5.5 5.5 0 4-1.5 6-2.5 7.5M12 3c3 0 5.5 2 5.5 5.5 0 2-.3 3.5-.8 4.7M9 20c1-2 1.5-4 1.5-6.5a3.5 3.5 0 0 1 7 0c0 1 0 2-.3 3M12 9.5a3 3 0 0 0-3 3c0 2.5-.5 4-1.2 5.5"/></svg>',
  digital: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
  financial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="6" width="20" height="12" rx="1.5"/><circle cx="12" cy="12" r="3"/><path d="M6 6v12M18 6v12"/></svg>',
  circumstantial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 2h7l3 3v17H7z"/><path d="M14 2v3h3M10 12h6M10 16h6"/></svg>',
  witness: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>',
}

function evidenceIcon(type) {
  return EVIDENCE_ICONS[type] || EVIDENCE_ICONS.circumstantial
}

const VERDICT_ICONS = {
  contradiction: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
  slip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2c4 4 7 8 7 12a7 7 0 0 1-14 0c0-4 3-8 7-12z"/></svg>',
  tell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M8 16c1.2-1 2.6-1.5 4-1.5s2.8.5 4 1.5"/></svg>',
  weak_answer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M9 15h6M9 9h.01M15 9h.01"/></svg>',
  no_change: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
}

const VERDICT_LABELS = {
  contradiction: 'Contradiction',
  slip: 'Slip',
  tell: 'Tell',
  weak_answer: 'Weak answer',
  no_change: 'No change',
}

function isCrackVerdict(type) {
  return type === 'contradiction' || type === 'slip'
}

// ─── Pronoun / room ──────────────────────────────────────────────────────

function renderRoom(state) {
  document.body.dataset.phase = state.phase === 'ended' ? 'ended' : state.phase
  if (state.publicCase) {
    document.body.dataset.pronoun = state.publicCase.suspect.pronoun
  }
}

// ─── HUD (shared component rendered into both briefing + interrogation) ───

function renderHud(state, suffix) {
  const fill = el(`hud-fill${suffix}`)
  const gain = el(`hud-gain${suffix}`)
  const delta = el(`hud-delta${suffix}`)
  const value = el(`hud-value${suffix}`)
  const mark80 = el(`hud-mark80${suffix}`)
  const caseNumberEl = el(suffix ? `hud-case-number${suffix}` : 'hud-case-number')
  const turnsEl = el(`hud-turns${suffix}`)
  if (!fill) return

  const before = Math.max(0, Math.min(100, state.previousCaseStrength))
  const after = Math.max(0, Math.min(100, state.caseStrength))
  const d = state.lastDelta

  if (caseNumberEl && state.publicCase) caseNumberEl.textContent = state.publicCase.caseNumber

  fill.style.width = `${before}%`
  value.textContent = String(state.caseStrength)
  const meter = value.parentElement
  meter.setAttribute('role', 'meter')
  meter.setAttribute('aria-valuemin', '0')
  meter.setAttribute('aria-valuemax', '100')
  meter.setAttribute('aria-valuenow', String(state.caseStrength))
  meter.setAttribute(
    'aria-label',
    `Case strength ${state.caseStrength} of 100${d ? `, up ${d}` : ''}`,
  )

  if (d > 0) {
    gain.style.left = `${before}%`
    gain.style.width = `${after - before}%`
    gain.className = `hud-meter-gain ${isCrackVerdict(state.lastVerdictType) ? 'crack' : ''}`
    delta.textContent = `+${d}`
    delta.className = `hud-meter-delta show ${isCrackVerdict(state.lastVerdictType) ? 'crack' : ''}`
    delta.style.left = `${before}%`
    // Merge the gain segment into the main fill, then clear the transient
    // delta tag — mirrors DESIGN.md §7's "merges into the main fill when the
    // next question is sent" by doing it on the following paint instead.
    requestAnimationFrame(() => {
      fill.style.width = `${after}%`
    })
  } else {
    fill.style.width = `${after}%`
    gain.style.width = '0'
    delta.classList.remove('show')
  }

  if (mark80) mark80.classList.toggle('reached', after >= 80)

  if (turnsEl) {
    turnsEl.innerHTML = ''
    for (let i = 0; i < state.maxInterrogationTurns; i++) {
      const pip = document.createElement('span')
      pip.className = `hud-pip${i < state.interrogationTurn ? ' spent' : ''}`
      turnsEl.appendChild(pip)
    }
    const slot = document.createElement('span')
    slot.className = 'hud-witness-slot'
    if (state.witnessUsed) {
      slot.classList.add('spent')
    } else if (state.witnessAvailable) {
      slot.classList.add('unlocked')
      if (!state.witnessPulsed) {
        slot.classList.add('pulse')
        state.witnessPulsed = true
      }
    }
    slot.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
    turnsEl.appendChild(slot)
  }
}

// ─── Briefing ────────────────────────────────────────────────────────────

function renderExhibitTag(item) {
  return `
    <span class="exhibit-icon">${evidenceIcon(item.type)}</span>
    <span class="exhibit-body">
      <span class="exhibit-name">${escapeHtml(item.name)}</span><br>
      <span class="exhibit-desc">${escapeHtml(item.description)}</span>
    </span>
    <span class="exhibit-id">${escapeHtml(item.id)}</span>
  `
}

function renderBriefing(state) {
  const pc = state.publicCase
  if (!pc) return
  el('dossier-title').textContent = pc.title
  el('dossier-suspect-name').textContent = pc.suspect.name
  el('dossier-suspect-occupation').textContent = capitalize(pc.suspect.occupation)
  el('dossier-victim').textContent = `${pc.victim.name} (${pc.victim.relationship})`
  el('dossier-window').textContent = `${pc.window.start} – ${pc.window.end}`
  el('dossier-victim-summary').textContent = pc.briefing.victimSummary
  el('dossier-suspect-summary').textContent = pc.briefing.suspectSummary
  el('dossier-scene-summary').textContent = pc.briefing.sceneSummary
  el('dossier-evidence-summary').textContent = pc.briefing.evidenceSummary

  const list = el('dossier-evidence-list')
  list.innerHTML = ''
  for (const item of pc.evidence) {
    const li = document.createElement('li')
    li.className = 'exhibit-tag'
    li.innerHTML = renderExhibitTag(item)
    list.appendChild(li)
  }
}

// ─── Interrogation: transcript ──────────────────────────────────────────

function renderVerdictLine(entry) {
  if (!entry.verdict) return ''
  const type = entry.verdict.type
  const crack = isCrackVerdict(type)
  return `
    <div class="verdict-line${crack ? ' crack' : ''}">
      <span class="verdict-icon">${VERDICT_ICONS[type] || VERDICT_ICONS.no_change}</span>
      <span class="verdict-label">${VERDICT_LABELS[type] || 'No change'}</span>
      <span class="verdict-reason">${escapeHtml(entry.verdict.reason)}</span>
      <span class="verdict-delta">${entry.delta > 0 ? `+${entry.delta}` : '+0'}</span>
    </div>
  `
}

function renderTranscript(state) {
  const container = el('transcript')
  container.innerHTML = ''

  state.transcript.forEach((entry, index) => {
    const aged = index < state.transcript.length - 1
    const wrap = document.createElement('div')
    wrap.className = `exchange${aged ? ' aged' : ''}`

    const presentedTags = (entry.presentedEvidence || [])
      .map((e) => `<span class="exhibit-tag"><span class="exhibit-name">${escapeHtml(e.name)}</span></span>`)
      .join('')

    wrap.innerHTML = `
      <div class="bubble-question">${presentedTags}${escapeHtml(entry.question)}</div>
      <div class="bubble-answer">
        <span class="speaker-marker">${entry.isWitness ? 'Witness' : 'Suspect'}${entry.demeanor ? ` — ${entry.demeanor}` : ''}</span>
        ${escapeHtml(entry.answerText)}
      </div>
      ${renderVerdictLine(entry)}
    `
    container.appendChild(wrap)
  })

  if (state.thinking) {
    const thinking = document.createElement('div')
    thinking.className = 'thinking-squares'
    thinking.innerHTML = '<span></span><span></span><span></span>'
    container.appendChild(thinking)
  }

  if (state.error && state.phase !== 'setup') {
    const errEl = document.createElement('div')
    errEl.className = 'transcript-error'
    errEl.innerHTML = `<span>${escapeHtml(state.error.message)}</span><button type="button" class="btn btn-ghost" id="transcript-retry-btn">Retry</button>`
    container.appendChild(errEl)
  }

  container.scrollTop = container.scrollHeight
}

function renderEvidenceTray(state) {
  const tray = el('evidence-tray')
  tray.innerHTML = ''
  if (!state.publicCase) return
  for (const item of state.publicCase.evidence) {
    const presented = item.presented
    const staged = state.evidenceStaged === item.id
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'exhibit-tag'
    btn.dataset.evidenceId = item.id
    btn.disabled = presented || state.witnessMode
    btn.setAttribute('aria-pressed', String(staged))
    btn.innerHTML = `
      <span class="exhibit-icon">${evidenceIcon(item.type)}</span>
      <span class="exhibit-body"><span class="exhibit-name">${escapeHtml(item.name)}</span></span>
      <span class="exhibit-id">${escapeHtml(item.id)}</span>
    `
    tray.appendChild(btn)
  }
}

function renderComposer(state) {
  const ended = !!state.ending
  const turnsLeft = state.witnessMode
    ? state.witnessTurn < state.maxWitnessTurns
    : state.interrogationTurn < state.maxInterrogationTurns

  el('composer').classList.toggle('hidden', ended)
  el('composer-ended').classList.toggle('hidden', !ended)

  const composer = el('composer')
  composer.dataset.mode = state.witnessMode ? 'witness' : 'suspect'
  el('composer-mode-label').textContent = state.witnessMode
    ? `Questioning the witness (${state.witnessTurn}/${state.maxWitnessTurns})`
    : 'Questioning the suspect'

  const input = el('interrogation-input')
  const submit = el('interrogation-submit')
  input.disabled = state.thinking || !turnsLeft
  submit.disabled = state.thinking || !turnsLeft
  input.placeholder = state.witnessMode ? 'Ask the witness...' : 'Ask your question...'

  el('char-count').textContent = String(300 - input.value.length)

  const witnessBtn = el('witness-btn')
  const witnessLabel = el('witness-btn-label')
  if (state.witnessMode) {
    witnessBtn.disabled = true
    witnessLabel.textContent = 'Questioning the witness'
    witnessBtn.removeAttribute('title')
  } else if (state.witnessUsed) {
    witnessBtn.disabled = true
    witnessLabel.textContent = 'Witness questioned'
    witnessBtn.removeAttribute('title')
  } else if (state.witnessAvailable) {
    witnessBtn.disabled = state.thinking
    witnessLabel.textContent = `Question the witness (${state.witnessTurn}/${state.maxWitnessTurns})`
    witnessBtn.removeAttribute('title')
  } else {
    witnessBtn.disabled = true
    witnessLabel.textContent = 'Question the witness'
    witnessBtn.title = 'You may not have enough yet'
  }
}

// ─── Reveal ──────────────────────────────────────────────────────────────
// Player layer renders as soon as state.ending is set; the reviewer layer
// only once state.breakdown has loaded (GET /:id/breakdown, gated server-side
// to post-ending sessions — see src/server/routes/game.ts).

const ENDING_COPY = {
  CHARGED_STRONG: {
    label: 'Charged — strong case',
    body: (cs, suspect) =>
      `Case Strength hit ${cs}. The evidence speaks for itself. ${suspect} is going away.`,
  },
  CHARGED_WEAK: {
    label: 'Charged — qualified case',
    body: (cs, suspect) =>
      `Case Strength ended at ${cs}. Not airtight, but enough to charge. ${suspect} goes to trial on a case with real holes in it.`,
  },
  RELEASED: {
    label: 'Released',
    body: (cs, suspect) =>
      `Case Strength ended at ${cs} — not enough to charge. ${suspect} walks. The detective failed to build the case.`,
  },
}

const EVIDENCE_QUALITY_LABELS = ['terrible lie', 'weak deflection', 'plausible', 'airtight']

function findEvidenceQuality(breakdown, evidenceId) {
  for (const d of breakdown.interrogationDetails) {
    const eh = d.invigilatorResponse?.signals.evidenceHandling.find((h) => h.evidenceId === evidenceId)
    if (eh) return eh
  }
  return null
}

function renderReviewerExchange(d, isWitness) {
  const delta = d.caseStrengthAfter - d.caseStrengthBefore
  const deltaText = delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : '+0'
  const dialogue = isWitness ? d.witnessResponse.dialogue : d.suspectResponse.dialogue
  const demeanor = isWitness ? d.witnessResponse.demeanor : d.suspectResponse.demeanor
  const inv = d.invigilatorResponse

  let signalsHtml = '<p class="reviewer-signal-none">Invigilator evaluation not available for this turn.</p>'
  if (inv) {
    const lines = []
    if (!isWitness) {
      for (const c of inv.signals.contradictions) {
        lines.push(`<p class="reviewer-signal crack">Contradiction (${escapeHtml(c.severity)}) vs ${escapeHtml(c.againstClaimId)}: ${escapeHtml(c.description)}</p>`)
      }
      if (inv.signals.guiltyKnowledgeLeak) {
        lines.push(`<p class="reviewer-signal crack">Guilty knowledge leak: ${escapeHtml(inv.signals.guiltyKnowledgeLeak.description)}</p>`)
      }
      for (const eh of inv.signals.evidenceHandling) {
        lines.push(`<p class="reviewer-signal">${escapeHtml(eh.evidenceId)} — quality ${eh.quality} (${EVIDENCE_QUALITY_LABELS[eh.quality]}): ${escapeHtml(eh.description)}</p>`)
      }
      if (inv.signals.demeanorShift) {
        lines.push('<p class="reviewer-signal">Demeanor shift observed.</p>')
      }
    } else if (inv.signals.suspectContradiction) {
      const sc = inv.signals.suspectContradiction
      lines.push(`<p class="reviewer-signal crack">Witness contradicts suspect vs ${escapeHtml(sc.againstClaimId)}: ${escapeHtml(sc.description)}</p>`)
    }
    lines.push(`<p class="reviewer-reasoning">${escapeHtml(inv.reasoning)}</p>`)
    signalsHtml = lines.join('')
  }

  return `
    <div class="verdict-line${delta > 0 ? ' crack' : ''}">
      <span class="verdict-label">${isWitness ? 'Witness' : 'Suspect'} turn ${d.turn}${demeanor ? ` — ${escapeHtml(demeanor)}` : ''}</span>
      <span class="verdict-delta">${deltaText} (${d.caseStrengthBefore} → ${d.caseStrengthAfter})</span>
    </div>
    <div class="reviewer-exchange-body">
      <p class="reviewer-question">${escapeHtml(d.playerQuestion)}</p>
      <p class="reviewer-answer">${escapeHtml(dialogue)}</p>
      ${signalsHtml}
    </div>
  `
}

function renderReviewerBody(breakdown) {
  const truthRows = breakdown.truth
    .map((beat) => `<p class="reviewer-truth-row"><span class="reviewer-truth-time">${escapeHtml(beat.time)}</span> ${escapeHtml(beat.fact)}</p>`)
    .join('')

  const exchanges = [
    ...breakdown.interrogationDetails.map((d) => renderReviewerExchange(d, false)),
    ...breakdown.witnessDetails.map((d) => renderReviewerExchange(d, true)),
  ].join('')

  const evidenceRows = breakdown.evidence
    .map((e) => {
      const quality = findEvidenceQuality(breakdown, e.id)
      const qualityNote = quality
        ? ` — quality ${quality.quality} (${EVIDENCE_QUALITY_LABELS[quality.quality]})`
        : ''
      return `
        <p class="reviewer-evidence-row${e.presented ? '' : ' never-presented'}">
          <span class="exhibit-id">${escapeHtml(e.id)}</span>
          ${escapeHtml(e.claim)}
          <span class="reviewer-evidence-status">${e.presented ? 'presented' : 'crackable — never pushed'}</span>${qualityNote}
        </p>
      `
    })
    .join('')

  return `
    <div class="reviewer-section">
      <h3>Cover story vs. the truth</h3>
      <p class="reviewer-cover-story">${escapeHtml(breakdown.suspectPersona.coverStory)}</p>
      <div class="reviewer-truth">${truthRows}</div>
    </div>
    <div class="reviewer-section">
      <h3>Exchange replay</h3>
      ${exchanges}
    </div>
    <div class="reviewer-section">
      <h3>Evidence</h3>
      ${evidenceRows}
    </div>
  `
}

function renderReveal(state) {
  const overlay = el('reveal-placeholder')
  const show = state.phase === 'ended' && !!state.ending
  overlay.classList.toggle('hidden', !show)
  if (!show) return

  const copy = ENDING_COPY[state.ending]
  const suspectName = state.publicCase ? state.publicCase.suspect.name : 'The suspect'
  el('reveal-ending-label').textContent = copy ? copy.label : state.ending
  el('reveal-copy').textContent = copy ? copy.body(state.caseStrength, suspectName) : ''

  const cs = Math.max(0, Math.min(100, state.caseStrength))
  el('hud-fill-reveal').style.width = `${cs}%`
  el('hud-value-reveal').textContent = String(state.caseStrength)
  el('hud-mark80-reveal').classList.toggle('reached', cs >= 80)

  const toggle = el('reveal-reviewer-toggle')
  const body = el('reveal-reviewer-body')
  toggle.setAttribute('aria-expanded', String(state.reviewerExpanded))
  body.classList.toggle('hidden', !state.reviewerExpanded)
  if (state.reviewerExpanded && state.breakdown) {
    body.innerHTML = renderReviewerBody(state.breakdown)
  } else if (state.reviewerExpanded) {
    body.innerHTML = '<p class="reviewer-signal-none">Loading…</p>'
  }
}

function renderError(state) {
  const banner = el('error-banner')
  if (state.error && state.phase === 'setup') {
    el('error-message').textContent = state.error.message
    banner.classList.remove('hidden')
  } else {
    banner.classList.add('hidden')
  }
}

export function render(state) {
  renderRoom(state)
  renderHud(state, '')
  renderHud(state, '-briefing')
  renderBriefing(state)
  renderTranscript(state)
  renderEvidenceTray(state)
  renderComposer(state)
  renderReveal(state)
  renderError(state)
}
