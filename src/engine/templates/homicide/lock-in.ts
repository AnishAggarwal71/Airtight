import type { Template } from '../shared'
import { beats, fullName, namedPerson } from '../shared'
import { addMinutes, hhmm } from '../../rng'

function pronouns(p: 'he' | 'she') {
  return p === 'he'
    ? { subj: 'he', obj: 'him', poss: 'his', Subj: 'He' }
    : { subj: 'she', obj: 'her', poss: 'her', Subj: 'She' }
}

export const lockIn: Template = {
  id: 'homicide-lock-in',
  crime: 'homicide',
  title: 'The Lock-In',
  build: (r, _detective, locality) => {
    const victim = namedPerson(r)
    const vp = pronouns(victim.pronoun)
    const suspect = fullName(r)
    const staffer = namedPerson(r)
    const sp = pronouns(staffer.pronoun)
    const start = hhmm(23, r.int(15, 45))
    const end = addMinutes(start, r.int(50, 70))
    const buyout = r.pick([85000, 120000, 160000, 210000])
    const pubName = r.pick([
      'the Anchor and Oak',
      'the Weavers Arms',
      'the Fox and Compass',
    ])
    const pub = locality ? `${pubName} in ${locality}` : pubName
    const loginOffset = r.int(20, 30)
    const loginTime = addMinutes(start, loginOffset)

    return {
      suspect: { name: suspect, occupation: 'co-owner and licensee' },
      victim: { name: victim.name, relationship: `the suspect's business partner, co-owner of the pub, pushing to force a buyout the suspect couldn't afford` },
      location: `${pub} — found behind the bar after an apparent break-in`,
      window: { start, end },

      truth: beats(
        ['t1', start, `After closing, the suspect and ${victim.name} stayed behind to go through the buyout paperwork ${victim.name} had brought to force the suspect's hand on the £${buyout.toLocaleString()} valuation.`],
        ['t2', addMinutes(start, 8), `${victim.name} said ${vp.subj} had already lined up a buyer and the suspect had thirty days to match the offer or sell up.`],
        ['t3', addMinutes(start, 13), `The suspect grabbed a bar stool during the argument and struck ${victim.name}, who fell against the till stand.`],
        ['t4', addMinutes(start, 22), `The suspect smashed the till drawer and the back door glass to stage a break-in, then logged into the till using ${victim.name}'s own staff credentials to make it look like ${vp.subj} had still been working alone.`],
        ['t5', loginTime, `The till system recorded ${victim.name}'s login completing a cash count minutes after the suspect says they'd already left.`],
        ['t6', addMinutes(loginTime, 15), `The suspect left through the back door they'd smashed and drove home, reporting the "break-in" the next morning when they returned to open up.`],
      ),

      evidence: [
        {
          id: 'e1', type: 'digital',
          linkedBeats: ['t4', 't5'],
          claim: `The till system logged a cash count under ${victim.name}'s own staff credentials at ${loginTime}, after the suspect claims they had both already left.`,
          vulnerability: `Shared logins are common practice among the long-serving staff at that pub — several people are known to use each other's credentials when their own card won't scan. It shows the login happened, not who physically typed it.`,
        },
        {
          id: 'e2', type: 'physical',
          linkedBeats: ['t4'],
          claim: `The back door glass was broken from the inside, not the outside, inconsistent with the reported break-in.`,
          vulnerability: `Glass fracture direction from a single blow is notoriously hard to read conclusively, and the forensic examiner's report hedges — "more consistent with," not definitive, leaving room for an unusual break-in method.`,
        },
        {
          id: 'e3', type: 'financial',
          linkedBeats: ['t2'],
          claim: `Partnership paperwork shows ${victim.name} had served formal notice demanding the suspect either match a £${buyout.toLocaleString()} buyout offer within thirty days or agree to sell.`,
          vulnerability: `A thirty-day ultimatum is a business dispute with a clear legal process attached, not an immediate crisis — the suspect had options besides violence, which a jury could read either way.`,
        },
        {
          id: 'e4', type: 'physical',
          linkedBeats: ['t3'],
          claim: `A bar stool recovered from behind the counter has a chip consistent with recent, forceful impact against a hard surface.`,
          vulnerability: `That stool gets knocked around every busy Friday night — a recent chip in a well-used piece of pub furniture isn't unusual on its own.`,
        },
        {
          id: 'e5', type: 'witness',
          linkedBeats: ['t1'],
          claim: `${staffer.name}, a bar staff member, overheard the suspect say ${victim.name} was "not going to force me out of my own pub" earlier that week.`,
          vulnerability: `People say things like that about business disputes all the time without meaning it literally — it's the kind of frustrated remark that gets said in every stressed small business, not a declared threat.`,
        },
      ],

      witness: {
        id: 'w1',
        name: staffer.name,
        relationship: `bar staff member who worked the evening shift`,
        personality: `Loyal to both partners and visibly uncomfortable being asked to choose a side, which makes ${sp.obj} careful but ultimately straightforward once pressed.`,
        knowledgeBoundary: `Left before closing and wasn't present for the lock-in conversation. Knows the business tension had been building for weeks from overheard remarks. Returned the next morning to find the "break-in" already reported. Has no direct knowledge of what happened after closing.`,
        suspectContradictions: [
          `If the suspect claims the partnership was amicable with no real conflict, ${sp.subj} overheard the suspect's remark about not being forced out, which says otherwise.`,
          `If the suspect claims they left together with ${victim.name} at closing, ${sp.subj} knows they stayed behind — that was the usual Tuesday routine for the books.`,
        ],
      },

      fatalFact: `The till login under ${victim.name}'s credentials happened after the altercation, staged by the suspect — ${victim.name} was not still alive and working alone at that point.`,

      suspectPersona: {
        personality: `Businesslike and practical-sounding even under pressure, treats the whole interview as a logistics problem to be managed — a tell in itself, since most people in this situation would be visibly distressed rather than composed. Cracks only when pushed specifically on the till login timing.`,
        coverStory: `Stayed behind with ${victim.name} to go through the buyout paperwork, which got heated but ended with both of them agreeing to speak again in the morning once tempers cooled. The suspect left first. Came back the next day to find the back door smashed and ${victim.name} dead — assumed a break-in gone wrong.`,
        breakingPoints: ['the till login timing', 'the direction of the broken glass', 'the bar stool', 'what was actually agreed about the buyout before they "left"'],
        guiltyKnowledge: [
          `The break-in was staged after the fact, not a real intrusion`,
          `${victim.name}'s own credentials were used deliberately to fake a login`,
          `${victim.name} did not leave the building alive that night`,
        ],
      },

      detectiveBriefing: {
        victimSummary: `${victim.name} was found dead behind the bar at ${pub}, in what was first reported as a break-in gone wrong. The staged scene doesn't fully hold up under examination.`,
        suspectSummary: `${suspect}, ${victim.name}'s business partner, was under pressure to match a £${buyout.toLocaleString()} buyout offer or sell the pub within thirty days.`,
        sceneSummary: `${pub}, behind the bar. Time window: ${start}–${end}.`,
        evidenceSummary: `Your team has assembled five pieces of evidence. None is conclusive alone, but together they paint a picture. The suspect doesn't know which items you have — use them carefully.`,
      },
    }
  },
}
