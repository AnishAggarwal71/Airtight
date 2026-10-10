# Playtest notes

**This file is owned by the testing machine.** The build machine owns
`CLAUDE.md` and `docs/decisions.md` — if you're testing, log findings here
instead of editing those directly, so the two machines don't collide on the
same file across a `git pull`. The build-side agent folds anything settled
out of this log into `CLAUDE.md` / `decisions.md` and may prune entries once
they've been incorporated — don't treat this file as permanent history, treat
`decisions.md` as that.

Each entry: date, what you ran (seed/crime, model), what happened, and
whether it's a bug, a tuning issue, or just a note. Flag anything that
touches the known open risks in `CLAUDE.md` (self-judging honesty,
cost/latency, prompt-injection handling) explicitly so it's easy to find.

Newest entries at the top.

---

## Template

```
## YYYY-MM-DD — short description

**Ran:** `npm run play -- <seed> <crime>` against <model/provider>

**What happened:** ...

**Category:** bug | tuning | question | praise

**Severity (if bug):** blocks play | annoying | cosmetic
```

---

<!-- Add entries below this line -->

## 2026-10-11 — First successful human playtests and five-game eval

**Ran:** Two real-player playthroughs of `test-seed-1` / homicide with
locality `Banglore`, plus `npm run eval -- --games 5`, using the configured
Claude Haiku 4.5 model. Tester reports combined spend of about $0.45; this
could not be independently confirmed from local files because billing data is
not available here.

**What happened / feedback:**

- The concept is interesting, but the evidence items and murder scene need to
  be more intuitive and engaging. Revisit evidence clarity, variety, and how
  the murder scene is introduced.
- Let players choose when to question the witness: before the suspect, after
  the suspect, or between suspect turns. If between, keep the two witness
  questions together as one block.
- The CLI truncates long evidence claims, making the table hard to read. For
  example, the wine-rack and debt items ended with `...none fou` and
  `...repayment d`. Show complete evidence text (possibly wrapped across lines).
- Both latest human transcripts are present under gitignored `playtest-logs/`:
  `2026-10-10T21-04-52-462Z-test-seed-1-12936.jsonl` has six suspect turns
  and one witness turn; `2026-10-10T21-35-10-996Z-test-seed-1-13400.jsonl`
  has six suspect turns and two witness turns. Both logged all exchanges
  without a request failure.
- The latest saved five-game eval report is
  `eval-results/eval-2026-10-10T22-30-31-026Z.json`. It records Claude
  Haiku 4.5, all 5 Layer 2 games completed (4 `CHARGED_STRONG`, 1
  `CHARGED_WEAK`), mean Case Strength 84, and Layer 1 at 7/18 passed
  (precision 0.36, recall 0.90). Total Layer 2 usage was 141,821 input and
  16,490 output tokens; this report does not include provider billing totals.
  A preceding report,
  `eval-results/eval-2026-10-10T22-21-24-293Z.json`, records Layer 1 at
  5/18 passed (precision 0.36, recall 0.90).
- The local eval report identifies `claude-haiku-4-5` as the model. The
  reported $0.45 is plausible but cannot be verified from the transcript or
  eval JSON alone; reconcile against the provider console for an exact spend.
  For cheaper iteration, consider a controlled small A/B run on the same
  seeds using a lower-cost model/provider, but retain the target model for
  final evals because structured-output reliability and judge accuracy may
  change with the model.

**Category:** tuning | UX | question

## 2026-10-02 — Turn-six guilty-knowledge leak not scored; witness JSON validation failed

**Ran:** `test-seed-1` / homicide / locality `banglore` against GroqCloud.
Transcript: `2026-10-02T11-32-27-498Z-test-seed-1-12220.jsonl`.

**What happened:**

- All six suspect turns completed. On turn 5, after the detective mentioned
  fingerprints on the murder weapon but did not identify it as a bottle, the
  suspect volunteered: “The bottle was in the kitchen and I didn’t touch it.”
  On turn 6, the detective correctly challenged this as information never
  disclosed by the detective. The suspect avoided addressing the point, and
  the transcript shows no visible response to the trap.
- The transcript records dialogue and presented evidence, but not structured
  model metadata or per-turn scoring. The code’s Case Strength signals depend
  on model-reported evidence quality, self-contradiction, and
  `inadvertentReveal`; it does not independently detect a prior-turn
  guilty-knowledge leak or reward a vague/non-responsive answer. The actor is
  also asked to self-judge its own behavior. This is a concrete instance of
  the known self-judging risk, not enough evidence to conclude the model is
  simply incapable.
- Evidence was formally presented on turns 3 (`e1,e3`) and 6 (`e5,e2`).
  Turn 5’s fingerprint claim was only dialogue, not formally presented
  evidence. On turn 6, the suspect’s prose does not address either presented
  item, but without its structured `evidenceResponses` and score delta we
  cannot confirm how the engine rated that response.
- The first witness question failed with
  `Failed to validate JSON. Please adjust your prompt. See 'failed_generation'
  for more details.` This is a structured-output validation failure from the
  Groq request path, not evidence of an invalid API key. The current surfaced
  error omits the provider’s detailed failure payload, so the specific
  schema/output mismatch cannot be determined from this run.

**Suggested developer follow-up:**

1. Add an independent judge for suspect turns to assess the dialogue against
   the previous suspect dialogue/claim ledger and hidden guilty knowledge,
   including detection of unsolicited knowledge and evasive non-answers.
   This addresses the demonstrated self-judging weakness but adds model calls,
   latency, and cost. Alternatively, keep one call and treat prompt/scoring
   heuristics as a cheaper but less reliable interim measure.
2. Extend transcripts with per-turn Case Strength before/after/delta and the
   structured scoring signals, so playtesters can tell whether an observed
   behavior was detected and how it affected the meter.
3. Preserve useful provider validation details (with API keys redacted) and
   consider a bounded retry or recoverable witness-turn failure for Groq
   structured-output errors, so one malformed response does not end the run.

**Category:** bug

**Severity (if bug):** blocks play

## 2026-10-02 — Persisting playtest transcripts

`npm run play` now saves each detective/AI exchange as it happens to a
gitignored JSONL file under `playtest-logs/`. Transcript files include the
case seed and crime, the exact detective input (including `PRESENT eN:`),
the suspect or witness dialogue, phase/turn, and presented evidence ID where
applicable. The CLI prints the path at game start; completed exchanges remain
saved even if a playthrough is quit early.
Each submitted turn is logged before its model request begins. Completed turns
get an `exchange` record; request failures get a `turn_failed` record with the
error message (API-key values are redacted). If the process is interrupted
before a completion/failure record can be written, the unmatched
`turn_started` record still shows the submitted input.

Homicide playthroughs optionally ask for a city/region and country (not a
street address). The location is used as the backdrop for the fictional scene;
the current name pool is unchanged. The location is saved in the transcript
header so a case can be regenerated with the same setting. Skipping the prompt
preserves the existing generated setting.

During interrogation, evidence can be presented with `PRESENT e3: question`.
Multiple items can be presented in one turn with `PRESENT e1,e3: question`.
The suspect assesses each item separately; combined evidence quality is
averaged for that turn so listing more items does not multiply the score.

## 2026-10-02 — Auditing failed turn-six playthrough

**Ran:** `test-seed-1` / homicide against GroqCloud; transcript
`2026-10-01T21-08-18-520Z-test-seed-1-14508.jsonl`.

**What happened:** The saved transcript contains only five successful suspect
exchanges and no error event, so it cannot identify why turn six failed. In
the generated case, the suspect's last building activity was at 23:11 while
the exit was recorded at 23:10. The same ordering defect occurred in 63/500
sampled homicide seeds. The scene chronology has been constrained and a
verification check added. The five visible answers largely repeated the
cover story; no evidence was formally presented, so this run did not exercise
the evidence-response scoring path.

**Category:** bug

**Severity (if bug):** annoying
