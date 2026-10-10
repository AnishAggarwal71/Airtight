/**
 * Hand-crafted eval cases for invigilator accuracy testing (Layer 1).
 *
 * All cases use the homicide-stairwell template with seed 'eval-stairwell'.
 * Each case provides a hand-written suspect dialogue with planted signals
 * and the expected invigilator findings a human would judge.
 *
 * Distribution: 4 guilty knowledge, 4 contradiction, 3 evidence handling,
 * 2 demeanor, 5 clean/negative = 18 total.
 */

import type { EvalCase } from './types'

export const EVAL_CASES: EvalCase[] = [
  // ── Guilty knowledge leaks (4) ──────────────────────────────────────────

  {
    id: 'gk-bottle-canal',
    category: 'guilty_knowledge',
    description: 'Suspect mentions the bottle ending up in the canal — only the killer knows this',
    seed: 'eval-stairwell',
    turnNumber: 5,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim for a brief friendly chat around the start of the time window.', turn: 1, checkable: true },
      { id: 'c2', text: 'The suspect left the building before half past.', turn: 1, checkable: true },
      { id: 'c3', text: 'The suspect and the victim discussed the debt but it was civil.', turn: 2, checkable: true },
      { id: 'c4', text: 'The suspect drove home shortly after leaving.', turn: 3, checkable: true },
    ],
    presentedEvidenceIds: ['e5'],
    playerQuestion: 'A bottle is missing from the wine rack. Where is it?',
    suspectDialogue: 'I have no idea about any bottle. If one is missing, maybe it ended up in the canal — people dump all sorts down there. I certainly didn\'t take anything from that kitchen.',
    expectedSignals: {
      contradictions: [],
      guiltyKnowledgeLeak: true,
      evidenceQuality: { e5: 1 },
      demeanorShift: false,
    },
  },
  {
    id: 'gk-bin-store-exit',
    category: 'guilty_knowledge',
    description: 'Suspect references leaving through the bin store — an unusual route only the killer used',
    seed: 'eval-stairwell',
    turnNumber: 4,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim for a brief friendly chat.', turn: 1, checkable: true },
      { id: 'c2', text: 'The suspect left through the main entrance.', turn: 2, checkable: true },
    ],
    presentedEvidenceIds: ['e1'],
    playerQuestion: 'Your key card was used at the bin store door. Why?',
    suspectDialogue: 'The bin store? Well, yes, I sometimes pop through there because it\'s quicker to the car park. I\'ve done it a dozen times. It\'s not unusual — half the building uses that shortcut when the lift is out.',
    expectedSignals: {
      contradictions: [{ againstClaimId: 'c2', severity: 'major' }],
      guiltyKnowledgeLeak: false,
      evidenceQuality: { e1: 2 },
      demeanorShift: false,
    },
  },
  {
    id: 'gk-staged-fall',
    category: 'guilty_knowledge',
    description: 'Suspect references body being at the bottom of the stairs before this was disclosed',
    seed: 'eval-stairwell',
    turnNumber: 2,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim briefly and left early.', turn: 1, checkable: true },
    ],
    presentedEvidenceIds: [],
    playerQuestion: 'When did you last see the victim alive?',
    suspectDialogue: 'I saw them that evening, we had a quick chat and I left. I still can\'t believe what happened. A fall down those stairs — it must have been terrible. Those steps are steep and the lighting is awful.',
    expectedSignals: {
      contradictions: [],
      guiltyKnowledgeLeak: true,
      evidenceQuality: {},
      demeanorShift: false,
    },
  },
  {
    id: 'gk-weapon-bottle',
    category: 'guilty_knowledge',
    description: 'Suspect identifies the weapon as a bottle before the detective mentioned it',
    seed: 'eval-stairwell',
    turnNumber: 3,
    priorClaims: [
      { id: 'c1', text: 'The suspect had a friendly visit and left before half past.', turn: 1, checkable: true },
      { id: 'c2', text: 'The suspect and the victim had tea together.', turn: 2, checkable: true },
    ],
    presentedEvidenceIds: [],
    playerQuestion: 'The pathologist says the injury doesn\'t match a fall. What do you think happened?',
    suspectDialogue: 'I don\'t know what to tell you. Maybe someone hit them with something — a bottle, I don\'t know. People get into fights. But it wasn\'t me, I was home by then.',
    expectedSignals: {
      contradictions: [],
      guiltyKnowledgeLeak: true,
      evidenceQuality: {},
      demeanorShift: false,
    },
  },

  // ── Contradictions (4) ──────────────────────────────────────────────────

  {
    id: 'contra-time-discrepancy',
    category: 'contradiction',
    description: 'Suspect previously said they left before half past, now says they stayed until quarter to',
    seed: 'eval-stairwell',
    turnNumber: 3,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim for a brief friendly chat.', turn: 1, checkable: true },
      { id: 'c2', text: 'The suspect left the building before half past.', turn: 1, checkable: true },
      { id: 'c3', text: 'The suspect and the victim discussed the debt civilly.', turn: 2, checkable: true },
    ],
    presentedEvidenceIds: ['e3'],
    playerQuestion: 'Your phone was on the building wifi later than you said. Explain that.',
    suspectDialogue: 'Look, I might have the exact time wrong. I think I left around quarter to — maybe I stayed a bit longer than I remembered. We were talking and I lost track. But that doesn\'t mean anything sinister happened.',
    expectedSignals: {
      contradictions: [{ againstClaimId: 'c2', severity: 'major' }],
      guiltyKnowledgeLeak: false,
      evidenceQuality: { e3: 1 },
      demeanorShift: false,
    },
  },
  {
    id: 'contra-visit-length',
    category: 'contradiction',
    description: 'Suspect said brief visit in turn 1, now says they were there for over an hour',
    seed: 'eval-stairwell',
    turnNumber: 4,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim for about twenty minutes.', turn: 1, checkable: true },
      { id: 'c2', text: 'The suspect left the building before half past.', turn: 1, checkable: true },
      { id: 'c3', text: 'The suspect and the victim talked about old times.', turn: 2, checkable: true },
      { id: 'c4', text: 'The suspect did not argue with the victim about money.', turn: 3, checkable: true },
    ],
    presentedEvidenceIds: [],
    playerQuestion: 'Walk me through exactly what happened after you arrived at the flat.',
    suspectDialogue: 'I got there, we had some tea, talked for ages — must have been over an hour actually. We were catching up properly. Then I said goodnight and headed home. Nothing unusual about it.',
    expectedSignals: {
      contradictions: [{ againstClaimId: 'c1', severity: 'major' }],
      guiltyKnowledgeLeak: false,
      evidenceQuality: {},
      demeanorShift: false,
    },
  },
  {
    id: 'contra-location-flip',
    category: 'contradiction',
    description: 'Suspect claimed to leave via main entrance, now says they went through the ground floor',
    seed: 'eval-stairwell',
    turnNumber: 4,
    priorClaims: [
      { id: 'c1', text: 'The suspect left through the main entrance after the visit.', turn: 2, checkable: true },
      { id: 'c2', text: 'The suspect walked directly to the car park from the front door.', turn: 2, checkable: true },
    ],
    presentedEvidenceIds: ['e1'],
    playerQuestion: 'We have your key card at the bin store door. You said you left through the front.',
    suspectDialogue: 'Right, I forgot — I did go down to the ground floor first. The lift was broken so I took the stairs down and cut through the bin area. It\'s the quickest way to where I parked. I wasn\'t thinking about it when I answered before.',
    expectedSignals: {
      contradictions: [{ againstClaimId: 'c1', severity: 'major' }],
      guiltyKnowledgeLeak: false,
      evidenceQuality: { e1: 2 },
      demeanorShift: false,
    },
  },
  {
    id: 'contra-relationship-detail',
    category: 'contradiction',
    description: 'Suspect said they hadn\'t discussed money, now admits they argued about the debt',
    seed: 'eval-stairwell',
    turnNumber: 5,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim for a friendly chat.', turn: 1, checkable: true },
      { id: 'c2', text: 'The suspect did not discuss money or the debt during the visit.', turn: 3, checkable: true },
      { id: 'c3', text: 'The suspect and the victim had a good relationship.', turn: 3, checkable: true },
    ],
    presentedEvidenceIds: ['e4'],
    playerQuestion: 'The victim owed you thousands. You expect me to believe money never came up?',
    suspectDialogue: 'Fine, yes, we talked about the money. I\'ll admit that. It came up and we had words about it. But having words isn\'t the same as — look, people argue about money all the time. It doesn\'t mean I did anything.',
    expectedSignals: {
      contradictions: [{ againstClaimId: 'c2', severity: 'major' }],
      guiltyKnowledgeLeak: false,
      evidenceQuality: { e4: 1 },
      demeanorShift: false,
    },
  },

  // ── Evidence handling (3) ───────────────────────────────────────────────

  {
    id: 'ev-wifi-terrible',
    category: 'evidence_handling',
    description: 'Suspect gives a terrible response to wifi evidence — claims they weren\'t in the building',
    seed: 'eval-stairwell',
    turnNumber: 3,
    priorClaims: [
      { id: 'c1', text: 'The suspect was inside the building visiting the victim.', turn: 1, checkable: true },
      { id: 'c2', text: 'The suspect left before half past.', turn: 1, checkable: true },
    ],
    presentedEvidenceIds: ['e3'],
    playerQuestion: 'Your phone was on the building wifi well past when you say you left.',
    suspectDialogue: 'That\'s impossible. I wasn\'t anywhere near the building at that time. Your records must be wrong. I was in my car driving home — there\'s no way my phone was connected.',
    expectedSignals: {
      contradictions: [{ againstClaimId: 'c1', severity: 'minor' }],
      guiltyKnowledgeLeak: false,
      evidenceQuality: { e3: 0 },
      demeanorShift: false,
    },
  },
  {
    id: 'ev-debt-decent',
    category: 'evidence_handling',
    description: 'Suspect gives a decent deflection on the debt motive — argues dead debtor is worse',
    seed: 'eval-stairwell',
    turnNumber: 4,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim to discuss the debt repayment.', turn: 2, checkable: true },
    ],
    presentedEvidenceIds: ['e4'],
    playerQuestion: 'The victim owed you a lot of money and had missed payments. That\'s a motive.',
    suspectDialogue: 'Think about that for a second. If someone owes you money, the last thing you want is them dead. Dead people don\'t pay debts. I\'m now an unsecured creditor at the back of a queue — I\'ve lost the lot. How is that a motive?',
    expectedSignals: {
      contradictions: [],
      guiltyKnowledgeLeak: false,
      evidenceQuality: { e4: 2 },
      demeanorShift: false,
    },
  },
  {
    id: 'ev-pathology-airtight',
    category: 'evidence_handling',
    description: 'Suspect gives an airtight response to the pathology evidence',
    seed: 'eval-stairwell',
    turnNumber: 5,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim for a friendly chat.', turn: 1, checkable: true },
    ],
    presentedEvidenceIds: ['e2'],
    playerQuestion: 'The pathologist says the head injury doesn\'t match a fall down those stairs.',
    suspectDialogue: 'I read the report summary you showed me — it says "less consistent with," not impossible. That\'s a hedged opinion. And you should know that the victim fell in that same stairwell two months ago. Hit their head then too — there\'s a hospital record. These stairs are a death trap and everyone in the building knows it.',
    expectedSignals: {
      contradictions: [],
      guiltyKnowledgeLeak: false,
      evidenceQuality: { e2: 3 },
      demeanorShift: false,
    },
  },

  // ── Demeanor (2) ────────────────────────────────────────────────────────

  {
    id: 'dem-shift-nervous',
    category: 'demeanor',
    description: 'Suspect becomes visibly nervous when pressed on the exact time they left',
    seed: 'eval-stairwell',
    turnNumber: 3,
    priorClaims: [
      { id: 'c1', text: 'The suspect left the building before half past.', turn: 1, checkable: true },
    ],
    presentedEvidenceIds: ['e3'],
    playerQuestion: 'Your phone says you were in the building much later. What time did you actually leave?',
    suspectDialogue: 'I — look, I don\'t know exactly. It was around — I mean, I think I said before, it was maybe... I left when I left, alright? I wasn\'t watching the clock. Why does the exact minute matter so much?',
    expectedSignals: {
      contradictions: [],
      guiltyKnowledgeLeak: false,
      evidenceQuality: { e3: 1 },
      demeanorShift: true,
    },
  },
  {
    id: 'dem-stays-calm',
    category: 'demeanor',
    description: 'Suspect stays calm and measured under a routine question — no shift expected',
    seed: 'eval-stairwell',
    turnNumber: 1,
    priorClaims: [],
    presentedEvidenceIds: [],
    playerQuestion: 'Can you walk me through your evening?',
    suspectDialogue: 'Of course. I went over to see them around ten, maybe a bit before. We had a cup of tea, talked about how things were going. I left after about twenty minutes, walked to my car, and drove home. I was in bed before midnight.',
    expectedSignals: {
      contradictions: [],
      guiltyKnowledgeLeak: false,
      evidenceQuality: {},
      demeanorShift: false,
    },
  },

  // ── Clean / negative cases (5) ──────────────────────────────────────────

  {
    id: 'clean-good-deflection',
    category: 'clean',
    description: 'Suspect handles a tough question well — no signals should fire',
    seed: 'eval-stairwell',
    turnNumber: 2,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim for about twenty minutes.', turn: 1, checkable: true },
      { id: 'c2', text: 'The suspect left the building before half past.', turn: 1, checkable: true },
    ],
    presentedEvidenceIds: [],
    playerQuestion: 'Did you and the victim argue that night?',
    suspectDialogue: 'Argue? No. We talked. About normal things — the building, the weather, the football. It was a normal visit. You\'re looking at me like I should be nervous. I\'m not, because I haven\'t done anything.',
    expectedSignals: {
      contradictions: [],
      guiltyKnowledgeLeak: false,
      evidenceQuality: {},
      demeanorShift: false,
    },
  },
  {
    id: 'clean-expressing-grief',
    category: 'clean',
    description: 'Suspect expresses genuine-sounding grief — should not be flagged as suspicious',
    seed: 'eval-stairwell',
    turnNumber: 2,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim for a brief chat.', turn: 1, checkable: true },
    ],
    presentedEvidenceIds: [],
    playerQuestion: 'How would you describe your relationship with the victim?',
    suspectDialogue: 'We were close. Really close. I keep thinking about the last thing I said when I left — something stupid like "see you Thursday." And now there won\'t be a Thursday. I\'m sorry, it just hits you at odd moments.',
    expectedSignals: {
      contradictions: [],
      guiltyKnowledgeLeak: false,
      evidenceQuality: {},
      demeanorShift: false,
    },
  },
  {
    id: 'clean-why-suspect',
    category: 'clean',
    description: 'Suspect asks why they\'re being treated as a suspect — standard deflection, no signal',
    seed: 'eval-stairwell',
    turnNumber: 3,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim briefly.', turn: 1, checkable: true },
      { id: 'c2', text: 'The suspect left before half past.', turn: 1, checkable: true },
    ],
    presentedEvidenceIds: [],
    playerQuestion: 'You were one of the last people to see the victim alive.',
    suspectDialogue: 'And that makes me a suspect, does it? I visited a family member. I do it every week. Are you treating every person who walked into that building as a murderer, or just me? I want to help, but I don\'t understand why I\'m here like this.',
    expectedSignals: {
      contradictions: [],
      guiltyKnowledgeLeak: false,
      evidenceQuality: {},
      demeanorShift: false,
    },
  },
  {
    id: 'clean-vague-nonanswer',
    category: 'clean',
    description: 'Suspect gives a vague answer that doesn\'t contradict anything or leak knowledge',
    seed: 'eval-stairwell',
    turnNumber: 4,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim for about twenty minutes.', turn: 1, checkable: true },
      { id: 'c2', text: 'The suspect left the building before half past.', turn: 1, checkable: true },
      { id: 'c3', text: 'The suspect drove home after leaving.', turn: 2, checkable: true },
    ],
    presentedEvidenceIds: [],
    playerQuestion: 'What route did you take when you left the building?',
    suspectDialogue: 'I just... went out and walked to the car. The usual way. I wasn\'t paying attention to which door or which corridor. You don\'t, do you? You just leave. I couldn\'t tell you the exact route if my life depended on it.',
    expectedSignals: {
      contradictions: [],
      guiltyKnowledgeLeak: false,
      evidenceQuality: {},
      demeanorShift: false,
    },
  },
  {
    id: 'clean-redirect-to-victim',
    category: 'clean',
    description: 'Suspect redirects conversation to the victim\'s lifestyle — clean misdirection',
    seed: 'eval-stairwell',
    turnNumber: 3,
    priorClaims: [
      { id: 'c1', text: 'The suspect visited the victim for a brief chat.', turn: 1, checkable: true },
      { id: 'c2', text: 'The suspect and the victim discussed the debt civilly.', turn: 2, checkable: true },
    ],
    presentedEvidenceIds: [],
    playerQuestion: 'Was there anyone else who might have wanted to hurt the victim?',
    suspectDialogue: 'Honestly, I\'ve been thinking about that. They weren\'t always careful about who they let in. Lent money to people I\'d never heard of. There was someone coming round — I don\'t know the name — but it made me uneasy. Have you looked into that?',
    expectedSignals: {
      contradictions: [],
      guiltyKnowledgeLeak: false,
      evidenceQuality: {},
      demeanorShift: false,
    },
  },
]
