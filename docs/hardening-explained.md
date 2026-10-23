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

## Steps 7-10 (planned)

- **7 Timeouts:** a stuck model call can't hang a request for ever.
- **8 Error handling and logging:** players see friendly messages, we log details privately.
- **9 Transcripts to Redis:** playtest logs saved safely (14 days), with a notice in the UI.
- **10 Repo hygiene:** keep secrets and logs out of git.
- **After 10, BYOK:** players can use their own Anthropic key.
