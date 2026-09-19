# AIRTIGHT — working notes for Claude Code

An LLM-driven interrogation game. The player is a guilty suspect; the objective
is to survive twelve rounds of questioning without the detective assembling a
chargeable case.

Read `README.md` for what exists and `AIRTIGHT-PRD.md` for the full design
before making changes. **M0 is complete and verified — don't rebuild it.**

---

## Hard invariants

Break any of these and the game stops working. `src/cli/verify.ts` enforces
the first two; run `npm run verify` after touching the engine.

1. **`generate()` must stay pure.** The server regenerates the case file from the
   seed on every turn instead of persisting it. Any impurity — a `Date.now()`, a
   `Math.random()`, a module-level mutable — desynchronises the session mid-game
   and silently invalidates the eval harness.

2. **Never serialise a `CaseFile` to the client.** Always route through
   `toPublicCase()`. It is a security boundary: it drops the truth timeline,
   every evidence `vulnerability`, all latent evidence, witness flaws and the
   fatal fact. If any of that reaches the browser the game is solved in devtools.

3. **The model judges; the engine scores.** All arithmetic on meters and evidence
   weights lives in TypeScript, never in a prompt. This is what makes difficulty
   a config file you can tune in seconds and what makes the game feel fair
   instead of arbitrary.

4. **The adjudicator returns structured output only.** No prose parsing, no
   regex over model text. Small discrete integer scales (0–3) — not 1–10, which
   is unstable across calls.

5. **Feed the claim ledger, never the transcript.** Each turn the adjudicator
   normalises the player's assertion into a compact claim record. Context stays
   flat across all twelve turns instead of growing, and "does this contradict
   claim c3" is far more reliable than "spot the inconsistency in 4,000 tokens."

---

## Architecture

```
seed + crime  ──>  generate()  ──>  CaseFile (server only)
                                      │
                                      ├─> toPublicCase()  ──>  browser
                                      │
player answer ──>  adjudicator (1 Haiku call, structured JSON)
                                      │
                                      └─> scoring engine (pure TS)
                                            ├─ claim ledger
                                            ├─ evidence weights
                                            ├─ Case Strength / Suspicion
                                            └─ ending check
```

Two meters in deliberate tension: **Case Strength** (what the detective can
prove) and **Suspicion** (how you're behaving). Silence is safe on the first and
catastrophic on the second — that tension is the game.

Three endings: CHARGED (Case Strength ≥ 80 at any point), RELEASED (round 12 with
< 50), HELD 48 HOURS (round 12 at 50–79).

---

## Next milestone: M1

Adjudicator + scoring engine + terminal play loop. **The game must be fully
playable in a terminal at the end of M1** — no UI until M3, because tuning
against a CLI is several times faster than tuning through a browser.

Deliverables:
- `src/engine/adjudicate.ts` — the Haiku call and its structured contract
- `src/engine/score.ts` — pure scoring, config-driven, no model involvement
- `src/engine/ledger.ts` — claim ledger accumulation and contradiction tracking
- `src/cli/play.ts` — interactive terminal interrogation

The adjudication contract and scoring table are specified in the PRD (§5.4).
Keep the scoring weights in one exported config object so M4 tuning is a
single-file change.

---

## Model

Claude Haiku 4.5 (`claude-haiku-4-5`). $1/$5 per MTok, cache reads at $0.10/M.
Put it behind a thin `adjudicate()` interface so the provider is swappable in
one file.

Mark the system prompt + case file block with `cache_control` — it's static for
the whole session and read twelve times. Cache minimum is 1,024 tokens, which
the case file clears comfortably.

Target: **under $0.05 per full playthrough**, verified by a token counter that
ships in the UI. Track `usage` from every response and thread it through to the
session total.

---

## Environment

- `ANTHROPIC_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY` / `OPENAI_API_KEY`,
  depending on provider) in `.env.local`, never committed. In production it's a
  Vercel environment variable readable only by server-side code.

---

## Design decisions already settled — don't relitigate

- **The player is always guilty.** Innocent-suspect mode is a v2 idea.
- **The claim ledger is hidden during play**, revealed in full on the post-game
  breakdown.
- **The detective may bluff** about evidence — 0–1 times per game, targeting
  something the player has already claimed. A bluff must be a *trap, not a tax*:
  flatly denying it costs nothing, but building a story on top of fake evidence
  creates a contradiction with reality. All bluffs must be labelled in the
  post-game breakdown or a player who lost to one feels cheated.
- **Prompt injection is a mechanic, not a bug.** Detect it, flag
  `injectionAttempt: true`, have the detective respond in character, spike
  Suspicion by 20. Do not filter it out — its visibility is the point.
- **No database.** Client holds the seed; server regenerates hidden state from it.
- **Post-game breakdown costs zero model calls** — everything needed is already
  in state. Include the turning point (largest Case Strength jump), the full
  annotated ledger, evidence weight deltas, vulnerabilities the player never
  found, and which detective claims were bluffs.
