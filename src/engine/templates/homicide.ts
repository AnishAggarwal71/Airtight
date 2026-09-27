import type { Template } from './shared'
import { beats, fullName, namedPerson } from './shared'
import { addMinutes, hhmm } from '../rng'

/**
 * Homicide — the anchor crime type. Long timelines, a relationship with the
 * victim that gives every question a second layer, and pathology evidence that
 * is almost always hedged in the report and therefore arguable.
 */

/** he/she → the full pronoun set, so a template never disagrees with a generated name. */
function pronouns(p: 'he' | 'she') {
  return p === 'he'
    ? { subj: 'he', obj: 'him', poss: 'his', Subj: 'He' }
    : { subj: 'she', obj: 'her', poss: 'her', Subj: 'She' }
}

/**
 * A vague, memory-shaped time phrase ("just gone eleven") instead of a clock
 * reading — the briefing tells the player roughly when they got home so a
 * lie about it is a deliberate risk, not a guess, but withholds the exact
 * minute that only the wifi/key-card evidence pins down.
 */
function roughly(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const hourWord = h === 0 ? 'midnight' : h === 23 ? 'eleven' : h === 22 ? 'ten' : h === 1 ? 'one in the morning' : `${h}`
  if (h === 0) return 'right around midnight'
  if (m < 10) return `just gone ${hourWord}`
  if (m < 25) return `not long after ${hourWord}`
  if (m < 40) return `about half past ${hourWord}`
  return `getting on for midnight`
}

const stairwell: Template = {
  id: 'homicide-stairwell',
  crime: 'homicide',
  title: 'The Service Stairwell',
  build: (r, detective) => {
    const victim = namedPerson(r)
    const vp = pronouns(victim.pronoun)
    const suspect = fullName(r)
    const neighbour = namedPerson(r)
    const np = pronouns(neighbour.pronoun)
    const rider = namedPerson(r)
    const rp = pronouns(rider.pronoun)
    const start = hhmm(22, r.int(40, 55))
    const end = addMinutes(start, r.int(35, 50))
    const debt = r.pick([9000, 12500, 14000, 18000, 21000])
    const wifiDrop = addMinutes(start, r.int(24, 32))
    const keyCardExit = addMinutes(start, r.int(28, 36))
    const relationship = r.pick([
      'your brother-in-law',
      'your sister’s husband',
      'your cousin',
      'your closest friend of nineteen years',
    ])
    const suspectOccupation = r.pick(['site foreman', 'locksmith', 'delivery driver', 'physiotherapist'])
    const block = r.pick([
      'Wraysbury Mill, a converted flour mill on the canal',
      'Ashcroft Wharf, a converted warehouse block',
      'the Ordnance Building, six floors of converted offices',
    ])

    // Occupation-based reason to have already been in the area that evening —
    // a cover-story hook the player can lean on or discard, not a fact the
    // detective ever brings up.
    const coverHooks: Record<string, string> = {
      'site foreman': `You'd signed off a snagging list on a site nearby that ran late — a reason to be in the area, if you needed one.`,
      locksmith: `You'd fitted a lock round the corner earlier that evening — a reason to be in the area, if you needed one.`,
      'delivery driver': `Your last drop of the shift happened to be two streets over — you were already in the area before you decided to go up.`,
      physiotherapist: `Your last home visit that evening was a few doors down — you were already in the area before you decided to go up.`,
    }
    const homeTime = addMinutes(keyCardExit, r.int(8, 15))

    return {
      suspect: { name: suspect, occupation: suspectOccupation },
      victim: { name: victim.name, relationship },
      location: `${block} — found at the foot of the service stairwell`,
      window: { start, end },
      briefing: {
        name: suspect,
        age: r.int(27, 52),
        occupation: suspectOccupation,
        what: `${victim.name} is ${relationship}, and ${vp.subj} owed you £${debt.toLocaleString()} — ${vp.subj}'d stopped even pretending to pay back. ${coverHooks[suspectOccupation]} Last night you went over to sort it out for good. It turned into a shouting match, and then it turned into something you can't undo. By the time you left, ${vp.subj} wasn't going to be paying anyone back anything. You got back to your own place ${roughly(homeTime)}, paranoid and guilty, running through what you'd say if anyone ever asked where you'd been.`,
      },
      truth: beats(
        ['t1', start, `You let yourself into ${victim.name}'s flat on the fourth floor. The argument about the money started almost immediately.`],
        ['t2', addMinutes(start, 6), `${vp.Subj} told you ${vp.subj} had no intention of paying and that you should take ${vp.obj} to court. You picked up a wine bottle from the counter.`],
        ['t3', addMinutes(start, 9), `You struck ${vp.obj} twice. The second blow killed ${vp.obj}.`],
        ['t4', addMinutes(start, 20), `You dragged ${vp.obj} to the service stairwell and arranged the body at the bottom of the flight to look like a fall.`],
        ['t5', wifiDrop, `You went back into the flat to collect the bottle. Your phone was still on the building wifi.`],
        ['t6', keyCardExit, `You left through the bin store on the ground floor and put the bottle and your jacket in the canal.`],
      ),
      evidence: [
        {
          id: 'e1', type: 'digital', baseWeight: 55,
          linkedBeats: ['t6'],
          topic: `exactly how you left the building`,
          claim: `Your key card opened the bin store door at ${keyCardExit}.`,
          vulnerability: `The log records the card, not the person holding it. Cards in that block get lent out all the time — to contractors, to family, to whoever does the gutters. Nobody signs for them.`,
        },
        {
          id: 'e2', type: 'witness', baseWeight: 45,
          linkedBeats: ['t1', 't2'],
          topic: `whether the argument was loud enough for anyone to hear`,
          claim: `${neighbour.name}, in the flat below, heard raised voices from ${victim.name}'s flat that night — two people, one of them shouting.`,
          vulnerability: `${np.Subj} is seventy-eight, takes ${np.poss} hearing aids out before bed, and has twice complained to the management company about noise ${np.subj} attributed to the wrong flat. Sound carries oddly between those floors.`,
        },
        {
          id: 'e3', type: 'physical', baseWeight: 60,
          linkedBeats: ['t3', 't4'],
          topic: `exactly how the injury happened`,
          claim: `The pathologist thinks the head injury doesn't quite fit a fall down that stairwell — the angle looks wrong.`,
          vulnerability: `The report says "less consistent with," not impossible — that's a hedged opinion, not a finding. ${victim.name} also fell in that same stairwell two months ago and was treated for a head injury then.`,
        },
        {
          id: 'e4', type: 'digital', baseWeight: 70,
          linkedBeats: ['t5'],
          topic: `how long you were actually still in the building`,
          claim: `Your phone stayed connected to the building wifi until ${wifiDrop}.`,
          vulnerability: `The router covers the whole east side of the building, including the car park and the towpath. Staying connected shows you were nearby, not that you were in the flat.`,
        },
        {
          id: 'e5', type: 'physical', baseWeight: 50,
          linkedBeats: ['t4'],
          topic: `the condition you left the stairwell in`,
          claim: `There's a fresh scuff on the stairwell wall a few steps above the landing.`,
          vulnerability: `It's a bare breeze-block stairwell that every contractor in the building uses. There are a dozen other scuffs on that wall and nobody dated any of them.`,
        },
        {
          id: 'e6', type: 'circumstantial', baseWeight: 40,
          linkedBeats: ['t1'],
          topic: `the money side of things between you and ${victim.name}`,
          claim: `${victim.name} owed you £${debt.toLocaleString()} and had missed the last three repayment dates.`,
          vulnerability: `A debt is a reason to want someone alive and earning. Dead, you're just an unsecured creditor at the back of a queue — you lose the money entirely.`,
        },
        {
          id: 'e7', type: 'physical', baseWeight: 55,
          linkedBeats: ['t2', 't5'],
          topic: `what happened to the bottle from the kitchen`,
          claim: `There's a gap in the wine rack in the kitchen — one bottle missing, and none found in the flat or the bins.`,
          vulnerability: `${vp.Subj} drank. A missing bottle from a wine rack is about the least remarkable thing in that kitchen.`,
        },
        {
          id: 'e8', type: 'witness', baseWeight: 35,
          linkedBeats: ['t6'],
          topic: `whether anyone outside saw you leave`,
          claim: `${rider.name}, a delivery rider waiting outside, saw someone come out of the bin store exit and walk toward the canal.`,
          vulnerability: `${rp.Subj} was looking at ${rp.poss} phone, it was dark, and ${rp.subj} describes a jacket but never a face. ${rp.Subj} initially told the first officer it might have been someone else entirely.`,
        },
      ],
      witnesses: [],
      fatalFact: `You were still inside that building at ${wifiDrop} — later than the account you're about to give will allow for.`,
      opener: `Talk me through last night, in your own words. Start wherever feels natural.`,
    }
  },
}

const boat: Template = {
  id: 'homicide-reservoir',
  crime: 'homicide',
  title: 'The Reservoir',
  build: (r, detective) => {
    const victim = fullName(r)
    const suspect = fullName(r)
    const marinaHand = fullName(r)
    const start = hhmm(r.int(16, 18), r.int(0, 55))
    const gap = r.int(34, 52)
    const callTime = addMinutes(start, gap)
    const end = addMinutes(callTime, 20)
    const payout = r.pick([180000, 240000, 310000, 425000])
    const water = r.pick(['Fenwick Reservoir', 'Ladysmere Water', 'the Culland Reservoir'])
    const business = r.pick(['a plant hire firm', 'a two-van refrigeration business', 'a timber yard', 'a scaffolding company'])

    return {
      suspect: { name: suspect, occupation: 'co-owner of ' + business },
      victim: { name: victim, relationship: `your business partner of eleven years` },
      location: `${water} — recovered from open water, 200m from the north jetty`,
      window: { start, end },
      truth: beats(
        ['t1', start, `You cut the engine mid-water and told him you knew he'd been talking to buyers behind your back.`],
        ['t2', addMinutes(start, 4), `He admitted it. He said he'd already signed heads of terms.`],
        ['t3', addMinutes(start, 7), `You swung the spare oar. He went over the gunwale on the starboard side.`],
        ['t4', addMinutes(start, 9), `He surfaced once. You did not throw the ring. You watched.`],
        ['t5', callTime, `After ${gap} minutes you called it in and said he'd slipped reaching for a line.`],
      ),
      evidence: [
        {
          id: 'e1', type: 'digital', anchor: true, baseWeight: 65,
          linkedBeats: ['t1', 't5'],
          claim: `The boat's GPS logger shows the engine cut at ${start} and the hull stationary for ${gap} minutes before your emergency call.`,
          vulnerability: `The logger records the hull, not the people. A man overboard in cold water — you're throwing lines, you're circling, you're not reaching for a phone. Panic is slow and it doesn't move the boat.`,
        },
        {
          id: 'e2', type: 'physical', anchor: true, baseWeight: 50,
          linkedBeats: ['t3'],
          claim: `${victim}'s lifejacket was recovered still clipped into the locker. Yours was on.`,
          vulnerability: `He never wore one. Ask anyone at that marina. Eleven years on that water and the man treated a lifejacket as an insult.`,
        },
        {
          id: 'e3', type: 'financial', anchor: true, baseWeight: 45,
          linkedBeats: ['t2'],
          claim: `Your partnership agreement has a cross-option clause. His death pays you out at roughly £${payout.toLocaleString()} and hands you the whole business.`,
          vulnerability: `That clause is boilerplate — every two-man partnership in the country has one, and the insurer wrote it, not you. It also pays out to his estate if you go first.`,
        },
        {
          id: 'e4', type: 'physical', baseWeight: 60,
          linkedBeats: ['t3'],
          claim: `There's bruising to ${victim}'s right forearm, patterned, consistent with a strike from a shaft-like object.`,
          vulnerability: `He worked a timber yard. He had bruises on his forearms every week of his working life, and the pathologist can't date this one to the hour.`,
        },
        {
          id: 'e5', type: 'physical', baseWeight: 55,
          linkedBeats: ['t3'],
          claim: `The spare oar has a fresh chip in the blade and a scrape of paint missing at the shaft.`,
          vulnerability: `You'd been using it to push off the jetty all season because the bow thruster's been out since March. The marina has the repair docket.`,
        },
        {
          id: 'e6', type: 'digital', baseWeight: 70,
          linkedBeats: ['t1'],
          claim: `Two days before, you searched for the maximum depth of ${water} and how long a body takes to surface in cold water.`,
          vulnerability: `You'd been arguing about whether to buy a heavier mooring. Half the searches on a boat owner's phone look sinister in a transcript and mundane on the water.`,
        },
        {
          id: 'e7', type: 'digital', baseWeight: 50,
          linkedBeats: ['t2'],
          claim: `${victim} emailed a commercial solicitor the morning he died about "structuring an exit."`,
          vulnerability: `You never saw that email. It was sent to his personal account and he hadn't told you.`,
        },
        {
          id: 'e8', type: 'witness', baseWeight: 40,
          linkedBeats: ['t5'],
          claim: `${marinaHand} at the marina says you carried two bags down to the boat that afternoon and came back with one.`,
          vulnerability: `One of them was a coolbag that stayed on board — it's still in the forward locker, and the recovery team photographed it there.`,
        },
      ],
      witnesses: [
        { id: 'w1', name: marinaHand, relationship: 'marina hand', claim: `Saw you take two bags out and return with one.`, accurate: false, flaw: 'The second bag is still on the boat and was photographed there.' },
      ],
      fatalFact: `${gap} minutes of a stationary hull between the engine cutting and the call. That gap is the case.`,
      opener: `Your boat's logger says the engine stopped at ${start}. You called us at ${callTime}. I want you to account for those ${gap} minutes, and I'd like you to take your time over it.`,
    }
  },
}

const restaurant: Template = {
  id: 'homicide-restaurant',
  crime: 'homicide',
  title: 'After Close',
  build: (r, detective) => {
    const victim = fullName(r)
    const suspect = fullName(r)
    const chef = fullName(r)
    const start = hhmm(0, r.int(45, 59))
    const carLeaves = addMinutes(start, r.int(40, 60))
    const end = addMinutes(carLeaves, 15)
    const skim = r.pick([22000, 31000, 44000, 58000])
    const place = r.pick(['Brasserie Ombra', 'The Salt House', 'Ferran & Co.', 'Little Marne'])

    return {
      suspect: { name: suspect, occupation: 'restaurateur' },
      victim: { name: victim, relationship: 'your co-owner' },
      location: `${place} — found in the kitchen after close`,
      window: { start, end },
      truth: beats(
        ['t1', start, `He showed you the reconciliation he'd run against the supplier invoices. He knew.`],
        ['t2', addMinutes(start, 8), `He said he was calling the accountant in the morning and then the police.`],
        ['t3', addMinutes(start, 11), `You hit him with a pan from the rail. You did not stop at once.`],
        ['t4', addMinutes(start, 25), `You emptied the till, broke the front window from the inside, and mopped the kitchen floor.`],
        ['t5', carLeaves, `You drove out of the yard.`],
      ),
      evidence: [
        {
          id: 'e1', type: 'physical', anchor: true, baseWeight: 70,
          linkedBeats: ['t4'],
          claim: `The front window was broken from the inside. The glass is on the pavement.`,
          vulnerability: `Toughened glass throws both ways when it goes, and the first responders walked through it twice before anyone photographed it.`,
        },
        {
          id: 'e2', type: 'circumstantial', anchor: true, baseWeight: 60,
          linkedBeats: ['t4'],
          claim: `The till was emptied. The safe, four feet away with considerably more in it, wasn't touched. Two people knew that code.`,
          vulnerability: `The code had been the same for three years and was written on the underside of the shelf above it. Every member of staff who'd ever cashed up knew where to look.`,
        },
        {
          id: 'e3', type: 'digital', anchor: true, baseWeight: 55,
          linkedBeats: ['t5'],
          claim: `The yard camera has your car in its usual space until ${carLeaves}.`,
          vulnerability: `You closed most nights and you routinely stayed late doing the books. The camera also caught you leaving after one in the morning on eleven other nights this year.`,
        },
        {
          id: 'e4', type: 'physical', baseWeight: 75,
          linkedBeats: ['t4'],
          claim: `The kitchen floor was mopped after close. The water in the mop bucket tested positive for blood.`,
          vulnerability: `It's a kitchen. Blood in a kitchen bucket at a restaurant that butchers its own meat is not, on its own, an accusation.`,
        },
        {
          id: 'e5', type: 'digital', baseWeight: 65,
          linkedBeats: ['t2'],
          claim: `There's an unsent draft on ${victim}'s phone to the accountant. It names you.`,
          vulnerability: `Unsent. He drafted things and deleted them constantly — there are forty unsent messages on that phone, including two to you calling the whole partnership off.`,
        },
        {
          id: 'e6', type: 'physical', baseWeight: 60,
          linkedBeats: ['t4'],
          claim: `Your fingerprints are on the inside of the broken window frame.`,
          vulnerability: `You own the building. Your prints are on every surface in it, and that window sticks — you've been shouldering it shut since the winter.`,
        },
        {
          id: 'e7', type: 'financial', baseWeight: 50,
          linkedBeats: ['t1'],
          claim: `Roughly £${skim.toLocaleString()} of supplier invoices over eighteen months don't match anything that was delivered.`,
          vulnerability: `Your supplier invoices are a disgrace and always have been. Sloppy books are evidence of sloppy books.`,
        },
        {
          id: 'e8', type: 'witness', baseWeight: 35,
          linkedBeats: ['t4'],
          claim: `${chef}, who lives above the shop next door, heard the shutter go at around ${addMinutes(start, 30)}.`,
          vulnerability: `She heard a shutter, not your shutter. There are four businesses on that row and three of them have roller shutters.`,
        },
      ],
      witnesses: [
        { id: 'w1', name: chef, relationship: 'neighbour above the adjacent shop', claim: `Heard a roller shutter around ${addMinutes(start, 30)}.`, accurate: false, flaw: 'Four businesses on the row have shutters; she assumed it was yours.' },
      ],
      fatalFact: `That window went out from the inside, which means the burglary was staged, which means whoever did this was already in the building.`,
      opener: `Before we get to your evening, I want to deal with the window. It was broken from the inside. Do you want to tell me how a burglar manages that?`,
    }
  },
}

export const homicideTemplates: Template[] = [stairwell, boat, restaurant]
