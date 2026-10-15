import type { Template } from '../shared'
import { beats, fullName, namedPerson } from '../shared'
import { addMinutes, hhmm } from '../../rng'

function pronouns(p: 'he' | 'she') {
  return p === 'he'
    ? { subj: 'he', obj: 'him', poss: 'his', Subj: 'He' }
    : { subj: 'she', obj: 'her', poss: 'her', Subj: 'She' }
}

export const smartGarage: Template = {
  id: 'homicide-smart-garage',
  crime: 'homicide',
  title: 'The Smart Garage',
  build: (r, _detective) => {
    const victim = namedPerson(r)
    const vp = pronouns(victim.pronoun)
    const suspect = fullName(r)
    const neighbour = namedPerson(r)
    const np = pronouns(neighbour.pronoun)
    const start = hhmm(1, r.int(10, 40))
    const end = addMinutes(start, r.int(40, 55))
    const inheritance = r.pick([31000000, 45000000, 58000000, 69000000])
    const street = r.pick([
      '12th Main, HSR Layout',
      '4th Cross, Koramangala',
      '9th Block, Jayanagar',
    ])
    const logOffset = r.int(26, 32)
    const logTime = addMinutes(start, logOffset)

    return {
      suspect: { name: suspect, occupation: r.pick(['software engineer', 'property manager', 'dental hygienist', 'logistics coordinator']) },
      victim: { name: victim.name, relationship: `the suspect's adult child` },
      location: `the attached garage of the family home on ${street} — found slumped in the driver's seat with the engine running`,
      window: { start, end },

      truth: beats(
        ['t1', start, `The suspect waited until ${victim.name} had come home late and gone to sit in the garage, as ${vp.subj} often did to call a partner privately, away from the house.`],
        ['t2', addMinutes(start, 3), `The suspect used the household smart-hub app, logged in under the shared family account, to close the garage door remotely.`],
        ['t3', addMinutes(start, 4), `The suspect then used the same smart-hub integration to remote-start ${victim.name}'s car, which was already running on fumes with a faulty exhaust seal the suspect knew about.`],
        ['t4', addMinutes(start, 25), `${victim.name} was overcome by carbon monoxide before realising what was happening.`],
        ['t5', logTime, `The smart-hub log recorded the suspect's phone as the device that triggered both the door closure and the engine start.`],
        ['t6', addMinutes(start, 35), `The suspect went back inside and waited until morning to "discover" the garage, having disabled the hub's push notifications for the night.`],
      ),

      evidence: [
        {
          id: 'e1', type: 'digital',
          linkedBeats: ['t2', 't3', 't5'],
          claim: `The smart-hub activity log shows the garage door closing and the engine remote-starting within the same minute, both triggered from the shared family account.`,
          vulnerability: `The whole household — the suspect, ${victim.name}, and a visiting sibling — uses the same shared smart-hub account and the same login. The log shows the account acted, not conclusively which family member's phone issued the command.`,
        },
        {
          id: 'e2', type: 'physical',
          linkedBeats: ['t3'],
          claim: `The exhaust seal fault that let fumes build up in the garage had been flagged by the car's own diagnostics two weeks earlier.`,
          vulnerability: `${victim.name} had been putting off the repair for weeks, which the suspect knew about secondhand from a dinner conversation — knowing about a known, previously-flagged fault isn't the same as having engineered this specific night around it.`,
        },
        {
          id: 'e3', type: 'financial',
          linkedBeats: ['t1'],
          claim: `Estate paperwork shows ${victim.name} had petitioned to accelerate inheritance of the family trust, over the suspect's formal written objection.`,
          vulnerability: `An accelerated inheritance petition against a parent's objection is a legal dispute with a court process, not evidence that the parent decided to end it violently rather than fight it through probate.`,
        },
        {
          id: 'e4', type: 'digital',
          linkedBeats: ['t6'],
          claim: `Push notifications for the smart-hub's garage sensor were manually disabled that night and not re-enabled until after the body was found.`,
          vulnerability: `Notification fatigue is common with these systems — several neighbours on the same street app have disabled similar alerts after one too many false triggers from cats or wind.`,
        },
        {
          id: 'e5', type: 'circumstantial',
          linkedBeats: ['t1'],
          claim: `${victim.name} had told a friend the week before that the suspect was "furious" about the accelerated inheritance petition.`,
          vulnerability: `Family inheritance disputes produce exactly this kind of secondhand, emotionally-charged relay constantly — "furious" relayed through a friend's recollection is not a documented threat.`,
        },
      ],

      witness: {
        id: 'w1',
        name: neighbour.name,
        relationship: `neighbour across the street on ${street}`,
        personality: `Night-owl type who notices comings and goings out of habit, happy to share observations but a little embarrassed about how much ${np.subj} actually watches the street.`,
        knowledgeBoundary: `Was awake and saw the garage light on later than usual that night. Didn't hear the engine specifically — the garage is well insulated. Saw no one enter or leave the house after that. Has no knowledge of the smart-hub system or who controlled it.`,
        suspectContradictions: [
          `If the suspect claims they were asleep all night and never went near the garage, ${np.subj} saw the garage light on at a time that doesn't fit a full night's sleep.`,
          `If the suspect claims ${victim.name} came home and went straight to bed, ${np.subj} saw the garage light go on specifically, consistent with ${victim.name} sitting in the car as usual.`,
        ],
      },

      fatalFact: `The smart-hub commands that sealed the garage and started the engine were issued from inside the house that night — not a malfunction, and not something ${victim.name} could have triggered alone while unconscious.`,

      suspectPersona: {
        personality: `Grieving parent framing throughout — leans on "no parent could do this to their own child" as the entire defense. Genuinely devastated, which makes the calculation underneath land as dissonant rather than as an obvious lie. Deflects hard toward the exhaust fault being pure bad luck.`,
        coverStory: `Was asleep the whole night. ${victim.name} often sat in the garage late to call a partner — it wasn't unusual to see the light on. Had no idea anything was wrong with the car; found out about the exhaust fault from the mechanic's report after the fact, same as everyone else. Woke up and discovered the garage in the morning.`,
        breakingPoints: ['the smart-hub login timing', 'the disabled push notifications', 'the exhaust fault they allegedly didn\'t know about', 'the inheritance petition dispute'],
        guiltyKnowledge: [
          `The garage door and engine were remotely triggered from inside the house, not a malfunction`,
          `The exhaust fault was known and specifically relied upon`,
          `The smart-hub notifications were deliberately disabled that night, not simply ignored`,
        ],
      },

      detectiveBriefing: {
        victimSummary: `${victim.name} was found dead in the family car in the attached garage on ${street}, apparently overcome by carbon monoxide. Initial assessment leaned toward a tragic accident caused by a known exhaust fault.`,
        suspectSummary: `${suspect}, ${victim.name}'s parent, had formally objected to ${victim.name}'s petition to accelerate inheritance of a ₹${inheritance.toLocaleString()} family trust.`,
        sceneSummary: `${street}, the attached garage. Time window: ${start}–${end}.`,
        crimeSummary: `${victim.name} was sealed inside the garage with the engine remote-started via the shared smart-hub account, exploiting a known exhaust fault to cause carbon monoxide poisoning. The suspect is ${victim.name}'s parent, who had formally objected to ${victim.name}'s petition to accelerate inheritance of a ₹${inheritance.toLocaleString()} family trust.`,
        evidenceSummary: `Your team has assembled five pieces of evidence. None is conclusive alone, but together they paint a picture. The suspect doesn't know which items you have — use them carefully.`,
      },
    }
  },
}
