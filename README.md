# AIRTIGHT

**An LLM-driven interrogation game where you are the detective.**

Build a case against an AI suspect before they talk their way free. Each case is generated deterministically from a seed; a guilty AI suspect sustains a cover story under questioning, a separate AI witness can corroborate or contradict that story, and an independent AI judge — not the suspect itself — decides what actually damages the case.

> **Status: V3 two-agent architecture implemented, type-checked, and passing `npm run verify`.** It is a terminal game. What hasn't happened yet: a live playthrough against a real model and a run of the eval harness.

## Why it exists

AIRTIGHT is a portfolio project about building dependable LLM systems, not merely wrapping a chat completion in a UI. It explores a constrained multi-agent game loop where one model performs a role, a second model judges that performance from a bird's-eye view, deterministic TypeScript owns state and scoring, hidden ground truth stays private, compact claim ledgers replace growing transcripts, and behaviour is replayable from a seed.

See [the portfolio brief](docs/portfolio.md) for the project narrative, architecture, design decisions, current scope, and evaluation plan.

## How it works

```text
seed + crime -> deterministic case generator -> private CaseFile
                                               |
                                               +-> public case briefing + evidence

detective question -> Persona Agent (suspect) -> dialogue + claims -> claim ledger
                                               |
                                               +-> Invigilator Agent (judge, full case context)
                                               |
                                               +-> pure scoring engine -> Case Strength

two witness questions -> Persona Agent (witness) -> dialogue + claims -> same judge/score flow
                                               |
                                               +-> charge, gamble, or release
```

Two model calls per turn: the Persona Agent generates in-character dialogue immediately, then the Invigilator Agent — which sees the full truth, evidence vulnerabilities, and claim ledger — returns structured signals (contradictions, guilty-knowledge leaks, evidence-handling quality, demeanor shifts). The engine converts those signals into Case Strength deltas with fixed weights; the model never does the arithmetic.

This exists because the earlier single-call design had the suspect self-report its own slips, and it never did — Case Strength stayed flat regardless of how badly the suspect contradicted itself. See `docs/decisions.md` for the full writeup.

The player receives a briefing and 4–5 evidence items, asks up to six questions of the suspect, then up to two questions of a witness. Evidence can be formally presented during an interrogation. Case Strength starts at 15 and reaches 80 for a strong charge; otherwise the player chooses whether to gamble on a charge or release a guilty suspect.

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

During play:

```text
PRESENT e3: Why does the phone record place you there?
PRESENT e1,e3: Explain both of these records.
/evidence     # reprint available evidence
/status       # reprint Case Strength
/quit         # leave early and see the breakdown
```

Questions are capped at 300 characters. Homicide cases can optionally use a city/region and country as fictional scene context. Each playthrough saves a gitignored JSONL transcript under `playtest-logs/`.

Evaluation harness (also requires the API key):

```bash
npm run eval                     # Layer 1: 18 hand-crafted invigilator accuracy cases
npm run eval -- --games 10       # Layer 1 + 10 automated full-game runs
```

Results are written to `eval-results/` (gitignored).

## Current implementation

| Area | What is here now |
|---|---|
| Cases | Deterministic seeded generation. **Homicide only** is active for V3 — one playable stairwell template. Arson stays on disk for portfolio breadth but is excluded from play/verify. Embezzlement is a Phase 2 placeholder. |
| Persona Agent | Structured suspect/witness actor: dialogue, normalized claims, demeanor. Does not see what evidence the detective has or any evidence's vulnerability — it improvises in character. |
| Invigilator Agent | A separate LLM-as-judge call with full case context (truth, vulnerabilities, persona, claim ledger) that returns structured signals: contradictions (tagged to claim IDs), guilty-knowledge leaks, evidence-handling quality (0–3), demeanor shifts. |
| Scoring | Pure TypeScript with all tuning weights in `SCORING_CONFIG`; the engine reads invigilator signals and does the arithmetic — the model never scores itself. |
| State | A compact claim ledger (suspect `c` prefix, witness `wc` prefix), evidence presentation state, Case Strength history, ending state, and token usage. |
| Safety boundary | `toPublicCase()` exposes the detective's evidence while withholding the truth timeline, evidence vulnerabilities, suspect persona/strategy, and the fatal fact. |
| Verification | Determinism, leak safety, template integrity, coverage, and output variance checks via `npm run verify` (8 checks, zero model calls). |
| Eval harness | Layer 1: 18 hand-crafted invigilator-accuracy cases. Layer 2: automated full-game runner with a scripted detective. Built, not yet run against a live model. |

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
  templates/        homicide (active), arson (on disk, excluded from play), embezzlement (placeholder)
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

The immediate priority is a live playthrough: validate invigilator accuracy against real (not hand-crafted) suspect dialogue, and run the eval harness to calibrate. A web UI, more templates, and innocent-suspect mode follow only after the two-agent loop proves itself against a live model.

For the detailed portfolio framing, read [docs/portfolio.md](docs/portfolio.md).
