/**
 * Witness interrogation — a separate model call from the suspect actor.
 *
 * The witness is a different persona with their own personality, limited
 * knowledge, and — crucially — the ability to contradict the suspect's
 * prior claims. The player gets up to 2 questions with the witness after
 * the main interrogation phase.
 *
 * Same Vercel AI SDK + Zod structured output pattern as adjudicate.ts.
 * Imports MODEL from adjudicate.ts so the provider is swapped in one place.
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { MODEL } from './adjudicate'
import type {
  CaseFile,
  Claim,
  TokenUsage,
  WitnessResponse,
} from './types'
import { serializeLedger } from './ledger'

// ─── Structured output schema ─────────────────────────────────────────────────

export const WitnessResponseSchema = z.object({
  dialogue: z.string().describe(
    'The witness\'s spoken response — in character, 2–4 sentences. ' +
    'Stay within your knowledge boundary. Don\'t speculate beyond what you know.',
  ),
  claims: z.array(z.object({
    text: z.string().describe('Normalised 1–2 sentence assertion in third person past tense'),
    checkable: z.boolean().describe('False for feelings/opinions. True for anything verifiable.'),
  })).describe('1–2 factual assertions from this response.'),
  suspectContradiction: z.object({
    againstClaimId: z.string().describe('Suspect claim ID from the ledger that your testimony contradicts'),
    witnessVersion: z.string().describe('What you (the witness) say happened'),
    suspectVersion: z.string().describe('What the suspect claimed (from the ledger)'),
  }).nullable().describe(
    'Set ONLY if your honest testimony directly contradicts something the suspect ' +
    'claimed in the ledger. Null if nothing contradicts.',
  ),
  demeanor: z.enum(['cooperative', 'reluctant', 'nervous', 'confused']).describe(
    'Your emotional state. Most witnesses are cooperative or nervous.',
  ),
})

// ─── System prompt ───────────────────────────────────────────────────────────

/**
 * Build the static witness system prompt from the case file. Like the suspect
 * prompt, this is cached across the witness phase (2 turns max).
 */
export function buildWitnessSystemPrompt(caseFile: CaseFile): string {
  const w = caseFile.witness
  const lines: string[] = []

  lines.push(`You are ${w.name}, ${w.relationship}. You are being questioned by a detective about a ${caseFile.crime} case.`)
  lines.push('')
  lines.push('## YOUR CHARACTER')
  lines.push(`Personality: ${w.personality}`)
  lines.push('')
  lines.push('## WHAT YOU ACTUALLY KNOW')
  lines.push(w.knowledgeBoundary)
  lines.push('')
  lines.push('## WHERE THE SUSPECT\'S STORY DOESN\'T MATCH WHAT YOU KNOW')
  for (const c of w.suspectContradictions) {
    lines.push(`  - ${c}`)
  }
  lines.push('')
  lines.push('## RULES')
  lines.push('1. Answer honestly based on what you know. You are not the suspect — you have no reason to lie (though you may be nervous or reluctant).')
  lines.push('2. Stay within your knowledge boundary. If asked something you don\'t know, say so. Don\'t fabricate details.')
  lines.push('3. If the detective asks about something where your knowledge contradicts the suspect\'s claims, answer honestly — this will naturally create the contradiction.')
  lines.push('4. Don\'t volunteer information the detective hasn\'t asked about. Be responsive, not proactive.')
  lines.push('5. If you would contradict a suspect claim, flag it in suspectContradiction with the specific claim ID.')
  lines.push('6. Return ONLY the structured JSON matching the schema. No extra text outside the JSON.')
  lines.push('')
  lines.push('## CASE CONTEXT')
  lines.push(`Suspect: ${caseFile.suspect.name}`)
  lines.push(`Victim: ${caseFile.victim.name} — ${caseFile.victim.relationship}`)
  lines.push(`Location: ${caseFile.location}`)

  return lines.join('\n')
}

// ─── User message ────────────────────────────────────────────────────────────

export type InterrogateWitnessInput = {
  caseFile: CaseFile
  turn: number
  maxTurns: number
  playerQuestion: string
  /** The suspect's claims so far — the witness can contradict these. */
  suspectClaims: Claim[]
  /** The witness's own prior claims (from turn 1, if this is turn 2). */
  witnessClaims: Claim[]
}

function buildWitnessUserMessage(input: InterrogateWitnessInput): string {
  const lines: string[] = []

  lines.push(`WITNESS INTERVIEW — QUESTION ${input.turn} OF ${input.maxTurns}`)
  lines.push('')

  // Suspect's claims — the witness can contradict these
  lines.push('WHAT THE SUSPECT HAS CLAIMED SO FAR:')
  lines.push(serializeLedger(input.suspectClaims))
  lines.push('')

  // Witness's own prior claims (for consistency in turn 2)
  if (input.witnessClaims.length > 0) {
    lines.push('YOUR OWN PRIOR STATEMENTS:')
    lines.push(serializeLedger(input.witnessClaims))
    lines.push('')
  }

  // The detective's question
  lines.push('THE DETECTIVE ASKS:')
  lines.push(`"${input.playerQuestion}"`)

  return lines.join('\n')
}

// ─── The call ────────────────────────────────────────────────────────────────

export type InterrogateWitnessResult = {
  response: WitnessResponse
  usage: TokenUsage
}

/**
 * Make one witness interrogation call. Returns the structured response and
 * token usage. Model errors are surfaced so a failed request cannot masquerade
 * as an in-character response.
 */
export async function interrogateWitness(
  input: InterrogateWitnessInput,
): Promise<InterrogateWitnessResult> {
  const systemPrompt = buildWitnessSystemPrompt(input.caseFile)
  const userMessage = buildWitnessUserMessage(input)

  try {
    const result = await generateObject({
      model: MODEL,
      schema: WitnessResponseSchema,
      system: systemPrompt,
      prompt: userMessage,
      maxOutputTokens: 1024,
    })

    const usage: TokenUsage = {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      cacheCreationTokens:
        (result.providerMetadata?.google?.cachedContentTokenCount as number)
        ?? (result.providerMetadata?.anthropic?.cacheCreationInputTokens as number)
        ?? 0,
      cacheReadTokens:
        (result.providerMetadata?.google?.cachedContentTokenCount as number)
        ?? (result.providerMetadata?.anthropic?.cacheReadInputTokens as number)
        ?? 0,
    }

    return { response: result.object as WitnessResponse, usage }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Witness model request failed: ${detail}`)
  }
}
