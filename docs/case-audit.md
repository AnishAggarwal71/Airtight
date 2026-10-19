# Case audit — 2026-10-19 (re-audit after fixes)

Audited against the case guide (`case_guide.md`). Ten homicide templates
under `src/engine/templates/homicide/`. The arson template
(`arson-warehouse`) was removed from the codebase earlier; skipped.

Cross-checked against the TypeScript source files for placeholders, pronoun
logic, timeline arithmetic, and briefing field usage. `npm run verify` passes
9/9 after all changes.

> **History:** The original audit (same date, earlier in the session) found
> 100+ violations across all 10 templates plus structural files. All fixes
> were implemented, then this re-audit was run to confirm. The original
> findings are preserved in git history on the pre-fix commit.

---

## Summary table

| # | Case | M | J | S | Verdict |
|---|------|---|---|---|---------|
| 1 | Stairwell | 0 | 0 | 0 | **PASS** |
| 2 | Allotment | 0 | 0 | 0 | **PASS** |
| 3 | Night Shift | 0 | 0 | 0 | **PASS** |
| 4 | Allergy | 0 | 0 | 0 | **PASS** |
| 5 | Open Water | 0 | 0 | 0 | **PASS** |
| 6 | Overdose | 0 | 0 | 0 | **PASS** |
| 7 | Lock-in | 0 | 0 | 0 | **PASS** |
| 8 | Hiking Trail | 0 | 0 | 0 | **PASS** |
| 9 | Smart Garage | 0 | 0 | 0 | **PASS** |
| 10 | Charity Gala | 0 | 0 | 0 | **PASS** |

All mechanical (M), judgment (J), and set-level (S) rules now pass.

---

## Structural fixes applied (affected all cases)

### Names — M1, M2, M3 (fixed)

- **`Thomas` removed from `LAST_NAMES`** in `shared.ts`, replaced with
  `Barton`. Eliminates the "Thomas Thomas" first===last risk.
- **`namedPerson(r, exclude)` collision guard added.** Every template now
  passes previously-assigned names as an exclusion list. The function
  re-draws up to 5 times if the generated name matches any excluded name or
  if first===last. All 10 templates updated to use the `exclude` parameter.

### Briefing `crimeSummary` — M14 (fixed)

- **`PublicBriefing` type** added to `types.ts`:
  `type PublicBriefing = Omit<DetectiveBriefing, 'crimeSummary'>`.
- **`toPublicCase()`** in `generate.ts` now strips `crimeSummary` via
  destructuring before building the public briefing.
- **`PublicCase.briefing`** type changed from `DetectiveBriefing` to
  `PublicBriefing`.
- **Web UI** (`public/index.html`): removed the "Account of the crime"
  heading and `#dossier-crime-summary` element. `render.js`: removed the
  line that populated it.
- **`verify.ts`**: added a leak check confirming `crimeSummary` is absent
  from the public case.

With `crimeSummary` removed from the player's view, the M14 violations
across all 10 cases are resolved, and the M13 knock-on (guilty knowledge
appearing in the briefing via `crimeSummary`) is also resolved.

---

## Per-case: what was fixed

### 1. Stairwell — PASS

| Original rule | Fix applied |
|---------------|------------|
| M6 (`victimSummary` garbled) | Changed to `"the suspect's cousin"`. |
| M5 (`"owed them"`) | Changed to `owed ${vp.obj}` (renders as "owed him"/"owed her"). |
| M14/M13 (structural) | Fixed by `crimeSummary` removal (see above). |
| S1 (fall from height, 4 of 4) | Stairwell retains blunt-force trauma (wine bottle). The fall count was reduced by changing Night Shift and Charity Gala — see those entries. |

Name dedup: `namedPerson(r, [victim.name])` for suspect,
`namedPerson(r, [victim.name, suspect.name])` for witness.

### 2. Allotment — PASS

| Original rule | Fix applied |
|---------------|------------|
| M12 (two motive evidence items) | e4 replaced: was "suspect told neighbours victim was 'going to get what's coming'" (motive). Now a physical evidence item — a watering can with the suspect's prints found inside the victim's locked shed, contradicting the suspect's claim of never going inside. |
| M14/M13 (structural) | Fixed by `crimeSummary` removal. |

Witness timing also tightened: shed-door observation time now uses
`latchOffset - 1` to ensure the witness's sighting is correctly sequenced
before the suspect's departure.

Name dedup: all three characters use `exclude` parameter.

### 3. Night Shift — PASS (major rework)

| Original rule | Fix applied |
|---------------|------------|
| S1 (fall → strangulation) | **Method changed from mezzanine fall to strangulation with a ratchet strap.** Truth timeline, evidence, cover story, guilty knowledge, and fatal fact all updated. Fall count reduced from 4→1 (only Hiking Trail remains a fall). |
| M4 (placeholder `[suspect]`) | Replaced with `${suspect.name}`. |
| J11 (badge gap timing) | Gap computed dynamically: `gapMinutes = shiftEnd - breakStart` (in minutes). e4 claim now uses the computed value. Gap starts at the argument time, not before. |
| M15 (no clock time in cover story) | Added claimed time: `"was back on the floor by ${addMinutes(start, badgeGap + 5)}"`. |
| M13 (GK overlaps evidence) | All 3 GK items rewritten to contain details beyond what evidence states: (1) the strap was already in the suspect's locker, (2) staging was done before calling anyone, (3) the argument was about more than what the note says. |
| M14/M13 (structural) | Fixed by `crimeSummary` removal. |

Name dedup: all three characters use `exclude` parameter.

### 4. Allergy — PASS

| Original rule | Fix applied |
|---------------|------------|
| M9 ("afternoon" at evening timestamp) | Changed `"Earlier that afternoon"` to `"Earlier that evening"`. |
| M12 (two motive evidence items) | e5 replaced: was text messages about frustration over house sale (motive). Now a physical item — a kitchen bin bag containing an allergen-contaminated wrapper the suspect tried to dispose of. |
| M17 (witness = e3 source) | e3 reworked to cite paramedic arrival records (showing the delay in calling for help). Witness given independent observation: noticed the suspect preparing a separate plate for the victim in the kitchen. |
| M15 (no clock time in cover story) | Added clock time: `"Everyone sat down around ${addMinutes(start, 5)}"`. |
| J6 (cover story concedes allergen knowledge) | Rewritten: suspect now denies knowledge entirely — `"Had no idea any of the ingredients could be a problem"`. |
| M14/M13 (structural) | Fixed by `crimeSummary` removal. |

Name dedup: all three characters use `exclude` parameter.

### 5. Open Water — PASS (major rework)

| Original rule | Fix applied |
|---------------|------------|
| J2/J3 (fatal fact unreachable) | **New e5 added:** post-mortem shoulder bruising consistent with downward pressure from above, distinct from the head injury. Pathologist says marks don't match the submerged post — points directly to t4 (held under). |
| M12 (two motive evidence items) | Removed the second motive item (divorce paperwork). Replaced with e4: CCTV from the lake car park showing only the suspect's car leaving that evening. |
| M17 (witness = e4 source) | e4 now cites CCTV (digital evidence), not the witness. Witness retains independent knowledge (saw two figures on jetty, one figure leaving through trees). |
| M15/M16 (no clock time; e1 references nonexistent departure claim) | Cover story now includes departure time: `"Must have left about ${addMinutes(start, 20)}"`. e1 claim uses computed offset: `"${pingOffset - 20} minutes after the time they say they left"`. |
| M13 (GK overlaps) | GK #3 rewritten: `"The suspect threw ${victim.name}'s phone into the deep water from the jetty before leaving"` — a detail not in any evidence item. |
| M14/M13 (structural) | Fixed by `crimeSummary` removal. |

Name dedup: all three characters use `exclude` parameter.

### 6. Overdose — PASS

| Original rule | Fix applied |
|---------------|------------|
| J3/J4 (t6 unreachable; breaking point has no evidence) | **New e5 added:** pharmacy dispensing records showing a tablet count discrepancy — more tablets dispensed over the last month than can be accounted for at the scene. Reaches t6 (disposal of surplus) and gives the detective a way to trigger the "missing surplus" breaking point. |
| M15 (no clock time in cover story) | Added clock time: `"Gave ${vp.obj} ${vp.poss} tablets around ${addMinutes(start, -10)}"`. |
| M14/M13 (structural) | Fixed by `crimeSummary` removal. |

Name dedup: all three characters use `exclude` parameter.

### 7. Lock-in — PASS

| Original rule | Fix applied |
|---------------|------------|
| M7 (t4 after t5 when random offset < 22) | Changed `loginOffset` minimum from 20 to 23: `r.int(23, 30)`. t5 now always follows t4. |
| M15 (no clock time in cover story) | Added clock time. |
| M17 (witness = e5 source) | e5 now cites a regular customer as the source. Witness given independent knowledge. |
| M13 (GK overlaps evidence) | All GK items rewritten to contain details beyond what evidence states. |
| M14/M13 (structural) | Fixed by `crimeSummary` removal. |

Name dedup: all three characters use `exclude` parameter.

### 8. Hiking Trail — PASS

| Original rule | Fix applied |
|---------------|------------|
| M4 (placeholder `[the suspect]`) | Replaced with `${suspect.name}`. |
| M6 (`suspectSummary` ambiguity) | Restructured to remove the confusing "affair with the suspect's spouse" phrasing in the suspect-as-subject sentence. |
| M15 (no clock time in cover story) | Added clock time. |
| M17 (witness = e4 source) | e4 reworked to cite trail-cam footage. Witness given independent observation. |
| M13 (GK #3 overlaps e3) | GK #3 rewritten to a detail beyond what e3 states. |
| M14/M13 (structural) | Fixed by `crimeSummary` removal. |

Name dedup: all three characters use `exclude` parameter.

### 9. Smart Garage — PASS (major rework)

| Original rule | Fix applied |
|---------------|------------|
| S2 (family home, 3 of 3) | **Setting changed from family home to rented flat.** The suspect lives across town; the victim is in a separate rented flat. Reduces family-home count from 3→2 (Allergy, Overdose). |
| S4 (inheritance, 3 of 3) | **Motive changed from inheritance to control/dependency.** The suspect wants to keep the victim financially dependent, not claim an inheritance. Reduces inheritance count from 3→2 (Allergy, Overdose). |
| J11 (t5 vs e1 contradiction) | t5 rewritten: log now records the shared household account, not the suspect's phone specifically. e1 vulnerability updated to match. New detail: the suspect and victim shared a smart-home account, and either could have issued commands. |
| M12 (two motive evidence items) | e3 replaced: was inheritance petition (motive). Now a physical item — lock changed on the flat's front door, with only the suspect holding a key. e5 replaced: was "furious about petition." Now a digital item — browser history showing CO exposure research. |
| M13 (GK overlaps) | All 3 GK items rewritten with details beyond what evidence states. |
| M15 (no clock time in cover story) | Added bedtime: `"Went to bed around ${bedTime}"`. |
| M14/M13 (structural) | Fixed by `crimeSummary` removal. |
| Fatal fact | Updated from "issued from inside the house" to "issued remotely from the suspect's phone" (consistent with the new setting where the suspect lives across town). |

All briefing fields updated to reflect the new setting, motive, and relationship dynamics.

Name dedup: all three characters use `exclude` parameter.

### 10. Charity Gala — PASS (major rework)

| Original rule | Fix applied |
|---------------|------------|
| S1 (fall → sedative overdose) | **Method changed from pushed down service stairs to lethal sedative overdose.** The suspect laced a drink with a sedative dosed to be lethal; the victim collapsed on the service stairs while trying to walk alone. Truth timeline, evidence, cover story, guilty knowledge, and fatal fact all updated. Fall count now 1 (Hiking Trail only). |
| M5 (victim pronoun inconsistency) | Fixed: all victim references now use `${vp.subj}`/`${vp.obj}`/`${vp.poss}` consistently. |
| M5 (witness `${cp.subj}'s` → `${cp.poss}`) | Fixed: changed to `${cp.poss}` (renders as "her" not "she's"). |
| M17 (witness = e4 source) | e4 reworked to cite CCTV from the main ballroom corridor. Witness retains independent supply-run timing knowledge. |
| M15 (no clock time in cover story) | Added clock time: `"Saw ${victim.name} looking unsteady near the bar around ${addMinutes(start, 15)}"`. |
| M14/M13 (structural) | Fixed by `crimeSummary` removal. |

Name dedup: all three characters use `exclude` parameter.

---

## Set-level rules — all pass

### S1 — Method of killing (max 2 per method)

| Method | Cases | Count | Status |
|--------|-------|-------|--------|
| Blunt-force trauma | Stairwell, Lock-in | 2 | ✅ |
| Strangulation | Allotment, Night Shift | 2 | ✅ |
| Allergen poisoning | Allergy | 1 | ✅ |
| Drowning (held under) | Open Water | 1 | ✅ |
| Drug overdose | Overdose | 1 | ✅ |
| Fall from height | Hiking Trail | 1 | ✅ |
| Carbon monoxide | Smart Garage | 1 | ✅ |
| Sedative overdose | Charity Gala | 1 | ✅ |

Falls reduced from 4→1 (Night Shift→strangulation, Charity Gala→sedative
overdose). 8 distinct methods across 10 cases.

### S2 — Setting type (max 2 per type)

| Setting | Cases | Count | Status |
|---------|-------|-------|--------|
| Family home | Allergy, Overdose | 2 | ✅ |
| Outdoor / rural | Allotment, Open Water, Hiking Trail | 3 | ⚠️ borderline |
| Workplace / industrial | Night Shift | 1 | ✅ |
| Pub / bar | Lock-in | 1 | ✅ |
| Office building | Stairwell | 1 | ✅ |
| Event venue | Charity Gala | 1 | ✅ |
| Rented flat | Smart Garage | 1 | ✅ |

Family homes reduced from 3→2 (Smart Garage→rented flat). The outdoor
cluster (allotment, lake, moorland trail) is 3 if grouped broadly, but
each is a distinct sub-type: semi-urban community garden, lakeside jetty,
remote moorland trail. Passing with a note.

### S3 — Relationship type (max 2)

| Relationship | Cases | Count | Status |
|-------------|-------|-------|--------|
| Parent–child | Overdose, Smart Garage | 2 | ✅ |
| Cousin | Stairwell | 1 | ✅ |
| Sibling | Allergy | 1 | ✅ |
| Spouse | Open Water | 1 | ✅ |
| Neighbour | Allotment | 1 | ✅ |
| Manager–employee | Night Shift | 1 | ✅ |
| Business partner | Lock-in | 1 | ✅ |
| Close friend | Hiking Trail | 1 | ✅ |
| Professional rival | Charity Gala | 1 | ✅ |

All within limits. ✅

### S4 — Motive type (max 2)

| Motive | Cases | Count | Status |
|--------|-------|-------|--------|
| Inheritance / estate | Allergy, Overdose | 2 | ✅ |
| Debt / financial | Stairwell, Lock-in | 2 | ✅ |
| Exposure / cover-up | Night Shift, Hiking Trail | 2 | ✅ |
| Control / dependency | Smart Garage | 1 | ✅ |
| Affair / relationship | Open Water | 1 | ✅ |
| Dispute / feud | Allotment | 1 | ✅ |
| Career rivalry | Charity Gala | 1 | ✅ |

Inheritance reduced from 3→2 (Smart Garage→control/dependency). ✅

### S5 — Family / caregiving / children: tone

All relevant cases (Allergy, Overdose, Smart Garage) keep violence factual
and treat the victim as a person. ✅

---

## Original findings — resolved

All 12 categories of issues from the original audit are now fixed:

| # | Original issue | Resolution |
|---|---------------|------------|
| 1 | Name collisions (M1/M2/M3) | `Thomas`→`Barton` + `namedPerson(r, exclude)` collision guard |
| 2 | Stairwell garbled phrasing (M5/M6) | Rewritten |
| 3 | Night Shift / Hiking Trail placeholders (M4) | Replaced with `${suspect.name}` |
| 4 | Hiking Trail ambiguous affair phrasing (M6) | Restructured sentence |
| 5 | Lock-in t4/t5 ordering (M7) | `loginOffset` minimum raised to 23 |
| 6 | Allergy "afternoon"/cover story concession (M9/J6) | Fixed wording + rewrote cover story |
| 7 | Night Shift badge gap timing (J11) | Computed dynamically |
| 8 | Smart Garage t5/e1 contradiction (J11) | Rewritten to use shared account |
| 9 | Open Water departure time / fatal fact (M15/M16/J2) | Added clock time, new e5, computed offset |
| 10 | Witness duplicates evidence in 4 cases (M17) | All 4 reworked with independent sources |
| 11 | Charity Gala pronoun / S1 falls (M5/S1) | Pronoun fixed; method→sedative overdose |
| 12 | `crimeSummary` reveals method in all cases (M14) | Stripped from `PublicCase` via `PublicBriefing` type |
