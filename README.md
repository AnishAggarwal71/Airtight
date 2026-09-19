# AIRTIGHT

**An LLM-driven interrogation game.** You did it. Now talk your way out.

A procedurally generated crime, an AI detective who remembers every word you say,
and twelve questions between you and a cell.

> **Status: M0 complete.** Scenario engine built and verified. No model calls yet —
> the adjudicator lands in M1.

---

## Run it

```bash
npm install
npm run verify                   # M0 sanity checks
npm run case                     # random case, full ground truth
npm run case mallard-7719 arson  # a specific case
npm run case:public mallard-7719 homicide   # what the browser would receive
```

Copy `.env.example` to `.env.local` and add your model API key before running
`npm run play`.

---

## What M0 built

```
src/engine/
  types.ts              CaseFile, Evidence, PublicCase
  rng.ts                seeded deterministic RNG (cyrb128 + sfc32)
  generate.ts           seed + crime → CaseFile, and the public-view boundary
  templates/
    homicide.ts         3 templates
    arson.ts            3 templates
    embezzlement.ts     3 templates
src/cli/
  inspect.ts            print a case file
  verify.ts             determinism, leak-safety, integrity, variance
```

Nine templates across three crime types, each producing a 4–6 beat ground-truth
timeline, 8 evidence items, 1–2 witnesses, and a fatal fact the detective builds
toward. Slot randomisation on names, times, locations, amounts, and which
evidence starts revealed means the same template yields a different case every
seed — verified at 10+ distinct cases per template across 120 seeds.

---

## Three decisions worth knowing

### Scenario generation is deterministic and costs nothing

No model call. Three payoffs: it's free, which is the biggest single lever on
cost per playthrough; it's instant, so there's no spinner between "start" and
the first question; and it's **reproducible**, which is the only reason the eval
harness in M2 can exist. A fixed seed is a fixed scenario to test against.

`generate()` must stay pure — the server regenerates the case file from the seed
on every turn rather than storing it, so any impurity desynchronises the session
mid-game. `verify.ts` asserts this.

### The case file never reaches the browser

`toPublicCase()` is a security boundary, not a convenience. It drops the truth
timeline, every evidence `vulnerability`, all latent evidence, witness flaws and
the fatal fact. If any of that reached the client the game would be solved in
devtools, so `verify.ts` checks all of it across 180 generated cases.

This is also why there's no database. The client holds the seed; the server
regenerates hidden state from it on demand. Nothing to persist, nothing to leak,
and sessions are shareable as a URL.

### Every piece of evidence has a crack in it

The `vulnerability` field is the quiet centre of the design. It's the innocent
explanation a sharp player might find, and it's never shown during play:

> **claim:** The fire investigator found an irregular burn pattern across the
> concrete at the rear racking — what they'd call a pour pattern.
>
> **vulnerability:** Irregular floor patterns were treated as proof of accelerant
> for decades and then the research showed flashover produces the same marks with
> no accelerant at all.

When a player's answer lands near it, the adjudicator scores the explanation high
and the evidence weight drops hard. That's the moment the game comes alive — and
it's why arson earns its slot, because fire investigation evidence is genuinely
contestable rather than merely inconvenient.

---

## Next

| Milestone | Deliverable |
|---|---|
| **M0** ✅ | Scenario engine, 9 templates, verification suite |
| **M1** | Adjudicator (Haiku 4.5, structured output) + scoring engine + CLI play loop — **game fully playable in a terminal** |
| **M2** | Eval harness, ~40 cases, published precision/recall on contradiction detection |
| **M3** | Next.js UI |
| **M4** | Tuning — 50 playthroughs |
| **M5** | Post-game breakdown, notebook panel, cost counter, replay mode |
| **M6** | Deploy, rate limits, writeup |

The engine and its evals come before any UI on purpose. The game is playable at
M1 in a terminal, and tuning against a CLI is several times faster than tuning
through a browser.

See `AIRTIGHT-PRD.md` for the full design.
