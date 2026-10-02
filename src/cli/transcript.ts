import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CrimeType } from '../engine/types'

export type TranscriptPhase = 'interrogation' | 'witness'

export type TranscriptExchange = {
  type: 'exchange'
  phase: TranscriptPhase
  turn: number
  detectiveMessage: string
  aiRole: 'suspect' | 'witness'
  aiMessage: string
  presentedEvidenceIds?: string[]
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

export async function createTranscriptLog(
  seed: string,
  crime: CrimeType,
  locality?: string,
): Promise<string> {
  const directory = path.resolve(process.cwd(), 'playtest-logs')
  await mkdir(directory, { recursive: true })

  const safeSeed = seed.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'case'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(
    directory,
    `${timestamp}-${safeSeed}-${process.pid}.jsonl`,
  )
  const header = {
    type: 'session',
    createdAt: new Date().toISOString(),
    seed,
    crime,
    ...(locality ? { locality } : {}),
    format: 'airtight-transcript-v1',
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

export async function appendTranscriptTurnFailed(
  filePath: string,
  turn: TranscriptTurnFailed,
  secrets: string[] = [],
): Promise<void> {
  const message = turn.error.message
    .replace(/gsk_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/xai-[A-Za-z0-9_-]+/g, '[REDACTED]')
  const redactedMessage = secrets
    .filter((secret) => secret.length > 0)
    .reduce((redacted, secret) => redacted.replaceAll(secret, '[REDACTED]'), message)
  await appendFile(
    filePath,
    `${JSON.stringify({ ...turn, error: { ...turn.error, message: redactedMessage } })}\n`,
    'utf8',
  )
}
