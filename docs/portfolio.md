# AIRTIGHT: Portfolio Project Brief

## Summary

AIRTIGHT is an LLM-driven interrogation game that puts the player in the role of a detective. A procedurally generated case supplies a suspect, victim, evidence, witness, and hidden ground truth. The player interrogates an AI suspect, then a separate AI witness, and decides whether the case is strong enough to charge.

The project demonstrates applied LLM engineering: not simply whether a model can produce dialogue, but whether a system can make that behaviour bounded, stateful, testable, explainable, and fun.

## The problem

Long-running LLM interactions often fail in ways a one-turn demo hides. An interrogation makes those failures visible: a suspect has to preserve a cover story, react to evidence, avoid leaking guilty knowledge, and remain distinct from a witness. Letting the model invent unrestricted facts, own the score, or see hidden state would make the game arbitrary.

AIRTIGHT treats those problems as product requirements. The loop is deliberately constrained so it can focus on consistency across turns, a real public/private information boundary, typed outputs, deterministic rules, and an explanation of the outcome.

## Why I built it

This is a portfolio artifact first and a game second. It makes several engineering decisions visible:

- Designing an LLM as one component in a system, rather than the system itself.
- Using schema-validated structured output instead of parsing prose.
- Keeping scoring deterministic, inspectable, and tunable.
- Protecting hidden state so a player cannot solve the game in developer tools.
- Building reproducibility and observability before UI polish.
- Documenting a real model-architecture risk and a measured fallback.

The game format is intentional: if the system works, it feels like a coherent interrogation; when it fails, the failure is concrete enough to diagnose.

## What the player does

1. Choose a homicide or arson case. A seed produces a repeatable briefing and five evidence items.
2. Ask up to six questions of a guilty AI suspect. Formally present evidence with `PRESENT eN: question`.
3. Ask up to two questions of a separate AI witness with limited, honest knowledge.
4. Build Case Strength through contradictions, poor evidence responses, guilty knowledge, demeanor shifts, and witness testimony.
5. Charge with a strong case, gamble on a weaker case, or release the suspect.
6. Review a zero-call post-game breakdown: truth, cover story, evidence weaknesses, ledgers, turning point, and token usage.

The suspect is always guilty in the current phase. This keeps early work focused on fair interrogation mechanics; innocent-suspect mode is a later, explicit scope item.

## Architecture

```text
                     deterministic generator
seed + crime --------------------------------> private CaseFile
                                                    |
                                                    | toPublicCase()
                                                    v
                                             detective briefing
                                             (evidence visible)
                                                    |
detective question --> suspect actor --> typed response --> scoring engine
                              |                   |              |
                              |                   v              v
                              |              claim ledger    Case Strength
                              v
                 hidden cover story, truth, vulnerabilities

detective question --> witness actor --> typed response --> corroboration
```

### Deterministic case generation

`generate({ seed, crime })` is pure: the same seed and crime yield the same case. Templates and a seeded RNG, not an LLM, make generation instant and free, let a playtest be reproduced exactly, and eliminate the need to persist private case state in a database.

### Security boundary

The internal `CaseFile` contains the truth timeline, fatal fact, suspect persona and cover story, evidence vulnerabilities, and witness-only knowledge. The player gets `PublicCase`, which includes usable evidence but excludes strategy and ground truth. `npm run verify` tests this boundary.

### Two distinct AI roles

The suspect and witness use separate prompts and model calls. The suspect is a guilty actor preserving a cover story; the witness is an honest but bounded observer who can contradict specific suspect claims. This gives the player genuine triangulation instead of an omniscient single persona.

### Structured outputs and a claim ledger

Zod validates model responses. The suspect returns dialogue, normalized claims, evidence-response quality, demeanor, and possible self-contradiction or guilty-knowledge signals. The witness returns dialogue, claims, and an optional contradiction of a specific suspect claim.

The system carries those compact claims forward rather than replaying the complete transcript every turn. That limits context growth, makes cross-turn checking easier, and produces a readable post-game record.

### The model acts; the engine scores

`SCORING_CONFIG` holds all score weights in TypeScript. The LLM supplies structured signals; code applies arithmetic and determines the ending. This keeps the Case Strength meter tunable and makes every outcome explainable.

## Current scope

V2 is implemented as a terminal game and passes deterministic generation, leak-safety, template-integrity, coverage, and variance checks. There is one playable homicide template and one playable arson template. Embezzlement is reserved for Phase 2. Sessions are saved as gitignored JSONL transcripts for manual review.

The next priority is live-model playtesting, not more features: actor consistency, witness usefulness, latency, and actual token cost all need evidence from real sessions.

## Key technical risk

For efficiency, a suspect call both acts in character and reports whether it contradicted itself or leaked guilty knowledge. A model may under-report its own mistakes, weakening the score.

This is a deliberate, testable trade-off. If playtests show the self-report is unreliable, the fallback is a two-call design: one actor generates dialogue and claims, then a separate judge evaluates them against the ledger and private truth. It is not implemented prematurely because it adds latency and cost.

## Evaluation and observability

```bash
npm run verify
```

The present verification suite checks engine properties without model calls. An earlier V1 precision/recall harness is retained as history but does not match V2’s actor contract. The V2 evaluation plan measures:

- suspect cover-story consistency across turns;
- honesty of self-reported contradictions and reveals;
- calibration of evidence-response quality;
- usefulness and accuracy of witness corroboration;
- latency and tokens per full session.

Every transcript can be replayed from its seed and crime type. The post-game breakdown surfaces the state necessary to understand a result without spending additional model tokens.

## Technology

- TypeScript, Node.js, and `tsx`
- Vercel AI SDK and Zod structured outputs
- GroqCloud by default (`openai/gpt-oss-20b`), with xAI fallback support
- Seeded `cyrb128` + `sfc32` random generation
- Terminal UI today; web interface later

## Explore the project

```bash
npm install
npm run verify
npm run case:public homicide

# After adding GROQ_API_KEY to .env.local
npm run play -- test-seed-1 homicide
```

At the end of a session, AIRTIGHT reveals the hidden timeline and strategy so the player can understand exactly what they proved, missed, or were deceived by.

## Next steps

1. Playtest the V2 actor loop and validate the self-judging assumption.
2. Build and publish a V2-specific evaluation harness.
3. Tune scoring and prompts from transcripts.
4. Add deterministic case templates and innocent-suspect mode.
5. Build the web presentation and optional reviewer/debug view.

The intended end state is not an open-ended role-play bot. It is a small, replayable LLM system where the boundaries, state, rules, uncertainty, and trade-offs are visible by design.
