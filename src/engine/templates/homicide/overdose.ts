import type { Template } from '../shared'
import { beats, fullName, namedPerson } from '../shared'
import { addMinutes, hhmm } from '../../rng'

function pronouns(p: 'he' | 'she') {
  return p === 'he'
    ? { subj: 'he', obj: 'him', poss: 'his', Subj: 'He' }
    : { subj: 'she', obj: 'her', poss: 'her', Subj: 'She' }
}

export const overdose: Template = {
  id: 'homicide-overdose',
  crime: 'homicide',
  title: 'The Overdose',
  build: (r, _detective) => {
    const victim = namedPerson(r)
    const vp = pronouns(victim.pronoun)
    const suspect = fullName(r)
    const carer = namedPerson(r)
    const cp = pronouns(carer.pronoun)
    const start = hhmm(20, r.int(0, 30))
    const end = addMinutes(start, r.int(60, 90))
    const estate = r.pick([9500000, 14000000, 16500000, 22000000])
    const medication = r.pick(['morphine', 'diazepam', 'digoxin'])
    const house = r.pick([
      'the house in Basavanagudi',
      'the bungalow in RT Nagar',
      'the house in Banashankari',
    ])
    const refillOffset = r.int(-4, -1)

    return {
      suspect: { name: suspect, occupation: r.pick(['registered carer', 'part-time nurse', 'none — full-time family carer']) },
      victim: { name: victim.name, relationship: `the suspect's elderly, dependent parent` },
      location: `${house} — found unresponsive in the bedroom`,
      window: { start, end },

      truth: beats(
        ['t1', '14:00', `${Math.abs(refillOffset)} days before the death, the suspect, as ${victim.name}'s registered carer, collected an early repeat prescription of ${medication} from the pharmacy, days ahead of schedule.`],
        ['t2', start, `The suspect administered a dose well beyond ${victim.name}'s prescribed amount during the evening medication round, after another difficult day of caregiving and a fresh argument with a sibling over the will.`],
        ['t3', addMinutes(start, 20), `${victim.name} became drowsy and unresponsive faster than a normal dose would cause.`],
        ['t4', addMinutes(start, 35), `The suspect noticed ${vp.poss} breathing had slowed badly but waited before calling for help, telling themselves it would pass.`],
        ['t5', addMinutes(start, 55), `The suspect eventually called 111, then 999, by which point ${victim.name} had stopped breathing.`],
        ['t6', addMinutes(start, 70), `The suspect disposed of the extra, unaccounted-for medication from the early refill before paramedics searched the house.`],
      ),

      evidence: [
        {
          id: 'e1', type: 'financial',
          linkedBeats: ['t1'],
          claim: `Pharmacy records show the suspect, as registered carer, collected a repeat prescription of ${medication} ${Math.abs(refillOffset)} days early.`,
          vulnerability: `${victim.name}'s dosing needs fluctuated and early refills had happened before, documented in the care notes — an early refill alone has a mundane explanation on this specific case history.`,
        },
        {
          id: 'e2', type: 'physical',
          linkedBeats: ['t2', 't3'],
          claim: `Toxicology shows a ${medication} level in ${victim.name}'s blood significantly above the prescribed dose.`,
          vulnerability: `${victim.name}'s declining kidney function meant the drug cleared more slowly than it used to — a correctly measured dose could still show as elevated in a post-mortem toxicology reading, depending on timing.`,
        },
        {
          id: 'e3', type: 'circumstantial',
          linkedBeats: ['t4'],
          claim: `Call logs show a 35-minute gap between when neighbours heard the suspect on the phone sounding distressed and when 999 was actually dialled.`,
          vulnerability: `The suspect called 111 first for advice, as instructed by the care plan for non-emergency symptom changes, which eats into exactly that kind of gap before an ambulance call escalates.`,
        },
        {
          id: 'e4', type: 'financial',
          linkedBeats: ['t2'],
          claim: `${victim.name}'s will leaves the bulk of a ₹${estate.toLocaleString()} estate to the suspect in recognition of years of caregiving, over objections from a sibling.`,
          vulnerability: `The will predates the death by years and reflects an existing, long-settled family arrangement — it's evidence of motive in the abstract, not of anything done this particular evening.`,
        },
        {
          id: 'e5', type: 'witness',
          linkedBeats: ['t6'],
          claim: `A hospice nurse who visited that week says the suspect seemed "at the end of their rope" with the caregiving burden and had said as much more than once.`,
          vulnerability: `Caregiver exhaustion is near-universal in long-term home care and is exactly the kind of thing hospice staff are trained to listen for and support — expressing exhaustion is not a confession.`,
        },
      ],

      witness: {
        id: 'w1',
        name: carer.name,
        relationship: `relief carer who covers alternate weekends for the family`,
        personality: `Professional and careful with ${cp.poss} words, used to being asked about care incidents and aware that anything said could matter. Sympathetic to the suspect but committed to being accurate.`,
        knowledgeBoundary: `Knows the general care routine and medication schedule from the shared care diary. Was not present on the night in question. Spoke to the suspect by phone earlier that day and found them exhausted and short-tempered about an argument with a sibling over the will. Has no direct knowledge of the dose given that evening.`,
        suspectContradictions: [
          `If the suspect claims the day had been calm and ordinary, ${cp.subj} spoke to them and found them exhausted and upset about a family argument.`,
          `If the suspect claims they followed the care diary's dosing instructions exactly, the diary ${cp.subj} maintains doesn't match the amount toxicology found.`,
        ],
      },

      fatalFact: `The early prescription refill was collected specifically to have surplus medication on hand for that evening — not an administrative accident, as the suspect's account implies.`,

      suspectPersona: {
        personality: `Visibly worn down by months of caregiving, which reads as genuine exhaustion rather than performance — because it is genuine, which makes the deliberate act underneath harder for the suspect to reconcile even in their own account. Defensive about being "blamed for doing their best."`,
        coverStory: `Gave the normal evening dose, same as always, following the care diary. ${victim.name} seemed tired but not unusual at first. When ${vp.poss} breathing changed, the suspect tried to figure out if it was serious before panicking and calling for help — didn't want to overreact and waste the ambulance crew's time over nothing.`,
        breakingPoints: ['the early prescription refill', 'the exact dose given that evening', 'the 35-minute gap before calling 999', 'the missing surplus medication'],
        guiltyKnowledge: [
          `The dose given was deliberately beyond the prescribed amount, not a normal dose`,
          `The early refill was collected specifically to have extra medication available that evening`,
          `The delay in calling for help was intentional, hoping it would resolve on its own`,
        ],
      },

      detectiveBriefing: {
        victimSummary: `${victim.name}, cared for at home by the suspect, was found unresponsive in the bedroom at ${house} and later pronounced dead. Initial assessment leaned toward a dosing accident given the long-term medication regime.`,
        suspectSummary: `${suspect}, ${victim.name}'s registered carer and child, stood to inherit the bulk of a ₹${estate.toLocaleString()} estate and had collected an early prescription refill days before the death.`,
        sceneSummary: `${house}, bedroom. Time window: ${start}–${end}.`,
        crimeSummary: `${victim.name} was given a dose of ${medication} well beyond the prescribed amount during the evening medication round, and help was delayed afterward. The suspect is ${victim.name}'s child and full-time carer, who stood to inherit the bulk of a ₹${estate.toLocaleString()} estate and had collected a prescription refill days early.`,
        evidenceSummary: `Your team has assembled five pieces of evidence. None is conclusive alone, but together they paint a picture. The suspect doesn't know which items you have — use them carefully.`,
      },
    }
  },
}
