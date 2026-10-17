# AIRTIGHT — UI design spec

This is the build spec for the new game UI: three screens (entry, case briefing, interrogation). The post-game reveal screen is being designed separately and will be added later. Do not build it from guesswork.

Mockups (source of truth for layout): https://claude.ai/artifact/UYyaga6VtHdnM7hPekDExv
The mockups use grey bars in place of text. Real copy comes from the engine and from the copy notes below.

---

## 0. How to work on this (read first)

### Permissions: ask once, upfront

Before writing any code, list every shell command and file operation you expect to need for the whole task (installs, dev server, `npm run verify`, `npm run play`, test runs, git commands). Present it as one list and ask for approval once. If anything is missing from `.claude/settings.json` (see `claude-settings.json` handed over with this file), propose the exact rules to add to `.claude/settings.local.json` in that same message. Do not trickle out one-off permission requests for small commands during the build. If a genuinely new command becomes necessary mid-task, batch it with any others and ask once.

Never ask for, or work around the need for, anything in the deny list: pushing, deleting outside the repo, reading `.env*`, changing the npm registry.

### Plan before code

1. Read this file, the mockups, `src/engine/types.ts`, the session/state code, and everything in `public/`.
2. Write a short plan: which files change, which new files appear, and how the UI gets each piece of state listed in section 6. Wait for approval.
3. Build one screen at a time in the order entry → briefing → interrogation. Show each before starting the next.

### Hard constraints

- **Stack stays as is.** Express server, vanilla JS/HTML/CSS in `public/`. No React, Next.js, Tailwind, or UI framework. A small animation helper is acceptable only if CSS cannot do the job; ask first.
- **Do not change scoring or invigilator logic.** The UI only displays what the engine produces. If the UI needs data the engine does not expose, add a read-only field to the session/state response and say so in the plan.
- **Server/browser split holds.** The server regenerates the private case from the seed on each request. The browser only ever receives public data. Nothing in this UI may require sending hidden state (the claim ledger, the true timeline, the suspect's cover story) to the client. Section 6 lists exactly what the client may receive.
- **Package installs** go through whatever registry the machine is already configured for. On a Lilly-managed machine that is JFrog Artifactory. Do not add `--registry` flags, `.npmrc` overrides, or anything that points at public npm.

### Dependencies this build waits on

These two engine changes are separate tasks. Build the UI against their interfaces; if they have not landed, stub the fields and flag it.

1. Engine rule changes: witness callable once mid-game when case strength is above 50; endings by trigger (80 reached, turns exhausted at 50–79, turns exhausted below 50); no charge/release choice.
2. Enriched logging: per-turn invigilator signals, delta and resulting case strength in the transcript records.

---

## 1. Game rules the UI must reflect

| Rule | Value |
|---|---|
| Win | Case strength reaches **80** at any point. The game ends immediately with a strong charge. |
| Suspect questions | **6** |
| Witness | **2** extra questions, one session, callable **once** |
| Witness unlock | Case strength **above 50**. Below that the button is visible but disabled. |
| Meter direction | **Rises only.** Never animate a decrease. |
| Per-turn cap | Delta is clamped at 25 by the engine. The UI does not clamp; it displays what it receives. |
| Input cap | 300 characters |
| Endings | Reach 80: strong charge. Turns run out at 50–79: qualified charge, case has gaps. Turns run out below 50: suspect walks because the detective did not build the case. Never frame this as the suspect being innocent. |

Pressure comes from questions running out, not from the meter dropping. The design leans on making remaining turns and spent evidence very visible.

---

## 2. Visual direction

**Cold forensic system laid over a warm physical room.** The pixel-art room is the suspect's world: tungsten-warm, still, a little oppressive. The UI is the detective's instrument: cool, precise, glass. Keep both deliberately. Do not tint the room cool or the UI warm.

The one exception is the **crack accent** (amber, section 3). It appears only when the suspect's story fails: the room's light leaking through the instrument at the moment of a contradiction. That rarity is what makes it land, so never use amber for anything else.

**The one bold element is the viewfinder corner brackets** on the main panels. Everything else stays quiet: near-square corners, hairline borders, no ornament.

### Layering

1. Room image, full bleed, `image-rendering: pixelated`, `background-size: cover`, `background-position: 28% 50%` (keeps the suspect left of the panel).
2. Dim layer, flat black at the opacity per screen (section 4). No gradients.
3. Glass panels: translucent ink with `backdrop-filter: blur(10px) saturate(.6)`.

### Layout

- Desktop: suspect and lamp sit on the left half. Panels sit on the right. They never overlap the figure.
- Below 720px wide: the panel takes the full width; the room becomes a dim edge visible around it. The HUD keeps the turn pips and drops the meter label.

---

## 3. Tokens

Put these in one `:root` block in a single stylesheet and use only these.

### Colour

| Token | Value | Use |
|---|---|---|
| `--ground` | `#07090b` | Page background behind the image |
| `--glass` | `rgba(10,16,20,.84)` | Panels (`.86` on interrogation) |
| `--glass-deep` | `rgba(4,8,10,.6)` | Inputs, inset blocks |
| `--ink` | `#d8e4e8` | Body text |
| `--ink-strong` | `#e8f0f3` | Headings, the suspect's words |
| `--ink-muted` | `#8a9ca2` | Labels, metadata (check it holds 4.5:1 on `--glass`; darken the glass, not the text, if it fails) |
| `--line` | `rgba(140,210,226,.16)` | Panel borders, dividers |
| `--cyan` | `#8cd2e2` | The forensic accent: interactive elements, the detective's own questions, meter fill, corner brackets, the 80 mark |
| `--cyan-ink` | `#06141a` | Text on cyan buttons |
| `--crack` | `#e8b04a` | Contradictions and guilty-knowledge leaks only |
| `--crack-wash` | `rgba(232,176,74,.1)` | Background of a crack verdict line |

Cyan and amber also differ in lightness, but verdict types must still be distinguishable by icon and label, never by colour alone.

### Type

- **IBM Plex Sans** for everything readable. Weights 400, 500, 600.
- **IBM Plex Mono** only for things that are literally codes or numbers: exhibit IDs, the case-strength number, deltas, the case number, seed.
- Load both from Google Fonts with `font-display: swap` and a fallback stack (`system-ui, sans-serif` / `ui-monospace, monospace`).

| Role | Size / line-height | Weight |
|---|---|---|
| Entry title | 44 / 1.05 | 600 |
| Case title | 30 / 1.15 | 600 |
| Body, suspect answers | 16 / 1.55 | 400 |
| Detective questions | 15 / 1.5 | 500 |
| Verdict reason line | 14 / 1.4 | 500 |
| Labels, metadata | 12 / 1.3 | 500, sentence case |

Sentence case everywhere. No all-caps labels, no letter-spaced eyebrows. The rubber stamp on the briefing is the only uppercase on any screen, because a stamp is uppercase.

### Space, shape, line

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 56. Panel padding 36–44px.
- Radius: 2px on everything, with one exception: exhibit tags are `2px 10px 10px 2px` with a punched hole, so they read as luggage-style evidence tags.
- Borders: 1px hairlines in `--line`. Dashed borders mean "unavailable": a locked witness, or spent evidence.
- Corner brackets: 18×18px, 2px `--cyan`, on the four corners of each main panel. Nothing else gets them.
- Touch targets at least 44px.

---

## 4. Assets

All original pixel art, generated by `make_room.py` (included). Do not upscale or resample the files; let CSS scale them with `image-rendering: pixelated`.

| File | Size | Screen | Dim layer |
|---|---|---|---|
| `room-empty.png` | 320×180 | Entry: empty chair under the lamp | 38% |
| `zoom-he.png` / `zoom-she.png` | 213×120 | Briefing: suspect seated, tight framing | 34% |
| `dim-he.png` / `dim-she.png` | 213×120 | Interrogation: same framing, pushed back | none (already darkened) |

Pick `he` / `she` from the suspect's pronoun field in the case templates (`'he' | 'she'`). It is public data.

Icons are inline stroke SVGs at 1.6px stroke, never emoji. One icon per evidence type: fingerprint, phone, physical item (box), document. If the engine has evidence types beyond these four, list them in the plan and propose icons.

---

## 5. Screens

### Screen 1: Entry

Room: `room-empty.png`.

One glass panel, right side, max width 500px, vertically centred. Top to bottom:

1. Small lock mark and the game name.
2. Title, then a one-to-two-line premise.
3. How to play: three rows, each an icon in a 34px outlined square plus one or two short lines. Ask questions, present evidence, watch the case build. Not numbered: these are rules, not steps.
4. Divider, then two optional fields side by side: case seed (text) and locality (select).
5. One primary button: **Begin**.

The entry screen is calm on purpose. No meter, no pips.

### Screen 2: Case briefing

Room: suspect variant of `zoom-*.png`.

**HUD strip** across the top, 64px, glass. This is the same component the interrogation screen uses, shown here in its starting state so the player sees the pressure before the first question:
- Left: lock mark and the case number.
- Centre: case-strength track, empty. Thin tick at 50, a stronger cyan mark at 80, number on the right.
- Right: six outlined question pips and a dashed, locked witness slot.

**Dossier panel**, right side, max width 600px, fills the height under the HUD, scrolls internally:
1. Case type label (cyan), case title, and a rotated stamp in the top-right corner.
2. Subject block, inset: a cropped thumbnail of the room image showing the silhouette, beside a two-by-two grid of label/value pairs (name, age, relationship to victim, stated whereabouts, or whatever the template provides).
3. The account of the crime, as prose.
4. Evidence, as a list of exhibit tags. Each row: tag with type icon, the evidence name and one-line description, exhibit ID in mono on the right.
5. Footer, pinned: primary **Begin questioning**, secondary **New case**.

**Motion: the one orchestrated moment in the game.** Entry → briefing crossfades the room from the empty chair to the seated suspect over about 900ms while the dossier panel replaces the entry panel. The suspect arrives. Nothing else on these two screens animates on load.

### Screen 3: Interrogation

Room: suspect variant of `dim-*.png`. The room recedes so six turns of reading stay comfortable.

**HUD strip** (same component as the briefing, now live):
- Meter fill in `--cyan`. The gain from the latest answer shows as a separate segment on the end of the fill, coloured by its verdict (amber for a crack, cyan otherwise), with a small delta tag in mono above the leading edge, e.g. `+15`. The segment merges into the main fill when the next question is sent.
- Pips: spent questions become solid and muted; remaining ones stay outlined and bright.
- Witness slot: dashed and locked below 51. When case strength first passes 50, it becomes solid cyan and pulses once (no looping pulse). After use, it shows as spent.

**Transcript panel**, right side, max width 680px, fills the height under the HUD.

The transcript (`role="log"`, scrolls internally) holds one exchange per question:
- **Detective question:** right-aligned, cyan hairline box, cyan text. If evidence was presented, the exhibit tag sits at the top of the box.
- **Suspect answer:** left-aligned, `--ink-strong`, no box.
- **Verdict line:** directly under the answer. Icon, verdict type, one-line reason, delta in mono on the right. This line is the invigilator thinking out loud, and it is the most important element on the screen: it makes the hidden-state scoring legible to a reviewer in seconds. A crack verdict gets the `--crack-wash` background and an amber border; other verdicts sit on the glass with no box.
- Older exchanges drop to 55% opacity so the latest exchange leads.
- While the suspect is answering: three blinking squares in place of the answer. Respect `prefers-reduced-motion` with static squares.

Witness questions use the same structure, with a small witness marker beside the answer so the two speakers cannot be confused.

The composer, pinned to the bottom, holds three rows:
1. **Evidence tray:** a row of exhibit tags as toggle buttons (`aria-pressed`). Tapping one attaches it to the next question; one at a time. Evidence already presented becomes dashed, crossed out and disabled.
2. **Question input** (textarea, 300-char limit) with the **Ask** button beside it. Enter sends; Shift+Enter makes a new line. Disable both while the suspect is answering.
3. **Witness button** (disabled with a lock icon until unlocked, with the hint "You may not have enough yet") plus the remaining character count on the right.

When the game ends (80 reached, or turns run out), the composer disables and a single button replaces it to go to the reveal screen. That screen is out of scope for now: route to a placeholder.

---

## 6. Data the UI needs from the server

Public data only. If any of these fields does not exist yet, add it read-only and flag it in the plan.

| Field | Notes |
|---|---|
| Case: title, type, number, locality | |
| Suspect: name, pronoun, public profile fields | Pronoun picks the room image |
| Crime account | |
| Evidence list: id, type, name, description, `presented: boolean` | |
| Case strength (0–100) | |
| Per turn: `delta`, `verdict.type`, `verdict.reason` | See below |
| Turns used / remaining, witness `available` / `used` | |
| Game status: `in_progress` / `ended`, and the ending | |

**Verdict type** is derived on the server from the invigilator signals, one per turn, by priority:

| Priority | Signal | Display type | Style |
|---|---|---|---|
| 1 | Contradiction (any severity) | Contradiction | Crack (amber) |
| 2 | Guilty-knowledge leak | Slip | Crack (amber) |
| 3 | Demeanour shift | Tell | Cyan |
| 4 | Evidence handled poorly by the suspect | Weak answer | Cyan |
| 5 | Nothing fired, delta 0 | No change | Muted |

**Verdict reason** is one sentence, at most about 90 characters, generated on the server from the invigilator's reasoning. It may cite public facts ("contradicts the 9pm phone log", "avoided the question about the car"). It must never reveal hidden state: no claim-ledger contents, nothing from the true timeline or the cover story that the player has not already seen. If no reason is available, show the type and delta only. This is the one place where hidden state could leak to the client, so add a test for it.

---

## 7. Event → feedback

| Event | Feedback |
|---|---|
| Player taps an exhibit tag | Tag fills with a cyan tint and shows pressed. Tapping again detaches it. |
| Question sent | Question appears instantly in the transcript; one pip turns solid; composer disables; answering squares appear. |
| Suspect answers | Answer fades in over 200ms. No typewriter effect: it slows reading and adds nothing. |
| Verdict arrives (delta > 0) | Verdict line slides in under the answer; the meter gain segment grows over 600ms, ease-out; the delta tag appears. |
| Contradiction or slip | As above with crack styling, plus one 120ms brightness flash of the amber segment. No screen shake. |
| No change | Muted verdict line, no meter movement. Quiet is the feedback. |
| Case strength passes 50 | Witness slot and button unlock with one pulse. |
| Witness called | The witness's two questions run in the same transcript with the witness marker; the witness slot shows as spent when both are used. |
| 80 reached | Meter fills to the 80 mark, the 80 mark brightens, the composer disables, and the button to the reveal appears. |
| Turns run out | Composer disables, the button to the reveal appears. Same treatment for both remaining endings; the reveal explains which. |
| Network or model error | Inline message in the transcript in the interface's voice, with a retry button. The question is not charged as a turn. |

All motion: honour `prefers-reduced-motion` by replacing movement with instant state changes.

---

## 8. Avoid

- Rounded, identical cards with soft grey drop shadows.
- Gradient blobs, gradient washes, glows, neon.
- Purple, or any accent beyond cyan and the crack amber.
- Inter, Roboto, Arial.
- All-caps tracked-out labels.
- Emoji anywhere.
- Typewriter text, looping animations, screen shake.
- Coloured left-border callouts.
- A red or downward meter animation (the meter never falls).
- Blurring the pixel-art room (pixel art plus blur turns to mud; dim it instead).
- Copy that implies the suspect might be innocent.

---

## 9. Accessibility

- Real `<button>`, `<input>`, `<textarea>`, `<label>`; no click handlers on divs.
- Visible focus rings (2px, offset) on everything interactive.
- `role="log"` with `aria-live="polite"` on the transcript, so screen readers hear new answers and verdicts.
- The meter has an accessible name that includes the number and the last change, e.g. "Case strength 38 of 100, up 15".
- Text contrast at least 4.5:1 against the glass, checked on the brightest part of the room behind it.

---

## 10. Data capture (needed before sharing with friends)

Playtests are only useful if each run can be audited afterwards: did a +15 actually match a damning answer?

- Persist every session server-side, not in session memory or gitignored JSONL. Use Postgres.
- Per turn: the question, the presented evidence id, the answer, the full invigilator signals object, the derived verdict type and reason, the delta, and the resulting case strength. Same for witness turns.
- Per session: seed, case id, start and end time, final case strength, ending, and an anonymous player id. No names or emails.
- Store the model and prompt versions on each session so tuning changes can be compared.
- Keep the spend cap and rate limiting in scope before the link goes out.

---

## 11. Done when

- [ ] All three screens match the mockups at 1440 wide and work at 390 wide.
- [ ] The room picks he/she correctly from the case.
- [ ] A full game of test-seed-1 plays end to end in the new UI, with a verdict line on every turn.
- [ ] The witness unlocks only above 50, runs exactly two questions, and cannot be called twice.
- [ ] Both "turns run out" paths (witness used, witness never unlocked) end correctly.
- [ ] A test proves the client never receives the claim ledger, true timeline or cover story.
- [ ] `npm run verify` passes.
- [ ] No new dependencies without approval; nothing installed from outside the configured registry.
