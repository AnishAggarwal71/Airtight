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
    const suspect = namedPerson(r, [victim.name])
    const neighbour = namedPerson(r, [victim.name, suspect.name])
    const np = pronouns(neighbour.pronoun)
    const start = hhmm(1, r.int(10, 40))
    const end = addMinutes(start, r.int(40, 55))
    const bedTime = addMinutes(start, r.int(-90, -60))
    const street = r.pick([
      'Elm Grove, Chalfont',
      'Victoria Road, Westbury',
      'Church Lane, Fairview',
    ])
    const logOffset = r.int(26, 32)
    const logTime = addMinutes(start, logOffset)

    return {
      suspect: { name: suspect.name, occupation: r.pick(['software engineer', 'property manager', 'dental hygienist', 'logistics coordinator']), pronoun: suspect.pronoun },
      victim: { name: victim.name, relationship: `the suspect's adult child, recently moved out` },
      location: `the attached garage of ${victim.name}'s rented flat on ${street} — found slumped in the driver's seat with the engine running`,
      window: { start, end },

      truth: beats(
        ['t1', start, `The suspect, monitoring the smart-hub remotely from home, saw ${victim.name} come home late and go to sit in the garage, as ${vp.subj} often did to call a partner privately.`],
        ['t2', addMinutes(start, 3), `The suspect used the household smart-hub app, logged in under the shared family account, to close the garage door remotely.`],
        ['t3', addMinutes(start, 4), `The suspect then used the same smart-hub integration to remote-start ${victim.name}'s car, which was already running on fumes with a faulty exhaust seal the suspect knew about.`],
        ['t4', addMinutes(start, 25), `${victim.name} was overcome by carbon monoxide before realising what was happening.`],
        ['t5', logTime, `The smart-hub log recorded the shared family account triggering both the door closure and the engine start.`],
        ['t6', addMinutes(start, 35), `The suspect disabled the hub's push notifications remotely and went to bed at their own home, waiting to be "called" about the garage the next morning.`],
      ),

      evidence: [
        {
          id: 'e1', type: 'digital',
          linkedBeats: ['t2', 't3', 't5'],
          claim: `The smart-hub activity log shows the garage door closing and the engine remote-starting within the same minute, both triggered from the shared family account.`,
          vulnerability: `The suspect set up the smart-hub when ${victim.name} moved in and was never removed from the shared account — ${victim.name} and a visiting friend also had access. The log shows the account acted, not conclusively which person issued the command.`,
        },
        {
          id: 'e2', type: 'physical',
          linkedBeats: ['t3'],
          claim: `The exhaust seal fault that let fumes build up in the garage had been flagged by the car's own diagnostics two weeks earlier.`,
          vulnerability: `${victim.name} had been putting off the repair for weeks, which the suspect knew about from a phone call the week before — knowing about a known, previously-flagged fault isn't the same as having engineered this specific night around it.`,
        },
        {
          id: 'e3', type: 'circumstantial',
          linkedBeats: ['t1'],
          claim: `${victim.name} had emailed the letting agent the day before asking to change the locks and remove the suspect's key access — the suspect had told a friend the request was "a slap in the face after everything I've done."`,
          vulnerability: `Adult children setting boundaries with a parent is a normal, healthy step — asking to change the locks on your own flat is not evidence of anything beyond a difficult family dynamic.`,
        },
        {
          id: 'e4', type: 'digital',
          linkedBeats: ['t6'],
          claim: `Push notifications for the smart-hub's garage sensor were manually disabled that night and not re-enabled until after the body was found.`,
          vulnerability: `Notification fatigue is common with these systems — several neighbours on the same street app have disabled similar alerts after one too many false triggers from cats or wind.`,
        },
        {
          id: 'e5', type: 'digital',
          linkedBeats: ['t3'],
          claim: `The suspect's browsing history from two days before shows searches for "how long does carbon monoxide take" and "garage ventilation CO levels."`,
          vulnerability: `The suspect says they searched after reading a news story about a family in a similar situation — checking whether ${victim.name}'s garage was safe, not planning anything.`,
        },
      ],

      witness: {
        id: 'w1',
        name: neighbour.name,
        relationship: `neighbour across the street on ${street}`,
        personality: `Night-owl type who notices comings and goings on the street, happy to share observations but a little embarrassed about how much ${np.subj} actually watches from the window.`,
        knowledgeBoundary: `Was awake and saw the garage light on later than usual that night. Didn't hear the engine specifically — the garage is well insulated. Noticed no visitors to the flat that evening. Has no knowledge of the smart-hub system or who controlled it.`,
        suspectContradictions: [
          `If the suspect claims ${victim.name} was thinking of moving back home, ${np.subj} says ${victim.name} seemed settled and happy in the flat.`,
          `If the suspect claims ${victim.name} came home and went straight to bed, ${np.subj} saw the garage light go on specifically, consistent with ${victim.name} sitting in the car as usual.`,
        ],
      },

      fatalFact: `The smart-hub commands that sealed the garage and started the engine were issued remotely from the suspect's phone that night — not a malfunction, and not something ${victim.name} could have triggered alone while unconscious.`,

      suspectPersona: {
        personality: `Grieving parent framing throughout — leans on "no parent could do this to their own child" as the entire defense. Genuinely devastated, which makes the calculation underneath land as dissonant rather than as an obvious lie. Deflects hard toward the exhaust fault being pure bad luck and the smart-hub access as a safety precaution, not surveillance.`,
        coverStory: `Went to bed about ${bedTime} at home across town, was asleep the whole night. ${victim.name} often sat in the garage late to call a partner — it wasn't unusual. Had no idea anything was wrong with the car; found out about the exhaust fault from the mechanic's report after the fact, same as everyone else. Came over the next morning to check in and found the garage.`,
        breakingPoints: ['the smart-hub login timing', 'the disabled push notifications', 'the browsing history about CO', 'the lock-change request and what it meant'],
        guiltyKnowledge: [
          `The suspect tested the garage door's remote-close the night before to make sure it worked silently`,
          `The suspect checked the exhaust fault themselves by looking under the car two days earlier — they didn't learn about it from a dinner conversation`,
          `The suspect re-enabled the push notifications before going to bed, then disabled them again when the overnight alert came through — they watched the notification arrive and dismissed it`,
        ],
      },

      detectiveBriefing: {
        victimSummary: `${victim.name} was found dead in the car in the attached garage at ${vp.poss} rented flat on ${street}, apparently overcome by carbon monoxide. Initial assessment leaned toward a tragic accident caused by a known exhaust fault.`,
        suspectSummary: `${suspect.name}, ${victim.name}'s parent, still had full admin access to the smart-hub system at ${victim.name}'s flat — set up when ${victim.name} moved in. ${victim.name} had asked the letting agent to change the locks and remove the suspect's access.`,
        sceneSummary: `${street}, the attached garage of ${victim.name}'s rented flat. Time window: ${start}–${end}.`,
        crimeSummary: `${victim.name} was sealed inside the garage with the engine remote-started via the shared smart-hub account, exploiting a known exhaust fault to cause carbon monoxide poisoning. The suspect is ${victim.name}'s parent, who still had full remote access to the flat's smart-hub and was about to lose it — ${victim.name} had asked the letting agent to change the locks and remove the suspect's key access.`,
        evidenceSummary: `Your team has assembled five pieces of evidence. None is conclusive alone, but together they paint a picture. The suspect doesn't know which items you have — use them carefully.`,
      },
    }
  },
}
