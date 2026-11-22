# AIRTIGHT: technical breakdown

How the system works, end to end, for an engineer reading the code for the
first time. For the reasoning behind each choice see
[`decisions.md`](decisions.md); for the plain-language version of the
production work see [`hardening-explained.md`](hardening-explained.md).

Live at https://airtight-rust.vercel.app. Stack: TypeScript (Node ESM),
Express, Vercel AI SDK (`generateObject` + Zod), Anthropic Claude Haiku 4.5,
Upstash Redis, Vercel Functions, vanilla JS front end.

---

## 1. System overview

```
                  ┌──────────── browser (public/) ────────────┐
                  │ state.js → render.js (only DOM writer)    │
                  │ api.js → fetch /api/game/*  (+BYOK header)│
                  └───────────────────┬───────────────────────┘
                                      │ JSON
┌─────────────────────────────────────▼──────────────────────────────────────┐
│ Vercel Function: src/index.ts → createApp() (src/server/app.ts)            │
│                                                                            │
│  rateLimit → validate → withSessionLock → load → reserve spend             │
│         → engine turn (2 model calls) → settle + save (CAS) → respond      │
│                                                                            │
│  src/server/*: seed, sessions, budget, lock, ratelimit, log, transcripts,  │
│                byok, verdict, breakdown                                    │
└──────────┬──────────────────────────────────────────────┬──────────────────┘
           │ pure engine (src/engine/*)                   │ Store interface
┌──────────▼────────────────────────┐        ┌────────────▼────────────────┐
│ generate(seed) → CaseFile         │        │ Upstash Redis (Vercel)      │
│ persona agent  → dialogue+claims  │        │ MemoryStore (local)         │
│ ledger         → claim records    │        │ sess:, spend:, lock:, rl:,  │
│ invigilator    → signals          │        │ tx:                         │
│ score          → Case Strength    │        └─────────────────────────────┘
└──────────┬────────────────────────┘
           │ @ai-sdk/anthropic
     Claude Haiku 4.5
```

Three layers with a strict dependency direction: the **engine** knows nothing
about HTTP or Redis; the **server** knows nothing about prompts or scoring
weights; the **browser** only ever sees the public projection of a case.

---

## 2. Case generation

**Entry:** `generate({ seed, crime, templateId? })` in `src/engine/generate.ts`.

- **RNG.** `src/engine/rng.ts` hashes the string `${seed}::${crime}` with
  `cyrb128` into four 32-bit words that seed an `sfc32` generator. Every
  random choice in generation draws from this one stream, in a fixed order.
- **Template.** `r.pick()` chooses one of the 10 homicide templates
  (`src/engine/templates/homicide/*.ts`), or the pinned `templateId`. Each
  template exports a `build(r, detective)` that fills slots (names, times,
  places, amounts, method details) from the same RNG and returns the truth
  timeline, evidence, witness, persona, fatal fact and briefing.
- **Purity is load-bearing.** No `Date.now()`, `Math.random()` or
  module-level mutable state. The same seed must give a byte-identical
  `CaseFile` forever: it is what makes the CLI replayable, the eval harness
  meaningful, and logged seeds useful for debugging. `verify` check 1 runs 40
  seed/crime pairs twice and compares.
- **Names.** `namedPerson(r, exclude)` in `templates/shared.ts` redraws up to
  5 times to avoid collisions with names already used in the case.

### The `CaseFile`

| Field | Player sees? | Used by |
|---|---|---|
| `title`, `suspect`, `victim`, `location`, `window` | yes | all |
| `detectiveBriefing` (minus `crimeSummary`) | yes | player |
| `evidence[].{id,type,claim,presented}` | yes | player, persona (only when presented), invigilator |
| `evidence[].vulnerability`, `linkedBeats` | **no** | invigilator only |
| `truth` (timeline beats) | **no** (breakdown only) | persona, invigilator |
| `suspectPersona` (personality, cover story, breaking points, guilty knowledge) | **no** | persona, invigilator |
| `witness.{personality, knowledgeBoundary, suspectContradictions}` | **no** | witness persona, invigilator |
| `fatalFact` | **no** (breakdown only) | persona, invigilator |
| `seed` | **never** | server only |

`toPublicCase()` builds the player view by explicit destructuring (an
allow-list, not a deny-list), and `PublicBriefing = Omit<DetectiveBriefing,
'crimeSummary'>` makes the omission a type error to undo. `verify` check 4
asserts every hidden field is absent.

---

## 3. One turn, step by step

`playInterrogationTurn(session, rawInput, config, callOpts)` in
`src/engine/session.ts`:

1. **Advance state.** `phase` returns to `'interrogation'` (unless the game
   has ended), `interrogationTurn++`.
2. **Parse input.** `parsePlayerInput()` splits `PRESENT e1, e3: question`
   into presented IDs, rejected IDs (unknown or already presented) and the
   question text. Presented items are marked `presented = true`.
3. **Call 1: persona agent** (`interrogateSuspect()`, `adjudicate.ts`).
   - System prompt: truth, persona, cover story, guilty knowledge, breaking
     points, fatal fact, acting rules. **No evidence and no vulnerabilities.**
   - User message: the turn number, the question, the claim ledger so far,
     and, only if presented this turn, each evidence item's *claim* (never
     its vulnerability).
   - Output (Zod `SuspectResponseSchema`): `dialogue` (2-5 sentences),
     `claims` (1-3 normalised third-person assertions with a `checkable`
     flag), `demeanor` (enum of five).
4. **Ledger.** `addClaims()` appends the new claims with sequential IDs
   (`c1`, `c2`, ...; the witness uses `wc`).
5. **Call 2: invigilator** (`evaluateSuspectTurn()`, `invigilator.ts`).
   - System prompt: everything, including evidence vulnerabilities.
   - User message: the question, the dialogue, presented evidence, the full
     ledger, and the **previous turn's demeanor** (so "shift" has a baseline;
     it is forced false on turn 1).
   - Output (`SuspectInvigilatorSchema`): `reasoning` plus `signals`:
     `contradictions[]` (`againstClaimId`, `severity: minor|major`),
     `guiltyKnowledgeLeak` (nullable), `evidenceHandling[]` (`quality` 0-3
     per presented item), `demeanorShift` (boolean).
   - Up to 3 attempts (`MAX_INVIGILATOR_RETRIES = 2`). If all fail, the
     engine throws `InvigilatorError(attempts)` internally, reports it via
     `callOpts.onInvigilatorFailure`, and the turn continues with **zero
     delta**.
6. **Score.** `scoreSuspectTurn()` (section 4).
7. **Ending.** `checkEnding()` (section 5).
8. **Record.** An `InterrogationDetail` (question, evidence, both model
   responses, Case Strength before and after) is pushed for the breakdown.

A witness turn (`playWitnessTurn()`, `witness.ts`) follows the same shape:
the witness persona knows only its `knowledgeBoundary` and answers honestly;
the invigilator returns one nullable `suspectContradiction` against a
suspect claim ID.

**Why the persona is blind to evidence:** if the suspect sees each item's
weakness in advance, it pre-computes a perfect deflection and presenting
evidence stops mattering. Blind, it must improvise, and improvisation is
where contradictions and slips come from.

**Why two calls:** in V2 one call both acted and reported its own slips. It
never reported any, so Case Strength never moved. Acting and judging are now
separate calls with different information.

---

## 4. Scoring

All weights are in `SCORING_CONFIG` (`src/engine/score.ts`):

| Signal | Points |
|---|---|
| Major contradiction (per claim) | +20 |
| Minor contradiction (per claim) | +8 |
| Guilty-knowledge leak | +15 |
| Evidence quality 0 / 1 / 2 / 3 | +12 / +8 / +3 / 0 (averaged across items presented that turn) |
| Demeanor shift | +3 |
| Witness contradicts a suspect claim | +10 |
| Per-turn cap (`maxTurnDelta`) | ±25 |
| Start / floor / ceiling | 15 / 0 / 100 |

`scoreSuspectTurn()`:

1. Builds a set of real claim IDs from the ledger. A contradiction citing an
   ID **not in the ledger is silently dropped**, so a hallucinated reference
   cannot add points.
2. Sums contradictions, the rounded mean of evidence-quality points, the leak
   and the shift.
3. Clamps the delta to ±25, then clamps Case Strength to 0-100.

`scoreWitnessTurn()` does the same for the single witness signal (also
clamped, so the two paths can't drift apart if a weight changes).

The model never produces a number that is added to the score. It produces
named findings; code turns them into points. Difficulty is a config change.

---

## 5. Game state and endings

`GameSession` (`src/engine/types.ts`) holds the `CaseFile` snapshot, turn
counters, `witnessUsed`, both claim ledgers, Case Strength and its history,
the ending, accumulated `usage`, and the per-turn details.

- **Witness gate:** `isWitnessAvailable()` is true when Case Strength exceeds
  `witnessUnlockThreshold` (50) and the witness hasn't been opened, or while
  an opened session still has a question left. Once opened, `witnessUsed`
  can never reset.
- **Endings:** `checkEnding()` returns `CHARGED_STRONG` the moment Case
  Strength reaches 80. Otherwise it waits for exhaustion (6 suspect turns,
  plus both witness turns if the witness was opened): >= 50 is
  `CHARGED_WEAK`, below is `RELEASED`. Mid-game it returns `null`.

---

## 6. The HTTP API

`src/server/routes/game.ts`, mounted at `/api/game`:

| Route | Rate bucket | What it does |
|---|---|---|
| `POST /` | create (10/h) | Choose seed, `createSession()`, store, return `toPublicCase()` + state. BYOK creates skip the daily-capacity check |
| `GET /:id` | read (120/min) | Rehydrate after a reload |
| `POST /:id/interrogate` | turn (40/10min, shared) | One suspect turn |
| `POST /:id/witness` | turn (shared) | One witness turn; 409 if locked or used |
| `GET /:id/breakdown` | read | Post-game breakdown; **409 until the game has ended** |

Unknown `/api/*` routes return a JSON 404; body-parser errors are 400
`BAD_REQUEST` / 413 `PAYLOAD_TOO_LARGE` (32 KB limit); anything unhandled is
a generic 500 `INTERNAL` with the cause logged.

### Request pipeline for a turn

```
rateLimit('turn')              first: a throttled request costs nothing
validateQuestionInput          ≤ 300 chars
withSessionLock(sid)           SET lock:<sid> NX PX 70000; else 409
  requireSession               load sess:<sid> (private copy); 404 if gone
  phase / turn / witness checks → 409
  readApiKey (BYOK sessions)   missing or malformed → 401, no reservation
  reserveSpend                 $0.01 against session + day counters; else 429
  recordTranscript(turn_started)
  engine turn with AbortSignal (50s deadline)
    on persona failure: settle the failed-turn charge, record turn_failed,
                        throw → nothing saved
  settleSpend(actual cost)
  saveSession                  compare-and-set on rev; stale → 409
  recordTranscript(exchange [+ session_end])
release lock (compare-and-delete)
respond
```

The lock is released **before** the response is sent, so a fast next click
never hits a 409 from its own previous turn.

### What the client receives per turn

Dialogue, demeanor, the delta, the new Case Strength, turn and witness state,
the ending, and a **verdict** (type + one-line reason) built by
`deriveVerdictReason()` in `src/server/verdict.ts`. That function never reads
the invigilator's free-text fields (which were written with full knowledge of
the truth); it composes fixed phrasing from the signal type, the player's own
question and already-public evidence text. Leak-safety is by construction,
not by filtering (`verify` check 8).

### Breakdown

`buildBreakdown()` (`src/server/breakdown.ts`) assembles, from session state
only, the truth timeline, annotated ledgers (which claims were contradicted),
evidence with ratings, the **turning point** (largest absolute swing), per-turn
reasoning, and token usage. Zero model calls.

---

## 7. State and storage

`src/server/store.ts` defines a `Store` interface with two implementations:
the Upstash store (`createUpstashStore()` in `upstash-store.ts`, loaded lazily
so local runs never need the package) and `MemoryStore` (local, injectable
clock for tests).
`createStore()` picks Upstash when `UPSTASH_REDIS_REST_*` or `KV_REST_API_*`
is set, MemoryStore otherwise, and **throws on Vercel with no credentials**.

| Store method | Redis implementation | Used for |
|---|---|---|
| `getJson` / `setJson` / `del` | GET / SET EX / DEL | sessions |
| `setJsonIfRev` | Lua: compare `rev`, then SET | versioned session save |
| `reserve(limits, amount)` | Lua: check every counter, then INCRBY all or none | spend reservation |
| `adjust(key, delta, ttl)` | INCRBY + EXPIRE | spend settlement |
| `acquireLock` / `releaseLock` | SET NX PX / Lua compare-and-delete | turn lock |
| `appendList` / `getList` | Lua: RPUSH + EXPIRE + LTRIM / LRANGE | transcripts |

| Key | Contents | TTL |
|---|---|---|
| `sess:<uuid>` | `{v, session, byok?, createdAt, rev}` (whole `GameSession`) | 1h, refreshed per turn |
| `spend:sess:<uuid>` | micro-dollars spent this game | 2h |
| `spend:day:<YYYY-MM-DD>` | micro-dollars spent today (UTC) | 48h |
| `lock:<uuid>` | random per-request token | 70s |
| `rl:<bucket>:*` | sliding-window counters (`@upstash/ratelimit`) | managed |
| `tx:<uuid>` | transcript entries (JSON), max 200 | 14 days, refreshed per write |

Counters are integer micro-dollars because INCRBY is integer-only. The whole
`GameSession` is stored (not just the seed) so a template deploy can't change
a game in progress.

---

## 8. Production controls

| Control | Mechanism | Failure behaviour |
|---|---|---|
| Seed hiding | Server picks 128 random bits; HMAC with `SESSION_SECRET` when set; never in any response | Boot fails on Vercel without a 32+ char secret |
| Spend cap | Reserve $0.01 → run → settle to actual. $0.08/game, `MAX_DAILY_SPEND_USD`/day (default $2) | **Fail closed**: store down → 503; over cap → 429 before any model call |
| Failed-turn charges | Persona failure $0.003; invigilator failure is charged at least the full $0.01 reservation (its failed attempts are billed but never reach `session.usage`); refused BYOK key $0 | |
| Concurrency | Lock + revision CAS | Lock store down → 503; stale save → 409 |
| Rate limits | Per IP from `x-vercel-forwarded-for` (never client headers); IPv6 keyed by /64 | **Fail open** (logged): spend cap and lock are the backstops |
| Timeouts | 50s request deadline, 25s persona, 15s per invigilator attempt; combined with `AbortSignal.any` | Persona timeout → 504 `MODEL_TIMEOUT`, nothing saved; invigilator → zero-delta turn |
| Error hygiene | Fixed player sentences; provider text kept as `ApiError.cause` | Logged scrubbed, never shown |
| Logging | `logEvent` / `logError`: one JSON line, `evt` first, every string scrubbed (secret env values, `sk-ant-`, Bearer, URL credentials), 500-char cap | |
| Transcripts | Redacted at any depth before write | **Best effort**: a failed write is logged, never fails a turn |
| BYOK | `X-Anthropic-Key` per request → `modelForApiKey()` → `TurnCallOptions.model` | Missing/malformed → 401; provider 401/403 → 401 `INVALID_API_KEY` |

Why the timeouts nest: 50s deadline < 60s function cap < 70s lock TTL, so a
lock can never expire under a turn that is still running.

Why fail-closed on spend but fail-open on rate limits: an uncounted model
call costs real money, so the spend path refuses when it can't count; a rate
limiter outage that failed closed would turn a Redis blip into a full outage,
while the spend cap still bounds the damage.

---

## 9. Bring-your-own-key

The browser keeps the key in `sessionStorage` (`public/js/byok.js`) and
`api.js` attaches it as `X-Anthropic-Key` on every game request.
`src/server/byok.ts` validates the shape (`sk-ant-` + 20-300 URL-safe
characters). A per-request model is built with `modelForApiKey(key)` and
passed down as `TurnCallOptions.model`. It is never installed with the global
`setModel()`, because Vercel runs concurrent requests in one instance and a
global would leak one player's key into another's turn.

The session stores only `byok: true`, so the key must be resent on every
request. BYOK turns reserve against the per-game counter only
(`reserveSessionSpend`, `dayKey = null`), so they continue after the shared
budget is spent. A provider 401/403 on a BYOK turn is the player's problem
(friendly 401); on the shared key it stays a 502, so a server credential
fault is never blamed on the player.

---

## 10. Front end

Vanilla JS modules in `public/js/`, no framework or build step:

- `state.js`: the single state object (phase, case, transcript, Case
  Strength, turn and witness state, `caseFileOpen`, `revealOpen`, errors).
- `render.js`: the **only** module that touches the DOM. `paint()` renders
  everything from state; every dynamic string goes through `escapeHtml()`.
  The transcript auto-scrolls only when an exchange arrives or a wait starts,
  never on keystrokes.
- `main.js`: event wiring and turn flow.
- `api.js`: `fetch` wrapper; maps error JSON to `ApiClientError`; forwards
  `?seed=` on create (inert unless the server allows client seeds).
- `byok.js`: the "use my own key" panel.

`revealOpen` is separate from `phase === 'ended'` so the last answer stays
readable; the outcome overlay opens on a button press.

---

## 11. Deployment

- **Function:** `src/index.ts` default-exports `createApp()` and imports
  `express` itself (the Vercel Express preset scans the entry file for it).
  Framework Preset must be **Express**.
- **ESM imports:** all relative imports end in `.js`. Vercel compiles `.ts`
  to `.js` but keeps specifiers, and Node ESM never guesses extensions.
  `tsconfig.json` uses `module`/`moduleResolution: NodeNext`, so `tsc`
  rejects an extensionless import. Local scripts run via `tsx`, which would
  hide the problem.
- **`vercel.json`:** `maxDuration: 60`; `includeFiles: "public/**"` because
  `GET /` reaches Express, which `sendFile`s `public/index.html`, and Vercel
  only bundles files the code imports.
- **Dependencies:** `package-lock.json` is gitignored, so Vercel installs from
  `package.json`. `engines.node` is `>=20.11 <25`.
- **Boot checks** (`createApp()`): `assertSeedConfig()` (secret on Vercel)
  and `createStore()` (Redis credentials on Vercel) throw at startup, so a
  misconfigured deploy fails loudly on the first request.

Env vars are listed in `CLAUDE.md` and `README.md`.

---

## 12. Testing and evaluation

### `npm run verify` (19 checks, no network, no model calls)

Uses a scripted fake model (`setModel()`) and `MemoryStore`.

| # | Check |
|---|---|
| 1 | `generate()` deterministic across 40 seed/crime pairs |
| 2 | Truth timelines in order, including midnight-crossing windows |
| 3 | `PRESENT` parsing (lists, already-presented items rejected) |
| 4 | `toPublicCase()` hides strategy, shows evidence |
| 5 | Every template produces a well-formed case |
| 6 | All 10 templates reachable |
| 7 | Slot randomisation gives high variance within a template |
| 8 | Verdict reasons never echo invigilator free text |
| 9 | Breakdown refuses mid-game (409) |
| 10 | No seed in any response body or header; client seeds ignored |
| 11 | Sessions persist across app instances; TTL; id validation; store-outage 503 |
| 12 | Spend cap: parallel turns admit exactly the budget; per-session and daily caps; fail-closed |
| 13 | Turn race: one request per session; parallel hammering yields exactly 6 + 2 turns |
| 14 | Failed persona call leaves the stored session byte-identical |
| 15 | Rate limits: trusted IP header only, IPv6 /64, sliding window, fail-open |
| 16 | Timeouts: hung persona → 504 with session intact; hung invigilator → zero-delta |
| 17 | Error and log hygiene: fixed 502, cause logged, planted secrets redacted |
| 18 | Transcripts: ordering, redaction, TTL, cap, best-effort, `TRANSCRIPTS=off` |
| 19 | BYOK: key appears nowhere; skips the daily counter; friendly 401s |

What verify can't prove: Upstash's Lua atomicity, real Anthropic error
shapes, and Vercel bundling. Those are covered by the live checks in
`.claude/audit-checklist.md`.

### Eval harness (`npm run eval`, real model calls)

- **Layer 1** (`src/eval/cases.ts`): 18 hand-written turns with known
  expected signals (4 guilty-knowledge, 4 contradiction, 3 evidence, 2
  demeanor, 5 clean). Measures invigilator precision and recall.
  2026-10-25: precision 0.692, recall 0.90, 13/18.
- **Layer 2** (`src/eval/detective.ts`): full automated games with a scripted
  detective (6 suspect + 2 witness questions), measuring ending distribution,
  Case Strength and signal rates. 2026-10-25, 5 games: 2 strong, 3 shaky,
  mean 74. A 50-game run is the next measurement.

Results in [`eval-v3-results.md`](eval-v3-results.md).

---

## 13. Cost and model

16 calls per game (two per turn), ~40K input and ~4K output tokens, about
$0.05-0.06 on Haiku 4.5. Prompt caching doesn't apply: Haiku 4.5's minimum
cacheable prompt is 4,096 tokens and the largest system prompt (invigilator)
is ~1,658. `maxOutputTokens`: persona 2048, witness 1024, invigilator 1024
(suspect turn) / 512 (witness turn). Swapping model or provider is one line
(`MODEL` in `adjudicate.ts`).

---

## 14. Known limits

- Layer 2 sample is 5 games; balance isn't established yet.
- The no-em-dash rule for model dialogue is a prompt instruction only.
- Shared-NAT visitors share a rate-limit bucket; a many-IP botnet is bounded
  by the daily spend cap, not by rate limits.
- Prompt injection is contained by architecture (public/private split,
  schema, escaping, 300-char cap), not by a detector.
- Phase 1 scope: homicide only, suspect always guilty.
