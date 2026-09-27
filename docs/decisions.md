# Decision log

Reverse-chronological. Each entry: what was decided, why, and what it
superseded or deferred. `CLAUDE.md` stays the settled/current-state summary —
the reasoning, dead ends, and things ruled out live here so they aren't
relitigated from scratch next session.

## 2026-09-27 — Default adjudicator model swapped to xAI Grok (pending validation)

**Decision:** `MODEL` in `src/engine/adjudicate.ts` now points at
`xai('grok-4.20-reasoning')`, replacing the Gemini 3.5 Flash Lite default
from M1.

**Why:** The M2 eval baseline (`eval-m2-results.md`) showed Gemini has 100%
precision but only 25% recall on contradiction detection — it's too
conservative, missing anything that requires inference rather than a bare
keyword clash. A reasoning-capable model was the next thing to test against
the same harness.

**Status:** Blocked. The `XAI_API_KEY` added to `.env.local` reaches xAI's
server but is rejected as invalid (`"Incorrect API key provided"`). Being
checked against console.x.ai (key validity / billing / org) on a separate
machine. Until this resolves, running the game or the eval harness with this
key silently falls back to safe defaults on every adjudicator call — check
for `[adjudicate] Model call failed` before trusting any output.

## 2026-09-27 — Tried OpenRouter as a free-tier alternative before paying for xAI/Anthropic

**Decision:** Added `OPENROUTER_API_KEY` support
(`createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', ... }).chat(modelId)`
— note `.chat()`, not the bare call, since OpenRouter only implements the
Chat Completions API, not OpenAI's Responses API) to test whether any
free-tier model could close Gemini's recall gap without new spend.

**Why:** OpenRouter aggregates many providers' free-tier models behind one
key — worth trying before committing to a paid model.

**Outcome:** Ruled out for now, not a dead end forever.
`nvidia/nemotron-3-super-120b-a12b:free` rambles past the 2048-token output
budget on chain-of-thought before ever emitting JSON — unusable with
`generateObject()`'s strict schema requirement.
`liquid/lfm-2.5-2.6b:free` runs cleanly but never flags a single
contradiction (0%/0% — strictly worse than Gemini).
`qwen/qwen3.8-27b:free` never got real data — the account-wide daily
free-tier quota (shared across all `:free` models on the account) was
exhausted by the two runs above before qwen got a turn. Would need $10 of
OpenRouter credit to test properly; not revisited this session.

## 2026-09-27 — Rejected: raising `maxOutputTokens` from 2048 to 4096

**Decision:** Declined. `maxOutputTokens: 2048` in `adjudicate()`'s
`generateObject()` call is unchanged.

**Why:** Proposed as a fix for nemotron's chain-of-thought rambling eating
the whole output budget before JSON. Explicitly rejected — treat as settled
unless revisited with a specific new reason.

## 2026-09-27 — Built the M2 eval harness (contradiction-detection precision/recall)

**Decision:** Added `src/cli/eval.ts` + `src/eval/` (17 hand-authored cases),
fulfilling the PRD's long-deferred M2 scope.

**Why:** The only prior evidence the adjudicator worked was "it felt right
in playtesting." A real, repeatable precision/recall number gives an actual
baseline to measure any future model swap against, instead of vibes.

**Outcome:** Real, trustworthy Gemini baseline established — see
`eval-m2-results.md` for the full table and methodology (including two
runs that turned out to be contaminated by rate-limit fallbacks and had to
be discarded).

## 2026-09-27 — PROBE-phase evidence hints now carry a non-revealing `topic`, not the claim

**Decision:** `Evidence` items gained an optional `topic` field
(`src/engine/types.ts`); PROBE-phase prompts (`buildUserMessage` in
`adjudicate.ts`) pass the detective this topic instead of the evidence's
full claim, and `evidencePlayed` is now explicitly scoped to only fire when
the claim itself was stated out loud.

**Why:** Previously PROBE and CONFRONT both received the full evidence claim,
so a PROBE-phase question could accidentally tip off exactly what the
detective already knew, undercutting the intended "walls closing in" arc
where CONFRONT should land as a consequence of the player's own PROBE-phase
answer, not a cold ambush.
