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
import { getModel } from './adjudicate'
import { capSignal, resolveTimeouts, type TurnCallOptions } from './timeouts'
import { serializeLedger } from './ledger'
import type {
  CaseFile,
  Claim,
  DetectiveEvidence,
  InvigilatorSuspectResponse,
  InvigilatorWitnessResponse,
  SuspectResponse,
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
        'minor: a detail is off (a time, a sequence, a minor fact) but the suspect\'s overall ' +
        'account of what happened is still intact. ' +
        'major: the suspect\'s new statement makes their PRIOR claim impossible to be true — not ' +
        'just inconsistent in flavor, but logically incompatible. If a prior claim and the new ' +
        'statement could BOTH be true with a charitable reading (vague phrasing, a different but ' +
        'compatible way of describing the same event), it is NOT a contradiction at all — do not ' +
        'flag it, not even as minor.',
      ),
    })).describe(
      'All contradictions between this turn\'s dialogue and prior claims. Empty array if none. ' +
      'One admission can only break the SINGLE prior claim it most directly contradicts — do not ' +
      'also flag other claims that are merely adjacent or related to the same topic. For example, ' +
      'admitting "we argued about money" contradicts a specific prior claim that money was not ' +
      'discussed, but it does NOT also separately contradict a general claim like "it was a friendly ' +
      'visit" or "we had a good relationship" — those are opinions/framing, not separate factual breaks.',
    ),
    guiltyKnowledgeLeak: z.object({
      description: z.string().describe('What was leaked and why only the guilty party would know this'),
    }).nullable().describe(
      'Non-null ONLY if the suspect revealed something they shouldn\'t know if innocent. ' +
      'Examples: mentioning the murder weapon before the detective did, knowing where the body ' +
      'was found, referencing details only the killer would have. A leak requires a SPECIFIC fact ' +
      'that was never stated by the detective, never visible in evidence claims the detective ' +
      'presented, and that an innocent person constructing an alibi would have no way to guess ' +
      'correctly. Generic or vague references to the scene/victim that could be inferred from ' +
      'common sense or from what the detective has already said out loud this game are NOT leaks. ' +
      'Null if nothing leaked.',
    ),
    evidenceHandling: z.array(z.object({
      evidenceId: z.string().describe('The evidence item ID'),
      quality: z.number().int().min(0).max(3).describe(
        '0 = terrible (contradicts known facts, makes it worse). ' +
        '1 = weak (doesn\'t address the evidence, obvious deflection). ' +
        '2 = plausible but cracked (addresses it but leaves doubt). ' +
        '3 = airtight (provides a convincing innocent explanation). ' +
        'Example: flatly denying the evidence exists is quality 1. Offering an explanation that ' +
        'technically accounts for the evidence but requires an unlikely coincidence is quality 2.',
      ),
      description: z.string().describe('How the suspect handled this evidence and why you gave this rating'),
    })).describe('One entry per evidence item presented this turn. Empty array if none presented.'),
    demeanorShift: z.boolean().describe(
      'True ONLY if the suspect\'s emotional state this turn is actually different from their ' +
      'PREVIOUS DEMEANOR given below — e.g. previous was "calm" and this turn reads nervous or ' +
      'defensive. False if demeanor is the same as previous, even under pressure — composed ' +
      'hedging or a calm admission is not a shift. There is no prior turn to compare against ' +
      'on turn 1, so this must be false on turn 1.',
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
  lines.push('3. A contradiction means the suspect said something NOW that conflicts with a SPECIFIC prior claim in the ledger. Quote the claim ID. One admission breaks at most one claim — the single most specific one it conflicts with — never a whole cluster of loosely related claims.')
  lines.push('3b. Before flagging any contradiction, state the exact two statements in tension in your reasoning field. If you cannot quote both sides precisely, you are inferring a contradiction that isn\'t there — do not flag it.')
  lines.push('4. A guilty knowledge leak means the suspect mentioned something only the killer would know — something the detective has not revealed. Be strict: if the detective asked about it first, it\'s not a leak.')
  lines.push('5. Evidence handling quality: how well did the suspect address each presented item? Did they provide a convincing innocent explanation, or did they fumble?')
  lines.push('6. Demeanor shift: compare this turn\'s demeanor to the PREVIOUS DEMEANOR given in the user message — only true if it actually changed. A calm admission is not a shift. False on turn 1 always.')
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
  previousDemeanor: SuspectResponse['demeanor'] | null
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

  lines.push(
    `PREVIOUS DEMEANOR (for demeanorShift comparison): ${input.previousDemeanor ?? 'none — this is turn 1'}`,
  )
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
 * Thrown when every invigilator attempt failed. Carries how many attempts were
 * made (the request deadline can cut the retries short) so the caller can log
 * it; the original error is kept as `cause`.
 */
export class InvigilatorError extends Error {
  attempts: number
  constructor(kind: 'suspect' | 'witness', attempts: number, cause: Error | null) {
    super(`Invigilator (${kind}) failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${cause?.message}`, { cause })
    this.name = 'InvigilatorError'
    this.attempts = attempts
  }
}

/**
 * Evaluate one suspect interrogation turn. The invigilator sees the full
 * context and returns structured signals for the scoring engine.
 *
 * `opts` (optional): each attempt is capped at `invigilatorAttemptMs`, and the
 * request-wide abort signal also stops further retries (an aborted deadline
 * means every remaining attempt would fail instantly anyway).
 */
export async function evaluateSuspectTurn(
  input: EvaluateSuspectInput,
  opts: TurnCallOptions = {},
): Promise<EvaluateSuspectResult> {
  const systemPrompt = buildInvigilatorSystemPrompt(input.caseFile)
  const userMessage = buildSuspectEvalMessage(input)

  let lastError: Error | null = null
  let attempts = 0
  for (let attempt = 0; attempt <= MAX_INVIGILATOR_RETRIES; attempt++) {
    attempts++
    try {
      const result = await generateObject({
        model: getModel(),
        schema: SuspectInvigilatorSchema,
        system: systemPrompt,
        prompt: userMessage,
        maxOutputTokens: 1024,
        abortSignal: capSignal(opts.abortSignal, resolveTimeouts(opts.timeouts).invigilatorAttemptMs),
      })

      const usage: TokenUsage = {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        cacheCreationTokens: (result.providerMetadata?.anthropic?.cacheCreationInputTokens as number) ?? 0,
        cacheReadTokens: (result.providerMetadata?.anthropic?.cacheReadInputTokens as number) ?? 0,
      }

      return { response: result.object as InvigilatorSuspectResponse, usage }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (opts.abortSignal?.aborted) break // request deadline hit: more attempts cannot succeed
      if (attempt < MAX_INVIGILATOR_RETRIES) continue
    }
  }

  throw new InvigilatorError('suspect', attempts, lastError)
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
 * testimony contradicts any suspect claim. `opts` works as in evaluateSuspectTurn.
 */
export async function evaluateWitnessTurn(
  input: EvaluateWitnessInput,
  opts: TurnCallOptions = {},
): Promise<EvaluateWitnessResult> {
  const systemPrompt = buildInvigilatorSystemPrompt(input.caseFile)
  const userMessage = buildWitnessEvalMessage(input)

  let lastError: Error | null = null
  let attempts = 0
  for (let attempt = 0; attempt <= MAX_INVIGILATOR_RETRIES; attempt++) {
    attempts++
    try {
      const result = await generateObject({
        model: getModel(),
        schema: WitnessInvigilatorSchema,
        system: systemPrompt,
        prompt: userMessage,
        maxOutputTokens: 512,
        abortSignal: capSignal(opts.abortSignal, resolveTimeouts(opts.timeouts).invigilatorAttemptMs),
      })

      const usage: TokenUsage = {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        cacheCreationTokens: (result.providerMetadata?.anthropic?.cacheCreationInputTokens as number) ?? 0,
        cacheReadTokens: (result.providerMetadata?.anthropic?.cacheReadInputTokens as number) ?? 0,
      }

      return { response: result.object as InvigilatorWitnessResponse, usage }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (opts.abortSignal?.aborted) break // request deadline hit: more attempts cannot succeed
      if (attempt < MAX_INVIGILATOR_RETRIES) continue
    }
  }

  throw new InvigilatorError('witness', attempts, lastError)
}
