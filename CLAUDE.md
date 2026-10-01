# AIRTIGHT — working notes for Claude Code

An LLM-driven interrogation game. **The player is the detective.** The AI plays
a guilty suspect (and a witness) who must lie convincingly across a limited
set of questions while the player tries to build a chargeable case.

> **Two-machine workflow:** this project is being built on one laptop and
> tested on another, each with its own Claude Code session. This file is the
> shared source of truth between them — keep it current on every substantive
> change (architecture, invariants, file map, how to run things) so the other
> machine's agent can pick up context cold. Session-specific noise (what we're
> mid-debugging *right now*) belongs in conversation, not here — but settled
> decisions, new files, and anything that changes "how do I run/test this"
> belongs in this file immediately, not as a follow-up.

Read `README.md` for a user-facing overview and `AIRTIGHT-PRD.md` for the
original design doc — **both still describe V1 (player-as-suspect) and are
stale.** Treat this file as the current-state source of truth until they're
rewritten.

**Status: V2 role-flip redesign implemented, not yet playtested with a live
model.** All three implementation layers (types/templates, engine, CLI) are
done, type-checked, and passing `npm run verify`. What hasn't happened yet:
an actual playthrough against a live API, and tuning the scoring config
against real transcripts.

---

## Docs index

This file is the settled/current-state summary. The reasoning behind
decisions, dead ends ruled out, and detailed results live in `docs/*.md`
instead — check there before relitigating something that was already tried.

- [`docs/decisions.md`](docs/decisions.md) — reverse-chronological decision
  log: what was decided, why, and what it superseded or deferred.
- [`docs/eval-m2-results.md`](docs/eval-m2-results.md) — M2 eval harness
  precision/recall results per model (V1 adjudicator-as-judge contract —
  doesn't apply to V2's actor model, kept for history).
- [`docs/playtest-notes.md`](docs/playtest-notes.md) — **owned by the testing
  machine.** Raw playtest findings land here first; this (build) side folds
  anything settled into this file or `decisions.md` and may prune entries
  once incorporated. Don't edit `CLAUDE.md`/`decisions.md` from the testing
  side directly — write here instead, to avoid both machines colliding on
  the same file across a `git pull`.

New file per topic when a topic grows past a few paragraphs (e.g. a future
`docs/eval-v2-results.md` once the V2 eval harness exists); index it here
with a one-line description rather than folding it into this file.

---

## The role flip (V1 → V2)

V1: player is the guilty suspect, AI is the detective who judges the
player's answers and scores them. V2 inverts this entirely:

- **Player = detective.** Gets a case briefing and 4–5 evidence items upfront,
  asks the suspect up to 6 questions, then questions 1 witness for up to 2
  questions, then decides whether to charge.
- **AI = suspect actor (+ witness persona).** The model now *generates*
  in-character dialogue as a guilty suspect who must maintain a consistent
  cover story, exploit the cracks in evidence against them, guard guilty
  knowledge, and only crack under real pressure. A second, independent model
  call plays the witness, who answers honestly within a limited knowledge
  boundary and may contradict the suspect.
- The model's job changed from **classifier/judge** to **actor**. This is the
  single biggest engineering change in the project — see "The self-judging
  risk" below for the risk it introduces.

Why: a flat classifier task is a thin AI-engineering story for a portfolio.
An actor that has to perform a consistent lie under adversarial questioning,
plus a second persona that can corroborate or contradict it, is a much richer
multi-agent orchestration problem — and it's a better game.

Non-negotiable constraints from the redesign brief (don't relitigate without
a new reason):
- Score the **answer** a question provoked, not the question itself.
- The suspect is **always guilty** in Phase 1. Innocent-suspect mode is
  Phase 2.
- 6 suspect questions, 2 witness questions. Tweakable after playtesting, not
  before.
- 2 crime types shipped (homicide, arson), 1 template each. Embezzlement
  template file exists but exports an empty array — Phase 2.
- 4–5 evidence items per case, shown to the player upfront, not drip-fed.
- Minimal scope on purpose — the goal right now is testing the core loop
  fast, not breadth.

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

3. **The model acts; the engine scores.** (Was "the model judges" in V1.)
   All Case Strength arithmetic lives in `SCORING_CONFIG`
   (`src/engine/score.ts`), never in a prompt. Difficulty is a config-file
   change, and the game feels fair instead of arbitrary.

4. **Structured output only.** No prose parsing, no regex over model text.
   `SuspectResponseSchema` and `WitnessResponseSchema` (Zod) are the only
   contract between the model and the engine. Small discrete integer scales
   (0–3 for evidence response quality) — not 1–10, which is unstable across
   calls.

5. **Feed the claim ledger, never the transcript.** Each turn, the model
   extracts its own new assertions into a compact claim record
   (`src/engine/ledger.ts`). Suspect claims use the `c` prefix, witness
   claims use `wc`. Context stays flat across all turns instead of growing,
   and "does this contradict claim c3" is far more reliable than "spot the
   inconsistency in 4,000 tokens."

---

## The self-judging risk (read this before touching adjudicate.ts or witness.ts)

The suspect model call does two jobs in one shot: it **acts** (writes
in-character dialogue) and **self-judges** (reports its own
`selfContradiction` and `inadvertentReveal` in the same structured response).
This is efficient but structurally risky — a model has no particular
incentive to flag that it just slipped, and if it's a bad judge of its own
output, the Case Strength meter becomes meaningless.

**Known fallback if playtesting shows this is unreliable:** split into two
calls — Call 1 (actor: dialogue + claims only) and Call 2 (judge: given the
dialogue, the claim ledger, and the truth, flag contradictions and reveals
from the outside). This mirrors V1's two-role split, except the model is also
acting in Call 1. Not implemented — do this only if the single-call version
demonstrably misreports itself in playtesting.

---

## Architecture

```
seed + crime  ──>  generate()  ──>  CaseFile (server only)
                                      │
                                      ├─> toPublicCase()  ──>  player (evidence shown, strategy hidden)
                                      │
player question  ──────────────────┬─────────────────────────┐
                                    │                         │
                         interrogateSuspect()         interrogateWitness()
                      (adjudicate.ts, suspect actor)  (witness.ts, separate persona)
                                    │                         │
                                    └───────────┬─────────────┘
                                                 │
                                        scoring engine (pure TS, score.ts)
                                          ├─ claim ledger (suspect + witness)
                                          ├─ self-contradiction / evidence quality / reveals
                                          ├─ Case Strength (single meter)
                                          └─ ending check
```

One meter: **Case Strength** — what the detective can prove. No Suspicion
meter in V2 (that was a V1 player-behaviour signal; doesn't apply when the
AI is the one being pressured).

Three endings:
- **CHARGED_STRONG** — Case Strength ≥ 80 at any point. Clean win.
- **CHARGED_WEAK** — below 80 at the end, player gambles and charges anyway.
  Always correct in Phase 1 since the suspect is always guilty — rewards
  good instinct over a mechanically perfect case.
- **RELEASED** — below 80, player chooses not to charge. The guilty suspect
  walks. Losing condition.

---

## File map (V2)

```
src/engine/
  types.ts              All V2 domain types — read this first, everything depends on it
  rng.ts                Seeded deterministic RNG (cyrb128 + sfc32) — unchanged from V1
  generate.ts            seed + crime → CaseFile; toPublicCase() inverted security boundary
  ledger.ts              Claim accumulation — 'c' prefix (suspect), 'wc' prefix (witness)
  adjudicate.ts          Suspect actor: system prompt, SuspectResponseSchema, interrogateSuspect().
                          Also exports MODEL — the one-line provider swap point.
  witness.ts             Witness persona: system prompt, WitnessResponseSchema,
                          interrogateWitness(). Imports MODEL from adjudicate.ts.
  score.ts               Pure scoring — SCORING_CONFIG, scoreSuspectTurn(), scoreWitnessTurn(),
                          checkEnding(). Tune difficulty here, never in a prompt.
  session.ts             Orchestration — createSession(), playInterrogationTurn(),
                          playWitnessTurn(), resolveVerdict(), parsePlayerInput()
                          (handles "PRESENT eN: question" syntax)
  templates/
    shared.ts            Template contract (TemplateBuild) + name-generation helpers
    homicide.ts           1 template: the stairwell. 5 evidence, 1 witness, suspect persona.
    arson.ts               1 template: the warehouse. 5 evidence, 1 witness, suspect persona.
    embezzlement.ts        Empty array — Phase 2 placeholder, don't build against this yet.
src/cli/
  play.ts                Interactive terminal game: briefing → interrogation → witness →
                          verdict → post-game breakdown (truth + hidden strategy revealed)
  verify.ts              Determinism, inverted leak-safety, template integrity, coverage, variance
  inspect.ts             Dump a full case file, or --public for exactly what the player sees
  eval.ts                STUB. V1's contradiction-detection eval doesn't transfer to an actor
                          model — prints a note and exits. New eval harness is unbuilt.
```

---

## How to run / test this

No model call needed (free, instant — run after any engine change):
```bash
npm run verify                        # 5 checks: determinism, leak-safety, integrity, coverage, variance
npm run case homicide                 # full case file, server-side (truth, vulnerabilities, persona — all visible)
npm run case:public homicide          # exactly what the player-detective sees
npm run case test-seed-1 arson        # pin a seed to inspect the same case repeatedly
```

Requires a model API key in `.env.local` (see `.env.example` — xAI is the
current documented default):
```bash
npm run play                           # crime picker, random seed
npm run play -- test-seed-1 homicide   # pin seed + crime, replay the same case while tuning
```

In-game commands during `npm run play`: `PRESENT e3: your question` to
formally present an evidence item (otherwise it's just a plain question with
no evidence attached), `/evidence` to re-print the evidence table, `/status`
to re-print the Case Strength bar, `/quit` to end early and still see the
breakdown.

**What to actually watch for while playing** (this is the real eval right
now, since the automated harness is deferred):
- Does the suspect's cover story stay consistent across all 6 turns, or does
  it drift without triggering a flagged contradiction?
- When evidence is `PRESENT`ed, does the reported quality (0–3) in the
  post-game breakdown match what you'd judge by reading the dialogue — does
  a "3 — airtight" response actually sound like it used the vulnerability?
- Does `selfContradiction` or `inadvertentReveal` ever fire honestly, or does
  the model protect its own score by never flagging itself? (This is the
  self-judging risk above — if this never fires across many playthroughs
  where it obviously should have, that's the signal to build the Call 1/Call
  2 split.)
- Does the witness ever meaningfully contradict the suspect, or do they stay
  too vague to matter?
- Does Case Strength feel earned — do demeanor shifts and evidence responses
  track with how the conversation actually went?

`npm run eval` currently just prints a stub message and exits 0 — don't rely
on it for anything yet.

---

## Model

Default: **xAI `grok-4.20-reasoning`**, set in `src/engine/adjudicate.ts`'s
exported `MODEL` constant. `witness.ts` imports the same `MODEL` so both
calls share one provider — swap it in one file to change providers for both
the suspect and the witness.

Other providers are commented out in `adjudicate.ts` ready to uncomment:
Google Gemini, Anthropic Claude, OpenAI, OpenRouter (note: OpenRouter needs
`.chat(modelId)`, not the bare call — it only implements the Chat Completions
API, not the Responses API).

No cost target has been re-validated for V2 yet — V1's "$0.05/playthrough"
target assumed Haiku pricing and a single-meter single-call-per-turn loop.
V2 makes 6 suspect calls + up to 2 witness calls per game, with longer system
prompts (full persona + cover story + guilty knowledge). Check
`session.usage` (surfaced in the post-game breakdown's token summary) against
actual provider pricing before claiming a number publicly.

---

## Environment

- Keys live in `.env.local` (gitignored, never committed). See
  `.env.example` for the full list and which variable name each provider
  expects. Both `adjudicate.ts` and the CLI entry points self-load
  `.env.local` via `dotenv.config()` at module top — this matters because
  static imports evaluate before an importing script's own `dotenv.config()`
  call runs, so provider factories that read `process.env` eagerly at import
  time need the env already loaded.
- In production (not yet built) this would be a Vercel environment variable
  readable only by server-side code — no UI exists yet, V2 is terminal-only
  so far, same as V1 was before M3.

---

## Design decisions already settled — don't relitigate

Carried over from V1 where still applicable, V2-specific ones added:

- **No database.** Client (or in V2's terminal-only form, the CLI process)
  holds the seed; state is regenerated from it. Nothing to persist, nothing
  to leak.
- **Post-game breakdown costs zero model calls.** Everything needed is
  already in session state by the time the game ends — the truth timeline,
  the full annotated claim ledgers (suspect + witness), which evidence was
  presented and how the suspect responded to each, the turning point (largest
  Case Strength jump), and the token usage total.
- **Prompt injection is a mechanic, not a bug** (carried from V1, not yet
  re-implemented for V2's suspect-actor prompt — V1 had an explicit
  `injectionAttempt` flag and a Suspicion spike; V2's `SuspectResponseSchema`
  doesn't have an equivalent field yet. Needs a decision: does an in-character
  guilty suspect even have a sensible "break character" mechanic the same way
  a detective judge did? Flag this if it comes up in testing.)
- **Evidence starts `presented: false` for all items, every game.** No item
  is ever pre-revealed — the player must choose to formally present each one
  via `PRESENT eN:`.
- **The suspect is always guilty in Phase 1.** Hardcoded, not randomised.
  Innocent-suspect mode is an explicit Phase 2 scope item, not an oversight.

---

## Open items / known gaps (check before assuming something is done)

- **No live playthrough has happened yet in this project's history for V2.**
  Everything above is implemented and type/logic-verified, but unverified
  against an actual model response. The two risks most likely to surface:
  the self-judging problem above, and prompt-length/latency from the much
  longer suspect system prompt (full persona + cover story + guilty
  knowledge + every evidence vulnerability, all in one cached block).
- **`npm run eval` is a stub.** V1's eval cases tested contradiction-detection
  precision/recall against a judge model — that contract doesn't exist in
  V2. A new eval needs different dimensions: suspect consistency across
  turns, self-report honesty, evidence-response-quality calibration, witness
  corroboration accuracy. Not designed yet.
- **`README.md` and `AIRTIGHT-PRD.md` still describe V1 end-to-end** (player
  as suspect, Suspicion meter, 12-round structure, M0–M6 milestone table).
  Don't trust them for current behavior; this file supersedes them until
  they're rewritten.
- **No prompt-injection handling in the V2 suspect schema** — see the design
  decisions note above.
- **Cost per playthrough unverified** for the new call pattern and model.
