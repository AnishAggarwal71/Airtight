import type { Template } from '../shared'
import { beats, fullName, namedPerson } from '../shared'
import { addMinutes, hhmm } from '../../rng'

function pronouns(p: 'he' | 'she') {
  return p === 'he'
    ? { subj: 'he', obj: 'him', poss: 'his', Subj: 'He' }
    : { subj: 'she', obj: 'her', poss: 'her', Subj: 'She' }
}

export const allergy: Template = {
  id: 'homicide-allergy',
  crime: 'homicide',
  title: 'The Allergy',
  build: (r, _detective) => {
    const victim = namedPerson(r)
    const vp = pronouns(victim.pronoun)
    const suspect = namedPerson(r)
    const otherGuest = namedPerson(r)
    const op = pronouns(otherGuest.pronoun)
    const start = hhmm(19, r.int(30, 55))
    const end = addMinutes(start, r.int(90, 120))
    const inheritance = r.pick([18000000, 24000000, 31000000, 42000000])
    const allergen = r.pick(['shellfish', 'peanut', 'sesame'])
    const house = r.pick([
      "their late mother's house in Jayanagar",
      "the family home in Malleswaram",
      "the house they'd inherited jointly in Indiranagar",
    ])
    const reactionOffset = r.int(35, 50)
    const reactionTime = addMinutes(start, reactionOffset)

    return {
      suspect: { name: suspect.name, occupation: r.pick(['estate agent', 'accountant', 'teacher', 'pharmacist']), pronoun: suspect.pronoun },
      victim: { name: victim.name, relationship: `the suspect's sibling, co-heir to the family estate` },
      location: `${house} — collapsed in the dining room during a family dinner`,
      window: { start, end },

      truth: beats(
        ['t1', start, `The suspect hosted a dinner at ${house} to "talk things through" about selling the inherited house, which ${victim.name} had been blocking.`],
        ['t2', addMinutes(start, 15), `Earlier that afternoon the suspect had worked a measured amount of ${allergen} paste into the sauce for ${victim.name}'s plate specifically, knowing about the allergy.`],
        ['t3', addMinutes(start, 25), `${victim.name} ate the main course and began showing signs of a reaction within minutes.`],
        ['t4', reactionTime, `The suspect delayed fetching ${victim.name}'s epinephrine auto-injector, claiming they couldn't find it, costing several critical minutes.`],
        ['t5', addMinutes(reactionTime, 6), `Paramedics were called, but by the time they arrived ${victim.name} had stopped breathing.`],
        ['t6', addMinutes(reactionTime, 12), `The suspect disposed of the ramekin of leftover sauce before police arrived, rinsing it in the kitchen sink.`],
      ),

      evidence: [
        {
          id: 'e1', type: 'physical',
          linkedBeats: ['t2'],
          claim: `A receipt shows the suspect bought a jar of ${allergen} paste that same afternoon, despite nobody at the dinner having a stated use for it.`,
          vulnerability: `The suspect cooks with ${allergen} paste regularly in other dishes — nobody checked whether the pantry already had an opened jar, which would make a fresh purchase unremarkable.`,
        },
        {
          id: 'e2', type: 'physical',
          linkedBeats: ['t6'],
          claim: `The ramekin used for the sauce was found rinsed and put away, unlike every other dish from that dinner, which was left in the sink.`,
          vulnerability: `The suspect says they rinsed it on autopilot while panicking and calling 999 — an understandable, if unlucky-looking, reflex rather than evidence of concealment.`,
        },
        {
          id: 'e3', type: 'witness',
          linkedBeats: ['t4'],
          claim: `${otherGuest.name}, another guest, says the suspect "seemed to take a while" finding the auto-injector everyone knew was kept in the hallway drawer.`,
          vulnerability: `Panicked people searching a familiar house for a small object under pressure often take longer than they would normally — a few delayed seconds reads very differently in hindsight than it did in the moment.`,
        },
        {
          id: 'e4', type: 'financial',
          linkedBeats: ['t1'],
          claim: `Estate paperwork shows the suspect stood to gain sole control of the ₹${inheritance.toLocaleString()} house sale if ${victim.name} were out of the picture.`,
          vulnerability: `${victim.name}'s death doesn't remove other heirs or legal complications from the estate — several other relatives have a claim, so the suspect doesn't automatically inherit sole control.`,
        },
        {
          id: 'e5', type: 'circumstantial',
          linkedBeats: ['t1'],
          claim: `Text messages show the suspect was frustrated that ${victim.name} had refused three separate offers to sell the house that year.`,
          vulnerability: `Siblings arguing about an inherited property is one of the most common disputes there is — frustration over a stalled house sale is not, by itself, evidence of anything beyond a stressful year.`,
        },
      ],

      witness: {
        id: 'w1',
        name: otherGuest.name,
        relationship: `family friend who was also at the dinner`,
        personality: `Shaken by what happened and eager to be useful, but second-guessing ${op.poss} own memory of a fast-moving, frightening evening.`,
        knowledgeBoundary: `Was at the table and saw ${victim.name} start struggling to breathe. Saw the suspect go to look for the injector and thought it took longer than expected, though can't say exactly how long. Didn't see the kitchen or the cooking. Has no idea the sauce was tampered with.`,
        suspectContradictions: [
          `If the suspect claims they found the injector immediately, ${op.subj} remembers it taking a while.`,
          `If the suspect claims the dinner was a normal, friendly gathering, ${op.subj} remembers it being called specifically to discuss selling the house, and that it was tense.`,
        ],
      },

      fatalFact: `The suspect bought the allergen that same afternoon and worked it specifically into ${victim.name}'s portion — this wasn't an accidental cross-contamination.`,

      suspectPersona: {
        personality: `Grief-stricken and guilt-ridden in a way that reads, at first, as pure sibling loss rather than concealment — genuinely did love their sibling, which makes the self-justification underneath harder to access. Gets defensive fast about "being blamed for an accident."`,
        coverStory: `Hosted a normal family dinner to patch things up about the house. Didn't know ${victim.name}'s allergy had gotten that severe recently — thought a small amount wouldn't matter, if it even came from this meal at all. Looked for the injector as fast as they could. Rinsed the ramekin without thinking, out of pure habit, while waiting for the ambulance.`,
        breakingPoints: ['the receipt for the allergen paste', 'exactly how long they searched for the injector', 'the rinsed ramekin', 'what the dinner was actually called to discuss'],
        guiltyKnowledge: [
          `The allergen was deliberately worked into ${victim.name}'s specific portion, not a general ingredient`,
          `The delay fetching the injector was intentional, not panic`,
          `The ramekin was rinsed specifically to remove evidence, not out of habit`,
        ],
      },

      detectiveBriefing: {
        victimSummary: `${victim.name} died of a severe allergic reaction during a family dinner at ${house}. Initial read was a tragic accident, but the timeline around the ingredient and the delayed treatment raises questions.`,
        suspectSummary: `${suspect.name}, ${victim.name}'s sibling, hosted the dinner and stood to gain control of a disputed ₹${inheritance.toLocaleString()} inherited property if ${victim.name} were out of the picture.`,
        sceneSummary: `${house}, dining room and kitchen. ${victim.name} collapsed at the table. Time window: ${start}–${end}.`,
        crimeSummary: `${victim.name} was deliberately fed ${allergen} paste worked into their portion of the meal, then treatment was delayed by several critical minutes. The suspect is ${victim.name}'s sibling, co-heir to a ₹${inheritance.toLocaleString()} estate ${victim.name} had refused three times to sell.`,
        evidenceSummary: `Your team has assembled five pieces of evidence. None is conclusive alone, but together they paint a picture. The suspect doesn't know which items you have — use them carefully.`,
      },
    }
  },
}
