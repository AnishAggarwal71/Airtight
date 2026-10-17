import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  CrimeType,
  Ending,
  InvigilatorSuspectResponse,
  InvigilatorWitnessResponse,
} from '../engine/types'

export type TranscriptPhase = 'interrogation' | 'witness'

/**
 * The invigilator's raw signals object for this turn (null if the
 * invigilator call failed and the turn went zero-delta) — exposing exactly
 * what score.ts consumed, so a score-vs-response audit can be done by
 * reading the transcript alone, with no engine code involved.
 */
export type TranscriptExchange = {
  type: 'exchange'
  phase: TranscriptPhase
  turn: number
  detectiveMessage: string
  aiRole: 'suspect' | 'witness'
  aiMessage: string
  presentedEvidenceIds?: string[]
  invigilatorSignals:
    | InvigilatorSuspectResponse['signals']
    | InvigilatorWitnessResponse['signals']
    | null
  caseStrengthDelta: number
  caseStrengthAfter: number
}

/** Logged once per session, after the ending resolves. */
export type TranscriptSessionEnd = {
  type: 'session_end'
  finalCaseStrength: number
  ending: Ending | null
}

export type TranscriptTurnStarted = {
  type: 'turn_started'
  phase: TranscriptPhase
  turn: number
  detectiveInput: string
  detectiveMessage: string
  aiRole: 'suspect' | 'witness'
  presentedEvidenceIds?: string[]
  rejectedEvidenceIds?: string[]
}

export type TranscriptTurnFailed = {
  type: 'turn_failed'
  phase: TranscriptPhase
  turn: number
  aiRole: 'suspect' | 'witness'
  error: { name: string; message: string }
}

/**
 * uniquifier disambiguates concurrent writers sharing one process — the CLI
 * is one process per game so process.pid is enough, but the Express server
 * is one process serving many concurrent sessions, so routes/game.ts passes
 * the session id instead.
 */
export async function createTranscriptLog(
  seed: string,
  crime: CrimeType,
  uniquifier: string = String(process.pid),
): Promise<string> {
  // PLAYTEST_LOGS_DIR lets a deployment point this at a mounted persistent
  // disk (e.g. Render/Railway/Fly volumes, which mount at a fixed path, not
  // the app's working directory) so logs survive restarts and redeploys.
  // Falls back to cwd-relative playtest-logs/ for local CLI/dev use.
  const directory = process.env.PLAYTEST_LOGS_DIR
    ? path.resolve(process.env.PLAYTEST_LOGS_DIR)
    : path.resolve(process.cwd(), 'playtest-logs')
  await mkdir(directory, { recursive: true })

  const safeSeed = seed.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'case'
  const safeUniquifier = uniquifier.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(
    directory,
    `${timestamp}-${safeSeed}-${safeUniquifier}.jsonl`,
  )
  const header = {
    type: 'session',
    createdAt: new Date().toISOString(),
    seed,
    crime,
    format: 'airtight-transcript-v3',
  }

  await writeFile(filePath, `${JSON.stringify(header)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })
  return filePath
}

export async function appendTranscriptExchange(
  filePath: string,
  exchange: TranscriptExchange,
): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(exchange)}\n`, 'utf8')
}

export async function appendTranscriptTurnStarted(
  filePath: string,
  turn: TranscriptTurnStarted,
): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(turn)}\n`, 'utf8')
}

export async function appendTranscriptSessionEnd(
  filePath: string,
  sessionEnd: TranscriptSessionEnd,
): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(sessionEnd)}\n`, 'utf8')
}

export async function appendTranscriptTurnFailed(
  filePath: string,
  turn: TranscriptTurnFailed,
  secrets: string[] = [],
): Promise<void> {
  const message = turn.error.message
    .replace(/gsk_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/xai-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]')
  const redactedMessage = secrets
    .filter((secret) => secret.length > 0)
    .reduce((redacted, secret) => redacted.replaceAll(secret, '[REDACTED]'), message)
  await appendFile(
    filePath,
    `${JSON.stringify({ ...turn, error: { ...turn.error, message: redactedMessage } })}\n`,
    'utf8',
  )
}
