# Decision log

Reverse-chronological. Each entry records what was decided and why, so it
isn't relitigated. `CLAUDE.md` holds the current state; this file holds the
reasoning. Superseded history is condensed under "Ruled out and superseded"
at the bottom. Full original wording is in git history (pre-2026-11-22).

## 2026-11-22 — Live on Vercel: three deploy fixes

The game is live at https://airtight-rust.vercel.app. Getting there took
three fixes, all invisible locally because `tsx` papers over them:

1. **Entry must import `express`.** The Vercel Express preset scans
   `src/index.ts`'s own source for an `express` import and does not follow
   `./server/app.js`. Without it the build fails with "No entrypoint found
   which imports express".
2. **Relative imports end in `.js`.** Vercel compiles each `.ts` to `.js` but
   keeps specifiers as written, and with `"type": "module"` Node's ESM loader
   never guesses extensions (`ERR_MODULE_NOT_FOUND` for `src/server/app`).
   All 169 relative imports now use `.js`, and `tsconfig.json` uses
   `NodeNext` so `npm run typecheck` rejects an extensionless one. Write new
   imports as `'./foo.js'` even though the file is `foo.ts`.
3. **`public/` is bundled into the function.** `GET /` reaches Express, which
   `sendFile`s `public/index.html`, but Vercel only bundles files the code
   imports. `vercel.json` sets `"includeFiles": "public/**"`. (The earlier
   assumption that Vercel's CDN serves `public/` did not hold for `/`.)

Framework Preset must be **Express**; "Other" deploys `public/` as a static
site with no API, which returns a bare Vercel 404 on `/api/*`.

## 2026-11-11 — Plain-voice copy, no em dashes in player-facing text

All player-facing text (start screen, labels, endings, breakdown, template
briefings and evidence, server error messages) was rewritten without em
dashes and without stock product phrasing. Hidden template fields were
de-dashed too, so the persona model has nothing dash-heavy to imitate. The
suspect and witness prompts got a voice rule (`adjudicate.ts` rule 11,
`witness.ts` rule 5): plain speech, contractions, no em dashes, no "I assure
you". It is a prompt instruction, not a guarantee; if dashes appear in live
dialogue, strip them in the response handler rather than adding prompt text.
Ending labels: "Charged, strong case" / "Charged, shaky case" / "Released".
CLI output and code comments keep em dashes on purpose.

## 2026-11-08 — HUD labels (web UI)

Playtesters could not read the interrogation HUD (a bare case number, an
unlabelled bar, six circles, a lock icon). Each element is now labelled
(`CASE`, `CASE STRENGTH` with "Reach 80 for a strong case", `QUESTIONS`,
`WITNESS`). Presentation only; the 80 in `index.html` is a display string
that must be updated by hand if `SCORING_CONFIG.chargedThreshold` changes.

## 2026-10-25 — Case-file drawer and held end state (web UI)

Playtesters could not retain the briefing across six questions, and never saw
the final answer because the outcome overlay opened in the same paint. Added a
**Case file** drawer (briefing + evidence, closed by default) and a held
"Case closed" state with a **View case outcome** button (a button, not a
timer, because reading speed varies). Also: the transcript no longer
re-scrolls on every keystroke, the room art persists at game end, and older
exchanges are more readable (opacity 0.72).

## 2026-10-24 — Bring-your-own-key (BYOK)

A player can play on their own Anthropic key instead of the shared daily
budget. The key travels in the `X-Anthropic-Key` header on every request,
lives in `sessionStorage` only, and is never stored or logged (the session
holds only `byok: true`; the `sk-ant-` shape is already redacted everywhere).
The model is built **per request** and passed as `TurnCallOptions.model`,
never via the global `setModel()`, because concurrent requests share one
instance. BYOK turns skip the shared daily counter but keep the per-session
cap, lock, CAS and rate limits. A provider 401/403 on a BYOK turn is a
friendly 401 `INVALID_API_KEY`; on the shared key it stays a 502, so a server
credential problem is never blamed on the player. Paid credits were
considered and deferred: a game costs ~$0.05 and the audience will not pay.

## 2026-10-23 — Deploy on Vercel; production hardening (steps 0-10)

Vercel replaced Render as the target. Constraint: no change to game design,
scoring, prompts or balance; security, reliability and deployability only.
Each step was one commit, with a verify check. Plain-language explanations
are in `docs/hardening-explained.md`; the current mechanics are summarised
in `CLAUDE.md` (Environment). Reasoning worth keeping:

- **Seed (1).** The seed regenerates the whole hidden case, so it never
  leaves the server. The server picks it (128-bit crypto random); with
  `SESSION_SECRET` set the stored seed is an HMAC of the raw value. In
  practice the HMAC adds little, since the logged and stored value is the
  derived seed itself, but the boot check requires the secret on Vercel.
- **Whole session stored, not just the seed (2),** so a template deploy
  cannot change a case mid-game.
- **Spend cap reserves before it spends (3).** Reserve $0.01 atomically
  against per-session and per-day counters, then settle to actual cost.
  Fail closed: if the store is down, refuse the turn, because uncountable
  paid calls are exactly what this prevents.
- **Lock plus versioned save (4).** The lock (70s TTL, released by
  compare-and-delete) stops concurrent turns; the revision compare-and-set is
  the backstop if a lock expires mid-request. The lock is released before the
  response is sent, so a fast next click never sees a spurious 409.
- **No manual rollback (5).** Each request mutates a private copy and saves
  only on success, so a failed persona call discards everything, including
  `evidence.presented`.
- **Rate limits fail open (6),** because the spend cap, lock and turn limits
  are the fail-closed backstops, and failing closed would turn a Redis blip
  into an outage. IP comes from `x-vercel-forwarded-for` only.
- **Timeouts (7).** A 50s request deadline sits under the 60s function cap and
  the 70s lock TTL, so a lock cannot expire under a running turn. Keep
  `maxDuration` at 60.
- **Logs and errors (8).** Players get fixed sentences; the provider text
  rides along as `ApiError.cause` and is logged scrubbed.
- **Transcripts in Redis (9)** are best-effort: a write failure is logged
  and never fails a paid turn.
- **Repo hygiene (10).** `playtest-logs/` was untracked (still in history).
  `package-lock.json` stays gitignored, so Vercel installs from
  `package.json`. `engines.node` is capped at `<25` so a platform default
  bump cannot change the runtime without a commit.

## 2026-10-19 — Cost, caching and prompt injection

- **Cost is ~$0.05/game** (provider billing), under the $0.08 per-session cap.
- **Prompt caching is not a lever.** Haiku 4.5's minimum cacheable prompt is
  4,096 tokens; the largest system prompt (invigilator) is ~1,658, so
  `cacheControl` breakpoints would be silently ignored. Revisit only if
  prompts grow substantially or the model changes.
- **Invigilator cache-token reporting fixed** (it hard-coded zeros), so usage
  reports are accurate.
- **No prompt-injection defence built.** Three direct override attempts
  against a live model all stayed in character. Exposure is bounded anyway:
  the player sees only `toPublicCase()` and the schema-validated `dialogue`
  string, everything is rendered through `escapeHtml()`, and input is capped
  at 300 characters. Revisit only if a playtest produces a real leak.

## 2026-10-18 — Homicide only; UK setting

Arson was removed from the codebase entirely (not just excluded), leaving 10
homicide templates; embezzlement is an empty Phase 2 placeholder. Template
flavour (names, places, currency, police ranks) was made consistently UK; an
earlier pass had mixed in an unrequested regional setting.

## 2026-10-19 — Case audit (summary)

All 10 templates were audited against mechanical, judgment and set-level
rules (names, timelines, pronouns, briefing fields, method/setting/motive
variety). The first pass found 100+ issues; after fixes, every template
passes. Night Shift, Open Water, Smart Garage and Charity Gala were
substantially reworked. Per-case detail is in git history
(`docs/case-audit.md`, removed 2026-11-22).

## 2026-10-15 — Witness timing and endings

- The witness is callable **once, mid-game**, for two extra questions, and
  unlocks when Case Strength exceeds 50 (`witnessUnlockThreshold`, a separate
  knob from `weakChargeThreshold` even though both are 50).
- **No charge/release choice.** Endings come from Case Strength and question
  exhaustion: >= 80 at any point is `CHARGED_STRONG` immediately; when
  questions run out, 50-79 is `CHARGED_WEAK` and below 50 is `RELEASED`.
  RELEASED reads as detective failure, never suspect innocence.
- Witness turns are clamped to `maxTurnDelta` (25) like suspect turns.

## 2026-10-11 — V3: split acting from judging; Anthropic Haiku 4.5

V2 asked the suspect model to act and to report its own contradictions in one
call. It never flagged itself, so Case Strength stayed at 15 all game. V3
splits it: the **persona agent** acts (dialogue, claims, demeanor) and an
independent **invigilator** judges with full case context, returning signals
(not deltas) that the engine scores. The suspect prompt no longer contains
the evidence or its weaknesses, so it must improvise when evidence is
presented, which is what makes presenting evidence a real move. Same release:
standardised on Anthropic Claude Haiku 4.5 (cheapest current Anthropic model)
behind the single `MODEL` export, and built the two-layer eval harness.

## 2026-10-02 — V2: the player is the detective

V1 had the player as the suspect and the model as a judge: a thin classifier
task. Flipping roles makes the model *act* a consistent lie under adversarial
questioning, with a witness who can corroborate or contradict it. Case
Strength became the only meter; 6 suspect questions plus 2 witness questions.

## Ruled out and superseded

Kept so these are not re-tried from scratch.

- **Render / Railway / Fly.io / a VM** (2026-10-15): superseded by Vercel. The
  persistent-disk reasoning no longer applies; all state lives in Redis.
- **GroqCloud, xAI Grok, Gemini, OpenRouter free models** (Sept to Oct
  2026): replaced by Anthropic. Gemini was precise but missed 75% of
  contradictions; OpenRouter free models either overran the output budget
  before emitting JSON or never flagged anything.
- **Raising `maxOutputTokens` to 4096** (2026-09-27): rejected.
- **V1/M-series design** (player as suspect, Suspicion meter, 12 rounds,
  PROBE/CONFRONT phases, `HELD 48 HOURS` ending, the M2 contradiction eval):
  all superseded by V2/V3. The original PRD and M2 results were removed
  2026-11-22.
- **A player charge/release choice at the end**: removed 2026-10-15.
- **A V1-style `injectionAttempt` flag**: not built (see 2026-10-19).
