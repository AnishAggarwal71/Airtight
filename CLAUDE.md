# AIRTIGHT — working notes for Claude Code

An LLM-driven interrogation game. **The player is the detective.** The AI
plays a guilty suspect (and a witness) through a **Persona Agent**, while an
independent **Invigilator Agent** (LLM-as-judge) evaluates each turn with full
case context. A deterministic scoring engine converts the invigilator's
structured signals into Case Strength changes.

> **Two-machine workflow:** built on one laptop, tested on another, each with
> its own Claude Code session. This file is the shared source of truth: keep
> it current on every substantive change (architecture, invariants, file map,
> how to run or deploy) so the other machine can pick up cold. What we're
> mid-debugging belongs in conversation; settled facts belong here.

`README.md` is the public, user-facing overview. This file is the
current-state reference for working on the code.

**Status (2026-11-22): live at https://airtight-rust.vercel.app.** V3
two-agent architecture, 10 homicide templates, `npm run verify` green (19
checks). Latest eval (2026-10-25): invigilator precision 0.692, recall 0.90;
5 automated games, mean Case Strength 74. The next measurement is a 50-game
Layer 2 run.

---

## Docs index

Reasoning, dead ends and detailed results live in `docs/`. Check there before
relitigating something.

- [`docs/decisions.md`](docs/decisions.md): decision log, newest first, with a
  "Ruled out and superseded" section at the bottom.
- [`docs/eval-v3-results.md`](docs/eval-v3-results.md): latest eval numbers,
  plus the original tuning history.
- [`docs/playtest-notes.md`](docs/playtest-notes.md): **owned by the testing
  machine.** Findings land there first; this side folds settled items into
  this file or `decisions.md` and prunes them. The testing side doesn't edit
  `CLAUDE.md` or `decisions.md` directly, to avoid `git pull` collisions.
- [`docs/hardening-explained.md`](docs/hardening-explained.md): plain-language
  what/why/how per production-hardening step.
- [`docs/portfolio.md`](docs/portfolio.md): project brief.
- [`.claude/audit-checklist.md`](.claude/audit-checklist.md): PowerShell
  checklist for the Windows test machine (offline, local, live-Vercel checks).
- `DESIGN.md`: web UI spec. Code comments cite its sections.

New topic past a few paragraphs gets its own `docs/` file, indexed here.

---

## Rules of the game (non-negotiable for Phase 1)

- Score the **answer** a question provoked, not the question.
- The suspect is **always guilty**. Innocent-suspect mode is Phase 2.
- 6 suspect questions; the witness gives 2 extra, once, unlocked when Case
  Strength exceeds 50.
- **Homicide only.** Arson is removed; embezzlement is an empty placeholder.
- 4-5 evidence items per case, all shown up front, none pre-presented.
- Case Strength starts at 15, max +25 per turn. Endings: >= 80 at any point is
  `CHARGED_STRONG`; when questions run out, 50-79 is `CHARGED_WEAK`, below 50
  is `RELEASED` (detective failure, never suspect innocence). No player
  charge/release choice.

---

## Hard invariants

Break any of these and the game stops working. `npm run verify` enforces #1
and #2; run it after touching the engine or server.

1. **`generate()` stays pure.** The case is a function of the seed. No
   `Date.now()`, `Math.random()` or module-level mutable state in it.
2. **Never send a `CaseFile` to the client.** Route through `toPublicCase()`.
   The boundary is inverted from V1: evidence claims are shown; the suspect's
   strategy is hidden (`suspectPersona`, every evidence `vulnerability`, the
   witness's `personality`/`knowledgeBoundary`/`suspectContradictions`, the
   truth timeline, `fatalFact`, `crimeSummary`). **The seed is hidden too**:
   it regenerates the whole case, so it is absent from `PublicCase`,
   `BreakdownResponse`, and every response and header. `src/server/seed.ts`
   owns seed choice (crypto random, HMAC'd with `SESSION_SECRET` when set).
   Client seeds are honoured only with `ALLOW_CLIENT_SEED=1` and never on
   `VERCEL_ENV=production`. The seed is logged server-side only
   (`session_created`) for replay with `npm run case <seed> homicide`.
3. **The suspect acts; the invigilator judges; the engine scores.** All Case
   Strength arithmetic is in `SCORING_CONFIG` (`src/engine/score.ts`), never
   in a prompt. The invigilator returns signals, not deltas.
4. **Structured output only.** No prose parsing or regex over model text.
   Four Zod schemas: `SuspectResponseSchema`, `WitnessResponseSchema`,
   `SuspectInvigilatorSchema`, `WitnessInvigilatorSchema`. Small integer
   scales (0-3 for evidence quality).
5. **Feed the claim ledger, never the transcript.** Claims are compact
   records (`c` prefix suspect, `wc` witness, `src/engine/ledger.ts`). The
   invigilator cites claim IDs; `scoreSuspectTurn()` drops any cited ID that
   isn't in the ledger.

---

## Information boundaries

| Agent | Knows | Does NOT know |
|-------|-------|---------------|
| **Player** | Evidence claims, briefing, suspect/witness names | Truth timeline, vulnerabilities, persona, guilty knowledge, fatal fact |
| **Persona (suspect)** | Truth, persona, cover story, guilty knowledge, breaking points, fatal fact | What evidence the detective has, evidence vulnerabilities |
| **Invigilator** | Everything, including the full claim ledger | Nothing hidden |

The suspect's blind spot is deliberate: it must improvise when evidence is
presented, which is what makes presenting evidence a real move.

---

## Architecture

```
seed ──> generate() ──> CaseFile (server only) ──> toPublicCase() ──> player

per turn:  player question
             └─> Persona agent (adjudicate.ts / witness.ts): dialogue + claims + demeanor
                   └─> claim ledger updated
                         └─> Invigilator (invigilator.ts): structured signals
                               └─> score.ts: SCORING_CONFIG weights, claim-ID check,
                                   Case Strength, ending check
```

Two model calls per turn, 16 per full game. If the invigilator fails after
retries, the turn is zero-delta (dialogue shown, claims saved, no score
change).

---

## File map

```
src/index.ts            Vercel entry. Imports `express` itself (the Express preset
                          requires it) and default-exports createApp().
src/engine/
  types.ts              All domain types. PublicBriefing = Omit<DetectiveBriefing,
                          'crimeSummary'> strips crimeSummary from the player view.
  rng.ts                Seeded RNG (cyrb128 + sfc32).
  generate.ts           seed -> CaseFile; toPublicCase().
  ledger.ts             Claim accumulation ('c' suspect, 'wc' witness).
  adjudicate.ts         Suspect persona: prompt, SuspectResponseSchema, interrogateSuspect().
                          Exports MODEL, getModel()/setModel() (test seam), modelForApiKey().
                          The suspect prompt never includes evidence or vulnerabilities.
  witness.ts            Witness persona; uses MODEL from adjudicate.ts.
  invigilator.ts        Judge: both invigilator schemas, buildInvigilatorSystemPrompt(),
                          evaluateSuspectTurn()/evaluateWitnessTurn() with retries.
  score.ts              SCORING_CONFIG, scoreSuspectTurn(), scoreWitnessTurn(), checkEnding().
  session.ts            createSession(), playInterrogationTurn(), playWitnessTurn(),
                          isWitnessAvailable(), parsePlayerInput().
  timeouts.ts           TURN_TIMEOUTS (request 50s, persona 25s, invigilator 15s/attempt).
  templates/
    shared.ts           Template contract + name helpers (namedPerson() collision guard).
    homicide.ts         Aggregates the 10 scenarios in homicide/.
    homicide/           stairwell, allotment, night-shift, allergy, open-water, overdose,
                          lock-in, hiking-trail, smart-garage, charity-gala.
    embezzlement.ts     Empty Phase 2 placeholder.
src/server/
  index.ts              Local server (binds PORT, default 3000).
  app.ts                createApp(): JSON body limit 32kb, routes, error handler, static files.
  routes/game.ts        /api/game routes (create, read, interrogate, witness, breakdown).
  seed.ts               Seed policy + boot check (SESSION_SECRET on Vercel).
  store.ts              Store interface; MemoryStore locally, Upstash when creds are set.
  upstash-store.ts      Upstash client (Lua scripts for reserve, CAS, lock, list append).
  sessions.ts           Session envelope in the Store (sess:<uuid>, 1h TTL, rev for CAS).
  budget.ts             Spend reservation and caps.
  lock.ts               withSessionLock().
  ratelimit.ts          Per-IP rate limits.
  log.ts                One-line JSON logs with secret scrubbing (logEvent/logError).
  transcripts.ts        Redacted transcripts in Redis (tx:<sid>).
  byok.ts               Bring-your-own-key header handling.
  breakdown.ts, verdict.ts, validation.ts, errors.ts, types.ts
src/eval/               types.ts, cases.ts (18 judge cases), detective.ts (Layer 1 + Layer 2).
src/cli/
  play.ts               Terminal game with post-game breakdown.
  verify.ts             19 offline checks (see "How to run").
  inspect.ts            Dump a case (full, or --public).
  eval.ts               Eval harness CLI; writes eval-results/.
  transcript.ts         CLI JSONL transcripts (playtest-logs/).
public/
  index.html, styles.css, assets/ (room art), fonts/
  js/state.js, render.js, main.js, api.js, byok.js
                        render.js is the only module that touches the DOM.
                        state.caseFileOpen drives the case-file drawer;
                        state.revealOpen gates the outcome overlay separately
                        from phase === 'ended'.
scripts/play-stairwell.mjs   Cross-platform launcher for `npm run play:stairwell`.
```

**Imports:** every relative import ends in `.js` (`from './server/app.js'`),
even though the file is `.ts`. Vercel runs compiled JS under Node ESM, which
never guesses extensions; `tsconfig.json` uses `NodeNext` so `npm run
typecheck` rejects a missing one. Local scripts run through `tsx`, which
would hide the problem.

---

## How to run / test

No model calls (free, instant):
```bash
npm run verify                     # 19 checks: determinism, leak safety, template integrity,
                                   # coverage, variance, verdict reason, breakdown gate, seed hiding,
                                   # sessions, spend cap, turn race, rollback, rate limits,
                                   # timeouts, log hygiene, transcripts, BYOK
npm run typecheck
npm run case homicide              # full case (truth, vulnerabilities, persona)
npm run case:public homicide       # exactly what the player sees
npm run case test-seed-1 homicide  # pin a seed
```

Needs `ANTHROPIC_API_KEY` in `.env.local` (see `.env.example`):
```bash
npm run dev                        # web game, http://localhost:3000 (memory store, no Redis)
npm run play                       # terminal game
npm run play -- test-seed-1 homicide
```

**Pinning a case in the web UI:** set `ALLOW_CLIENT_SEED=1` (in `.env.local`
or inline), then open `http://localhost:3000/?seed=<seed>`;
`public/js/api.js` `createGame()` forwards the `?seed=` param, and the server
ignores it unless client seeds are allowed. You can also POST
`{"seed":"..."}` (optionally `"templateId"`) to `/api/game`. If
`SESSION_SECRET` is set locally, the stored seed is the HMAC of the one you
send, so replay the logged `session_created` seed with `npm run case`.

CLI commands: `PRESENT e3: question` (or `PRESENT e1, e3: ...`) presents
evidence; otherwise it's a plain question. `/evidence`, `/status`,
`/witness`, `/quit` (still shows the breakdown).

Eval harness (needs the key):
```bash
npm run eval                       # Layer 1: 18 invigilator accuracy cases
npm run eval -- --games 5          # Layer 1 + 5 automated games
npm run eval -- --layer2-only 50   # 50 games, ~30-45 min
```
Reports go to `eval-results/` (tracked, so the build machine can read the
test machine's runs).

**Watch for while playing:** does the invigilator catch contradictions you
notice? Miss obvious guilty-knowledge slips? Does its evidence rating (0-3)
match your read? Does Case Strength feel earned? Do em dashes appear in model
dialogue (the prompt discourages them; see `decisions.md` 2026-11-11)?

---

## Model

Anthropic Claude Haiku 4.5 (`claude-haiku-4-5`) via `@ai-sdk/anthropic`, for
all four schemas, from the one `MODEL` export in `adjudicate.ts` (swapping
model or provider is a one-line change). ~$0.05-0.06 per game. Prompt caching
is **not** a lever: Haiku 4.5's cache minimum is 4,096 tokens and the largest
system prompt is ~1,658 (`decisions.md` 2026-10-19). Token usage per session
is in `session.usage` and shown in the post-game breakdown.

---

## Deployment (Vercel) and environment

**Live:** https://airtight-rust.vercel.app, deployed from `main` (pushes to
`dev` make preview deploys if enabled). The Express app is one Vercel
Function (`src/index.ts`). Deploy facts that are easy to get wrong:

- **Framework Preset must be Express.** "Other" serves `public/` as a static
  site with no API.
- `vercel.json`: `maxDuration: 60` (the 50s turn deadline and 70s lock TTL
  assume it) and `includeFiles: "public/**"`, because `GET /` reaches Express,
  which `sendFile`s `public/index.html`.
- `package-lock.json` is gitignored, so Vercel installs from `package.json`.
  `engines.node` is `>=20.11 <25`.

Environment variables (keys live in `.env.local` locally, gitignored):

| Name | Where | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | required | server only, never sent to the client |
| `SESSION_SECRET` | required on Vercel | 32+ chars; the app refuses to boot without it |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | required on Vercel | from the Upstash Marketplace integration; `UPSTASH_REDIS_REST_URL`/`_TOKEN` also work. Without one pair the app refuses to boot on Vercel; locally it uses `MemoryStore` |
| `MAX_DAILY_SPEND_USD` | optional | default 2 |
| `TRANSCRIPTS` | optional | `off`/`0`/`false` records nothing; then remove `#transcript-notice` from `public/index.html` |
| `ALLOW_CLIENT_SEED` | dev only | never in production (ignored there anyway) |
| `PLAYTEST_LOGS_DIR` | CLI only | where `npm run play` writes JSONL (default `playtest-logs/`) |

`adjudicate.ts` and the CLI entry points self-load `.env.local` via
`dotenv.config()` at module top, because static imports evaluate before an
importing script's own `dotenv.config()` runs.

**Production hardening (steps 1-10, all done; reasoning in `decisions.md`
2026-10-23):**

| Mechanism | Where | What it does |
|---|---|---|
| Seed hiding | `seed.ts` | Server picks the seed; it never appears in a response |
| Sessions in Redis | `sessions.ts`, `store.ts` | `sess:<uuid>`, 1h TTL; each request mutates a private copy and saves only on success (so a failed turn needs no rollback) |
| Spend cap | `budget.ts` | Reserve $0.01 per turn against per-game ($0.08) and per-UTC-day counters, then settle to actual cost. Over cap: 429 before any model call. Store down: 503 (fail closed) |
| Turn lock + CAS | `lock.ts`, `sessions.ts` | `lock:<id>` (70s TTL, compare-and-delete); concurrent turn gets 409. Save is a revision compare-and-set (stale write: 409) |
| Rate limits | `ratelimit.ts` | First middleware on every route. Create 10/h, turns 40/10min (suspect + witness share), reads 120/min per IP. IP from `x-vercel-forwarded-for` only. Fails open |
| Timeouts | `engine/timeouts.ts` | One `AbortSignal` per turn, threaded through `TurnCallOptions`. Persona timeout: 504 `MODEL_TIMEOUT`, nothing saved. Invigilator timeout: zero-delta turn |
| Errors and logs | `log.ts`, `errors.ts` | Players get fixed sentences (502 `MODEL_REQUEST_FAILED`, 504 `MODEL_TIMEOUT`); provider text goes in `ApiError.cause` and is logged scrubbed (`turn_failed`, `invigilator_fallback`). Bad JSON 400, oversize 413. Never `console.*` raw strings in server code |
| Transcripts | `transcripts.ts` | Redis list `tx:<sid>`, redacted, 14-day TTL, max 200 entries, best-effort. Read with `LRANGE tx:<sid> 0 -1` in the Upstash console |
| Repo hygiene | `.gitignore` | `.env*` (except `.env.example`), `.vercel/`, `playtest-logs/` ignored |
| BYOK | `byok.ts`, `public/js/byok.js` | `X-Anthropic-Key` header, `sessionStorage` only; per-request model via `TurnCallOptions.model`; session stores only `byok: true`; skips the daily cap, keeps the per-game cap, lock and rate limits. Provider 401/403 on BYOK: 401 `INVALID_API_KEY`; on the shared key: 502. A BYOK session must resend the key every request |

Request order per turn: rate limit -> validate -> lock -> load + 409 checks
-> reserve -> run -> settle + save -> release -> respond.

---

## Design decisions already settled

- **No game database.** The case is a pure function of the seed. The web
  server stores the whole `GameSession` (including the `CaseFile` snapshot,
  so a template deploy can't change a running case) in Redis.
- **Post-game breakdown costs zero model calls.** Everything is in session
  state: truth, annotated ledgers, evidence ratings, turning point, per-turn
  reasoning, token usage.
- **One model for both agents.** Split only if the judge needs a stronger
  model.
- **Invigilator returns signals, not deltas**, and hallucinated claim IDs are
  dropped.
- **No prompt-injection defence.** Tested against a live model; contained by
  the public/private split, the schema, `escapeHtml()` and the 300-char input
  cap. Revisit only if a playtest produces a real leak.

---

## Portfolio signals

Multi-agent orchestration with different information boundaries; LLM-as-judge
against ground truth; structured-output contracts (Zod + `generateObject()`);
deterministic scoring from model-detected signals; a two-layer eval pipeline;
seeded reproducible generation; and a hardened serverless deployment (spend
caps, locking, rate limits, timeouts, log scrubbing).

---

## Open items

- **50-game Layer 2 run** (`npm run eval -- --layer2-only 50`). The 5-game
  run on 2026-10-25 gave 40% strong charges, against a 50-70% target; too
  few games to act on.
- **CLI evidence table truncates at 80 characters** (`src/cli/play.ts`). The
  web UI is unaffected.
- **Testers want more engaging evidence and scene setup** (design, not a bug).
- **Em dashes in model dialogue:** discouraged by prompt only. If they show
  up live, strip them in the response handler.
- **Transcript retention:** deployed transcripts expire after 14 days. Export
  anything worth keeping from Upstash, summarise it into `docs/`, and prune
  `playtest-logs/` on this machine at the same time.
- **Git history** still contains early `playtest-logs/` files and a work
  email on many commits. Cleaning it means a history rewrite and force-push;
  not done.
