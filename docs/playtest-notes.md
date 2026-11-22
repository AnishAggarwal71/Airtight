# Playtest notes

**Owned by the testing machine.** Log findings here rather than editing
`CLAUDE.md` or `docs/decisions.md`, so the two machines don't collide on one
file across a `git pull`. The build side folds settled findings into those
files and prunes this one.

Each entry: date, what you ran (live URL or `npm run play -- <seed>`), what
happened, and whether it's a bug, a tuning issue or a note. Newest first.

---

## Template

```
## YYYY-MM-DD — short description

**Ran:** live site | `npm run play -- <seed> homicide`

**What happened:** ...

**Category:** bug | tuning | question | praise

**Severity (if bug):** blocks play | annoying | cosmetic
```

---

## Summary of findings to 2026-11-22 (entries pruned)

- **Fixed:** witness timing (now callable mid-game, `decisions.md`
  2026-10-15); turn-six scoring and witness JSON failures from the Groq era
  (resolved by the V3 split and the move to Haiku 4.5); transcripts now
  persist (Redis on the web, `playtest-logs/` in the CLI).
- **Still open:** the CLI evidence table truncates long claims at 80
  characters (`src/cli/play.ts`, `renderEvidenceTable` and the evidence
  breakdown). The web UI is not affected.
- **Still open, design:** testers found evidence and the scene setup could be
  more intuitive and engaging.

<!-- Add entries below this line -->
