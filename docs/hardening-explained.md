# Hardening explained in plain language

One section per step: **What** we did, **Why**, and **How**. Kept short on
purpose. The engineering reasoning is in [`decisions.md`](decisions.md)
(2026-10-23 and 2026-11-22); the full technical picture is in
[`technical-breakdown.md`](technical-breakdown.md). Add a section here in the
same commit as any new hardening step.

**The big picture.** The game started out running on one computer that stayed
on. On Vercel it runs as many small, short-lived copies of the server that
share nothing, and strangers on the internet can reach it. That breaks
anything kept in the server's memory and makes the API key a target. The
steps below make the game safe and cheap to leave public. The game itself
(rules, prompts, balance) didn't change.

**Status (2026-11-22):** all steps are done and the game is live at
https://airtight-rust.vercel.app. Each step has an automated check in
`npm run verify` (19 checks in total).

**Words used below**
- **Redis (Upstash):** a small shared notebook in the cloud that every server copy can read and write.
- **Atomic:** happens as one indivisible action, so two requests can't both slip through at the same moment.
- **Lua script:** a tiny program Redis runs as one atomic action.
- **TTL:** time to live. Redis forgets the entry after that long.
- **Seed:** the secret value the whole case is generated from. Know the seed, know the answer.

---

## Step 0: Running on Vercel

- **What:** The Express server runs as a single Vercel Function, with the web page bundled inside it.
- **Why:** Vercel runs functions on demand, not an always-on server.
- **How:** `src/index.ts` hands Vercel the Express app. Going live took three fixes that never showed up locally, because the local tool (`tsx`) quietly papers over them:
  1. **Vercel has to see `express` in the entry file.** Its Express setting reads `src/index.ts` and won't follow the import into `server/app.ts`, so the entry file imports `express` itself. The project's Framework Preset must be **Express**: with "Other", Vercel serves only the web page and the API doesn't exist.
  2. **Imports name the real file.** Vercel turns each `.ts` file into `.js` but leaves the imports untouched, and Node won't guess a missing `.js`. So every import is written `'./server/app.js'`, and the TypeScript setting (`NodeNext`) now refuses any import without it.
  3. **The page ships inside the function.** Opening the site reaches Express, which reads `public/index.html` from disk. Vercel only includes files the code imports, so `vercel.json` lists `public/**` explicitly (`includeFiles`).
- **The 60-second setting:** `vercel.json` lets the function run up to 60 seconds (`maxDuration: 60`). Steps 4 and 7 depend on it: a turn gives up at 50 seconds and a lock expires at 70, so the function must not be cut off before 60.
- **Safety at startup:** on Vercel the app refuses to start without `SESSION_SECRET` (32+ characters) or Redis credentials, so a half-configured deploy fails immediately instead of misbehaving.

## Step 1: Keep the seed secret

- **What:** The seed never reaches the browser. The server picks it.
- **Why:** The seed rebuilds the whole hidden case. Anyone who saw it in the browser's network tab could solve the game instantly.
- **How:** `seed` was removed from everything sent to the player, and the seed box was removed from the UI. The server makes a random seed (mixed with `SESSION_SECRET`). For local testing, `ALLOW_CLIENT_SEED=1` lets a developer pin one (`http://localhost:3000/?seed=...`); it is ignored in production.

## Step 2: Games are saved in Redis

- **What:** A game's state lives in Redis, not the server's memory, for 1 hour after the last turn.
- **Why:** Each request may land on a different server copy, so a game kept in memory would vanish between turns. It also means a player can reload the page and carry on.
- **How:** A small `Store` layer (`store.ts`) talks to Upstash Redis on Vercel and to plain memory on a laptop. Each request loads the game, plays the turn, and saves it back. The whole game is saved (not just the seed), so a code update can't change a case someone is in the middle of.

## Step 3: Spend cap

- **What:** Hard limits on model cost: $0.08 per game and $2 per day across all players (adjustable with `MAX_DAILY_SPEND_USD`).
- **Why:** Every turn is paid for with the project's Anthropic key. Without a cap, a script could run up an unlimited bill.
- **How:** Before each turn the server *reserves* $0.01 in Redis. If that would pass a limit, the player is told "The bureau has closed for the day" (HTTP 429) and no model call happens. After the turn the reservation is corrected to the real cost. The check is a Lua script, so ten simultaneous requests can't all squeeze through. If Redis is down, the turn is refused rather than paid for blind.

## Step 4: One request per game at a time

- **What:** Only one turn per game can run at once.
- **Why:** If someone fired 20 requests together, each would see "turns remaining: 6", each would cost money, and the game could get extra turns or lose updates.
- **How:** Two guards:
  1. A lock in Redis (`lock:<game id>`). A second request while one is running gets 409 straight away, before anything is spent. The lock is released just before the answer is sent, so your next click never bumps into it.
  2. A version number on the saved game. An out-of-date copy trying to save over a newer one is refused. This is the backup if a lock ever expires early.

## Step 5: A failed turn costs nothing

- **What:** If the model call fails, the game is exactly as it was before you pressed send. You keep the turn and any evidence you tried to present.
- **Why:** The game marks evidence as "used" and counts the turn *before* asking the model. The old code only undid the turn count by hand, so a flaky API on `PRESENT e1:` silently cost the player e1.
- **How:** The hand-written undo was deleted. Each request works on its own private copy of the game and saves it only after the suspect's reply arrives. A failed request never saves, so everything is discarded in one go. If only the judge fails, the turn still counts with no score change.

## Step 6: Per-visitor rate limits

- **What:** Each visitor (by IP address) gets a ration: 10 new games per hour, 40 questions per 10 minutes (suspect and witness share it), and 120 page reads per minute. Over the limit you see "You're going a little fast. Please wait about N seconds" (HTTP 429).
- **Why:** The spend cap protects the money, but one script could still burn the whole day's budget in minutes and lock out every real player.
- **How:** `ratelimit.ts` counts requests per IP in Redis using a sliding window (no reset-on-the-hour loophole). It runs **first** on every route, so a throttled request costs nothing. On Vercel the visitor's address comes from Vercel's own header, which visitors can't fake; locally it's the real connection address. IPv6 visitors are grouped by /64 block, since one home gets billions of addresses. If the limiter's Redis is down, requests are let through, because the spend cap and turn limits still protect the money.

## Step 7: Timeouts

- **What:** A model call that goes quiet is cut off: 25 seconds for the suspect or witness, 15 seconds per attempt for the judge, 50 seconds for the whole turn. A suspect timeout shows "The suspect took too long to answer. Your turn was not used, so please try again."
- **Why:** Without a clock, one stuck call would hold the game's lock until the platform killed the function, and the player would just see a spinner.
- **How:** One 50-second stopwatch starts with each turn and is handed to every model call, and each call has its own shorter one. Whichever runs out first cancels the call. A suspect timeout is a failed turn (Step 5: nothing saved). A judge timeout falls back to "turn counts, no score change", and once the 50 seconds are up the judge isn't retried. 50 seconds sits under the 60-second function limit and the 70-second lock, so a lock can't expire while a turn is still going.

## Step 8: Polite errors, private logs

- **What:** When the AI service fails, the player sees one fixed sentence ("The suspect could not answer right now. Your turn was not used, so please try again in a moment."), never the provider's own error text. The real reason goes to the server log. Broken or oversized requests get a clear 400 or 413. Judge failures, which used to pass silently, are now logged.
- **Why:** Provider error messages can contain request details, account information or even parts of a key. Anything shown to a player is public, and logs are read by more people than should see secrets.
- **How:** `log.ts` writes each log entry as one line of JSON and first wipes anything that looks like a secret: our secret settings' actual values, `sk-ant-` keys, "Bearer" tokens and passwords inside URLs. The original error rides along privately with the friendly one, so the log gets the real cause plus the game and turn, and the player gets only the sentence.

## Step 9: Transcripts in Redis

- **What:** Each web game's conversation is recorded in Redis for 14 days. The start screen says so: "your questions and the suspect's answers are saved for 14 days". Setting `TRANSCRIPTS=off` turns recording off (then remove the notice from `public/index.html`).
- **Why:** Vercel has no disk that survives, so file logs would vanish, and real conversations are how the game gets better. Recording what strangers type needs honesty (the notice) and care (no secrets stored, automatic deletion).
- **How:** Each game gets one Redis list, `tx:<game id>`. Every event (game started, question, answer and score, failed turn, ending) is added as one line of JSON, with every piece of text scrubbed of anything key-shaped first. The list keeps at most 200 entries and is deleted 14 days after the last one. If writing fails, the turn still works and the failure is logged. To read one, open the Upstash console and run `LRANGE tx:<game id> 0 -1`. The terminal version of the game still writes local files to `playtest-logs/`.

## Step 10: Repo hygiene

- **What:** Git refuses to track any `.env` file (except the blank `.env.example`), the `.vercel/` folder and `playtest-logs/`. Old playtest logs were taken out of git. The Node version has an upper limit.
- **Why:** The repo is public. A stray `.env` holding the API key is the classic leak, and playtest logs hold what real people typed. The Node limit stops Vercel switching Node versions without anyone noticing.
- **How:** Edited `.gitignore` and removed the logs from git tracking (the files stay on disk). A scan of tracked files found nothing key-shaped except the placeholder in `.env.example`. Caveat: the old logs and a work email are still in git's history; removing them would need a history rewrite.

## Bring your own key (BYOK)

- **What:** An optional "Use my own Anthropic key" box on the start screen. A player who pastes their key plays on their own account, and keeps playing even after the shared daily budget runs out.
- **Why:** The shared budget is small. Someone who already has a key shouldn't have to wait for tomorrow, or cost the project money.
- **How:** The key stays in the player's browser tab (forgotten when the tab closes) and is sent with each request. The server uses it for that one request and keeps nothing: not in Redis, the transcript, logs or any reply. Only a "this game uses the player's own key" flag is saved, so the key must be sent again every turn. Each request builds its own connection to Anthropic rather than changing the shared one, because many players share one server copy at the same moment. The $0.08 per-game cap, the lock and the rate limits still apply. If Anthropic refuses the key, the player sees "Anthropic rejected the API key you provided..." and the turn isn't used or charged. Caveat: the key does pass through the server, so players should use a key they can revoke, with a low spend limit.

---

## What's confirmed live, and what isn't yet

Everything above was first built and tested on a laptop with a pretend model
and pretend (in-memory) Redis. That proves the logic, not the real services.

**Confirmed on the live site (2026-11-22):** the function builds and starts
(Step 0), the boot checks pass with real env vars, and the start page, styles
and API routes are served.

**Not yet confirmed live**, each with the audit check in
`.claude/audit-checklist.md` that proves it:

- **The Redis scripts** (spend cap, lock, version check, transcripts) running on real Upstash. A mistake there would show up as a 503 on every turn or a stuck game. Audit C3, C4, C7, C14, D1-D5.
- **The rate limiter** reading the right visitor address and counting as expected. Audit C11, D4.
- **What Anthropic returns for a wrong key.** The "your key was refused" message depends on a 401 or 403. A key with no credit comes back as a 400, which deliberately shows the generic message instead. Audit D6.
- **The 60-second limit** actually applied to the deployed function. Audit C8.
- **A full live game** played through to an ending. Audit E1-E5.

None of these change the game. If one fails, the fix is a small code change
made after seeing the exact error, not a redesign.
