import type { Template } from './shared'
import { beats, fullName, namedPerson } from './shared'
import { addMinutes, hhmm } from '../rng'

/**
 * Homicide — the anchor crime type. Long timelines, a relationship with the
 * victim that gives every question a second layer, and pathology evidence that
 * is almost always hedged in the report and therefore arguable.
 */

function pronouns(p: 'he' | 'she') {
  return p === 'he'
    ? { subj: 'he', obj: 'him', poss: 'his', Subj: 'He' }
    : { subj: 'she', obj: 'her', poss: 'her', Subj: 'She' }
}

const stairwell: Template = {
  id: 'homicide-stairwell',
  crime: 'homicide',
  title: 'The Service Stairwell',
  build: (r, _detective, locality) => {
    const victim = namedPerson(r)
    const vp = pronouns(victim.pronoun)
    const suspect = fullName(r)
    const neighbour = namedPerson(r)
    const np = pronouns(neighbour.pronoun)
    const start = hhmm(22, r.int(40, 55))
    const end = addMinutes(start, r.int(35, 50))
    const debt = r.pick([9000, 12500, 14000, 18000, 21000])
    const wifiDropOffset = r.int(24, 32)
    const keyCardExitOffset = Math.max(r.int(28, 36), wifiDropOffset + 1)
    const wifiDrop = addMinutes(start, wifiDropOffset)
    const keyCardExit = addMinutes(start, keyCardExitOffset)
    const relationship = r.pick([
      `${vp.poss} brother-in-law`,
      `${vp.poss} cousin`,
      `${vp.poss} closest friend of nineteen years`,
    ])
    const suspectOccupation = r.pick(['site foreman', 'locksmith', 'delivery driver', 'physiotherapist'])
    const blockName = r.pick([
      'Wraysbury Mill, a converted flour mill on the canal',
      'Ashcroft Wharf, a converted warehouse block',
      'the Ordnance Building, six floors of converted offices',
    ])
    const block = locality ? `${blockName} in ${locality}` : blockName
    const homeTime = addMinutes(keyCardExit, r.int(8, 15))

    return {
      suspect: { name: suspect, occupation: suspectOccupation },
      victim: { name: victim.name, relationship },
      location: `${block} — found at the foot of the service stairwell`,
      window: { start, end },

      truth: beats(
        ['t1', start, `The suspect entered ${victim.name}'s flat on the fourth floor. An argument about the £${debt.toLocaleString()} debt started almost immediately.`],
        ['t2', addMinutes(start, 6), `${victim.name} said ${vp.subj} had no intention of paying and told the suspect to take ${vp.obj} to court. The suspect picked up a wine bottle from the counter.`],
        ['t3', addMinutes(start, 9), `The suspect struck ${victim.name} twice. The second blow was fatal.`],
        ['t4', addMinutes(start, 20), `The suspect dragged the body to the service stairwell and arranged it at the bottom of the flight to look like a fall.`],
        ['t5', wifiDrop, `The suspect went back into the flat to collect the bottle. Their phone was still on the building wifi.`],
        ['t6', keyCardExit, `The suspect left through the bin store on the ground floor and put the bottle and jacket in the canal.`],
      ),

      evidence: [
        {
          id: 'e1', type: 'digital',
          linkedBeats: ['t6'],
          claim: `The suspect's key card opened the bin store door at ${keyCardExit}.`,
          vulnerability: `The log records the card, not the person holding it. Cards in that block get lent out all the time — to contractors, to family, to whoever does the gutters.`,
        },
        {
          id: 'e2', type: 'physical',
          linkedBeats: ['t3', 't4'],
          claim: `The pathologist thinks the head injury doesn't quite fit a fall down that stairwell — the angle looks wrong.`,
          vulnerability: `The report says "less consistent with," not impossible — that's a hedged opinion, not a finding. ${victim.name} also fell in that same stairwell two months ago and was treated for a head injury then.`,
        },
        {
          id: 'e3', type: 'digital',
          linkedBeats: ['t5'],
          claim: `The suspect's phone stayed connected to the building wifi until ${wifiDrop}.`,
          vulnerability: `The router covers the whole east side of the building, including the car park and the towpath. Staying connected shows the suspect was nearby, not that they were in the flat.`,
        },
        {
          id: 'e4', type: 'circumstantial',
          linkedBeats: ['t1'],
          claim: `${victim.name} owed the suspect £${debt.toLocaleString()} and had missed the last three repayment dates.`,
          vulnerability: `A debt is a reason to want someone alive and earning. Dead, the suspect is just an unsecured creditor at the back of a queue — they lose the money entirely.`,
        },
        {
          id: 'e5', type: 'physical',
          linkedBeats: ['t2', 't5'],
          claim: `There's a gap in the wine rack in the kitchen — one bottle missing, and none found in the flat or the bins.`,
          vulnerability: `${victim.name} drank. A missing bottle from a wine rack is about the least remarkable thing in that kitchen.`,
        },
      ],

      witness: {
        id: 'w1',
        name: neighbour.name,
        relationship: `neighbour — lives in the flat directly below ${victim.name}`,
        personality: `Elderly, eager to help but prone to embellishment. Tends to present guesses as facts. Genuinely wants to assist the police but ${np.poss} hearing and memory aren't what they used to be.`,
        knowledgeBoundary: `Heard raised voices from ${victim.name}'s flat that night — two people, one of them shouting. Took ${np.poss} hearing aids out before it got loud, so couldn't make out words. Heard a door slam later, around ${addMinutes(start, 22)}. Saw nothing. Did not see anyone enter or leave the building. Has no knowledge of the stairwell or the body.`,
        suspectContradictions: [
          `If the suspect claims the visit was friendly and quiet, the neighbour heard shouting.`,
          `If the suspect claims they left early, the neighbour heard a door slam around ${addMinutes(start, 22)}.`,
        ],
      },

      fatalFact: `The suspect was still inside that building at ${wifiDrop} — later than the account they're giving allows for.`,

      suspectPersona: {
        personality: `Quiet confidence masking genuine fear. Speaks in measured sentences, pauses before answering as if choosing words carefully. Defaults to grieving family member rather than defensive suspect. Will express concern about ${victim.name} to deflect. Becomes terse and guarded when pushed on specific times.`,
        coverStory: `Went over to check on ${victim.name} around ${start}, had a brief friendly visit — maybe twenty minutes. They talked about money but it was civil. Left before half past, walked to the car, drove home. Was home by ${homeTime}. Had no idea anything had happened until the police called.`,
        breakingPoints: ['the wine bottle', 'the exact time they left the building', 'the wifi data showing they stayed late', 'what route they used to leave'],
        guiltyKnowledge: [
          `The body was arranged at the bottom of the stairs to look like a fall`,
          `The bottle ended up in the canal`,
          `The bin store exit route — most residents wouldn't use it`,
        ],
      },

      detectiveBriefing: {
        victimSummary: `${victim.name}, ${relationship} to the suspect, was found dead at the foot of the service stairwell in ${block}. Initial assessment is a fall, but the pathology doesn't quite fit.`,
        suspectSummary: `${suspect}, ${suspectOccupation}. ${victim.name} owed them £${debt.toLocaleString()}. They admit to visiting the flat that evening but say it was a short, friendly visit.`,
        sceneSummary: `${block}. The body was found at the bottom of the service stairwell between the fourth and third floors. Time of death window: ${start}–${end}.`,
        evidenceSummary: `Your team has assembled five pieces of evidence. None is conclusive alone, but together they paint a picture. The suspect doesn't know which items you have — use them carefully.`,
      },
    }
  },
}

export const homicideTemplates: Template[] = [stairwell]
