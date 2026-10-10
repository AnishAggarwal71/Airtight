# M2 eval harness — results

Source: `npm run eval` (`src/cli/eval.ts`, cases in `src/eval/cases.ts`). Isolates
the adjudicator's contradiction-detection judgment only — one live
`adjudicate()` call per case against a planted claim, not full playthroughs.
See `CLAUDE.md`'s "Model" section for the model this feeds into.

## How to read these numbers

- **Precision** — of everything the model flagged as a contradiction, how much
  was real. Low precision means the model falsely accuses the player, which
  breaks the fairness invariant in `CLAUDE.md`.
- **Recall** — of everything that was actually a contradiction, how much the
  model caught. Low recall means the model lets the player get away with lies.
- A run is only trustworthy if its log has zero
  `[adjudicate] Model call failed, using safe defaults` lines. A failed call
  silently returns `contradictions: []`, which looks identical to a real true
  negative unless the log is checked — this bit us twice this session (see
  Known contamination below).

## Results

| Model | Provider | Precision | Recall | F1 | Accuracy | TP/FP/FN/TN | Status |
|---|---|---|---|---|---|---|---|
| gemini-3.5-flash-lite | Google | 100% | 25% | 40% | 65% | 2/0/6/9 | Real, clean baseline |
| liquid/lfm-2.5-2.6b:free | OpenRouter | 0% | 0% | 0% | 53% | 0/0/8/9 | Real, clean — strictly worse than Gemini |
| nvidia/nemotron-3-super-120b-a12b:free | OpenRouter | — | — | — | — | — | Unusable — burns the 2048-token output budget on chain-of-thought before ever emitting JSON; every call fails `NoObjectGeneratedError` |
| qwen/qwen3.8-27b:free | OpenRouter | — | — | — | — | — | No data — every call blocked by OpenRouter's account-wide daily free-tier quota, exhausted by the nemotron + lfm runs before qwen got a turn |
| grok-4.20-reasoning | xAI | — | — | — | — | — | Pending — `XAI_API_KEY` currently rejected by xAI's server as invalid; being checked against console.x.ai on a separate machine |

## Interpretation

Gemini never falsely accuses (100% precision) but misses roughly 3 in 4 real
contradictions — especially ones that require inference rather than a bare
keyword clash (e.g. "just the two of us on the boat" implying a prior
alone-together trip). That directly weakens the CONFRONT-phase "your own
words catch up with you" mechanic, which is the emotional core of the game.

Neither free-tier OpenRouter model tried has beaten Gemini: one is strictly
worse (0% recall), one is structurally incompatible with the adjudicator's
2048-token structured-output budget. No real second data point exists yet —
the Grok run is next.

## Known contamination (excluded from the table above)

- An early Gemini run showed 38% recall — traced to 429 rate-limit fallbacks
  (Gemini's free tier caps at 15 req/min) silently returning safe defaults.
  Fixed by adding a 4.5s delay between eval cases in `eval.ts`; the re-run
  confirmed zero failed-call log lines before the 25% recall number above was
  trusted.
- The qwen row above is fully contaminated (every call hit the quota wall)
  and carries no real signal — kept in the table only to record that it was
  attempted, not as a result.

## Environment note (not project config)

Live model calls in this environment currently require
`NODE_EXTRA_CA_CERTS` pointed at an exported bundle of macOS system root
certs, to work around a corporate TLS-inspection proxy that Node's own CA
store doesn't trust by default. This is a local-machine workaround, not
something the project or other environments need — deliberately not
committed anywhere in the repo.
