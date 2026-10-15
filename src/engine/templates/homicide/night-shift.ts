import type { Template } from '../shared'
import { beats, fullName, namedPerson } from '../shared'
import { addMinutes, hhmm } from '../../rng'

function pronouns(p: 'he' | 'she') {
  return p === 'he'
    ? { subj: 'he', obj: 'him', poss: 'his', Subj: 'He' }
    : { subj: 'she', obj: 'her', poss: 'her', Subj: 'She' }
}

export const nightShift: Template = {
  id: 'homicide-night-shift',
  crime: 'homicide',
  title: 'The Night Shift',
  build: (r, _detective) => {
    const victim = namedPerson(r)
    const vp = pronouns(victim.pronoun)
    const suspect = fullName(r)
    const coworker = namedPerson(r)
    const cp = pronouns(coworker.pronoun)
    const start = hhmm(2, r.int(5, 35))
    const end = addMinutes(start, r.int(40, 55))
    const theftAmount = r.pick([32000, 48000, 61000, 75000])
    const site = r.pick([
      'the Whitefield logistics park warehouse',
      'the Peenya industrial estate distribution depot',
      'the Bommasandra fulfilment centre',
    ])
    const badgeOffset = r.int(10, 16)
    const badgeTime = addMinutes(start, badgeOffset)
    const breakStart = addMinutes(start, r.int(-10, -4))
    const breakEnd = addMinutes(badgeTime, r.int(4, 9))

    return {
      suspect: { name: suspect, occupation: 'warehouse operative' },
      victim: { name: victim.name, relationship: `the suspect's shift manager` },
      location: `${site} — found at the base of the mezzanine stairs near loading bay 4`,
      window: { start, end },

      truth: beats(
        ['t1', start, `${victim.name} called the suspect up to the mezzanine office to tell them the theft investigation naming them for ₹${theftAmount.toLocaleString()} in missing stock was going to HR in the morning.`],
        ['t2', addMinutes(start, 3), `The suspect pleaded, then threatened. ${victim.name} said it was already out of ${vp.poss} hands.`],
        ['t3', addMinutes(start, 6), `The suspect shoved ${victim.name} toward the mezzanine stair rail during the argument. ${vp.Subj} went over and fell to the floor below.`],
        ['t4', addMinutes(start, 9), `The suspect went down, found ${victim.name} not breathing, and used ${vp.poss} badge to override the loading bay's safety lockout so the scene would read as an unwitnessed equipment accident.`],
        ['t5', badgeTime, `The badge override was logged against ${victim.name}'s own credentials.`],
        ['t6', breakEnd, `The suspect clocked back in from "break" and resumed their round on the far side of the warehouse.`],
      ),

      evidence: [
        {
          id: 'e1', type: 'digital',
          linkedBeats: ['t5'],
          claim: `${victim.name}'s own badge was used to override the loading bay 4 safety lockout at ${badgeTime}, while the suspect claims to have been on an unrelated break at the time.`,
          vulnerability: `Badge-sharing on that shift is endemic — supervisors wave their own badges to clear overrides for whoever's hands are full. It shows the badge was used, not who physically held it.`,
        },
        {
          id: 'e2', type: 'physical',
          linkedBeats: ['t3', 't4'],
          claim: `The pathologist notes bruising on ${victim.name}'s shoulder consistent with being pushed, not with an unassisted fall from the mezzanine.`,
          vulnerability: `The mezzanine rail is narrow and the stairs are steep — a stumble into the rail before falling could produce a similar shoulder bruise, and the report concedes this reading isn't ruled out.`,
        },
        {
          id: 'e3', type: 'financial',
          linkedBeats: ['t1'],
          claim: `An internal audit names the suspect as the primary suspect in a ₹${theftAmount.toLocaleString()} stock-shrinkage investigation ${victim.name} was overseeing — and was days away from escalating to HR.`,
          vulnerability: `Three other operatives on that shift are also named in the same audit — the suspect being investigated doesn't make them the only one with a motive to silence ${victim.name}.`,
        },
        {
          id: 'e4', type: 'digital',
          linkedBeats: ['t6'],
          claim: `The suspect's own badge shows no activity for an 11-minute gap starting around ${breakStart}, logged as a break.`,
          vulnerability: `Breaks on that shift are self-logged and routinely run long or get back-filled after the fact — an unlogged gap is normal shift behaviour, not proof of where someone physically was.`,
        },
        {
          id: 'e5', type: 'witness',
          linkedBeats: ['t1'],
          claim: `${victim.name}'s calendar shows a note: "see [suspect] re: audit — tonight, mezzanine."`,
          vulnerability: `A scheduled meeting proves the conversation happened, not how it ended. Plenty of difficult meetings on that shift end with nothing worse than hurt feelings.`,
        },
      ],

      witness: {
        id: 'w1',
        name: coworker.name,
        relationship: `coworker — operates the forklift on the same night shift`,
        personality: `Tired, matter-of-fact, not keen to get dragged into management's business. Answers precisely but volunteers nothing extra unless pushed.`,
        knowledgeBoundary: `Was on the warehouse floor and glanced up toward the mezzanine around the time of the argument — saw two figures near the rail, raised voices, nothing more specific. Didn't see anyone fall. Clocked the suspect returning to the floor minutes later looking "off." Has no knowledge of the badge override.`,
        suspectContradictions: [
          `If the suspect claims they never went up to the mezzanine that night, ${cp.subj} saw two figures up there arguing.`,
          `If the suspect claims they were calm and collected afterward, ${cp.subj} thought the suspect looked "off" when they came back down.`,
        ],
      },

      fatalFact: `The badge override at loading bay 4 happened minutes after ${victim.name} stopped responding — the suspect staged it, they didn't stumble into it afterward.`,

      suspectPersona: {
        personality: `Defensive and quick to pivot to grievance about the theft accusation itself, as if re-litigating the audit will make the real question go away. Clipped, impatient tone that reads as exhaustion from a long shift rather than guilt — until pressed on the mezzanine specifically.`,
        coverStory: `Got called up to see ${victim.name} about the audit, had a tense but short conversation, then went on break because they needed to clear their head. Came back and finished the shift. Found out about the fall when everyone else did, when the shift supervisor radioed it in.`,
        breakingPoints: ['the badge override', 'the shoulder bruising', 'exactly how long the "break" lasted', 'what was actually said in the mezzanine office'],
        guiltyKnowledge: [
          `${victim.name} was pushed, not simply fell`,
          `The badge override was staged using ${victim.name}'s own credentials, not the suspect's`,
          `The argument was specifically about the theft going to HR the next morning`,
        ],
      },

      detectiveBriefing: {
        victimSummary: `${victim.name}, the night shift manager, was found at the base of the mezzanine stairs near loading bay 4 at ${site}. Initial read was an unwitnessed workplace accident.`,
        suspectSummary: `${suspect}, a warehouse operative on the same shift, was the subject of a theft investigation ${victim.name} was about to escalate to HR.`,
        sceneSummary: `${site}, loading bay 4. Body found at the base of the mezzanine stairs. Time of death window: ${start}–${end}.`,
        crimeSummary: `${victim.name} was shoved from the mezzanine rail during a confrontation and the scene staged as an equipment accident using the victim's own badge. The suspect is a warehouse operative on ${victim.name}'s shift, named in a ₹${theftAmount.toLocaleString()} stock-theft investigation that was days from going to HR.`,
        evidenceSummary: `Your team has assembled five pieces of evidence. None is conclusive alone, but together they paint a picture. The suspect doesn't know which items you have — use them carefully.`,
      },
    }
  },
}
