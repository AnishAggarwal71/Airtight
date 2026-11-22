/**
 * Vercel entry point — exports the Express app as the default export, which
 * is the shape Vercel's Express support looks for (`src/index.ts`). Vercel
 * wraps the whole app as ONE function; `public/` is served by the CDN
 * directly, so `express.static` inside createApp() is inert there.
 *
 * Inputs:  env vars supplied by Vercel (ANTHROPIC_API_KEY etc.) — no dotenv
 *          here; Vercel injects them and src/engine/adjudicate.ts self-loads
 *          .env.local for local runs.
 * Outputs: the Express app (no listen() call — Vercel invokes it per request).
 *
 * Local development does NOT use this file: `npm run dev` / `npm run server`
 * run src/server/index.ts, which binds a port. `vercel dev` uses this one.
 */

// Vercel's Express preset only accepts an entry file that imports `express`
// itself (it scans this file's source and does not follow the import into
// server/app.ts). This import exists for that check; without it the build
// fails with "No entrypoint found which imports express".
import express from 'express'
import { createApp } from './server/app'

const app: ReturnType<typeof express> = createApp()
export default app
