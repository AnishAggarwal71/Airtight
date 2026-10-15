import type { Template } from '../shared'
import { beats, fullName, namedPerson } from '../shared'
import { addMinutes, hhmm } from '../../rng'

function pronouns(p: 'he' | 'she') {
  return p === 'he'
    ? { subj: 'he', obj: 'him', poss: 'his', Subj: 'He' }
    : { subj: 'she', obj: 'her', poss: 'her', Subj: 'She' }
}

export const allotment: Template = {
  id: 'homicide-allotment',
  crime: 'homicide',
  title: 'The Allotment Shed',
  build: (r, _detective) => {
    const victim = namedPerson(r)
    const vp = pronouns(victim.pronoun)
    const suspect = fullName(r)
    const otherHolder = namedPerson(r)
    const op = pronouns(otherHolder.pronoun)
    const start = hhmm(19, r.int(10, 40))
    const end = addMinutes(start, r.int(45, 60))
    const dispute = r.pick(['the shared water tank', 'the boundary line between the plots', 'the compost pit'])
    const site = r.pick([
      'the Kaveri Nagar community allotments',
      'the Horamavu kitchen-garden plots',
      'the Yelahanka allotment gardens',
    ])
    const latchOffset = r.int(18, 26)
    const latchTime = addMinutes(start, latchOffset)
    const gloveColour = r.pick(['green', 'navy', 'grey'])

    return {
      suspect: { name: suspect, occupation: r.pick(['retired postal worker', 'school caretaker', 'plumber', 'market trader']) },
      victim: { name: victim.name, relationship: `the plot-holder two rows over` },
      location: `${site} — found face-down between the runner bean canes on ${vp.poss} own plot`,
      window: { start, end },

      truth: beats(
        ['t1', start, `The suspect walked over to ${victim.name}'s plot at dusk to confront ${vp.obj} again about ${dispute}.`],
        ['t2', addMinutes(start, 4), `${victim.name} laughed it off and said ${vp.subj} had already reported the suspect to the committee. The suspect grabbed the washing line strung between two canes.`],
        ['t3', addMinutes(start, 7), `The suspect looped the line around ${vp.poss} neck from behind and held it until ${vp.subj} stopped moving.`],
        ['t4', addMinutes(start, 15), `The suspect left the body where it fell among the canes, hoping it would read as a fall or a heart attack.`],
        ['t5', latchTime, `The suspect went to the communal shed to return the shears they'd borrowed earlier, catching a glove on the rusted latch.`],
        ['t6', addMinutes(latchTime, 10), `The suspect walked home along the towpath rather than past the site office.`],
      ),

      evidence: [
        {
          id: 'e1', type: 'physical',
          linkedBeats: ['t5'],
          claim: `A torn fragment of ${gloveColour} fabric was caught on the rusted latch of the communal shed.`,
          vulnerability: `Half the plot-holders use that shed and that latch snags everyone — three other people have reported torn gloves on it this year. It proves presence at the shed, not at the body.`,
        },
        {
          id: 'e2', type: 'physical',
          linkedBeats: ['t3'],
          claim: `A ligature mark consistent with cord or line, not a fall, was found on ${victim.name}'s neck.`,
          vulnerability: `${victim.name} grew runner beans up garden twine strung at neck height — the pathologist admits a bad fall into strung twine could leave a similar mark, though it's a stretch.`,
        },
        {
          id: 'e3', type: 'witness',
          linkedBeats: ['t1', 't2'],
          claim: `The site secretary's minutes show the suspect received a formal written warning about the dispute the week before.`,
          vulnerability: `A warning letter shows friction existed, not that it escalated. Half the site has received warnings over boundary disputes at one point or another.`,
        },
        {
          id: 'e4', type: 'circumstantial',
          linkedBeats: ['t1'],
          claim: `The suspect had complained to three separate neighbours that ${victim.name} was "going to get what's coming" over ${dispute}.`,
          vulnerability: `People say things like that about allotment feuds constantly — it's a figure of speech on that site, not a threat anyone took literally at the time.`,
        },
        {
          id: 'e5', type: 'digital',
          linkedBeats: ['t6'],
          claim: `The suspect's fitness tracker shows a walking route home along the towpath that evening, well out of their normal way.`,
          vulnerability: `The towpath is a popular shortcut when the site office is locked for the night, which it was. Taking it proves nothing about where the suspect had been beforehand.`,
        },
      ],

      witness: {
        id: 'w1',
        name: otherHolder.name,
        relationship: `fellow plot-holder — tends the plot backing onto ${victim.name}'s`,
        personality: `Blunt and a little gossipy, enjoys being asked for an opinion. Will volunteer rumour as readily as fact unless pressed to separate the two. Genuinely liked the victim.`,
        knowledgeBoundary: `Was watering nearby and heard the suspect and victim talking, tone rising, around the time of the visit. Didn't see the confrontation itself — the sheds blocked the view. Heard what sounded like the shed door later, around ${addMinutes(start, 16)}. Has no idea how the victim actually died.`,
        suspectContradictions: [
          `If the suspect claims they never went near ${victim.name}'s plot that evening, ${op.subj} heard them talking right there.`,
          `If the suspect claims the conversation was calm, ${op.subj} heard raised voices.`,
        ],
      },

      fatalFact: `The suspect returned to the shed and handled the latch minutes after ${victim.name} stopped answering — not before, as their account implies.`,

      suspectPersona: {
        personality: `Prickly and self-righteous about the dispute, treats the whole thing as a grievance rather than a crime. Happy to litigate the boundary argument at length as a deflection. Goes quiet and short when the conversation moves from the dispute to the actual evening.`,
        coverStory: `Went over about ${start} to try to sort things out about ${dispute} one more time, civilly. ${victim.name} wasn't having it, so the suspect left after a few minutes, frustrated but nothing more. Returned the shears to the shed on the way out and walked home along the towpath because the office gate was shut. Heard about the death the next morning from another plot-holder.`,
        breakingPoints: ['the washing line', 'exactly how long the conversation lasted', 'the torn glove on the latch', 'why they took the towpath instead of the usual path'],
        guiltyKnowledge: [
          `The washing line was used, not a fall or a fight`,
          `The body was left among the bean canes deliberately, hoping it would look natural`,
          `The shed visit happened after the confrontation, not before it`,
        ],
      },

      detectiveBriefing: {
        victimSummary: `${victim.name} was found dead on ${vp.poss} own allotment plot at ${site}, among the runner bean canes. Initial assessment leaned toward a fall or a cardiac event, but a ligature mark complicates that.`,
        suspectSummary: `${suspect}, who holds a nearby plot, had been in a long and documented dispute with ${victim.name} over ${dispute}. They admit to visiting the plot that evening.`,
        sceneSummary: `${site}. The body lay between the bean canes on ${victim.name}'s plot. Time of death window: ${start}–${end}.`,
        crimeSummary: `${victim.name} was strangled with a washing line among the bean canes on their own plot and the body left to look like a fall or heart attack. The suspect holds a nearby plot and had been in a long-running dispute with ${victim.name} over ${dispute}.`,
        evidenceSummary: `Your team has assembled five pieces of evidence. None is conclusive alone, but together they paint a picture. The suspect doesn't know which items you have — use them carefully.`,
      },
    }
  },
}
