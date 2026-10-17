import type { Template } from '../shared'
import { beats, fullName, namedPerson } from '../shared'
import { addMinutes, hhmm } from '../../rng'

function pronouns(p: 'he' | 'she') {
  return p === 'he'
    ? { subj: 'he', obj: 'him', poss: 'his', Subj: 'He' }
    : { subj: 'she', obj: 'her', poss: 'her', Subj: 'She' }
}

export const charityGala: Template = {
  id: 'homicide-charity-gala',
  crime: 'homicide',
  title: 'The Charity Gala',
  build: (r, _detective) => {
    const victim = namedPerson(r)
    const vp = pronouns(victim.pronoun)
    const suspect = namedPerson(r)
    const caterer = namedPerson(r)
    const cp = pronouns(caterer.pronoun)
    const start = hhmm(21, r.int(20, 50))
    const end = addMinutes(start, r.int(70, 90))
    const promotion = r.pick(['Head of Development', 'Regional Director', 'Chief Marketing Officer'])
    const venue = r.pick([
      'the Taj Vivanta ballroom',
      'the Chancery Pavilion banquet hall',
      'the ITC Gardenia ballroom',
    ])
    const serviceStairOffset = r.int(30, 40)
    const fallTime = addMinutes(start, serviceStairOffset)

    return {
      suspect: { name: suspect.name, occupation: r.pick(['fundraising manager', 'events director', 'communications lead', 'account director']), pronoun: suspect.pronoun },
      victim: { name: victim.name, relationship: `the suspect's professional rival` },
      location: `${venue} — found at the base of the service stairwell behind the kitchen`,
      window: { start, end },

      truth: beats(
        ['t1', start, `At the gala's open bar, the suspect handed ${victim.name} a drink laced with a sedative, timed around the toasts so the dose would peak once the crowd thinned.`],
        ['t2', addMinutes(start, 20), `${victim.name} began to seem unusually drowsy and unsteady, which others at the gala put down to the free-flowing wine.`],
        ['t3', addMinutes(start, 28), `The suspect offered to walk ${victim.name} to the service corridor for air, away from the main room.`],
        ['t4', fallTime, `At the top of the service stairwell, the suspect pushed ${victim.name}, who was too sedated to catch themselves properly on the way down.`],
        ['t5', addMinutes(fallTime, 5), `The suspect returned to the main ballroom and resumed mingling as if nothing had happened.`],
        ['t6', addMinutes(fallTime, 25), `${victim.name} was discovered by kitchen staff doing a supply run and the gala was brought to a halt.`],
      ),

      evidence: [
        {
          id: 'e1', type: 'witness',
          linkedBeats: ['t1'],
          claim: `CCTV from the bar area shows the suspect handing ${victim.name} a drink directly, rather than ${victim.name} collecting it themselves.`,
          vulnerability: `It was an open bar with the suspect and ${victim.name} both circulating and handing each other drinks all night, like most of the guests — dozens of similar hand-offs happened on the same footage.`,
        },
        {
          id: 'e2', type: 'physical',
          linkedBeats: ['t1', 't2'],
          claim: `Toxicology found a sedative in ${victim.name}'s system consistent with being administered earlier in the evening.`,
          vulnerability: `The ingestion window toxicology gives is wide, covering several hours during which ${victim.name} had dozens of drinks from the open bar handed by many different people — the sedative's presence doesn't identify who administered it.`,
        },
        {
          id: 'e3', type: 'physical',
          linkedBeats: ['t4'],
          claim: `Bruising on ${victim.name}'s upper arms is consistent with being gripped and guided, not merely falling alone.`,
          vulnerability: `${victim.name} was visibly unsteady from the sedative by that point — anyone nearby, including kitchen staff, may have grabbed their arms simply trying to help them walk, which could leave the same marks.`,
        },
        {
          id: 'e4', type: 'circumstantial',
          linkedBeats: ['t3'],
          claim: `The suspect was the last person seen with ${victim.name} before ${vp.subj} was found at the bottom of the stairwell.`,
          vulnerability: `Being last seen together is a function of who happened to be near the service corridor at that moment — several other guests passed through there in the same stretch, caterers included.`,
        },
        {
          id: 'e5', type: 'financial',
          linkedBeats: ['t1'],
          claim: `HR records show the suspect and ${victim.name} were the two finalists for the same ${promotion} role, with a decision due the following week.`,
          vulnerability: `Competing for the same promotion is extremely common and resolves without incident the overwhelming majority of the time — professional rivalry is a motive in the abstract, not evidence of this specific act.`,
        },
      ],

      witness: {
        id: 'w1',
        name: caterer.name,
        relationship: `catering staff working the service corridor that night`,
        personality: `Busy and task-focused during the event, recalling things through the lens of the service schedule rather than the social drama — precise about timing because of the supply runs, vague about everything else.`,
        knowledgeBoundary: `Was doing supply runs through the service corridor most of the evening and saw two people near the top of the service stairwell around the time in question, but was focused on a tray and didn't get a clear look at faces. Found ${victim.name} at the bottom on a later run. Has no knowledge of the drink or the sedative.`,
        suspectContradictions: [
          `If the suspect claims they never went near the service corridor that night, ${cp.subj} saw two people near the stairwell at roughly that time.`,
          `If the suspect claims they parted ways with ${victim.name} in the main ballroom well before the fall, ${cp.subj}'s supply-run timing puts two people at the stairwell much closer to when ${victim.name} was found.`,
        ],
      },

      fatalFact: `The suspect guided ${victim.name}, already sedated, specifically to the top of the service stairwell before the fall — this was not an unlucky accident after a few too many drinks.`,

      suspectPersona: {
        personality: `Polished and professionally composed even under direct questioning — the same skill that makes them good at the job makes them hard to read here. Frames the promotion rivalry as "healthy competition" to downplay motive, and expresses performative shock about the "accident."`,
        coverStory: `Saw ${victim.name} looking unsteady near the bar and assumed ${vp.subj}'d had too much to drink, like plenty of people that night. Didn't walk ${vp.obj} anywhere — last saw ${vp.obj} heading toward the restrooms, which happen to be past the service corridor. Went back to mingling and only learned about the fall when the gala was interrupted.`,
        breakingPoints: ['the CCTV of handing over the drink', 'what exactly happened in the service corridor', 'the timing of the supply-run witness sighting', 'the promotion decision due the following week'],
        guiltyKnowledge: [
          `The drink was deliberately laced with a sedative, not just normal party drinking`,
          `${victim.name} was guided to the stairwell specifically, not heading to the restrooms alone`,
          `${victim.name} was pushed, not simply stumbled while unsteady`,
        ],
      },

      detectiveBriefing: {
        victimSummary: `${victim.name} was found dead at the base of the service stairwell at ${venue} during a charity gala. Initial assessment leaned toward an intoxicated accidental fall.`,
        suspectSummary: `${suspect.name}, a colleague of ${victim.name}'s, was the other finalist for the same ${promotion} role, with a decision due the following week.`,
        sceneSummary: `${venue}, service stairwell behind the kitchen. Time window: ${start}–${end}.`,
        crimeSummary: `${victim.name} was sedated via a drink at the open bar, then pushed down the service stairwell while too impaired to catch themselves. The suspect is a colleague of ${victim.name}'s, the other finalist for the same ${promotion} role with a decision due the following week.`,
        evidenceSummary: `Your team has assembled five pieces of evidence. None is conclusive alone, but together they paint a picture. The suspect doesn't know which items you have — use them carefully.`,
      },
    }
  },
}
