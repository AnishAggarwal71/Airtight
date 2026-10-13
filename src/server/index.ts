#!/usr/bin/env tsx
/**
 * AIRTIGHT web server entry point — boots the Express app on PORT.
 *
 * Run with: npm run server   (one-shot)  or  npm run dev   (restarts on change)
 *
 * Note: src/engine/adjudicate.ts already self-loads .env.local on import
 * (static imports evaluate before this file's own dotenv.config() runs),
 * so the calls below are redundant but harmless — kept so the API-key
 * preflight check below can run before any request hits the server,
 * mirroring the same check in src/cli/play.ts.
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { createApp } from './app'

const PORT = Number(process.env.PORT) || 3000

const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
if (!apiKey) {
  console.error('\n  Missing API key.')
  console.error('  Put your Anthropic key in .env.local as: ANTHROPIC_API_KEY=sk-ant-...\n')
  process.exit(1)
}

const app = createApp()

app.listen(PORT, () => {
  console.log(`AIRTIGHT server listening on http://localhost:${PORT}`)
})
