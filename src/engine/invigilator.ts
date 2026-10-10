/**
 * Invigilator agent — the LLM-as-judge that evaluates each turn.
 *
 * Sees the full case context (truth, evidence + vulnerabilities, persona) and
 * the suspect/witness dialogue, then returns structured signals that the
 * deterministic scoring engine converts to case strength changes.
 *
 * "The suspect acts; the invigilator judges; the engine scores."
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { MODEL } from './adjudicate'
import { serializeLedger } from './ledger'
import type {
  CaseFile,
  Claim,
  DetectiveEvidence,
  InvigilatorSuspectResponse,
  InvigilatorWitnessResponse,
  TokenUsage,
} from './types'

// ─── Suspect evaluation schema ─────────────────────────────────────────────

export const SuspectInvigilatorSchema = z.object({
  reasoning: z.string().describe(
    '2–3 sentences explaining your assessment of this turn. What did the suspect ' +
    'do well or poorly? Did they stay in character? Did anything slip?',
  ),
  signals: z.object({
    contradictions: z.array(z.object({
      againstClaimId: z.string().describe('Claim ID from the ledger that was contradicted, e.g. "c3"'),
      description: z.string().describe('What the suspect said now vs what they claimed before'),
      severity: z.enum(['minor', 'major']).describe(
        'minor: inconsistency in detail (times off by a bit). ' +
        'major: direct contradiction of a core claim.',
      ),
    })).describe('All contradictions between this turn\'s dialogue and prior claims. Empty array if none.'),
    guiltyKnowledgeLeak: z.object({
      description: z.string().describe('What was leaked and why only the guilty party would know this'),
    }).nullable().describe(
      'Non-null ONLY if the suspect revealed something they shouldn\'t know if innocent. ' +
      'Examples: mentioning the murder weapon before the detective did, knowing where the body ' +
      'was found, referencing details only the killer would have. Null if nothing leaked.',
    ),
    evidenceHandling: z.array(z.object({
      evidenceId: z.string().describe('The evidence item ID'),
      quality: z.number().int().min(0).max(3).describe(
        '0 = terrible (contradicts known facts, makes it worse). ' +
        '1 = weak (doesn\'t address the evidence, obvious deflection). ' +
        '2 = plausible but cracked (addresses it but leaves doubt). ' +
        '3 = airtight (provides a convincing innocent explanation).',
      ),
      description: z.string().describe('How the suspect handled this evidence and why you gave this rating'),
    })).describe('One entry per evidence item presented this turn. Empty array if none presented.'),
    demeanorShift: z.boolean().describe(
      'True if the suspect\'s emotional state noticeably changed this turn compared to ' +
      'their prior behaviour — becoming more nervous, defensive, aggressive, or evasive ' +
      'under pressure. False if they maintained composure.',
    ),
  }),
})

// ─── Witness evaluation schema ──────────────────────────────────────────────

export const WitnessInvigilatorSchema = z.object({
  reasoning: z.string().describe(
    '1–2 sentences explaining your assessment. Did the witness provide useful testimony? ' +
    'Does their account contradict anything the suspect claimed?',
  ),
  signals: z.object({
    suspectContradiction: z.object({
      againstClaimId: z.string().describe('Suspect claim ID from the ledger that the witness contradicts'),
      description: z.string().describe('What the witness says vs what the suspect claimed'),
    }).nullable().describe(
      'Non-null ONLY if the witness\'s honest testimony directly contradicts a specific ' +
      'suspect claim in the ledger. Null if the testimony is consistent or unrelated.',
    ),
  }),
})

// ─── System prompt (shared for both suspect and witness evaluation) ────────

/**
 * Build the invigilator's system prompt. Contains the full case context —
 * truth, all evidence with vulnerabilities, suspect persona. This is static
 * and cached across all turns in a session.
 */
export function buildInvigilatorSystemPrompt(caseFile: CaseFile): string {
  const lines: string[] = []

  lines.push('You are an impartial judge evaluating an interrogation game. You see EVERYTHING — the truth, the evidence, the suspect\'s strategy. Your job is to assess what just happened in this turn.')
  lines.push('')
  lines.push('## THE TRUTH — WHAT ACTUALLY HAPPENED')
  for (const beat of caseFile.truth) {
    lines.push(`  ${beat.id} [${beat.time}] ${beat.fact}`)
  }
  lines.push('')
  lines.push(`## FATAL FACT: ${caseFile.fatalFact}`)
  lines.push('')
  lines.push('## SUSPECT PROFILE')
  lines.push(`${caseFile.suspect.name}, ${caseFile.suspect.occupation}`)
  lines.push(`Personality: ${caseFile.suspectPersona.personality}`)
  lines.push(`Cover story: ${caseFile.suspectPersona.coverStory}`)
  lines.push('')
  lines.push('## GUILTY KNOWLEDGE (things the suspect knows but shouldn\'t if innocent)')
  for (const gk of caseFile.suspectPersona.guiltyKnowledge) {
    lines.push(`  - ${gk}`)
  }
  lines.push('')
  lines.push('## BREAKING POINTS')
  for (const bp of caseFile.suspectPersona.breakingPoints) {
    lines.push(`  - ${bp}`)
  }
  lines.push('')
  lines.push('## ALL EVIDENCE (with vulnerabilities the suspect could exploit)')
  for (const e of caseFile.evidence) {
    lines.push(`  ${e.id} [${e.type}]: ${e.claim}`)
    lines.push(`    Vulnerability: ${e.vulnerability}`)
  }
  lines.push('')
  lines.push('## WITNESS PROFILE')
  lines.push(`${caseFile.witness.name}, ${caseFile.witness.relationship}`)
  lines.push(`Knows: ${caseFile.witness.knowledgeBoundary}`)
  lines.push('Known contradictions with suspect:')
  for (const c of caseFile.witness.suspectContradictions) {
    lines.push(`  - ${c}`)
  }
  lines.push('')
  lines.push('## JUDGING RULES')
  lines.push('1. You are NOT the suspect or witness. You are an outside observer with full knowledge.')
  lines.push('2. Judge the DIALOGUE — what was actually said — against the truth and prior claims.')
  lines.push('3. A contradiction means the suspect said something NOW that conflicts with a SPECIFIC prior claim in the ledger. Quote the claim ID.')
  lines.push('4. A guilty knowledge leak means the suspect mentioned something only the killer would know — something the detective has not revealed. Be strict: if the detective asked about it first, it\'s not a leak.')
  lines.push('5. Evidence handling quality: how well did the suspect address each presented item? Did they provide a convincing innocent explanation, or did they fumble?')
  lines.push('6. Demeanor shift: did the suspect\'s emotional state change noticeably under pressure this turn?')
  lines.push('7. Be precise and conservative. Only flag what you can point to in the dialogue. Do not infer what was "implied" — flag what was SAID.')
  lines.push('8. Return ONLY the structured JSON matching the schema.')

  return lines.join('\n')
}

// ─── Suspect evaluation ─────────────────────────────────────────────────────

export type EvaluateSuspectInput = {
  caseFile: CaseFile
  turn: number
  maxTurns: number
  playerQuestion: string
  suspectDialogue: string
  presentedEvidence: DetectiveEvidence[]
  suspectClaims: Claim[]
}

function buildSuspectEvalMessage(input: EvaluateSuspectInput): string {
  const lines: string[] = []

  lines.push(`INTERROGATION TURN ${input.turn} OF ${input.maxTurns}`)
  lines.push('')

  lines.push('THE DETECTIVE ASKED:')
  lines.push(`"${input.playerQuestion}"`)
  lines.push('')

  if (input.presentedEvidence.length > 0) {
    lines.push('EVIDENCE PRESENTED THIS TURN:')
    for (const e of input.presentedEvidence) {
      lines.push(`  [${e.id}] (${e.type}): ${e.claim}`)
      lines.push(`    Vulnerability: ${e.vulnerability}`)
    }
    lines.push('')
  }

  lines.push('THE SUSPECT RESPONDED:')
  lines.push(`"${input.suspectDialogue}"`)
  lines.push('')

  lines.push('SUSPECT\'S PRIOR CLAIMS (check for contradictions):')
  lines.push(serializeLedger(input.suspectClaims))

  return lines.join('\n')
}

export type EvaluateSuspectResult = {
  response: InvigilatorSuspectResponse
  usage: TokenUsage
}

const MAX_INVIGILATOR_RETRIES = 2

/**
 * Evaluate one suspect interrogation turn. The invigilator sees the full
 * context and returns structured signals for the scoring engine.
 */
export async function evaluateSuspectTurn(
  input: EvaluateSuspectInput,
): Promise<EvaluateSuspectResult> {
  const systemPrompt = buildInvigilatorSystemPrompt(input.caseFile)
  const userMessage = buildSuspectEvalMessage(input)

  let lastError: Error | null = null
  for (let attempt = 0; attempt <= MAX_INVIGILATOR_RETRIES; attempt++) {
    try {
      const result = await generateObject({
        model: MODEL,
        schema: SuspectInvigilatorSchema,
        system: systemPrompt,
        prompt: userMessage,
        maxOutputTokens: 1024,
      })

      const usage: TokenUsage = {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }

      return { response: result.object as InvigilatorSuspectResponse, usage }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_INVIGILATOR_RETRIES) continue
    }
  }

  throw new Error(`Invigilator (suspect) failed after ${MAX_INVIGILATOR_RETRIES + 1} attempts: ${lastError?.message}`)
}

// ─── Witness evaluation ─────────────────────────────────────────────────────

export type EvaluateWitnessInput = {
  caseFile: CaseFile
  turn: number
  maxTurns: number
  playerQuestion: string
  witnessDialogue: string
  suspectClaims: Claim[]
  witnessClaims: Claim[]
}

function buildWitnessEvalMessage(input: EvaluateWitnessInput): string {
  const lines: string[] = []

  lines.push(`WITNESS INTERVIEW — QUESTION ${input.turn} OF ${input.maxTurns}`)
  lines.push('')

  lines.push('THE DETECTIVE ASKED:')
  lines.push(`"${input.playerQuestion}"`)
  lines.push('')

  lines.push('THE WITNESS RESPONDED:')
  lines.push(`"${input.witnessDialogue}"`)
  lines.push('')

  lines.push('SUSPECT\'S CLAIMS (check if the witness contradicts any):')
  lines.push(serializeLedger(input.suspectClaims))
  lines.push('')

  if (input.witnessClaims.length > 0) {
    lines.push('WITNESS\'S OWN PRIOR STATEMENTS:')
    lines.push(serializeLedger(input.witnessClaims))
  }

  return lines.join('\n')
}

export type EvaluateWitnessResult = {
  response: InvigilatorWitnessResponse
  usage: TokenUsage
}

/**
 * Evaluate one witness interrogation turn. Checks whether the witness's
 * testimony contradicts any suspect claim.
 */
export async function evaluateWitnessTurn(
  input: EvaluateWitnessInput,
): Promise<EvaluateWitnessResult> {
  const systemPrompt = buildInvigilatorSystemPrompt(input.caseFile)
  const userMessage = buildWitnessEvalMessage(input)

  let lastError: Error | null = null
  for (let attempt = 0; attempt <= MAX_INVIGILATOR_RETRIES; attempt++) {
    try {
      const result = await generateObject({
        model: MODEL,
        schema: WitnessInvigilatorSchema,
        system: systemPrompt,
        prompt: userMessage,
        maxOutputTokens: 512,
      })

      const usage: TokenUsage = {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }

      return { response: result.object as InvigilatorWitnessResponse, usage }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_INVIGILATOR_RETRIES) continue
    }
  }

  throw new Error(`Invigilator (witness) failed after ${MAX_INVIGILATOR_RETRIES + 1} attempts: ${lastError?.message}`)
}
