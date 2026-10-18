# AIRTIGHT: Portfolio Project Brief

## Summary

AIRTIGHT is an LLM-driven interrogation game that puts the player in the role of a detective. A procedurally generated case supplies a suspect, victim, evidence, witness, and hidden ground truth. The player interrogates a guilty AI suspect, then a separate AI witness, while an independent AI judge evaluates every turn from a bird's-eye view and decides whether the case is strong enough to charge.

The project demonstrates applied LLM engineering: not simply whether a model can produce dialogue, but whether a system can make that behaviour bounded, stateful, testable, explainable, and fair — including being honest about where a simpler design failed and why.

## The problem

Long-running LLM interactions often fail in ways a one-turn demo hides. An interrogation makes those failures visible: a suspect has to preserve a cover story, react to evidence, avoid leaking guilty knowledge, and remain distinct from a witness. Letting the model invent unrestricted facts, own the score, or see hidden state would make the game arbitrary — and letting the same call that plays the suspect also judge the suspect turned out, in practice, to make the game broken.

AIRTIGHT treats those problems as product requirements. The loop is deliberately constrained so it can focus on consistency across turns, a real public/private information boundary, typed outputs, deterministic rules, and an explanation of the outcome.

## Why I built it

This is a portfolio artifact first and a game second. It makes several engineering decisions visible:

- Designing an LLM as one component in a system, rather than the system itself.
- Splitting "act" and "judge" into separate model calls once self-judging was shown empirically to fail — not as a hypothetical risk, but as an observed bug.
- Using schema-validated structured output instead of parsing prose.
- Keeping scoring deterministic, inspectable, and tunable.
- Protecting hidden state so a player cannot solve the game in developer tools.
- Building reproducibility and observability before UI polish.
- Running a two-layer eval harness against the judge, not just the actor.

The game format is intentional: if the system works, it feels like a coherent interrogation; when it fails, the failure is concrete enough to diagnose.

## What the player does

1. Start a homicide case. A seed produces a repeatable briefing and 4–5 evidence items.
2. Ask up to six questions of a guilty AI suspect. Formally present evidence with `PRESENT eN: question`.
3. Ask up to two questions of a separate AI witness with limited, honest knowledge.
4. Build Case Strength through contradictions, poor evidence responses, guilty knowledge leaks, demeanor shifts, and witness testimony — all detected by an independent judge, not self-reported by the suspect.
5. Charge with a strong case, gamble on a weaker case, or release the suspect.
6. Review a zero-call post-game breakdown: truth, cover story, evidence weaknesses, ledgers, turning point, per-turn judge reasoning, and token usage.

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
detective question --> Persona Agent (suspect) --> dialogue + claims --> claim ledger
                              |                                              |
                              |                                              v
                              |                              Invigilator Agent (judge)
                              |                              full case context: truth,
                              |                              vulnerabilities, persona,
                              |                              guilty knowledge, ledger
                              |                                              |
                              v                                              v
                 hidden cover story, truth,                      structured signals
                 vulnerabilities (never sent                    (contradictions, GK leak,
                 to the suspect itself)                          evidence quality, demeanor)
                                                                              |
                                                                              v
                                                                     pure scoring engine
                                                                     (SCORING_CONFIG)
                                                                              |
                                                                              v
                                                                       Case Strength

detective question --> Persona Agent (witness) --> dialogue + claims --> same judge/score flow
```

### Deterministic case generation

`generate({ seed, crime })` is pure: the same seed and crime yield the same case. Templates and a seeded RNG, not an LLM, make generation instant and free, let a playtest be reproduced exactly, and eliminate the need to persist private case state in a database.

### Security boundary

The internal `CaseFile` contains the truth timeline, fatal fact, suspect persona and cover story, evidence vulnerabilities, and witness-only knowledge. The player gets `PublicCase`, which includes usable evidence but excludes strategy and ground truth. The boundary is inverted from an earlier version of this game: it now *shows* evidence (the detective needs it) but *hides* the suspect's strategy. `npm run verify` tests this boundary.

### Three agent roles, one architecture

The suspect, witness, and invigilator use separate prompts and model calls:

- **Persona Agent (suspect)** — a guilty actor preserving a cover story. Deliberately does not know what evidence the detective holds or any item's vulnerability, so it must improvise rather than pre-compute a perfect deflection.
- **Persona Agent (witness)** — an honest but knowledge-bounded observer who can contradict specific suspect claims.
- **Invigilator Agent (judge)** — sees everything: the truth, every evidence vulnerability, the suspect's persona and guilty knowledge, and the full claim ledger. It never acts in the scene; it only returns structured signals about what the persona agents just did.

This gives the player genuine triangulation, and gives the game a judge who can actually catch what the suspect would never admit to.

### Why there's a judge at all

An earlier version had the suspect's own model call self-report whether it had just contradicted itself or leaked guilty knowledge, in the same response that generated its dialogue. Playtesting showed this doesn't work: the model never flagged its own slips, so the score stayed flat no matter how badly the interrogation actually went. The fix was architectural, not prompt-tuning — split acting and judging into two calls with two different views of the case, and make the judge's output a structured signal that deterministic code scores. See `docs/decisions.md` for the full incident writeup.

### Structured outputs and a claim ledger

Zod validates every model response — four schemas total: suspect response, witness response, invigilator-on-suspect, invigilator-on-witness. The suspect/witness return dialogue, normalized claims, and demeanor. The invigilator returns named signals (contradictions tagged to specific claim IDs, a guilty-knowledge-leak description or null, per-evidence-item quality ratings, a demeanor-shift boolean) and 2–3 sentences of reasoning.

The system carries compact claims forward rather than replaying the complete transcript every turn. That limits context growth, lets the invigilator reference exact claim IDs instead of re-reading a transcript, and produces a readable post-game record. `scoreSuspectTurn()` validates that any claim ID the invigilator cites against the ledger actually exists before counting it — hallucinated claim IDs are silently dropped, which prevents the judge from inflating the score on a fabricated reference.

### The suspect acts; the invigilator judges; the engine scores

`SCORING_CONFIG` holds all score weights in TypeScript. The invigilator supplies structured signals, never deltas; code applies arithmetic and determines the ending. This keeps the Case Strength meter tunable, makes every outcome explainable, and keeps the one component capable of grading itself — the model — out of the grading.

## Current scope

V3 is implemented as a terminal game and passes deterministic generation, leak-safety, template-integrity, coverage, and variance checks (`npm run verify`, 9 checks, zero model calls). Scope was narrowed to **murder only** for V3 focus: 10 homicide templates are active. Embezzlement is a Phase 2 placeholder. Sessions are saved as JSONL
transcripts under `playtest-logs/` for manual review, and currently kept
(not gitignored) on the build machine intentionally — see `docs/decisions.md`
(2026-10-19) for the retention policy.

The next priority is a live-model playthrough and an eval run, not more features: invigilator accuracy against real suspect dialogue and prompt latency need evidence from real sessions. Actual token cost has real-world evidence now: confirmed ~$0.05/run (2026-10-19) — see `docs/decisions.md` for the analysis, including why prompt caching doesn't apply at this model/prompt size (Haiku 4.5's cache minimum is 4,096 tokens; this project's largest system prompt measures ~1,658).

## Key technical risk — resolved by architecture, now needs calibration

The original key risk was self-judging: a single suspect call both acting in character and reporting its own contradictions. That was resolved, not mitigated — by splitting into a two-agent architecture (above), not by better prompting the same call.

The risk that replaces it: the invigilator is itself an LLM, and LLM-as-judge accuracy is not guaranteed by architecture alone. This is exactly what the Layer 1 eval harness (18 hand-crafted cases spanning guilty-knowledge leaks, contradictions, evidence handling, and demeanor shifts) is built to measure — and it has not yet been run against a live model.

## Evaluation and observability

```bash
npm run verify                   # 8 engine checks, zero model calls
npm run eval                     # Layer 1: 18 invigilator accuracy cases
npm run eval -- --games 10       # Layer 1 + 10 automated full-game runs
npm run eval -- --layer2-only 50 # Layer 2 only, 50 games (full run)
```

The verification suite checks engine properties without model calls: determinism, leak-safety, template integrity, coverage, and variance. The eval harness is two layers:

- **Layer 1** measures invigilator precision/recall against hand-crafted cases where the correct signal is known in advance.
- **Layer 2** runs full automated games against a scripted detective and reports ending distribution, Case Strength statistics, and signal frequency.

Both layers are built and type-checked but have not yet been run against a live model — results land in `eval-results/` once they are.

Every transcript can be replayed from its seed and crime type. The post-game breakdown surfaces the state necessary to understand a result — including per-turn invigilator reasoning — without spending additional model tokens.

## Technology

- TypeScript, Node.js, and `tsx`
- Vercel AI SDK and Zod structured outputs
- Anthropic Claude Haiku 4.5 (`claude-haiku-4-5`) for both the persona and invigilator agents
- Seeded `cyrb128` + `sfc32` random generation
- Terminal UI today; web interface later

## Explore the project

```bash
npm install
npm run verify
npm run case:public homicide

# After adding ANTHROPIC_API_KEY to .env.local
npm run play -- test-seed-1 homicide
```

At the end of a session, AIRTIGHT reveals the hidden timeline and strategy so the player can understand exactly what they proved, missed, or were deceived by.

## Next steps

1. Playtest the V3 two-agent loop against a live model and run the eval harness to calibrate invigilator accuracy.
2. Tune `SCORING_CONFIG` and prompts from real transcripts rather than hand-crafted cases alone.
3. Add a web presentation and optional reviewer/debug view.
4. Add innocent-suspect mode and further case templates as Phase 2 scope.

The intended end state is not an open-ended role-play bot. It is a small, replayable LLM system where the boundaries, state, rules, uncertainty, and trade-offs are visible by design — and where a design decision that didn't survive contact with reality (self-judging) is documented rather than hidden.
