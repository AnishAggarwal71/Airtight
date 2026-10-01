#!/usr/bin/env tsx
/**
 * V2 eval harness — DEFERRED.
 *
 * The V1 eval tested contradiction detection precision/recall, which was
 * the model's primary judgment task. V2 changes the model's role from judge
 * to actor (lying suspect + witness), which requires fundamentally different
 * eval dimensions:
 *
 *   - Suspect consistency (does the cover story hold across turns?)
 *   - Self-contradiction accuracy (does the model honestly flag its own slips?)
 *   - Evidence response quality (does quality 3 actually exploit the vulnerability?)
 *   - Witness corroboration (does the witness contradict when they should?)
 *
 * These are harder to eval than V1's binary yes/no contradiction cases because
 * the model is generating behaviour, not classifying it. Start with manual
 * playtesting via `npm run play`, formalize eval after patterns emerge.
 *
 * The V1 eval cases (src/eval/cases.ts) test a V1 adjudicator contract that
 * no longer exists — they'll need to be rewritten for the V2 suspect actor.
 */

console.log('\n  V2 eval harness not yet implemented.')
console.log('  Run `npm run play` for manual playtesting.\n')
process.exit(0)
