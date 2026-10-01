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
