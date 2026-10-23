# Hardening explained in plain language

One section per step: **What** we did, **Why**, and **How**. Kept short on
purpose. Each new step adds a section here in the same commit. The detailed
engineering notes live in `decisions.md`; this file is the simple version.

**The big picture.** The game used to run on one computer that stayed on.
On Vercel it runs as many tiny short-lived copies of the server that share
nothing. That breaks anything stored in the server's memory, and it means
strangers on the internet can poke the game. The 10 steps make it safe and
cheap to leave public. The game itself (rules, prompts, balance) is untouched.

**Words used below**
- **Redis (Upstash):** a small shared notebook in the cloud that every server copy can read and write. It lives on Upstash's servers, not on the player's computer.
- **Atomic:** happens as one indivisible action, so two requests can't both slip in at the same moment.
- **Lua script:** a tiny program that Redis runs as one atomic action.
- **TTL:** time to live. Redis forgets the entry after that long.
- **Seed:** the secret number the whole case is generated from. Know the seed, know the answer.

---

## Step 0: Vercel wiring

- **What:** Made the app deployable on Vercel.
- **Why:** Vercel runs functions, not an always-on server.
- **How:** `src/index.ts` exports the Express app; the static front-end is served by Vercel's CDN.

## Step 1: Stop leaking the seed

- **What:** The seed is never sent to the browser. The server picks it.
- **Why:** The seed rebuilds the whole hidden case. Anyone who read it in the browser's network tab could solve the game instantly.
- **How:** Removed `seed` from the data sent to the player and removed the seed box from the UI. The server makes a random seed (mixed with a secret, `SESSION_SECRET`). A developer-only switch, `ALLOW_CLIENT_SEED`, lets us pin a seed locally, and it is ignored in production.

## Step 2: Sessions live in Redis

- **What:** A game's state is saved in Redis instead of the server's memory, for 1 hour.
- **Why:** Each request may land on a different server copy. In-memory games would vanish between turns. It also lets a player reload the page and keep playing.
- **How:** A small `Store` layer (`store.ts`). On Vercel it talks to Upstash Redis; on your laptop it uses plain memory. Each request loads the game, plays the turn, and saves it back.

## Step 3: Spend cap

- **What:** Hard limits on model cost: $0.01 reserved per turn, $0.08 per game, $2 per day across everyone.
- **Why:** The Anthropic key pays for every turn. Without a cap, a script could run up an unlimited bill.
- **How:** Before each turn we *reserve* $0.01 in Redis. If that would pass a limit, the player gets "resting for today" (429) and no model call happens. After the turn we correct the reservation to the real cost. The check is a Lua script, so ten simultaneous requests can't all squeeze through. If Redis is down we refuse the turn rather than spend blind.

## Step 4: Turn-limit race

- **What:** Only one request per game can run at a time.
- **Why:** If someone fired 20 requests at once, each would see "turns remaining: 6", each would spend money, and the game would get more than 6 turns or lose updates.
- **How:** Two guards.
  1. A lock in Redis (`lock:<game id>`). A second request while one is running gets 409 immediately, before spending anything. The lock is released before the answer is sent back, so your next click never collides.
  2. A version number on the saved game. If an old copy tries to save over a newer one, it is rejected. This is the backup if a lock ever times out.

## Step 5: Failed-turn rollback

- **What:** If the model call fails, the game is exactly as it was before you pressed send. You keep the turn and you keep any evidence item you tried to present.
- **Why:** The game marks evidence as "used" and counts the turn *before* it asks the model. The old code only undid the turn count by hand. If the model errored on `PRESENT e1:`, evidence e1 stayed marked as used, so a flaky API quietly cost the player their evidence.
- **How:** We deleted the hand-written undo. Each request works on its own private copy of the game and saves it only after the suspect's reply succeeds. A failed request simply never saves, so everything is discarded in one go. If only the judge (invigilator) fails, the turn still counts with no score change, same as before.

## Step 6: Per-IP rate limits

- **What:** Each visitor (by IP address) gets a ration of requests: 10 new games per hour, 40 questions per 10 minutes (suspect and witness share that ration), and 120 page loads/reloads per minute. Over the ration you get a polite "you're going a little fast, wait N seconds" (HTTP 429).
- **Why:** The spend cap protects the money, but one script could still use up the whole day's budget in minutes and lock out every real player. Rate limits stop one person doing that.
- **How:** A new `ratelimit.ts` counts requests per IP in Redis (the `@upstash/ratelimit` library, "sliding window", so there is no reset-at-the-top-of-the-hour loophole). It runs FIRST on every route, so a throttled request costs nothing: no lock, no spend, no model call. Which IP? On Vercel we trust Vercel's own `x-vercel-forwarded-for` header, which a visitor cannot fake. On your laptop we use the connection's real address and ignore forwarding headers, because there anyone can fake them. IPv6 visitors are grouped by their /64 block, since one home gets billions of addresses. If the limiter's Redis is down we let the request through (the spend cap and turn limits still protect us).

## Step 7: Timeouts

- **What:** A model call that goes quiet is cut off. The suspect or witness gets 25 seconds to answer, the judge (invigilator) gets 15 seconds per try, and the whole turn gets 50 seconds in total. If the suspect times out you see "The suspect took too long to answer. Your turn was not used, so please try again."
- **Why:** Without a clock, one stuck call would hold your game's lock and a server slot until the platform killed the function (60 seconds), and you would just see a spinner. Now it ends quickly, cleanly, and costs you nothing.
- **How:** The server starts one 50-second stopwatch when a turn begins and hands it to every model call; each call also gets its own shorter stopwatch. The first to ring cancels the call. A suspect timeout counts as a failed turn (same as Step 5: nothing is saved, no turn or evidence is lost). A judge timeout falls back to the existing "turn counts, no score change" behaviour, and once the 50 seconds are up the judge is not retried. The 50 seconds is deliberately below the 60-second function limit and the 70-second lock, so a lock can never run out while a turn is still going. No prompts or scoring changed.

## Step 8: Friendly errors, private logs

- **What:** When the AI service fails, the player now sees one fixed, polite sentence ("The suspect could not answer right now... please try again"), never the provider's own error text. The real reason goes to the server log. Broken or oversized requests get a clear 400 or 413 instead of a vague 500. Judge (invigilator) failures, which used to pass silently, are now logged too.
- **Why:** Provider error messages can contain request details, account information or even pieces of the API key. Anything shown to a player is public, and server logs are readable by more people than the secrets are. We also could not see when the judge was quietly failing and giving zero points.
- **How:** A new `log.ts` writes every log as one line of JSON (easy to search) and first wipes out anything that looks like a secret: the actual values of our secret settings, `sk-ant-` keys, "Bearer" tokens and passwords inside URLs. The route attaches the original error to the friendly one privately, so the log gets the real cause with the game id and turn number, while the player gets only the sentence. No prompts or scoring changed.

## Step 9: Transcripts in Redis

- **What:** Every web game's conversation is now recorded in Redis for 14 days instead of written to a file. The start screen tells players: "your questions and the suspect's answers are recorded for 14 days". Setting `TRANSCRIPTS=off` turns recording off.
- **Why:** Vercel has no disk that survives, so file logs would vanish. We still want playtest conversations to learn from. Recording what strangers type needs honesty (the notice) and care (no secrets stored, automatic deletion).
- **How:** Each game gets one Redis list called `tx:<game id>`. Every event (game started, question asked, answer and score, failed turn, ending) is added to the end as one line of JSON. Before saving, every piece of text is scrubbed of anything that looks like a key or password. The list is capped at 200 entries and Redis deletes it 14 days after the last entry. If saving a transcript fails, the player's turn still works; we just log that the write failed. To read one, open the Upstash console and run `LRANGE tx:<game id> 0 -1`. The command-line game still writes its own files as before.

## Step 10: Repo hygiene

- **What:** Git now refuses to track any `.env` file (except the blank template `.env.example`), the `.vercel/` folder, and the `playtest-logs/` folder. The 35 old playtest logs were taken out of git (still on your disk). The Node version setting got an upper limit.
- **Why:** The code is about to be public. A stray `.env` with the Anthropic key is the classic way people leak keys, and before this only `.env.local` was covered. Playtest logs hold things real people typed. The Node limit stops Vercel from quietly switching to a newer Node version one day.
- **How:** Edited `.gitignore` and ran `git rm --cached` on the logs (that removes them from git but leaves the files). We scanned the tracked files for anything shaped like a key: only the placeholder in `.env.example` showed up. One caveat: the old logs are still inside git's past commits. They contain no keys, but if you want them gone from a public repo's history, that needs a separate history rewrite.

## Next: BYOK (planned, after step 10)

- Players can use their own Anthropic key, kept only in their browser tab.
