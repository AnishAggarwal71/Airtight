import type { Template } from '../shared'
import { beats, fullName, namedPerson } from '../shared'
import { addMinutes, hhmm } from '../../rng'

function pronouns(p: 'he' | 'she') {
  return p === 'he'
    ? { subj: 'he', obj: 'him', poss: 'his', Subj: 'He' }
    : { subj: 'she', obj: 'her', poss: 'her', Subj: 'She' }
}

export const hikingTrail: Template = {
  id: 'homicide-hiking-trail',
  crime: 'homicide',
  title: 'The Hiking Trail',
  build: (r, _detective) => {
    const victim = namedPerson(r)
    const vp = pronouns(victim.pronoun)
    const suspect = namedPerson(r)
    const otherHiker = namedPerson(r)
    const op = pronouns(otherHiker.pronoun)
    const start = hhmm(14, r.int(10, 40))
    const end = addMinutes(start, r.int(50, 70))
    const affairPartner = r.pick(["the suspect's spouse", "the suspect's business partner", "the suspect's sister-in-law"])
    const trail = r.pick([
      'the Pennine ridge trail',
      'the Blackstone Edge hiking path',
      'the Haworth Moor trail',
    ])
    const gpsOffset = r.int(3, 6)

    return {
      suspect: { name: suspect.name, occupation: r.pick(['architect', 'personal trainer', 'graphic designer', 'veterinary nurse']), pronoun: suspect.pronoun },
      victim: { name: victim.name, relationship: `the suspect's close friend of many years` },
      location: `${trail} — found at the base of a cliff section known locally as the Scar`,
      window: { start, end },

      truth: beats(
        ['t1', start, `The suspect invited ${victim.name} on a regular Saturday hike along ${trail}, as they had done for years.`],
        ['t2', addMinutes(start, 20), `Near the Scar viewpoint, ${victim.name} said ${vp.subj} couldn't keep quiet about the affair any longer and intended to tell everyone that weekend.`],
        ['t3', addMinutes(start, 24), `The suspect pushed ${victim.name} during the argument. ${vp.Subj} went over the edge at the Scar.`],
        ['t4', addMinutes(start, 30), `The suspect looked over the edge, saw ${victim.name} wasn't moving, and didn't climb down or call for help immediately.`],
        ['t5', addMinutes(start, gpsOffset + 30), `The suspect stood at the viewpoint for several minutes before continuing along the trail as if nothing had happened.`],
        ['t6', addMinutes(start, 55), `The suspect called it in from further down the trail, claiming to have only just noticed ${victim.name} was missing.`],
      ),

      evidence: [
        {
          id: 'e1', type: 'digital',
          linkedBeats: ['t4', 't5'],
          claim: `The suspect's phone GPS shows them stationary at the Scar viewpoint for several minutes, starting around the time ${victim.name} is believed to have fallen.`,
          vulnerability: `The Scar is the single most photographed viewpoint on the entire trail — hikers routinely stop there for minutes at a time for photos, and the suspect has a documented habit of doing exactly that on previous hikes.`,
        },
        {
          id: 'e2', type: 'physical',
          linkedBeats: ['t3'],
          claim: `${victim.name}'s injuries are consistent with being pushed from a standing position rather than losing footing on loose scree.`,
          vulnerability: `The scree at that exact section is notoriously unstable, and the pathologist's report notes a fall from standing could produce near-identical injuries to a push — it's a judgment call, not a hard finding.`,
        },
        {
          id: 'e3', type: 'circumstantial',
          linkedBeats: ['t2'],
          claim: `Messages from ${victim.name} to a mutual friend the night before say "I'm telling everyone this weekend, I can't carry this anymore about [the suspect] and ${affairPartner}."`,
          vulnerability: `The message doesn't name what ${victim.name} intended to reveal — the detective is inferring it was the affair, but ${victim.name} may have meant something else entirely unrelated to the suspect.`,
        },
        {
          id: 'e4', type: 'witness',
          linkedBeats: ['t6'],
          claim: `${otherHiker.name}, hiking the same trail that day, says the suspect looked "unbothered, almost calm" when they encountered them shortly before the suspect reported ${victim.name} missing.`,
          vulnerability: `Shock affects people very differently — a flat or calm affect after trauma is a recognised and common response, not reliable evidence of guilt on its own.`,
        },
        {
          id: 'e5', type: 'physical',
          linkedBeats: ['t3'],
          claim: `Scuff marks at the cliff edge are consistent with two sets of boot prints close together, not one person walking alone to the edge.`,
          vulnerability: `That viewpoint sees dozens of hikers a week standing close together for photos — overlapping boot prints from unrelated hikers earlier that day are entirely plausible.`,
        },
      ],

      witness: {
        id: 'w1',
        name: otherHiker.name,
        relationship: `fellow hiker encountered on the trail that day`,
        personality: `Casual and a bit of a trail chatterbox, happy to describe everything in detail but not especially precise about timing.`,
        knowledgeBoundary: `Passed the suspect on the trail some time after the fall, heading away from the Scar, alone. Noticed the suspect's demeanor seemed off but couldn't say exactly how. Didn't see the fall itself or hear anything from the viewpoint. Has no knowledge of what was said between the suspect and ${victim.name}.`,
        suspectContradictions: [
          `If the suspect claims they were together with ${victim.name} right up until they realised ${vp.subj} was missing, ${op.subj} passed the suspect walking alone well before that point.`,
          `If the suspect claims they were visibly distressed and hurrying for help, ${op.subj} remembers them seeming calm, almost unbothered.`,
        ],
      },

      fatalFact: `The suspect stood at the viewpoint for several minutes after ${victim.name} went over the edge before moving on — this was not someone who had just witnessed an accidental fall and rushed to help.`,

      suspectPersona: {
        personality: `Leans on the decades-long friendship as a shield — "I would never, we've hiked together for years" — treating the accusation itself as the offense. Composed in a way that reads as denial rather than innocence once the GPS data comes up.`,
        coverStory: `${victim.name} seemed a bit distracted that day but nothing alarming. They were hiking together near the Scar, the suspect went ahead a short way to take photos, and when they turned back ${victim.name} was gone. Assumed ${vp.subj} had gone on ahead. Only realised something was wrong much further down the trail and called it in immediately.`,
        breakingPoints: ['the GPS data showing them stationary at the Scar', `what ${victim.name} actually said about telling everyone`, 'why they didn\'t call for help sooner', 'their demeanor when the other hiker passed them'],
        guiltyKnowledge: [
          `${victim.name} went over the edge during a confrontation, not while out of sight ahead on the trail`,
          `The suspect saw ${victim.name} at the base of the cliff and did not immediately seek help`,
          `${victim.name} intended to reveal the affair that specific weekend`,
        ],
      },

      detectiveBriefing: {
        victimSummary: `${victim.name} was found dead at the base of a cliff section known as the Scar on ${trail}, while hiking with the suspect. Initial assessment leaned toward a fall on unstable scree.`,
        suspectSummary: `${suspect.name}, ${victim.name}'s close friend of many years, was about to be exposed by ${victim.name} for an ongoing affair with ${affairPartner}.`,
        sceneSummary: `${trail}, the Scar viewpoint and cliff base. Time window: ${start}–${end}.`,
        crimeSummary: `${victim.name} was pushed from the cliff edge at the Scar during a confrontation and left there while the suspect walked on. The suspect is ${victim.name}'s close friend of many years, who was about to be exposed for an ongoing affair with ${affairPartner}.`,
        evidenceSummary: `Your team has assembled five pieces of evidence. None is conclusive alone, but together they paint a picture. The suspect doesn't know which items you have — use them carefully.`,
      },
    }
  },
}
