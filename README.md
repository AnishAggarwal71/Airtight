# AIRTIGHT

**An LLM-driven interrogation game where you are the detective.**

Build a case against an AI suspect before they talk their way free. Each case is generated deterministically from a seed; the suspect must sustain a cover story under questioning, and an independent AI witness can corroborate or dismantle that story.

> **Status: V2 core loop is implemented and verified.** It is currently a terminal game; live-model playtesting and tuning are the next milestones.

## Why it exists

AIRTIGHT is a portfolio project about building dependable LLM systems, not merely wrapping a chat completion in a UI. It explores a constrained multi-agent game loop where the model performs a role, deterministic TypeScript owns state and scoring, hidden ground truth stays private, compact claim ledgers replace growing transcripts, and behaviour is replayable from a seed.

See [the portfolio brief](docs/portfolio.md) for the project narrative, architecture, design decisions, current scope, and evaluation plan.

## How it works

```text
seed + crime -> deterministic case generator -> private CaseFile
                                               |
                                               +-> public case briefing + evidence

detective question -> AI suspect -> structured response -> pure scoring engine
                                               |
                                               +-> claim ledger

two witness questions -> separate AI witness -> corroboration / contradiction
                                               |
                                               +-> charge, gamble, or release
```

The player receives a briefing and five evidence items, asks up to six questions of the suspect, then up to two questions of a witness. Evidence can be formally presented during an interrogation. Case Strength reaches 80 for a strong charge; otherwise the player chooses whether to gamble on a charge or release a guilty suspect.

## Run it

```bash
npm install
npm run verify

# Inspect deterministic cases (no API key required)
npm run case homicide
npm run case:public homicide
npm run case test-seed-1 arson

# Play against a model
Copy-Item .env.example .env.local
npm run play
npm run play -- test-seed-1 homicide
```

Add `GROQ_API_KEY` to `.env.local` for the default setup. The game uses Groq when that key is present (default model: `openai/gpt-oss-20b`); xAI is the optional fallback. Keys are local only and must never be committed.

During play:

```text
PRESENT e3: Why does the phone record place you there?
PRESENT e1,e3: Explain both of these records.
/evidence     # reprint available evidence
/status       # reprint Case Strength
/quit         # leave early and see the breakdown
```

Questions are capped at 300 characters. Homicide cases can optionally use a city/region and country as fictional scene context. Each playthrough saves a gitignored JSONL transcript under `playtest-logs/`.

## Current implementation

| Area | What is here now |
|---|---|
| Cases | Deterministic seeded generation; homicide and arson each have one playable template. Embezzlement is reserved for Phase 2. |
| Suspect | Structured AI actor response: dialogue, claims, evidence response quality, demeanor, contradictions, and inadvertent reveals. |
| Witness | A separate persona and model call with bounded knowledge that can challenge suspect claims. |
| State | A compact claim ledger, evidence presentation state, Case Strength history, ending state, and token usage. |
| Scoring | Pure TypeScript with all tuning weights in `SCORING_CONFIG`; the model never performs score arithmetic. |
| Safety boundary | `toPublicCase()` exposes the detective’s evidence while withholding the truth timeline, evidence vulnerabilities, and suspect strategy. |
| Verification | Determinism, leak safety, template integrity, coverage, and output variance checks via `npm run verify`. |

## Project map

```text
src/engine/
  generate.ts       seeded case generation and public/private boundary
  adjudicate.ts     suspect actor prompt and structured-response call
  witness.ts        independent witness prompt and structured-response call
  ledger.ts         compact suspect and witness claim ledgers
  score.ts          pure scoring configuration and ending checks
  session.ts        game-loop orchestration
  templates/        homicide, arson, and future embezzlement cases
src/cli/
  play.ts           interactive terminal experience and post-game breakdown
  verify.ts         generator and leak-safety verification
  inspect.ts        full or public-case inspection
  transcript.ts     JSONL playtest logging
docs/
  portfolio.md      portfolio-ready project brief
  decisions.md      architectural decision log
  playtest-notes.md findings from manual testing
```

## Important design choices

**The model acts; the engine scores.** The AI generates dialogue and structured signals. Case Strength arithmetic, thresholds, and outcomes live in code so the game can be tuned and explained.

**The transcript is not the memory.** The system passes a small, normalized claim ledger between turns instead of repeatedly sending the full conversation. That controls context growth and gives the witness precise suspect claims to confirm or contradict.

**Ground truth stays private.** The player can inspect all available evidence, but not the suspect’s cover story, the evidence’s exploitable weaknesses, or the actual timeline. Those are revealed only in the zero-call post-game breakdown.

**Every case is reproducible.** A seed and crime type always produce the same case, which makes bugs replayable and future evaluation possible without a database.

## Next

The immediate priority is live playtesting: validate actor consistency, self-reported contradictions, witness usefulness, latency, and real token cost. If the suspect cannot reliably identify its own slips, the planned fallback is to split acting and judging into separate model calls. A V2 evaluation harness, a web UI, more templates, and innocent-suspect mode follow only after the core loop proves fun and fair.

For the detailed portfolio framing, read [docs/portfolio.md](docs/portfolio.md).
