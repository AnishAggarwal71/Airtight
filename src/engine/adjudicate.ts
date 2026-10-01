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
 * The provider sits behind the Vercel AI SDK so swapping to OpenAI/Anthropic is
 * a one-line change (swap MODEL). — CLAUDE.md
 */

import { generateObject } from 'ai'
import { xai } from '@ai-sdk/xai'
import { z } from 'zod'
import type {
  CaseFile,
  Claim,
  DetectiveEvidence,
  SuspectResponse,
  TokenUsage,
} from './types'
import { serializeLedger } from './ledger'
import dotenv from 'dotenv'

// Self-load env — see comment in V1 adjudicate.ts. Static imports evaluate
// before the caller's dotenv.config() runs, which matters if any provider
// factory reads apiKey eagerly at import time.
dotenv.config({ path: '.env.local' })
dotenv.config()

// ─── Model ───────────────────────────────────────────────────────────────────
// Swap this one line to change provider. The rest of the file stays identical.

export const MODEL = xai('grok-4.20-reasoning')

// Other options:
// import { google } from '@ai-sdk/google'
// export const MODEL = google('gemini-3.5-flash-lite')
// import { createOpenAI } from '@ai-sdk/openai'
// const openrouter = createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY })
// export const MODEL = openrouter.chat('qwen/qwen3.8-27b:free')
// import { anthropic } from '@ai-sdk/anthropic'
// export const MODEL = anthropic('claude-haiku-4-5-20251001', { cacheControl: true })
// import { openai } from '@ai-sdk/openai'
// export const MODEL = openai('gpt-4o-mini')

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
  evidenceResponse: z.object({
    evidenceId: z.string().describe('The ID of the evidence item you are responding to'),
    strategy: z.enum(['deny', 'explain_away', 'deflect', 'partial_admit']).describe(
      'deny: flat rejection. explain_away: provide innocent explanation (use the vulnerability). ' +
      'deflect: change subject. partial_admit: concede the fact but deny the implication.',
    ),
    quality: z.number().int().min(0).max(3).describe(
      '0 = terrible lie (contradicts known facts). ' +
      '1 = weak deflection (doesn\'t address the evidence). ' +
      '2 = plausible but cracked (addresses it but leaves doubt). ' +
      '3 = airtight (exploits the vulnerability perfectly).',
    ),
  }).nullable().describe('Set ONLY when the player presented evidence this turn (PRESENT eN: question). Null otherwise.'),
  selfContradiction: z.object({
    againstClaimId: z.string().describe('Claim ID from the ledger, e.g. "c3"'),
    quotedEarlier: z.string().describe('The exact or closely paraphrased earlier claim'),
    quotedNow: z.string().describe('What you just said that contradicts it'),
    severity: z.enum(['minor', 'major']).describe(
      'minor: inconsistency in detail (times off by a bit, small discrepancy). ' +
      'major: direct contradiction of a core claim (was there vs wasn\'t, saw vs didn\'t see).',
    ),
  }).nullable().describe(
    'Flag ONLY if your dialogue this turn genuinely contradicts one of your own prior claims ' +
    'in the ledger. Be honest — the engine uses this for scoring. If in doubt, null.',
  ),
  demeanor: z.enum(['calm', 'nervous', 'defensive', 'aggressive', 'evasive']).describe(
    'Your emotional state this turn. Start calm. Shift when breaking points are hit or pressure mounts.',
  ),
  inadvertentReveal: z.boolean().describe(
    'True if your dialogue this turn accidentally reveals guilty knowledge — ' +
    'something you shouldn\'t know if innocent. Be honest. The engine checks this.',
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
  lines.push('## EVIDENCE THE DETECTIVE MAY HAVE (and how to exploit the cracks)')
  for (const e of caseFile.evidence) {
    lines.push(`  ${e.id} [${e.type}]: ${e.claim}`)
    lines.push(`    Vulnerability you can exploit: ${e.vulnerability}`)
  }
  lines.push('')
  lines.push('## ACTING RULES')
  lines.push('1. NEVER confess outright unless cornered with 3+ unexplainable contradictions AND presented evidence you cannot explain away.')
  lines.push('2. When evidence is presented: use the vulnerability to explain it away if you can. The quality of your response should honestly reflect how well you addressed it (0–3 scale).')
  lines.push('3. Maintain consistency with your cover story and ALL prior claims in the ledger. If you accidentally contradict yourself, flag it honestly in selfContradiction.')
  lines.push('4. Start calm. Only shift demeanor when a breaking point is hit or sustained pressure mounts.')
  lines.push('5. Guard guilty knowledge — deflect questions that get close. If you accidentally reveal something you shouldn\'t know, set inadvertentReveal: true.')
  lines.push('6. Never volunteer incriminating detail. Keep answers tight when the question gets dangerous.')
  lines.push('7. You may express concern about the victim, redirect to your grief, ask why you\'re being treated as a suspect — use the full range of suspect behaviour.')
  lines.push('8. Return ONLY the structured JSON matching the schema. No extra text outside the JSON.')
  lines.push('')
  lines.push('## SELF-JUDGING — THIS IS A HARD CONSTRAINT')
  lines.push('The engine scores you based on your own structured output. If you contradict a prior claim, you MUST flag it. If you reveal guilty knowledge, you MUST flag it. Lying in the metadata to protect your score defeats the purpose — the game becomes unfair. Be an honest reporter of your own performance as a liar.')
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
  presentedEvidence: DetectiveEvidence | null
  suspectClaims: Claim[]
}

function buildSuspectUserMessage(input: InterrogateSuspectInput): string {
  const lines: string[] = []

  lines.push(`INTERROGATION TURN ${input.turn} OF ${input.maxTurns}`)
  lines.push('')

  // Evidence presented this turn, if any
  if (input.presentedEvidence) {
    const e = input.presentedEvidence
    lines.push('THE DETECTIVE IS PRESENTING EVIDENCE:')
    lines.push(`  [${e.id}] (${e.type}): ${e.claim}`)
    lines.push('You must respond to this. Use the vulnerability if you can. Set evidenceResponse accordingly.')
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
 * token usage. On parse failure, returns safe defaults so the game doesn't crash.
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
      cacheCreationTokens:
        (result.providerMetadata?.google?.cachedContentTokenCount as number)
        ?? (result.providerMetadata?.anthropic?.cacheCreationInputTokens as number)
        ?? 0,
      cacheReadTokens:
        (result.providerMetadata?.google?.cachedContentTokenCount as number)
        ?? (result.providerMetadata?.anthropic?.cacheReadInputTokens as number)
        ?? 0,
    }

    return { response: result.object as SuspectResponse, usage }
  } catch (err) {
    console.error('[interrogateSuspect] Model call failed, using safe defaults:', err)
    return {
      response: {
        dialogue: 'I... I need a moment. Can you repeat that?',
        claims: [],
        evidenceResponse: null,
        selfContradiction: null,
        demeanor: 'nervous',
        inadvertentReveal: false,
      },
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    }
  }
}
