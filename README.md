# AIRTIGHT

**An interrogation game where you're the detective and the suspect is an AI.**

**Play it: https://airtight-rust.vercel.app**

You get a case file, a handful of evidence, six questions and one witness. The
suspect is guilty, knows exactly what happened, and has a cover story ready.
Your job is to catch them out before the questions run out.

Behind the scenes, one model plays the suspect and a second, independent model
judges every answer against the hidden truth. A small, deterministic scoring
engine turns those judgements into the Case Strength meter, so the score is
explainable rather than a model's opinion of itself.

## How a game works

1. **The case.** Each case is generated from a seed: victim, suspect, a
   hidden true timeline, the suspect's cover story, and 4-5 pieces of
   evidence. You see the briefing and all the evidence up front. You never see
   the truth, the cover story, or each item's weak spot.
2. **Questioning.** You get six questions. Ask anything, or formally present
   evidence. The suspect answers in character and has no idea what evidence
   you hold, so it has to improvise when you play one.
3. **Judging.** After each answer, a separate judge with the full case
   (truth, evidence weak spots, everything the suspect has claimed so far)
   reports what happened: contradictions with earlier claims, slips that only
   the killer would know, how well the evidence was handled (0-3), and shifts
   in demeanor. It never rates how convincing the answer sounded.
4. **Case Strength.** One meter, starting at 15. The engine turns the judge's
   findings into points, at most 25 per turn.
5. **The witness.** Unlocks once Case Strength passes 50. Two extra questions,
   once per game, at any point.
6. **Endings.** Reach 80 at any point for a strong charge. Otherwise, when the
   questions run out: 50-79 is a shaky charge, under 50 the suspect walks.
7. **The breakdown.** After the game you see the truth, every claim the
   suspect made, which ones broke, and the judge's reasoning per turn. It costs
   no extra model calls.

## Why it's built this way

- **The actor and the judge are separate calls.** In an earlier version the
  suspect reported its own slips. It never did, and the score never moved.
  Splitting acting from judging fixed that.
- **The model finds things; code does the maths.** The judge returns named
  signals, not scores. All weights live in `SCORING_CONFIG`
  (`src/engine/score.ts`), so difficulty is a config change.
- **A claim ledger, not the transcript.** Each answer's factual claims are
  stored as short records with IDs (`c1`, `c2`...). The judge cites those IDs,
  and a cited ID that doesn't exist is dropped, so it can't invent a
  contradiction.
- **The answer key never leaves the server.** The seed regenerates the whole
  hidden case, so the browser never receives it, and the player only ever
  gets the public view of a case (`toPublicCase()`).
- **Reproducible.** The same seed always produces the same case, so any game
  can be replayed while debugging.

More detail: [`docs/technical-breakdown.md`](docs/technical-breakdown.md)
(how it all works), [`docs/portfolio.md`](docs/portfolio.md) (project brief)
and [`docs/decisions.md`](docs/decisions.md) (why things are the way they are).

## Run it locally

Needs Node 20.11 or newer (below 25).

```bash
npm install
npm run verify                    # 19 checks, no API key or model calls

# Look at generated cases (no key needed)
npm run case homicide             # full case, including the hidden truth
npm run case:public homicide      # exactly what the player sees
npm run case test-seed-1 homicide # pin a seed
```

To play, copy `.env.example` to `.env.local` and add an `ANTHROPIC_API_KEY`.

```bash
npm run dev                       # web game at http://localhost:3000
npm run play                      # terminal version
npm run play -- test-seed-1 homicide
```

Terminal commands: `PRESENT e3: your question` presents evidence (or
`PRESENT e1, e3: ...` for several), `/evidence`, `/status`, `/witness`,
`/quit`.

Locally, sessions live in memory and no Redis is needed. Set
`ALLOW_CLIENT_SEED=1` and open `http://localhost:3000/?seed=<seed>` to replay
a specific case in the browser.

## Deploy your own (Vercel)

1. Import the repo into Vercel. **Framework Preset: Express.** Leave the build
   command, output directory and install command empty.
2. **Storage → Upstash Redis**, connected to the project. That adds
   `KV_REST_API_URL` and `KV_REST_API_TOKEN` (`UPSTASH_REDIS_REST_URL` and
   `_TOKEN` also work). The app refuses to start on Vercel without Redis.
3. Environment variables (Production):

   | Name | |
   |---|---|
   | `ANTHROPIC_API_KEY` | required |
   | `SESSION_SECRET` | required on Vercel, 32+ random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `MAX_DAILY_SPEND_USD` | optional, default `2` |
   | `TRANSCRIPTS` | optional; `off` stops recording games (then delete the notice in `public/index.html`) |

   Never set `ALLOW_CLIENT_SEED` in production (it is ignored there anyway).
4. Deploy. Env var changes need a new deployment to take effect.

## Cost and limits

A game makes 16 model calls (two per turn) on Claude Haiku 4.5 and costs about
$0.05-0.06. The server caps spend at $0.08 per game and `MAX_DAILY_SPEND_USD`
per day (about 40 games at the default $2), and rate-limits per IP. Each
answer is capped at 25 points and each question at 300 characters.

Players can use **their own Anthropic key** from the start screen. It's kept in
that browser tab only, passed to Anthropic per request, and never stored or
logged. Those games skip the daily cap (the per-game cap still applies).

**Data:** web games are recorded in Redis for 14 days (`tx:<session id>`,
secrets redacted) and the start screen says so. Nothing is stored
permanently. CLI games write JSONL to `playtest-logs/` (gitignored).

## Evaluation

```bash
npm run eval                      # Layer 1: 18 hand-written judge accuracy cases
npm run eval -- --games 10        # plus 10 automated full games
npm run eval -- --layer2-only 50  # 50 games, no Layer 1
```

Latest run (2026-10-25, Haiku 4.5): judge precision **0.692**, recall
**0.90** (13/18 cases). Five automated games averaged Case Strength 74, with
2 strong and 3 shaky charges. A 50-game run is the next measurement. Details
in [`docs/eval-v3-results.md`](docs/eval-v3-results.md); raw reports in
`eval-results/`.

## Project map

```text
src/engine/        the game: case generation, persona agent, judge, scoring
  generate.ts      seed -> case, and the public/private split
  adjudicate.ts    suspect persona (exports MODEL)
  witness.ts       witness persona
  invigilator.ts   the judge
  score.ts         SCORING_CONFIG and endings
  session.ts       one turn: persona -> ledger -> judge -> score
  templates/       10 homicide scenarios
src/server/        Express API: sessions, spend cap, locks, rate limits, logs
src/index.ts       Vercel entry point
src/cli/           play, verify, inspect, eval
src/eval/          eval cases and runners
public/            browser UI (vanilla JS)
docs/              technical breakdown, decisions, eval results, brief, hardening
```

## Status and scope

Live and playable. Phase 1 is homicide only, and the suspect is always guilty.
More templates and an innocent-suspect mode are future scope.
