import type { Template } from '../shared'
import { beats, fullName, namedPerson } from '../shared'
import { addMinutes, hhmm } from '../../rng'

function pronouns(p: 'he' | 'she') {
  return p === 'he'
    ? { subj: 'he', obj: 'him', poss: 'his', Subj: 'He' }
    : { subj: 'she', obj: 'her', poss: 'her', Subj: 'She' }
}

export const openWater: Template = {
  id: 'homicide-open-water',
  crime: 'homicide',
  title: 'The Open Water',
  build: (r, _detective) => {
    const victim = namedPerson(r)
    const vp = pronouns(victim.pronoun)
    const suspect = namedPerson(r)
    const dogWalker = namedPerson(r)
    const dp = pronouns(dogWalker.pronoun)
    const start = hhmm(18, r.int(15, 45))
    const end = addMinutes(start, r.int(45, 65))
    const lover = r.pick(['a colleague', 'a university friend', 'someone from the gym'])
    const lake = r.pick([
      'Elmridge Lake',
      'the lake at Thornfield',
      'Marsden reservoir',
    ])
    const pingOffset = r.int(35, 45)
    const pingTime = addMinutes(start, pingOffset)

    return {
      suspect: { name: suspect.name, occupation: r.pick(['solicitor', 'surveyor', 'IT consultant', 'nurse']), pronoun: suspect.pronoun },
      victim: { name: victim.name, relationship: `the suspect's spouse of several years` },
      location: `${lake} — found in the shallows near the eastern jetty`,
      window: { start, end },

      truth: beats(
        ['t1', start, `The suspect suggested an evening walk around ${lake} with ${victim.name}, who had confronted them about the affair with ${lover} two days earlier and was pushing for a decision about the marriage.`],
        ['t2', addMinutes(start, 10), `On the jetty, ${victim.name} said ${vp.subj} intended to tell ${lover}'s partner and file for divorce, taking half of everything.`],
        ['t3', addMinutes(start, 14), `The suspect pushed ${victim.name} off the jetty during the argument. ${vp.Subj} hit ${vp.poss} head on a submerged post on the way down.`],
        ['t4', addMinutes(start, 17), `${victim.name} was dazed and struggling in the water. The suspect held ${vp.poss} shoulders under rather than pulling ${vp.obj} out.`],
        ['t5', addMinutes(start, 25), `The suspect left the body in the shallows and walked back along the tree line rather than the main path.`],
        ['t6', pingTime, `The suspect's phone pinged a cell tower near the lake car park, well after they claim to have already left the area.`],
      ),

      evidence: [
        {
          id: 'e1', type: 'digital',
          linkedBeats: ['t6'],
          claim: `The suspect's phone pinged a tower covering the lake and its car park at ${pingTime}, forty minutes after the time they say they left.`,
          vulnerability: `That tower's coverage radius is wide and imprecise, overlapping the public car park and a stretch of the main road — the ping shows the phone was somewhere in a broad area, not specifically at the jetty.`,
        },
        {
          id: 'e2', type: 'physical',
          linkedBeats: ['t3'],
          claim: `Pre-death bruising on ${victim.name}'s scalp is consistent with striking a submerged post, not with a straightforward drowning.`,
          vulnerability: `That stretch of shoreline is littered with old mooring posts just under the surface — the pathologist concedes an accidental fall from the jetty could produce the same injury without anyone else involved.`,
        },
        {
          id: 'e3', type: 'circumstantial',
          linkedBeats: ['t1', 't2'],
          claim: `Messages between the suspect and ${lover} show the affair was ongoing, and that ${victim.name} had found out and confronted the suspect two days before the walk.`,
          vulnerability: `An affair gives a motive for divorce, not necessarily for murder — plenty of marriages survive discovered affairs, and the messages don't show the suspect wanting ${victim.name} dead, only wanting to avoid losing everything in a split.`,
        },
        {
          id: 'e4', type: 'witness',
          linkedBeats: ['t5'],
          claim: `${dogWalker.name}, walking a dog nearby, saw someone matching the suspect's description walking briskly away from the jetty along the tree line, not the main path.`,
          vulnerability: `The tree line is a well-used shortcut to the car park that avoids the muddy main path after rain — taking it isn't itself suspicious, and the description is vague enough to fit several regular joggers.`,
        },
        {
          id: 'e5', type: 'financial',
          linkedBeats: ['t2'],
          claim: `Divorce paperwork drafted by ${victim.name}'s solicitor, dated the day before the death, demands an even split of the marital assets.`,
          vulnerability: `Drafted paperwork that was never filed shows an intention, not an action — plenty of people draft divorce papers as leverage in an argument without ever actually filing them.`,
        },
      ],

      witness: {
        id: 'w1',
        name: dogWalker.name,
        relationship: `local dog walker, often around the lake in the evenings`,
        personality: `Observant about the dog, vague about everything else. Happy to help but gets details of time and sequence muddled easily.`,
        knowledgeBoundary: `Was walking a dog on the far side of the lake and saw two figures on the jetty from a distance, then later saw one figure walking away alone through the trees. Didn't hear anything specific over the wind. Didn't see anyone fall or anyone in the water. Has no idea what was said on the jetty.`,
        suspectContradictions: [
          `If the suspect claims they left together with ${victim.name} and parted ways amicably at the car park, ${dp.subj} saw only one figure leaving, alone, through the trees.`,
          `If the suspect claims they took the main path home, ${dp.subj} saw them cut through the tree line instead.`,
        ],
      },

      fatalFact: `The suspect held ${victim.name} under rather than pulling ${vp.obj} out once ${vp.subj} was already struggling in the water — this was not a failed rescue attempt.`,

      suspectPersona: {
        personality: `Performs grief convincingly and leans hard into the "devoted but imperfect spouse" framing, treating the affair as the real crime they're ashamed of rather than deflecting from the death itself. Becomes clipped and evasive specifically around the moment ${victim.name} went into the water.`,
        coverStory: `Went for an evening walk together to talk things through after the affair came out. Things were tense but calm. ${victim.name} wanted some time alone on the jetty to think, so the suspect walked back ahead through the trees to give ${vp.obj} space. Found out the next day what had happened and has been in shock since.`,
        breakingPoints: ['the phone ping near the car park', 'exactly what was said on the jetty', `why they left ${victim.name} alone there`, 'the route they took back'],
        guiltyKnowledge: [
          `${victim.name} went into the water from the jetty during the argument, not afterward alone`,
          `${victim.name} was held under rather than struggling unassisted`,
          `The suspect was still at the lake well after the time they claim to have left`,
        ],
      },

      detectiveBriefing: {
        victimSummary: `${victim.name} was found dead in the shallows of ${lake}, near the eastern jetty. Initial assessment leaned toward an accidental drowning, but pre-death bruising complicates that.`,
        suspectSummary: `${suspect.name}, ${victim.name}'s spouse, had been having an affair with ${lover}, recently discovered by ${victim.name}, who was pushing for a divorce and a full asset split.`,
        sceneSummary: `${lake}, eastern jetty and shoreline. Time of death window: ${start}–${end}.`,
        crimeSummary: `${victim.name} was pushed from the jetty during an argument, struck their head on a submerged post, and was held under rather than pulled out. The suspect is ${victim.name}'s spouse, who was recently discovered to be having an affair with ${lover} and was facing a demand for divorce and a full asset split.`,
        evidenceSummary: `Your team has assembled five pieces of evidence. None is conclusive alone, but together they paint a picture. The suspect doesn't know which items you have — use them carefully.`,
      },
    }
  },
}
