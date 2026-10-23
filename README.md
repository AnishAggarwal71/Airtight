# AIRTIGHT

**An LLM-driven interrogation game where you are the detective.**

Build a case against an AI suspect before they talk their way free. Each case is generated deterministically from a seed; a guilty AI suspect sustains a cover story under questioning, a separate AI witness can corroborate or contradict that story, and an independent AI judge — not the suspect itself — decides what actually damages the case.

> **Status: V3 two-agent architecture implemented, type-checked, and passing `npm run verify`.** Live human playtests have been run against Claude Haiku 4.5 (transcripts under `playtest-logs/`), and the eval harness has been run and tuned: Layer 1 invigilator accuracy sits at precision 0.667 / recall 0.80 (10 of 18 hand-crafted cases passed), and Layer 2 automated gameplay (10 games) produced a 6/10 `CHARGED_STRONG` rate with a mean Case Strength of 77 *(these Layer 2 numbers predate the 2026-10-15 witness/clamp rule changes and are pending a re-run)*. Full results in [`docs/eval-v3-results.md`](docs/eval-v3-results.md); raw reports in `eval-results/`.

## Why it exists

AIRTIGHT is a portfolio project about building dependable LLM systems, not merely wrapping a chat completion in a UI. It explores a constrained multi-agent game loop where one model performs a role, a second model judges that performance from a bird's-eye view, deterministic TypeScript owns state and scoring, hidden ground truth stays private, compact claim ledgers replace growing transcripts, and behaviour is replayable from a seed.

See [the portfolio brief](docs/portfolio.md) for the project narrative, architecture, design decisions, current scope, and evaluation plan.

## How it works

1. **Setup.** Each case is generated from a seed: a guilty suspect, a hidden true timeline, a cover story, and a claim ledger. The player only ever sees the public case — the briefing and evidence — never the hidden timeline or the suspect's strategy.
2. **The loop.** The player gets six questions for the suspect and can present evidence. The suspect (a persona agent) answers in character, improvising without knowing what evidence the detective holds. A separate invigilator agent then checks that answer against the hidden state — contradictions with the claim ledger, guilty-knowledge leaks, how the evidence was handled, demeanor shifts. It does not judge how persuasive the answer sounded.
3. **Case Strength.** One meter, starting at 15, that only rises — it never drops. Each turn's gain is capped at 25 points, on both suspect turns and witness turns.
4. **The witness.** Becomes callable once Case Strength climbs above 50. Can be called exactly once, for two extra questions that don't come out of the suspect's six.
5. **Endings.** Case Strength reaching 80 at any point ends the game immediately as a strong charge. If the questions run out first, 50–79 is a qualified charge; below 50, the suspect walks — that's the detective failing to build the case, not proof the suspect was innocent.
6. **Why it's built this way.** Models are too agreeable to reliably judge how convincing their own performance was, so the invigilator never rates persuasiveness — only consistency against hidden ground truth — and a pure scoring engine, not a prompt, turns those checks into the number.

See `docs/decisions.md` for the full writeup of why the architecture split the acting and judging roles apart.

## Run it

```bash
npm install
npm run verify

# Inspect deterministic cases (no API key required)
npm run case homicide
npm run case:public homicide
npm run case test-seed-1 homicide

# Play against a model
Copy-Item .env.example .env.local
npm run play
npm run play -- test-seed-1 homicide
```

Add `ANTHROPIC_API_KEY` to `.env.local`. The game uses Claude Haiku 4.5 (`claude-haiku-4-5`) for both the persona and invigilator agents. Keys are local only and must never be committed.

Server spend cap (web deployment): each turn reserves $0.01 of model cost against a per-session limit ($0.08, about one full game) and a server-wide daily limit. The daily limit defaults to $2 and is set with the optional `MAX_DAILY_SPEND_USD` env var; when it is used up, new games are refused until the next UTC day.

During play:

```text
PRESENT e3: Why does the phone record place you there?
PRESENT e1,e3: Explain both of these records.
/evidence     # reprint available evidence
/status       # reprint Case Strength
/quit         # leave early and see the breakdown
```

Questions are capped at 300 characters. Homicide cases can optionally use a city/region and country as fictional scene context. Each playthrough saves a JSONL transcript under `playtest-logs/`.

Evaluation harness (also requires the API key):

```bash
npm run eval                     # Layer 1: 18 hand-crafted invigilator accuracy cases
npm run eval -- --games 10       # Layer 1 + 10 automated full-game runs
```

Results are written to `eval-results/` as timestamped JSON.

## Current implementation

| Area | What is here now |
|---|---|
| Cases | Deterministic seeded generation. **Homicide only** is active for V3 — 10 distinct scenario templates. Embezzlement is a Phase 2 placeholder. |
| Persona Agent | Structured suspect/witness actor: dialogue, normalized claims, demeanor. Does not see what evidence the detective has or any evidence's vulnerability — it improvises in character. |
| Invigilator Agent | A separate LLM-as-judge call with full case context (truth, vulnerabilities, persona, claim ledger) that returns structured signals: contradictions (tagged to claim IDs), guilty-knowledge leaks, evidence-handling quality (0–3), demeanor shifts. |
| Scoring | Pure TypeScript with all tuning weights in `SCORING_CONFIG`; the engine reads invigilator signals and does the arithmetic — the model never scores itself. |
| State | A compact claim ledger (suspect `c` prefix, witness `wc` prefix), evidence presentation state, Case Strength history, ending state, and token usage. |
| Safety boundary | `toPublicCase()` exposes the detective's evidence while withholding the truth timeline, evidence vulnerabilities, suspect persona/strategy, and the fatal fact. |
| Verification | Determinism, leak safety, template integrity, coverage, and output variance checks via `npm run verify` (15 checks, zero model calls). |
| Eval harness | Layer 1: 18 hand-crafted invigilator-accuracy cases (precision 0.667, recall 0.80, 10/18 passed). Layer 2: automated full-game runner with a scripted detective (6/10 `CHARGED_STRONG`, mean Case Strength 77 over 10 games) — *Layer 2 numbers predate the 2026-10-15 witness/clamp rule changes and are pending a re-run.* See [`docs/eval-v3-results.md`](docs/eval-v3-results.md). |

## Project map

```text
src/engine/
  generate.ts       seeded case generation and public/private boundary
  adjudicate.ts     Persona Agent (suspect mode): prompt + structured-response call; exports MODEL
  witness.ts        Persona Agent (witness mode): prompt + structured-response call
  invigilator.ts    Invigilator Agent: LLM-as-judge, structured signals, retry logic
  ledger.ts         compact suspect and witness claim ledgers
  score.ts          pure scoring configuration and ending checks
  session.ts        game-loop orchestration (persona -> ledger -> invigilator -> score)
  templates/        homicide (active, 10 scenarios), embezzlement (placeholder)
src/eval/
  cases.ts          18 hand-crafted invigilator accuracy cases
  detective.ts       Layer 1 (invigilator accuracy) and Layer 2 (automated gameplay) runners
src/cli/
  play.ts           interactive terminal experience and post-game breakdown
  eval.ts           eval harness CLI
  verify.ts         generator and leak-safety verification
  inspect.ts        full or public-case inspection
  transcript.ts     JSONL playtest logging
docs/
  portfolio.md      portfolio-ready project brief
  decisions.md      architectural decision log
  playtest-notes.md findings from manual testing
```

## Important design choices

**The suspect acts; the invigilator judges; the engine scores.** The suspect generates dialogue and claims. A separate judge with full case context evaluates them. Case Strength arithmetic, thresholds, and outcomes live in code so the game can be tuned and explained — and so the suspect is never asked to grade its own performance.

**The transcript is not the memory.** The system passes a small, normalized claim ledger between turns instead of repeatedly sending the full conversation. That controls context growth and gives both the witness and the invigilator precise claims to confirm, contradict, or evaluate.

**Ground truth stays private.** The player can inspect all available evidence, but not the suspect's cover story, the evidence's exploitable weaknesses, or the actual timeline. Those are revealed only in the zero-call post-game breakdown.

**Every case is reproducible.** A seed and crime type always produce the same case, which makes bugs replayable and evaluation possible without a database.

## Next

Live playtesting and the eval harness run are done against the CLI — see the status line above and [`docs/eval-v3-results.md`](docs/eval-v3-results.md) for the full numbers (Layer 2 numbers predate the 2026-10-15 witness/clamp rule changes and are pending a re-run). The mid-game witness call and the Case Strength 50 witness-unlock gate described above are now implemented in the engine. A web UI exists (Express API + browser client) and has been manually playtested end-to-end against all three endings, but is **not yet deployed** — the plan is to deploy from the user's own hosting rather than this machine. More templates and innocent-suspect mode remain future scope.

For the detailed portfolio framing, read [docs/portfolio.md](docs/portfolio.md).
