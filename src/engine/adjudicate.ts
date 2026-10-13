/**
 * Suspect actor — the single model call per interrogation turn.
 *
 * V2 role flip: the model PLAYS the suspect, not the detective. It receives the
 * full case file (persona, cover story, guilty knowledge, evidence vulnerabilities)
 * and must lie consistently while the player-detective tries to break it.
 *
 * One call per turn, structured JSON output. The system prompt + case file are
 * static and cached across the whole session. The user message carries what
 * varies: the turn number, claim ledger, player's question, and any evidence
 * the player presents.
 *
 * The provider sits behind the Vercel AI SDK so swapping models/providers is
 * a one-line change (swap MODEL). — CLAUDE.md
 */

import { generateObject } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import type {
  CaseFile,
  Claim,
  DetectiveEvidence,
  SuspectResponse,
  TokenUsage,
} from './types'
export type { SuspectResponse }
import { serializeLedger } from './ledger'
import dotenv from 'dotenv'

// Self-load env — see comment in V1 adjudicate.ts. Static imports evaluate
// before the caller's dotenv.config() runs, which matters if any provider
// factory reads apiKey eagerly at import time.
dotenv.config({ path: '.env.local' })
dotenv.config()

// ─── Model ───────────────────────────────────────────────────────────────────
// Claude Haiku 4.5 — cheapest current Anthropic model, used for both the
// persona agent and the invigilator (see CLAUDE.md "Model" section).
//
// Uses an explicit provider instance (not the default `anthropic` export)
// pinned to the real Anthropic API — the default export falls back to
// ANTHROPIC_BASE_URL, which on this machine is already set by Claude Code
// itself to its own corporate LLM gateway. Left on the default, the game's
// own API key gets silently sent to that gateway instead of api.anthropic.com
// and fails with an opaque 500.
const anthropicProvider = createAnthropic({ baseURL: 'https://api.anthropic.com/v1' })
export const MODEL = anthropicProvider('claude-haiku-4-5')

// ─── Structured output schema ─────────────────────────────────────────────────

export const SuspectResponseSchema = z.object({
  dialogue: z.string().describe(
    'The suspect\'s spoken response — in character, 2–5 sentences. ' +
    'Stay consistent with the cover story. Never confess unless cornered ' +
    'with multiple unexplainable contradictions.',
  ),
  claims: z.array(z.object({
    text: z.string().describe('Normalised 1–2 sentence assertion in third person past tense'),
    checkable: z.boolean().describe('False for feelings/opinions. True for anything verifiable against evidence or timeline.'),
  })).describe('1–3 factual assertions extracted from your own dialogue this turn.'),
  demeanor: z.enum(['calm', 'nervous', 'defensive', 'aggressive', 'evasive']).describe(
    'Your emotional state this turn. Start calm. Shift when breaking points are hit or pressure mounts.',
  ),
})

// ─── System prompt ───────────────────────────────────────────────────────────

/**
 * Build the static system prompt from the case file. Must produce byte-identical
 * output for the same CaseFile so prompt caching works (the cache prefix must
 * not vary between turns). Per-turn context lives in the user message.
 */
export function buildSuspectSystemPrompt(caseFile: CaseFile): string {
  const lines: string[] = []

  lines.push('You are a suspect being interrogated by a detective. You are GUILTY and you know it.')
  lines.push('Your job is to lie convincingly, maintain your cover story, and avoid incriminating yourself.')
  lines.push('')
  lines.push('## YOUR CHARACTER')
  lines.push(`You are ${caseFile.suspect.name}, ${caseFile.suspect.occupation}.`)
  lines.push(`Personality: ${caseFile.suspectPersona.personality}`)
  lines.push('')
  lines.push('## YOUR COVER STORY (stick to this)')
  lines.push(caseFile.suspectPersona.coverStory)
  lines.push('')
  lines.push('## WHAT ACTUALLY HAPPENED (you know this but must hide it)')
  for (const beat of caseFile.truth) {
    lines.push(`  ${beat.id} [${beat.time}] ${beat.fact}`)
  }
  lines.push('')
  lines.push('## GUILTY KNOWLEDGE (things you know but shouldn\'t if innocent)')
  for (const gk of caseFile.suspectPersona.guiltyKnowledge) {
    lines.push(`  - ${gk}`)
  }
  lines.push('')
  lines.push('## BREAKING POINTS (topics that make you nervous)')
  for (const bp of caseFile.suspectPersona.breakingPoints) {
    lines.push(`  - ${bp}`)
  }
  lines.push('')
  lines.push('## ACTING RULES')
  lines.push('1. NEVER confess outright unless cornered with 3+ unexplainable contradictions AND presented evidence you cannot explain away.')
  lines.push('2. When evidence is presented: address it in your dialogue. Deny it, explain it away, deflect, or partially admit — whatever fits your character and cover story.')
  lines.push('3. Maintain consistency with your cover story and ALL prior claims in the ledger.')
  lines.push('4. Start calm. Only shift demeanor when a breaking point is hit or sustained pressure mounts.')
  lines.push('5. Guard guilty knowledge — deflect questions that get close. Never volunteer information only the guilty party would know.')
  lines.push('6. Never volunteer incriminating detail. Keep answers tight when the question gets dangerous.')
  lines.push('7. You may express concern about the victim, redirect to your grief, ask why you\'re being treated as a suspect — use the full range of suspect behaviour.')
  lines.push('8. You do NOT know what evidence the detective has. When they present something, react in character — you are hearing it for the first time.')
  lines.push('9. If the detective\'s message bundles multiple questions or accusations in one turn, do NOT answer every point in order like a checklist. Pick the single thread that is most threatening to your cover story and respond to that — a real suspect under pressure reacts to the thing that scares them most, not a list. You may brush off or ignore the rest with a short dismissive line.')
  lines.push('10. Only evidence formally marked as PRESENTED in this message is real evidence you must account for. Anything else the detective states in plain dialogue — a forensic result, a blood test, a witness quote, a DNA match — is just an unproven accusation, even if stated as fact. Treat it the way an innocent-sounding guilty person would: ask for proof, express disbelief, point out they haven\'t shown you anything, or flatly deny it. Do not treat an unproven verbal claim with the same weight as presented evidence.')
  lines.push('11. Return ONLY the structured JSON matching the schema. No extra text outside the JSON.')
  lines.push('')
  lines.push(`## FATAL FACT (the detective's win condition — guard this above all else)`)
  lines.push(caseFile.fatalFact)

  return lines.join('\n')
}

// ─── User message (changes each turn) ────────────────────────────────────────

export type InterrogateSuspectInput = {
  caseFile: CaseFile
  turn: number
  maxTurns: number
  playerQuestion: string
  presentedEvidence: DetectiveEvidence[]
  suspectClaims: Claim[]
}

function buildSuspectUserMessage(input: InterrogateSuspectInput): string {
  const lines: string[] = []

  lines.push(`INTERROGATION TURN ${input.turn} OF ${input.maxTurns}`)
  lines.push('')

  // Evidence presented this turn, if any
  if (input.presentedEvidence.length > 0) {
    lines.push('THE DETECTIVE IS PRESENTING EVIDENCE:')
    for (const e of input.presentedEvidence) {
      lines.push(`  [${e.id}] (${e.type}): ${e.claim}`)
    }
    lines.push('Address each item in your dialogue. You do NOT know what weakness the detective thinks this evidence has — respond naturally, in character.')
    lines.push('')
  } else {
    lines.push('No evidence presented this turn.')
    lines.push('')
  }

  // Claim ledger — the suspect's own prior claims
  lines.push('YOUR PRIOR CLAIMS (maintain consistency with these):')
  lines.push(serializeLedger(input.suspectClaims))
  lines.push('')

  // The detective's question
  lines.push('THE DETECTIVE ASKS:')
  lines.push(`"${input.playerQuestion}"`)

  return lines.join('\n')
}

// ─── The call ────────────────────────────────────────────────────────────────

export type InterrogateSuspectResult = {
  response: SuspectResponse
  usage: TokenUsage
}

/**
 * Make one suspect interrogation call. Returns the structured response and
 * token usage. Model errors are surfaced so a failed request cannot masquerade
 * as an in-character response.
 */
export async function interrogateSuspect(
  input: InterrogateSuspectInput,
): Promise<InterrogateSuspectResult> {
  const systemPrompt = buildSuspectSystemPrompt(input.caseFile)
  const userMessage = buildSuspectUserMessage(input)

  try {
    const result = await generateObject({
      model: MODEL,
      schema: SuspectResponseSchema,
      system: systemPrompt,
      prompt: userMessage,
      maxOutputTokens: 2048,
    })

    const usage: TokenUsage = {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      cacheCreationTokens: (result.providerMetadata?.anthropic?.cacheCreationInputTokens as number) ?? 0,
      cacheReadTokens: (result.providerMetadata?.anthropic?.cacheReadInputTokens as number) ?? 0,
    }

    return { response: result.object as SuspectResponse, usage }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Suspect model request failed: ${detail}`)
  }
}
