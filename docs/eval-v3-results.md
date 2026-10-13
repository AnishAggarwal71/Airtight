# V3 Eval Results — Invigilator Prompt Tuning

Post-tuning measurements for the V3 two-agent architecture. All runs use
Claude Haiku 4.5 via `@ai-sdk/anthropic`. Baseline was collected on the
pre-fix code; post-fix runs include the A.1 prompt precision edits and the
`maxTurnDelta: 25` cap.

## Layer 1 — Invigilator Accuracy (18 hand-crafted cases)

| Metric | Baseline (pre-fix) | Post-fix | Target |
|--------|-------------------|----------|--------|
| Precision | 0.391 | **0.667** | ≥ 0.65 |
| Recall | 0.90 | **0.80** | ≥ 0.80 |
| Passed | 7/18 | **10/18** | — |

### What changed

The dominant baseline failure was **demeanor shift over-firing** (9/11
failures had `demeanorShift: expected false, got true`). The
`previousDemeanor` threading fix (force false on turn 1, compare against
prior turn's demeanor) eliminated this entirely — zero post-fix failures
are demeanor-only.

Remaining post-fix failures (8/18):
- 4× spurious extra contradiction (the invigilator flags a second
  claim ID when only one was expected — e.g. flagging both c1 and c2
  when only c1 was the true contradiction). Rule 3b ("quote both
  statements") reduced but didn't fully eliminate this.
- 2× missed signal (1 GK leak, 1 minor contradiction) — acceptable
  recall cost from tightening the bar.
- 2× evidence quality rating off by 1–2 points or missing entirely.

### Recall trade-off

Recall dropped from 0.90 → 0.80. The two missed signals:
- `gk-bottle-canal`: the invigilator correctly noted the suspect
  mentioned the canal but classified it as speculative rather than a
  guilty knowledge leak, likely because the tightened GK bar ("specific
  fact an innocent person couldn't guess") made the canal reference
  borderline.
- `ev-wifi-terrible`: a minor contradiction (suspect's flat denial
  vs. prior vague timeline) was not flagged, likely because the
  tightened severity bar ("logically incompatible") made the
  invigilator treat it as evasion rather than contradiction.

Both are defensible judgment calls at the tighter bar. No critical
signal categories (major contradictions, clear GK leaks) were missed.

## Layer 2 — Automated Gameplay (10 games)

| Metric | Baseline (pre-fix) | Post-fix | Target |
|--------|-------------------|----------|--------|
| CHARGED_STRONG | 10/10 (100%) | **6/10 (60%)** | 50–70% |
| CHARGED_WEAK | 0/10 | **4/10 (40%)** | — |
| Mean CS | 90 | **77** | 70–85 |
| Median CS | 89 | **82** | — |
| Min / Max CS | 81 / 100 | **58 / 93** | — |
| Max per-turn Δ | 55 | **25** | ≤ 25 |

### Signal frequency (per game)

| Signal | Baseline | Post-fix |
|--------|----------|----------|
| Contradictions | 2.6 | **1.7** |
| GK leaks | 0.3 | **0.1** |
| Demeanor shifts | 3.1 | **0.7** |
| Witness contradictions | 0.1 | **1.2** |

Demeanor shifts dropped from 3.1 → 0.7 per game (the single biggest
driver of the over-easy baseline). Witness contradictions increased —
likely because the scripted detective now gets to witness turns more
often (games last longer when the suspect isn't blown open by turn 4).

### Per-turn delta distribution

No delta exceeds the `maxTurnDelta: 25` cap. Typical turns land in the
3–11 range; 23–25 deltas appear on turns where multiple real signals
(major contradiction + evidence quality + demeanor shift) stack
legitimately. The +55/+46/+39 outlier turns from baseline are gone.

### Game-by-game

| Game | Final CS | Ending | Turns | Max Δ | Contradictions | GK | Demeanor |
|------|----------|--------|-------|-------|----------------|----|---------:|
| 0 | 79 | WEAK | 8 | 25 | 2 | 0 | 0 |
| 1 | 59 | WEAK | 8 | 14 | 2 | 0 | 2 |
| 2 | 60 | WEAK | 8 | 10 | 0 | 0 | 0 |
| 3 | 80 | STRONG | 8 | 23 | 1 | 0 | 0 |
| 4 | 82 | STRONG | 6 | 25 | 2 | 0 | 1 |
| 5 | 87 | STRONG | 8 | 25 | 1 | 0 | 1 |
| 6 | 86 | STRONG | 7 | 25 | 3 | 0 | 0 |
| 7 | 58 | WEAK | 8 | 16 | 1 | 0 | 1 |
| 8 | 87 | STRONG | 8 | 25 | 2 | 1 | 0 |
| 9 | 93 | STRONG | 6 | 25 | 3 | 0 | 2 |

## Decision: `guiltyKnowledgeLeak` weight stays at 15

The plan specified lowering `guiltyKnowledgeLeak` from 15 → 10 only if
Layer 2 still skewed high after the prompt fix. Since all targets are
met with the prompt fix + `maxTurnDelta` cap alone, **no weight change
is needed**. `SCORING_CONFIG` is unchanged from its pre-tuning state
except for the addition of `maxTurnDelta: 25`.

## Cost per game (Haiku 4.5)

Average per game: ~39K input tokens, ~4K output tokens.
At Haiku 4.5 pricing ($1.00/1M input, $5.00/1M output):
~$0.04 input + ~$0.02 output ≈ **$0.06 per game**.
