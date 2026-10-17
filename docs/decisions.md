# Decision log

Reverse-chronological. Each entry: what was decided, why, and what it
superseded or deferred. `CLAUDE.md` stays the settled/current-state summary —
the reasoning, dead ends, and things ruled out live here so they aren't
relitigated from scratch next session.

## 2026-10-15 — Deployment target: Render (persistent disk), transcript path made configurable

**Decision:** Picked **Render** as the deployment target over Railway,
Fly.io, or a small VM, and made `createTranscriptLog()`
(`src/cli/transcript.ts`) write to `process.env.PLAYTEST_LOGS_DIR` when
set, falling back to the existing cwd-relative `playtest-logs/` for local
CLI/dev use.

**Why Render over the alternatives:**
- Render's persistent disks explicitly document surviving both restarts
  and redeploys when the app writes inside the disk's mount path — exactly
  the write pattern `transcript.ts` already uses (`appendFile`/`writeFile`
  via `node:fs/promises`, no DB). Disks require a paid plan (no free-tier
  disk), but the cheapest paid web service + disk combination is simple to
  reason about and the docs are unambiguous about the persistence
  guarantee.
- Railway also offers volumes (0.5GB on its Free plan, 5GB on Hobby at
  $5/mo), but Free-tier volume data is documented as deleted 30 days after
  plan/account expiry — a worse fit for a portfolio project meant to sit
  untouched between demos.
- Fly.io volumes are explicitly tied to a single machine in a single
  region with no built-in replication, and Fly's own docs recommend
  provisioning at least two volumes per app for redundancy — more
  infrastructure complexity than this project's single-process, no-DB
  design needs.
- A small VM (e.g. a basic cloud instance) trivially satisfies "disk
  persists" but requires self-managed OS patching, TLS, and process
  supervision that Render's platform already provides — not worth the
  ops overhead for a portfolio demo.

**The real risk wasn't the host, it was the write path.** Every one of
these hosts mounts its persistent disk/volume at a fixed path you choose
(e.g. Render's disks mount wherever you configure, commonly `/var/data`),
which is **not** the app's working directory. `createTranscriptLog()`
previously always resolved `playtest-logs/` relative to `process.cwd()` —
deployed as-is, on any of these hosts, logs would have been written
outside the mounted disk and lost on every redeploy regardless of which
host was picked. Fixed by reading `PLAYTEST_LOGS_DIR` from the environment
first, so the Render deploy sets it to the disk's mount path (e.g.
`PLAYTEST_LOGS_DIR=/var/data/playtest-logs`) and the CLI/local dev path is
unchanged (env var unset → same cwd-relative fallback as before).

**Outcome:** `npx tsc --noEmit` clean, `npm run verify` still 9/9 (no
engine files touched). Not yet deployed from this machine — this records
the decision and the code fix that makes it correct wherever it's
deployed, not a completed deployment.

## 2026-10-15 — Implemented: mid-game witness timing, ending reframe, cap audit

**Decision:** Implemented the three engine rule changes queued by the
"Locked" entry below (same date): mid-game witness calling, the
charge/release-choice removal, and the per-turn-cap audit. `npm run verify`
passes (7/7 — determinism, leak-safety, template integrity, coverage,
variance, plus the two input-parsing assertions folded into check 1).

1. **Witness is now callable once, mid-game, gated on Case Strength.**
   `src/engine/score.ts` gained `witnessUnlockThreshold: 50` (separate knob
   from `weakChargeThreshold`, even though both are 50 today — they tune
   different things). `GameSession` (`src/engine/types.ts`) gained
   `witnessUsed: boolean`. `src/engine/session.ts` exports
   `isWitnessAvailable(session, config)`: false once both witness turns are
   spent; true for the remainder of an opened session even if Case Strength
   has since dropped (the gate applies to *opening* the session, not each
   question within it); otherwise `caseStrength > witnessUnlockThreshold`.
   `playWitnessTurn()` sets `witnessUsed = true` on its first call and no
   longer forces `phase` to a one-way `'witness'` lock — `playInterrogationTurn()`
   now resumes `phase = 'interrogation'` on every call (except once
   `'verdict'` is reached), so suspect questioning can continue after a
   witness interruption. The CLI (`src/cli/play.ts`) exposes this as a
   `/witness` command inside the interrogation loop, available once unlocked,
   routing into a new `runWitnessSession()` helper that asks both questions
   and returns control to the interrogation loop. The server
   (`src/server/routes/game.ts`) exposes `witnessAvailable`/`witnessUsed` on
   `POST /` and `GET /:id`, and `POST /:id/witness` now 409s with a specific
   message if the witness isn't unlocked yet vs. already used — no UI wiring
   was added per instruction (`public/js/` untouched; see flag below).

2. **Charge/release player choice removed; endings are now pure
   Case-Strength + turn-exhaustion outcomes.** `resolveVerdict()` is deleted
   from `session.ts` entirely. `checkEnding()` in `score.ts` takes a new
   `TurnExhaustion` struct (`interrogationTurn`/`maxInterrogationTurns`/
   `witnessUsed`/`witnessTurn`/`maxWitnessTurns`) alongside `caseStrength`:
   Case Strength ≥ `chargedThreshold` (80) returns `CHARGED_STRONG`
   immediately, regardless of remaining turns; otherwise, only once every
   available question is spent (six suspect turns, plus both witness turns
   if the witness was opened) does it resolve — `CHARGED_WEAK` at or above
   `weakChargeThreshold` (50), `RELEASED` below it. Both
   `playInterrogationTurn()` and `playWitnessTurn()` call the new signature
   after every turn. `play.ts`'s CLI loop no longer has a Phase 4
   charge-or-release prompt; `renderEnding()`'s `CHARGED_WEAK` copy changed
   from "gamble paid off / your instinct was right" to "qualified case /
   not airtight, but enough to charge," and `RELEASED` changed from "they
   were guilty, they walked free" to "Case Strength ended at N — not enough
   to charge... the detective failed to build the case," per the explicit
   instruction that RELEASED must read as detective failure, not suspect
   innocence. `src/server/routes/game.ts`'s `/:id/verdict` endpoint is
   deleted outright (its only purpose was calling `resolveVerdict`).

3. **Cap audit: one real gap found and fixed, nothing else.**
   `scoreSuspectTurn()` already clamped its delta to
   `[-maxTurnDelta, +maxTurnDelta]`. `scoreWitnessTurn()` did **not** — it
   computed `delta` from `witnessContradiction` (10) and applied it
   unclamped. Harmless today since no witness signal can exceed 25, but it
   was a genuinely uncapped path. Fixed by routing it through the same
   `clamp()` call, matching `scoreSuspectTurn()`. No weights changed; `25`
   stays `25`.

**Flagged for review (not silently changed):**
- `src/eval/detective.ts`'s `runOneGame()` previously always spent both
  witness questions unconditionally after all six interrogation turns, then
  force-charged via `resolveVerdict(session, true)`. It's been reworked to
  call the witness only once `isWitnessAvailable()` is true (interleaved
  between interrogation turns) and to drop the `resolveVerdict` call —
  endings now resolve on their own via `checkEnding()`. **This will change
  the Layer 2 numbers already published** in `README.md` and
  `docs/eval-v3-results.md` (6/10 `CHARGED_STRONG`, mean CS 77): those were
  produced by a runner that always exercised the witness regardless of
  gating. The eval harness has not been re-run against this change — the
  published numbers are now stale and should be re-run and re-published
  before being cited again.
- `public/js/` (the Express web UI from commit `a7c4e8f`) still calls
  `POST /api/game/:id/verdict` (`api.js:submitVerdict`) and tracks a
  `'verdict'` game phase (`state.js`, `main.js`, `render.js`) expecting a
  manual charge/release choice. That endpoint is now deleted and the
  server never requires a player decision — the existing UI will break on
  that call. No UI code was touched per instruction ("do not build any
  UI"); this is flagged as follow-up work, not fixed here.
- `README.md`'s "How it works" section (flagged in the "Locked" entry below)
  is now actively wrong, not just destined to go stale — the engine no
  longer runs a fixed suspect-then-witness-then-verdict phase order. Still
  not rewritten in this task, per the original Task 1 instruction to flag
  rather than silently rewrite README; carrying the flag forward since the
  implementation it was waiting on has now landed.

## 2026-10-15 — Locked: charged threshold, witness timing, and witness unlock gate

**Decision:** Four design decisions locked for the witness-calling redesign:

1. **Charged threshold stays at 80.** `SCORING_CONFIG.chargedThreshold` in
   `src/engine/score.ts` is unchanged — Case Strength ≥ 80 still means
   `CHARGED_STRONG`. No change proposed or needed; stated here so it isn't
   relitigated alongside the witness-timing changes below.
2. **The witness becomes callable once, mid-game**, with two questions that
   are *extra* — not drawn from the six suspect-interrogation turns. The
   player can interrupt suspect questioning to call the witness at any point
   once the gate (below) is open, rather than the witness phase being a
   fixed block after all six suspect turns.
3. **The witness unlocks only when Case Strength exceeds 50.** Below that
   threshold, the option to call the witness is shown but disabled. If 50
   is never reached during a playthrough, the witness never becomes
   available at all for that game.
4. **Open item, not yet built:** the engine (`src/engine/session.ts`) still
   runs the witness as a fixed phase after all six suspect turns via
   `playWitnessTurn()`, with no Case Strength gate. Mid-game witness calling
   and the >50 unlock gate are future work — not implemented as of this
   entry.

**Why:** Locks in the target design for the next engine iteration before
implementation starts, so the witness-timing change doesn't get redesigned
mid-build.

**Not yet done:** `session.ts`, `play.ts`, and the web UI (`public/js/`)
all currently assume a fixed suspect-then-witness phase order with no gate
— none of these were touched by this entry. Implementing decisions 2–3
requires: a way to interrupt interrogation turns to call the witness,
a Case Strength check gating `to-witness-btn`/the CLI witness entry point,
and session state to track whether the one-time witness call has been
used. See "Flagged for review" below for a contradiction this surfaces in
existing docs.

**Flagged for review (not silently changed):** `README.md`'s "How it
works" section and current-implementation table describe "up to six
questions of the suspect, then up to two questions of a witness" as how
the game plays today — that description is accurate for the *current*
fixed-phase engine behavior (open item 4 above), but will become stale
once mid-game witness calling ships. Left as-is pending the actual
implementation; flagging so it isn't missed when `session.ts` changes.

## 2026-10-11 — Provider switch: GroqCloud/xAI → Anthropic Claude Haiku 4.5

**Decision:** Replaced the Groq-primary/xAI-fallback provider logic in
`adjudicate.ts` with a single Anthropic call: `anthropic('claude-haiku-4-5')`
via `@ai-sdk/anthropic`, selected using `ANTHROPIC_API_KEY`. Removed the
`@ai-sdk/google`, `@ai-sdk/openai`, and `@ai-sdk/xai` dependencies (unused
once the branching logic and commented-out provider examples were deleted)
and the Google-specific cache-token lookup in the token usage mapping.
Updated `.env.example`, `README.md`, `docs/portfolio.md`, and this project's
`CLAUDE.md` ("Model"/"Environment" sections) to match. Added an
`sk-ant-[A-Za-z0-9_-]+` redaction pattern to `transcript.ts` alongside the
existing Groq/xAI ones, and swapped the key-validation and transcript-secret
plumbing in `play.ts`/`eval.ts` from `GROQ_API_KEY`/`XAI_API_KEY` to
`ANTHROPIC_API_KEY`.

**Why:** User already has an Anthropic API key and asked to standardize on
it, picking Haiku 4.5 as the cheapest current Anthropic model. `@ai-sdk/anthropic`
was already a dependency and the token-usage mapping in `adjudicate.ts`/
`witness.ts` already anticipated Anthropic's `cacheCreationInputTokens`/
`cacheReadInputTokens` provider-metadata keys, so this was a low-risk swap
behind the existing single-`MODEL`-export architecture.

**Left alone:** Historical docs (`docs/playtest-notes.md`,
`docs/decisions.md` entries below this one, `docs/eval-m2-results.md`) keep
their original Groq/xAI mentions — they document what actually happened at
the time of those runs and are not rewritten retroactively.

**Not yet done:** No live playthrough or eval run against Haiku 4.5 yet —
this is a provider swap, not a recalibration. Invigilator accuracy and
evidence-quality scoring should be re-validated against the new model before
trusting old Groq/xAI-era eval numbers.

---



**Decision:** Split the single model call per turn into two agents. The
**Persona Agent** (adjudicate.ts / witness.ts) acts — generates in-character
dialogue, claims, and demeanor. The **Invigilator Agent** (new file:
invigilator.ts) judges — an independent LLM-as-judge with full case context
that evaluates the dialogue and returns structured signals (contradictions
with claim IDs, guilty knowledge leaks, evidence handling quality 0–3,
demeanor shifts). The deterministic scoring engine reads invigilator signals
instead of the suspect's self-reported fields, applying the same
`SCORING_CONFIG` weights.

Also: narrowed to **murder only** (arson template stays on disk, excluded
from active play/verify), built a **two-layer eval harness** (18 hand-crafted
invigilator accuracy cases + automated full-game runner with hardcoded
detective script).

**Why — the self-judging failure:** V2 playtesting proved the documented
risk was real. The suspect model called `selfContradiction: false` and
`inadvertentReveal: null` on every single turn across multiple games, even
when it obviously contradicted itself or leaked guilty knowledge. Case
Strength stayed at 15 the entire game. The fallback documented in V2's
CLAUDE.md (split into two calls — actor + external judge) was the correct
fix.

**Why — remove evidence from suspect prompt:** V2 gave the suspect all
evidence items with vulnerabilities, making it unrealistically good at
deflecting. V3 strips evidence from the suspect's system prompt entirely.
The suspect knows the truth and its cover story, but NOT what evidence the
detective has. When evidence is presented, the user message shows the claim
only (not the vulnerability). The suspect must improvise.

**Why — murder only:** Focus. One crime type, one template, exercised deeply
through the eval harness, is more convincing for a portfolio than three
shallow crime types. Arson stays on disk to show the multi-crime design.

**What changed, by file:**
- `types.ts`: added `InvigilatorSuspectResponse`, `InvigilatorWitnessResponse`.
  Simplified `SuspectResponse` (removed `evidenceResponses`,
  `selfContradiction`, `inadvertentReveal`). Simplified `WitnessResponse`
  (removed `suspectContradiction`). Updated `InterrogationDetail` and
  `WitnessDetail` to include `invigilatorResponse`.
- `adjudicate.ts`: stripped evidence section from suspect system prompt.
  Simplified `SuspectResponseSchema` to dialogue + claims + demeanor only.
- `witness.ts`: removed `suspectContradiction` from `WitnessResponseSchema`.
- `invigilator.ts` (new): `SuspectInvigilatorSchema`,
  `WitnessInvigilatorSchema`, `buildInvigilatorSystemPrompt()` (full case
  context), `evaluateSuspectTurn()`, `evaluateWitnessTurn()` with retry.
- `score.ts`: rewired `scoreSuspectTurn()` and `scoreWitnessTurn()` to read
  invigilator signals. Added claim ID validation (checks `againstClaimId`
  exists in actual ledger before counting).
- `session.ts`: two-call flow per turn (persona → ledger → invigilator →
  score). Invigilator failure = zero-delta turn.
- `play.ts`: murder-only (no crime picker), shows invigilator reasoning
  after each turn, breakdown shows per-turn invigilator analysis.
- `verify.ts`, `inspect.ts`: murder-only active crime list.
- `eval/types.ts`, `eval/cases.ts`, `eval/detective.ts`, `cli/eval.ts` (new):
  full eval harness replacing the V2 stub.

**Deferred, not forgotten:**
- No live playthrough or eval run yet — implementation is verified by
  `npx tsc --noEmit` and `npm run verify`, not by actual model responses.
- Arson/embezzlement templates not removed, just excluded.
- README.md and AIRTIGHT-PRD.md still describe V1.
- Cost per playthrough unverified for 16-call pattern.

---

## 2026-10-02 — V2 role flip: player is now the detective, AI plays a lying suspect + witness

**Decision:** Complete redesign and reimplementation of the game's core loop.
Player was the guilty suspect being judged by an AI detective (V1); now the
player is the detective, and the AI generates in-character dialogue as a
guilty suspect (and a separate witness persona) that the player must break.
All 14 engine/CLI files touched, 1 new file (`witness.ts`). Full file map and
architecture are in `CLAUDE.md` — not duplicated here.

**Why:** V1's adjudicator was a flat classifier task (judge the player's
answer, extract claims, flag contradictions) — a thin AI-engineering story
for a portfolio. Flipping the roles turns the model's job into *acting*
instead of *judging*: it has to perform a consistent lie under adversarial
questioning while a second persona (the witness) can independently
corroborate or contradict it. This is a materially richer multi-agent
orchestration problem, and separately, playtesting V1 suggested catching an
AI's lies is more fun than defending your own.

**What changed, briefly:** Security boundary in `toPublicCase()` inverted
(evidence now shown upfront, suspect's strategy hidden — was the reverse).
Suspicion meter dropped; Case Strength is now the only meter. Turn structure
collapsed from 12 player-defense rounds to 6 suspect-interrogation questions
+ 2 witness questions. New endings: `CHARGED_STRONG` / `CHARGED_WEAK` /
`RELEASED`, replacing V1's `CHARGED` / `RELEASED` / `HELD 48 HOURS`.

**Known risk accepted, not yet resolved:** the suspect model call both acts
(writes dialogue) and self-judges (reports its own contradictions and
inadvertent reveals) in one structured response. If playtesting shows the
model doesn't honestly flag its own slips, the documented fallback is to
split into two calls — see "The self-judging risk" section in `CLAUDE.md`.
Not implemented pre-emptively; wait for evidence it's actually a problem.

**Deferred, not forgotten:**
- `npm run eval` is now a stub — V1's contradiction-detection eval doesn't
  transfer to an actor model. New eval dimensions needed (suspect
  consistency, self-report honesty, evidence-response-quality calibration,
  witness corroboration accuracy) — not designed yet, waiting on manual
  playtesting patterns first.
- No live playthrough has happened against a real model response yet as of
  this entry — `npx tsc --noEmit` and `npm run verify` are clean, but the
  suspect-actor prompt (persona + cover story + guilty knowledge + every
  evidence vulnerability in one cached block) is unverified for latency,
  cost, and whether the model actually stays in character.
- `README.md` and `AIRTIGHT-PRD.md` still describe V1 in full — not rewritten
  yet. `CLAUDE.md` is the only current-state source of truth until they are.
- No prompt-injection handling exists in the V2 suspect schema. V1 had an
  explicit `injectionAttempt` flag; whether an in-character guilty suspect
  needs an equivalent "break character" mechanic is an open question, not a
  decision.
- Cost-per-playthrough target not re-validated. V1's $0.05 target assumed
  Haiku pricing and one call per turn; V2 makes up to 8 calls per game with
  longer prompts, against Grok instead of Haiku.

## 2026-09-27 — Default adjudicator model swapped to xAI Grok (pending validation)

**Decision:** `MODEL` in `src/engine/adjudicate.ts` now points at
`xai('grok-4.20-reasoning')`, replacing the Gemini 3.5 Flash Lite default
from M1.

**Why:** The M2 eval baseline (`eval-m2-results.md`) showed Gemini has 100%
precision but only 25% recall on contradiction detection — it's too
conservative, missing anything that requires inference rather than a bare
keyword clash. A reasoning-capable model was the next thing to test against
the same harness.

**Status:** Blocked. The `XAI_API_KEY` added to `.env.local` reaches xAI's
server but is rejected as invalid (`"Incorrect API key provided"`). Being
checked against console.x.ai (key validity / billing / org) on a separate
machine. Until this resolves, running the game or the eval harness with this
key silently falls back to safe defaults on every adjudicator call — check
for `[adjudicate] Model call failed` before trusting any output.

## 2026-09-27 — Tried OpenRouter as a free-tier alternative before paying for xAI/Anthropic

**Decision:** Added `OPENROUTER_API_KEY` support
(`createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', ... }).chat(modelId)`
— note `.chat()`, not the bare call, since OpenRouter only implements the
Chat Completions API, not OpenAI's Responses API) to test whether any
free-tier model could close Gemini's recall gap without new spend.

**Why:** OpenRouter aggregates many providers' free-tier models behind one
key — worth trying before committing to a paid model.

**Outcome:** Ruled out for now, not a dead end forever.
`nvidia/nemotron-3-super-120b-a12b:free` rambles past the 2048-token output
budget on chain-of-thought before ever emitting JSON — unusable with
`generateObject()`'s strict schema requirement.
`liquid/lfm-2.5-2.6b:free` runs cleanly but never flags a single
contradiction (0%/0% — strictly worse than Gemini).
`qwen/qwen3.8-27b:free` never got real data — the account-wide daily
free-tier quota (shared across all `:free` models on the account) was
exhausted by the two runs above before qwen got a turn. Would need $10 of
OpenRouter credit to test properly; not revisited this session.

## 2026-09-27 — Rejected: raising `maxOutputTokens` from 2048 to 4096

**Decision:** Declined. `maxOutputTokens: 2048` in `adjudicate()`'s
`generateObject()` call is unchanged.

**Why:** Proposed as a fix for nemotron's chain-of-thought rambling eating
the whole output budget before JSON. Explicitly rejected — treat as settled
unless revisited with a specific new reason.

## 2026-09-27 — Built the M2 eval harness (contradiction-detection precision/recall)

**Decision:** Added `src/cli/eval.ts` + `src/eval/` (17 hand-authored cases),
fulfilling the PRD's long-deferred M2 scope.

**Why:** The only prior evidence the adjudicator worked was "it felt right
in playtesting." A real, repeatable precision/recall number gives an actual
baseline to measure any future model swap against, instead of vibes.

**Outcome:** Real, trustworthy Gemini baseline established — see
`eval-m2-results.md` for the full table and methodology (including two
runs that turned out to be contaminated by rate-limit fallbacks and had to
be discarded).

## 2026-09-27 — PROBE-phase evidence hints now carry a non-revealing `topic`, not the claim

**Decision:** `Evidence` items gained an optional `topic` field
(`src/engine/types.ts`); PROBE-phase prompts (`buildUserMessage` in
`adjudicate.ts`) pass the detective this topic instead of the evidence's
full claim, and `evidencePlayed` is now explicitly scoped to only fire when
the claim itself was stated out loud.

**Why:** Previously PROBE and CONFRONT both received the full evidence claim,
so a PROBE-phase question could accidentally tip off exactly what the
detective already knew, undercutting the intended "walls closing in" arc
where CONFRONT should land as a consequence of the player's own PROBE-phase
answer, not a cold ambush.
