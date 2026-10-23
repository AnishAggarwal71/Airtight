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

import { createApp } from './server/app'

export default createApp()
