# AIRTIGHT — working notes for Claude Code

An LLM-driven interrogation game. **The player is the detective.** The AI
plays a guilty suspect (and a witness) through a **Persona Agent**, while an
independent **Invigilator Agent** (LLM-as-judge) evaluates each turn from a
bird's-eye view with full case context. A deterministic scoring engine
converts the invigilator's structured signals into Case Strength changes.

> **Two-machine workflow:** this project is being built on one laptop and
> tested on another, each with its own Claude Code session. This file is the
> shared source of truth between them — keep it current on every substantive
> change (architecture, invariants, file map, how to run things) so the other
> machine's agent can pick up context cold. Session-specific noise (what we're
> mid-debugging *right now*) belongs in conversation, not here — but settled
> decisions, new files, and anything that changes "how do I run/test this"
> belongs in this file immediately, not as a follow-up.

Read `README.md` for a user-facing overview — kept in sync with the current
V3 state. Treat this file as the current-state source of truth for anything
`README.md` doesn't cover.

**Status: V3 two-agent architecture implemented, tuned, and verified.** 10
homicide templates, invigilator prompt tuning landed and measured (precision
0.667, recall 0.80; 60% CHARGED_STRONG, mean CS 77 — all targets hit; see
`docs/eval-v3-results.md`). `npm run verify` green (8/8 checks). What hasn't
happened yet: the web UI (Area B in the plan).

---

## Docs index

This file is the settled/current-state summary. The reasoning behind
decisions, dead ends ruled out, and detailed results live in `docs/*.md`
instead — check there before relitigating something that was already tried.

- [`docs/decisions.md`](docs/decisions.md) — reverse-chronological decision
  log: what was decided, why, and what it superseded or deferred.
- [`docs/eval-m2-results.md`](docs/eval-m2-results.md) — M2 eval harness
  precision/recall results per model (V1 adjudicator-as-judge contract —
  doesn't apply to V3, kept for history).
- [`docs/playtest-notes.md`](docs/playtest-notes.md) — **owned by the testing
  machine.** Raw playtest findings land here first; this (build) side folds
  anything settled into this file or `decisions.md` and may prune entries
  once incorporated. Don't edit `CLAUDE.md`/`decisions.md` from the testing
  side directly — write here instead, to avoid both machines colliding on
  the same file across a `git pull`.
- [`docs/eval-v3-results.md`](docs/eval-v3-results.md) — V3 invigilator
  tuning results: Layer 1 precision/recall and Layer 2 gameplay balance,
  before/after comparison, per-game breakdown.

New file per topic when a topic grows past a few paragraphs (e.g. a future
`docs/eval-v3-results.md` once the eval has been run); index it here with a
one-line description rather than folding it into this file.

---

## History: V1 → V2 → V3

**V1:** Player is the guilty suspect, AI is the detective who judges and
scores. A flat classifier task — thin for a portfolio.

**V2:** Roles flipped — player is detective, AI plays a lying suspect +
witness. Much richer orchestration, but the suspect self-judged its own
contradictions and guilty-knowledge leaks in one call. Playtesting proved
this was unreliable: the model never flagged itself, so Case Strength stayed
flat and the game felt broken.

**V3 (current):** Two-agent split. The **Persona Agent** acts (suspect
dialogue + claims); the **Invigilator Agent** judges (structured signals from
a bird's-eye view). The engine scores deterministically from those signals.
Also narrowed to **murder only** for focus — the arson template was removed
from the codebase entirely (2026-10-18) and embezzlement remains a Phase 2
placeholder.

Non-negotiable constraints (don't relitigate without a new reason):
- Score the **answer** a question provoked, not the question itself.
- The suspect is **always guilty** in Phase 1. Innocent-suspect mode is
  Phase 2.
- 6 suspect questions, 2 witness questions.
- **Homicide only** for V3. Arson is gone (not just excluded); embezzlement
  is a Phase 2 placeholder.
- 4–5 evidence items per case, shown to the player upfront, not drip-fed.

---

## Hard invariants

Break any of these and the game stops working. `src/cli/verify.ts` enforces
#1 and #2; run `npm run verify` after touching the engine.

1. **`generate()` must stay pure.** The server regenerates the case file from
   the seed on every turn instead of persisting it. Any impurity — a
   `Date.now()`, a `Math.random()`, a module-level mutable — desynchronises
   the session mid-game and silently invalidates testing.

2. **Never serialise a `CaseFile` to the client.** Always route through
   `toPublicCase()`. **The security boundary is inverted from V1:** it now
   *shows* all evidence claims (the player-detective needs them) but *hides*
   the suspect's strategy — `suspectPersona` (personality, cover story,
   breaking points, guilty knowledge), every evidence item's `vulnerability`,
   the witness's `personality`/`knowledgeBoundary`/`suspectContradictions`,
   the truth timeline, and the `fatalFact`. If any of that reaches the
   player, the game is solved by reading the inspect output.

3. **The suspect acts; the invigilator judges; the engine scores.** All Case
   Strength arithmetic lives in `SCORING_CONFIG` (`src/engine/score.ts`),
   never in a prompt. The invigilator returns structured **signals** (not
   deltas) — the engine applies deterministic weights. Difficulty is a
   config-file change, and the game feels fair instead of arbitrary.

4. **Structured output only.** No prose parsing, no regex over model text.
   Four Zod schemas define the contracts: `SuspectResponseSchema` (persona
   agent, suspect mode), `WitnessResponseSchema` (persona agent, witness
   mode), `SuspectInvigilatorSchema` (invigilator, suspect turn),
   `WitnessInvigilatorSchema` (invigilator, witness turn). Small discrete
   integer scales (0–3 for evidence response quality) — not 1–10.

5. **Feed the claim ledger, never the transcript.** Each turn, the persona
   agent extracts new assertions into a compact claim record
   (`src/engine/ledger.ts`). Suspect claims use the `c` prefix, witness
   claims use `wc`. The invigilator references claim IDs when flagging
   contradictions — "does this contradict claim c3" is far more reliable
   than "spot the inconsistency in 4,000 tokens."

---

## Information boundaries (three views of one case)

| Agent | Knows | Does NOT know |
|-------|-------|---------------|
| **Player (detective)** | Evidence claims, briefing, suspect/witness names | Truth timeline, vulnerabilities, persona, guilty knowledge, fatal fact |
| **Persona Agent (suspect)** | Truth, persona, cover story, guilty knowledge, breaking points, fatal fact | What evidence the detective has, evidence vulnerabilities |
| **Invigilator Agent (judge)** | Everything: truth, all evidence + vulnerabilities, persona, guilty knowledge, full claim ledger | Nothing hidden — full bird's-eye view |

The suspect's blind spot is deliberate: it must improvise when evidence is
presented, rather than pre-computing a perfect deflection from knowing the
vulnerability. This makes evidence presentation meaningful as a game mechanic.

---

## Architecture

```
seed  ──>  generate()  ──>  CaseFile (server only)
                               │
                               ├─> toPublicCase()  ──>  player (evidence shown, strategy hidden)
                               │
player question  ──────────────┼─────────────────────────────┐
                               │                             │
              ┌────────────────┴────────────────┐   ┌────────┴────────────┐
              │ CALL 1: Persona Agent           │   │ Persona Agent       │
              │ (adjudicate.ts — suspect mode)  │   │ (witness.ts)        │
              │ dialogue + claims + demeanor     │   │ dialogue + claims   │
              └────────────┬────────────────────┘   └────────┬────────────┘
                           │                                  │
                    update claim ledger                 update claim ledger
                           │                                  │
              ┌────────────┴────────────────┐   ┌────────────┴────────────┐
              │ CALL 2: Invigilator Agent   │   │ Invigilator Agent       │
              │ (invigilator.ts)            │   │ (invigilator.ts)        │
              │ signals: contradictions,    │   │ signals: suspect        │
              │   GK leak, evidence quality,│   │   contradiction         │
              │   demeanor shift            │   │                         │
              └────────────┬────────────────┘   └────────────┬────────────┘
                           │                                  │
                           └───────────┬──────────────────────┘
                                       │
                              scoring engine (pure TS, score.ts)
                                ├─ SCORING_CONFIG weights
                                ├─ validate claim IDs in signals
                                ├─ Case Strength (single meter)
                                └─ ending check
```

**Two calls per turn.** Call 1 (persona) produces dialogue shown to the
player immediately. Call 2 (invigilator) runs while the player reads the
dialogue. If Call 2 fails after retries, the turn is zero-delta (dialogue
shown, claims saved, no score change, warning printed).

**16 model calls per game** = 6 suspect turns × 2 + 2 witness turns × 2.

One meter: **Case Strength** — what the detective can prove. Starts at 15.

Three endings:
- **CHARGED_STRONG** — Case Strength ≥ 80 at any point. Clean win.
- **CHARGED_WEAK** — below 80 at the end, player gambles and charges anyway.
  Always correct in Phase 1 since the suspect is always guilty — rewards
  good instinct over a mechanically perfect case.
- **RELEASED** — below 80, player chooses not to charge. The guilty suspect
  walks. Losing condition.

---

## File map (V3)

```
src/engine/
  types.ts              All domain types — SuspectResponse, WitnessResponse,
                          InvigilatorSuspectResponse, InvigilatorWitnessResponse,
                          GameSession, InterrogationDetail, WitnessDetail, etc.
  rng.ts                Seeded deterministic RNG (cyrb128 + sfc32) — unchanged from V1
  generate.ts           seed + crime → CaseFile; toPublicCase() inverted security boundary
  ledger.ts             Claim accumulation — 'c' prefix (suspect), 'wc' prefix (witness)
  adjudicate.ts         Persona agent (suspect mode): system prompt, SuspectResponseSchema,
                          interrogateSuspect(). Exports MODEL — the one-line provider swap.
                          Suspect prompt does NOT include evidence items or vulnerabilities.
  witness.ts            Persona agent (witness mode): system prompt, WitnessResponseSchema,
                          interrogateWitness(). Imports MODEL from adjudicate.ts.
  invigilator.ts        LLM-as-judge: SuspectInvigilatorSchema, WitnessInvigilatorSchema,
                          buildInvigilatorSystemPrompt() (full case context),
                          evaluateSuspectTurn(), evaluateWitnessTurn(). Retry logic built in.
  score.ts              Pure scoring — SCORING_CONFIG, scoreSuspectTurn() (reads invigilator
                          signals, validates claim IDs), scoreWitnessTurn(), checkEnding().
  session.ts            Orchestration — createSession(), playInterrogationTurn() (two-call
                          flow: persona → ledger → invigilator → score), playWitnessTurn(),
                          resolveVerdict(), parsePlayerInput()
  templates/
    shared.ts           Template contract (TemplateBuild) + name-generation helpers
    homicide.ts         Aggregator — imports 10 templates from homicide/ subfolder
    homicide/           10 distinct scenario files: stairwell, allotment, night-shift,
                          allergy, open-water, overdose, lock-in, hiking-trail,
                          smart-garage, charity-gala. Each exports one Template const.
    embezzlement.ts     Empty array — Phase 2 placeholder.
src/eval/
  types.ts              EvalCase, EvalResult, GameResult, EvalReport types
  cases.ts              18 hand-crafted invigilator accuracy cases (4 GK, 4 contradiction,
                          3 evidence handling, 2 demeanor, 5 clean/negative)
  detective.ts          Layer 1 runner (runLayer1, runEvalCase, compareSignals,
                          computePrecisionRecall) + Layer 2 runner (runLayer2, runOneGame,
                          DETECTIVE_SCRIPT with 6 interrogation + 2 witness questions)
src/cli/
  play.ts               Interactive terminal game: murder only, briefing → interrogation →
                          witness → verdict → post-game breakdown with per-turn invigilator
                          analysis (reasoning, signals, evidence quality, claim contradictions)
  verify.ts             Determinism, leak-safety, template integrity, coverage, variance
                          (homicide only in active checks)
  inspect.ts            Dump a full case file, or --public for exactly what the player sees
                          (homicide only)
  eval.ts               Eval harness CLI: Layer 1 (invigilator accuracy, 18 cases) and
                          Layer 2 (automated gameplay, --games N). Results to eval-results/.
  transcript.ts         JSONL transcript logger (format 'airtight-transcript-v2')
```

---

## How to run / test this

No model call needed (free, instant — run after any engine change):
```bash
npm run verify                        # 8 checks: determinism, leak-safety, integrity, coverage, variance, etc.
npm run case homicide                 # full case file, server-side (truth, vulnerabilities, persona — all visible)
npm run case:public homicide          # exactly what the player-detective sees
npm run case test-seed-1 homicide     # pin a seed to inspect the same case repeatedly
```

Requires a model API key in `.env.local` (see `.env.example` — GroqCloud is
the documented default):
```bash
npm run play                           # random seed, always homicide
npm run play -- test-seed-1 homicide   # pin seed, replay the same case while tuning
```

In-game commands during `npm run play`: `PRESENT e3: your question` to
formally present an evidence item (otherwise it's just a plain question with
no evidence attached), `PRESENT e1, e3: question` to present multiple items,
`/evidence` to re-print the evidence table, `/status` to re-print the Case
Strength bar, `/quit` to end early and still see the breakdown.

Eval harness (requires API key):
```bash
npm run eval                           # Layer 1 only: 18 invigilator accuracy cases
npm run eval -- --games 5              # Layer 1 + 5 automated games (quick check)
npm run eval -- --games 50             # Layer 1 + 50 automated games (full run, ~30-45 min)
npm run eval -- --layer2-only 10       # skip Layer 1, just run 10 games
```

Results are written to `eval-results/` (gitignored) as timestamped JSON.

**What to watch for while playing:**
- Does the invigilator catch contradictions you notice in the dialogue?
- Does the invigilator miss obvious guilty knowledge leaks? (This is the
  signal detection problem the eval harness tests.)
- When evidence is `PRESENT`ed, does the invigilator's quality rating (0–3)
  match what you'd judge by reading the dialogue?
- Does the witness ever meaningfully contradict the suspect?
- Does Case Strength feel earned — do the per-turn deltas track with how
  the conversation actually went?

---

## Model

Anthropic Claude Haiku 4.5 (`claude-haiku-4-5`) via `@ai-sdk/anthropic`,
selected using `ANTHROPIC_API_KEY` in `.env.local`. All four schemas (persona
suspect/witness + invigilator suspect/witness) use the same `MODEL` export
from `adjudicate.ts` — swapping models/providers is a one-line change there.

V3 makes **16 model calls per game** (vs 8 in V2). The invigilator's system
prompt is large (full case context) but static/cacheable. Check
`session.usage` (surfaced in the post-game breakdown's token summary) against
Anthropic's published Haiku 4.5 pricing ($1.00/1M input, $5.00/1M output)
before claiming a cost number publicly.

---

## Environment

- Keys live in `.env.local` (gitignored, never committed). See
  `.env.example` for the minimal Anthropic setup. The CLI checks for a key
  before play, and model request failures are surfaced rather than replaced
  with pretend dialogue. Both `adjudicate.ts` and the CLI entry points self-load
  `.env.local` via `dotenv.config()` at module top — this matters because
  static imports evaluate before an importing script's own `dotenv.config()`
  call runs, so provider factories that read `process.env` eagerly at import
  time need the env already loaded.
- **Deployment target: Render**, chosen over Railway/Fly.io/a small VM for
  its persistent-disk guarantee across restarts and redeploys (requires a
  paid plan — no free-tier disk). `ANTHROPIC_API_KEY` is a server-side-only
  Render environment variable, never shipped to the client. See
  `docs/decisions.md` (2026-10-15) for the full host comparison.
- **`PLAYTEST_LOGS_DIR`** (optional env var, read in
  `src/cli/transcript.ts`) — set this to the Render disk's mount path (e.g.
  `/var/data/playtest-logs`) in production. Every persistent-disk host
  mounts its volume at a fixed path that is *not* the app's working
  directory, and `createTranscriptLog()` otherwise resolves its log folder
  relative to `process.cwd()` — unset, logs would be written outside the
  mounted disk and lost on redeploy. Unset in local/CLI dev, it falls back
  to the previous cwd-relative `playtest-logs/` behavior unchanged.

---

## Design decisions already settled — don't relitigate

Carried over from V1 where still applicable, V3-specific ones added:

- **No database.** CLI process holds the seed; state is regenerated from it.
  Nothing to persist, nothing to leak.
- **Post-game breakdown costs zero model calls.** Everything needed is
  already in session state: truth timeline, full annotated claim ledgers
  (with invigilator contradiction tags), which evidence was presented and the
  invigilator's per-item quality rating, the turning point (largest CS jump),
  per-turn invigilator reasoning, and token usage total.
- **Two agents, one provider.** The persona and invigilator share the same
  model. This simplifies config and keeps the portfolio story clean. If the
  invigilator needs a stronger model than the persona, that's a future split.
- **Invigilator returns signals, not deltas.** The invigilator's structured
  response contains named findings (contradictions with claim IDs, guilty
  knowledge leak descriptions, evidence quality ratings, demeanor shift
  boolean). The engine applies `SCORING_CONFIG` weights. This preserves the
  "model judges; engine scores" invariant.
- **Claim ID validation.** `scoreSuspectTurn()` verifies that any
  `againstClaimId` in an invigilator contradiction signal actually exists in
  the claim ledger before counting it. Hallucinated claim IDs are silently
  dropped. This prevents the invigilator from inflating the score.
- **Evidence starts `presented: false` for all items, every game.** No item
  is ever pre-revealed — the player must choose to formally present each one
  via `PRESENT eN:`.
- **The suspect is always guilty in Phase 1.** Hardcoded, not randomised.
  Innocent-suspect mode is an explicit Phase 2 scope item, not an oversight.
- **Murder only for V3.** The arson template was removed from the codebase
  entirely (2026-10-18) rather than kept on disk — see
  `docs/decisions.md`.

---

## Portfolio signals (for AI Engineer / FDE interviews)

This project demonstrates:
- **Multi-agent orchestration** — two LLM calls per turn with different
  information boundaries, error handling, and graceful degradation
- **LLM-as-judge pattern** — invigilator evaluates model output against
  ground truth, returning structured signals
- **Structured output contracts** — four Zod schemas enforced via Vercel AI
  SDK `generateObject()`, no prose parsing
- **Deterministic scoring with LLM-detected signals** — the model finds
  things, the engine does math
- **Information boundary design** — three views of the same case (player,
  suspect, judge), enforced by `toPublicCase()` and prompt construction
- **Eval pipeline** — Layer 1 (hand-crafted precision/recall on the judge)
  + Layer 2 (automated gameplay at scale)
- **Seeded deterministic generation** — `generate()` is pure, every case is
  reproducible from a seed

---

## Open items / known gaps (check before assuming something is done)

- **Web UI implemented** (Express API + vanilla JS/HTML/CSS front-end under
  `public/`), manually playtested end-to-end this round against
  `test-seed-1` through all three endings (RELEASED, CHARGED_WEAK,
  CHARGED_STRONG) — reveal screen and breakdown data confirmed correct for
  each. **Not yet deployed** — `docs/decisions.md` (2026-10-15) records the
  Render decision; deploy is on hold, the user plans to deploy from their
  own website/hosting instead of this machine.
- **`README.md` rewritten to match V3** and **`AIRTIGHT-PRD.md` deleted**
  (2026-10-18) — the stale V1 doc pair this section used to warn about no
  longer exists; `README.md` is now a trustworthy current-state summary
  alongside this file.
- **Crime-template flavor content (names, locations, currency) was
  regenerated to a consistent UK setting** (2026-10-18) — a prior session
  had silently generated Indian names/places/₹ inconsistently mixed with
  UK emergency numbers and police ranks. Fixed across `shared.ts` and all
  11 template files that existed at the time (10 homicide + arson, before
  arson was removed). `npm run verify` green after the change.
- **No prompt-injection handling in the V3 suspect schema** — V1 had an
  explicit `injectionAttempt` flag. Whether an in-character guilty suspect
  needs a "break character" mechanic is an open question.
- **Cost per playthrough unverified** for the 16-call pattern.

