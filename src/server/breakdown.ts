/**
 * Builds the post-game breakdown DTO from a resolved GameSession.
 *
 * This is a JSON port of src/cli/play.ts's renderBreakdown() — same source
 * fields, same turning-point and contradicted-claim-ID derivations, just
 * assembled into a plain object instead of printed with ANSI codes. Keep
 * the two in sync if the underlying session/invigilator shapes change.
 */

import type { GameSession } from '../engine/types'
import type { BreakdownResponse, TranscriptEntry, TurningPoint } from './types'

/** Finds the interrogation turn with the largest absolute Case Strength swing. */
function findTurningPoint(session: GameSession): TurningPoint | null {
  let turningTurn = 0
  let maxDelta = 0
  for (const d of session.interrogationDetails) {
    const delta = Math.abs(d.caseStrengthAfter - d.caseStrengthBefore)
    if (delta > maxDelta) {
      maxDelta = delta
      turningTurn = d.turn
    }
  }
  if (maxDelta === 0) return null
  const detail = session.interrogationDetails.find((d) => d.turn === turningTurn)!
  return {
    turn: turningTurn,
    phase: 'interrogation',
    caseStrengthBefore: detail.caseStrengthBefore,
    caseStrengthAfter: detail.caseStrengthAfter,
    playerQuestion: detail.playerQuestion,
  }
}

/** Collects every suspect claim ID the invigilator flagged as contradicted, across all turns. */
function findContradictedClaimIds(session: GameSession): string[] {
  const contradictedIds = new Set<string>()
  for (const d of session.interrogationDetails) {
    if (d.invigilatorResponse) {
      for (const c of d.invigilatorResponse.signals.contradictions) {
        contradictedIds.add(c.againstClaimId)
      }
    }
  }
  return [...contradictedIds]
}

export function buildBreakdown(session: GameSession): BreakdownResponse {
  // No seed in the response, even post-game: it would let a player replay
  // this exact case. Replay uses the server-side session_created log line.
  return {
    ending: session.ending!, // guarded by the caller — only reachable once ending is set
    caseStrength: session.caseStrength,
    caseStrengthHistory: session.caseStrengthHistory,
    interrogationTurn: session.interrogationTurn,
    maxInterrogationTurns: session.maxInterrogationTurns,
    witnessTurn: session.witnessTurn,
    maxWitnessTurns: session.maxWitnessTurns,
    truth: session.caseFile.truth,
    fatalFact: session.caseFile.fatalFact,
    turningPoint: findTurningPoint(session),
    interrogationDetails: session.interrogationDetails,
    witnessDetails: session.witnessDetails,
    suspectPersona: session.caseFile.suspectPersona,
    evidence: session.caseFile.evidence,
    suspectClaims: session.suspectClaims,
    witnessClaims: session.witnessClaims,
    contradictedClaimIds: findContradictedClaimIds(session),
    usage: session.usage,
  }
}

/** Reshapes interrogation + witness details into a flat transcript, used by the reconnect endpoint. */
export function buildTranscript(session: GameSession): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  for (const d of session.interrogationDetails) {
    entries.push({ speaker: 'detective', text: d.playerQuestion, turn: d.turn })
    entries.push({
      speaker: 'suspect',
      text: d.suspectResponse.dialogue,
      demeanor: d.suspectResponse.demeanor,
      turn: d.turn,
    })
  }
  for (const d of session.witnessDetails) {
    entries.push({ speaker: 'detective', text: d.playerQuestion, turn: d.turn })
    entries.push({
      speaker: 'witness',
      text: d.witnessResponse.dialogue,
      demeanor: d.witnessResponse.demeanor,
      turn: d.turn,
    })
  }
  return entries
}
