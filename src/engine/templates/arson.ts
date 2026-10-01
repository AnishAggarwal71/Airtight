import type { Template } from './shared'
import { beats, fullName } from './shared'
import { addMinutes, hhmm } from '../rng'

/**
 * Arson — the most argumentative crime type. Fire investigation evidence is
 * probabilistic and full of known false positives, which makes it perfect for
 * this game: almost every item has a real, findable crack in it.
 */

const warehouse: Template = {
  id: 'arson-warehouse',
  crime: 'arson',
  title: 'The Warehouse',
  build: (r, _detective) => {
    const suspect = fullName(r)
    const bookkeeper = fullName(r)
    const start = hhmm(r.int(2, 4), r.int(0, 55))
    const alarm = addMinutes(start, r.int(18, 34))
    const end = addMinutes(alarm, 40)
    const cover = r.pick([620000, 840000, 1150000, 1400000])
    const debt = r.pick([190000, 265000, 320000])
    const trade = r.pick(['reclaimed furniture', 'commercial flooring', 'garden machinery', 'shopfitting supplies'])

    return {
      suspect: { name: suspect, occupation: `owner of a ${trade} business` },
      victim: { name: 'Unit 14, Brennan Industrial Park', relationship: 'the suspect\'s own premises' },
      location: `Unit 14, Brennan Industrial Park — total loss`,
      window: { start, end },

      truth: beats(
        ['t1', addMinutes(start, -90), `The suspect moved the valuable stock into a rented lock-up on Tyle Road.`],
        ['t2', start, `The suspect laid a trail of white spirit from the rear racking to the office partition and lit it at the racking end.`],
        ['t3', addMinutes(start, 6), `The suspect left through the rear fire door, which they had wedged earlier so it wouldn't lock behind them.`],
        ['t4', alarm, `The alarm triggered when the smoke reached the office sensor. The rear of the unit had no working detector.`],
      ),

      evidence: [
        {
          id: 'e1', type: 'physical',
          linkedBeats: ['t2'],
          claim: `The fire investigator found an irregular burn pattern across the concrete at the rear racking — what they'd call a pour pattern.`,
          vulnerability: `Irregular floor patterns were treated as proof of accelerant for decades until research showed flashover produces the same marks with no accelerant at all. It's in the investigator's own guidance.`,
        },
        {
          id: 'e2', type: 'physical',
          linkedBeats: ['t2', 't3'],
          claim: `Debris from the rear racking tested positive for a medium petroleum distillate — white spirit.`,
          vulnerability: `The suspect's business uses white spirit as stock. There were eleven litres on the racking. The lab can't distinguish stock that burned in place from spirit that was poured.`,
        },
        {
          id: 'e3', type: 'circumstantial',
          linkedBeats: ['t1'],
          claim: `The suspect rented a lock-up on Tyle Road eleven days before the fire and moved stock into it.`,
          vulnerability: `The unit's roof had been leaking since February and a water-damage claim had already been refused. Moving stock somewhere dry is what a reasonable person does.`,
        },
        {
          id: 'e4', type: 'physical',
          linkedBeats: ['t3'],
          claim: `The rear fire door was wedged open — it hadn't shut properly.`,
          vulnerability: `The closer has been broken since the spring. The fire risk assessment flagged it in March and the suspect has an unpaid repair quote sitting in the file.`,
        },
        {
          id: 'e5', type: 'digital',
          linkedBeats: ['t3'],
          claim: `The suspect's phone was switched off from midnight until ${addMinutes(alarm, 25)}.`,
          vulnerability: `The suspect had been turning the phone off every night for months — their ex-partner had been calling at three in the morning. The phone records show a pattern going back weeks.`,
        },
      ],

      witness: {
        id: 'w1',
        name: bookkeeper,
        relationship: `the suspect's bookkeeper for the business`,
        personality: `Nervous, doesn't want to get anyone in trouble, but honest when directly asked a specific question. Won't volunteer information unprompted — needs to be led.`,
        knowledgeBoundary: `Knows the suspect asked twice in the last month what the insurance policy actually covered. Knows the business was carrying about £${debt.toLocaleString()} of debt and had been refused a credit extension six weeks earlier. Was not present at the warehouse the night of the fire. Has no knowledge of the lock-up on Tyle Road.`,
        suspectContradictions: [
          `If the suspect claims the insurance payout never crossed their mind, the bookkeeper knows they asked about coverage twice.`,
          `If the suspect downplays the business's financial trouble, the bookkeeper knows about the £${debt.toLocaleString()} debt and the refused credit extension.`,
        ],
      },

      fatalFact: `The valuable stock left the building eleven days before it burned. Everything else is argument; that is a fact with a date on it.`,

      suspectPersona: {
        personality: `Indignant and performatively outraged — "I'm the victim here, I lost everything." Uses anger as a shield to deflect uncomfortable questions. Speaks quickly when nervous, slower and more emphatic when lying about something prepared. Defaults to "why would I burn my own business" as a rhetorical dodge.`,
        coverStory: `Was at home asleep when the fire happened. Got the call from the alarm company and drove straight to the site. The lock-up was about the leaking roof, nothing more. The insurance increase was the broker's recommendation. Has no idea how the fire started — maybe electrical, the wiring in that unit was ancient.`,
        breakingPoints: ['the lock-up timing — eleven days is suspicious', 'what exactly was moved and why', 'the insurance conversations with the bookkeeper', 'the phone being off at the exact right time'],
        guiltyKnowledge: [
          `The rear fire door was wedged deliberately, not just broken`,
          `White spirit was laid as a trail, not just stored on the racking`,
          `The rear of the unit had no working smoke detector — the suspect knew the alarm would be slow`,
        ],
      },

      detectiveBriefing: {
        victimSummary: `Unit 14, Brennan Industrial Park — a ${trade} warehouse. Total loss. No casualties but the building is destroyed.`,
        suspectSummary: `${suspect}, owner of the business operating from Unit 14. The business was in financial trouble — significant debt, refused credit extension. Insurance cover was doubled nine weeks before the fire.`,
        sceneSummary: `The fire started at the rear racking, sometime between ${start} and ${alarm}. The fire investigator found a pour pattern and traces of white spirit. The rear fire door was wedged open.`,
        evidenceSummary: `Your team has assembled five pieces of evidence. The fire evidence is strong but every item has a plausible innocent explanation. The suspect doesn't know which items you have — deploy them strategically.`,
      },
    }
  },
}

export const arsonTemplates: Template[] = [warehouse]
