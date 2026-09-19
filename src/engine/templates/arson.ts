import type { Template } from './shared'
import { beats, fullName } from './shared'
import { addMinutes, hhmm } from '../rng'

/**
 * Arson — the most argumentative crime type. Fire investigation evidence is
 * probabilistic and full of known false positives, which makes it perfect for
 * this game: almost every item has a real, findable crack in it.
 */

const warehouse: Template = {
  id: 'arson-warehouse',
  crime: 'arson',
  title: 'The Warehouse',
  build: (r) => {
    const suspect = fullName(r)
    const bookkeeper = fullName(r)
    const guard = fullName(r)
    const start = hhmm(r.int(2, 4), r.int(0, 55))
    const alarm = addMinutes(start, r.int(18, 34))
    const end = addMinutes(alarm, 40)
    const cover = r.pick([620000, 840000, 1150000, 1400000])
    const debt = r.pick([190000, 265000, 320000])
    const trade = r.pick(['reclaimed furniture', 'commercial flooring', 'garden machinery', 'shopfitting supplies'])

    return {
      suspect: { name: suspect, occupation: `owner of a ${trade} business` },
      victim: { name: 'Unit 14, Brennan Industrial Park', relationship: 'your own premises' },
      location: `Unit 14, Brennan Industrial Park — total loss`,
      window: { start, end },
      truth: beats(
        ['t1', addMinutes(start, -90), `You moved the good stock — the pieces actually worth something — into the rented lock-up on Tyle Road.`],
        ['t2', start, `You laid a trail of white spirit from the rear racking to the office partition and lit it at the racking end.`],
        ['t3', addMinutes(start, 6), `You left through the fire door at the back, which you'd wedged earlier so it wouldn't lock behind you.`],
        ['t4', alarm, `The alarm finally triggered when the smoke reached the office sensor. The rear of the unit had no working detector.`],
      ),
      evidence: [
        {
          id: 'e1', type: 'financial', anchor: true, baseWeight: 55,
          linkedBeats: ['t1'],
          claim: `You increased the cover on that unit to £${cover.toLocaleString()} nine weeks ago, roughly double what it had been.`,
          vulnerability: `Your broker told you to. The old figure hadn't been revised in six years and wouldn't have rebuilt a third of the unit at current prices — the broker's file will show it was their recommendation, not your request.`,
        },
        {
          id: 'e2', type: 'physical', anchor: true, baseWeight: 65,
          linkedBeats: ['t2'],
          claim: `The fire investigator found an irregular burn pattern across the concrete at the rear racking — what they'd call a pour pattern.`,
          vulnerability: `Irregular floor patterns were treated as proof of accelerant for decades and then the research showed flashover produces the same marks with no accelerant at all. It's in the investigator's own guidance. Ask them what they'd say under cross-examination.`,
        },
        {
          id: 'e3', type: 'physical', anchor: true, baseWeight: 60,
          linkedBeats: ['t2', 't3'],
          claim: `Debris from the rear racking tested positive for a medium petroleum distillate. White spirit.`,
          vulnerability: `You restore furniture. There were eleven litres of white spirit on the racking as stock, and the lab can't distinguish stock that burned from spirit that was poured.`,
        },
        {
          id: 'e4', type: 'circumstantial', baseWeight: 70,
          linkedBeats: ['t1'],
          claim: `You rented a lock-up on Tyle Road eleven days before the fire and moved stock into it.`,
          vulnerability: `The unit's roof had been leaking since February and you'd already had a claim refused for water damage. Moving stock somewhere dry is what a sane person does.`,
        },
        {
          id: 'e5', type: 'physical', baseWeight: 60,
          linkedBeats: ['t3'],
          claim: `The rear fire door was wedged. It hadn't shut properly.`,
          vulnerability: `It's been wedged since the spring because the closer is broken — the fire risk assessment flagged it in March and you've got the quote for the repair sitting unpaid.`,
        },
        {
          id: 'e6', type: 'financial', baseWeight: 50,
          linkedBeats: ['t1'],
          claim: `The business was carrying about £${debt.toLocaleString()} of debt and had been refused an extension six weeks earlier.`,
          vulnerability: `Half the trade is carrying that kind of paper. Debt is a motive for everything and a proof of nothing.`,
        },
        {
          id: 'e7', type: 'digital', baseWeight: 55,
          linkedBeats: ['t3'],
          claim: `Your phone was switched off from midnight until ${addMinutes(alarm, 25)}.`,
          vulnerability: `You'd turned it off every night since your ex-partner started calling at three in the morning. There's a pattern of it going back months in the same data.`,
        },
        {
          id: 'e8', type: 'witness', baseWeight: 40,
          linkedBeats: ['t3'],
          claim: `${guard}, a security guard on the estate, saw a dark hatchback leave the park at around ${addMinutes(start, 10)}.`,
          vulnerability: `He was in the cabin at the far gate, 400 metres off, and he described the car as "dark, maybe blue, maybe a Ford." Yours is grey and it's a Vauxhall.`,
        },
      ],
      witnesses: [
        { id: 'w1', name: guard, relationship: 'estate security', claim: `Saw a dark hatchback leaving around ${addMinutes(start, 10)}.`, accurate: false, flaw: 'Wrong colour, wrong make, 400m away in the dark.' },
        { id: 'w2', name: bookkeeper, relationship: 'your bookkeeper', claim: `Says you asked twice in the last month what the policy actually covered.`, accurate: true },
      ],
      fatalFact: `The good stock left the building eleven days before it burned. Everything else is argument; that is a fact with a date on it.`,
      opener: `I'll be straight with you. I'm not going to start with the fire. I'm going to start with a lock-up on Tyle Road. Whose idea was that?`,
    }
  },
}

const rental: Template = {
  id: 'arson-rental',
  crime: 'arson',
  title: 'The Tenancy',
  build: (r) => {
    const suspect = fullName(r)
    const tenant = fullName(r)
    const neighbour = fullName(r)
    const start = hhmm(r.int(1, 3), r.int(0, 55))
    const call = addMinutes(start, r.int(22, 40))
    const end = addMinutes(call, 35)
    const arrears = r.pick([4200, 6800, 9100, 11500])
    const street = r.pick(['48 Crossley Terrace', '12 Pinfold Row', '7 Abbot’s Walk', '203 Hartland Road'])

    return {
      suspect: { name: suspect, occupation: 'landlord, four properties' },
      victim: { name: tenant, relationship: 'your tenant — treated for smoke inhalation, survived' },
      location: `${street} — ground floor gutted, first floor smoke-damaged`,
      window: { start, end },
      truth: beats(
        ['t1', addMinutes(start, -20), `You let yourself in with the landlord key. You'd checked the night before that they were away.`],
        ['t2', start, `You started it in the under-stairs cupboard, at the consumer unit, so it would read as electrical.`],
        ['t3', addMinutes(start, 5), `You left by the back gate and walked to the car two streets away.`],
        ['t4', addMinutes(start, 14), `${tenant} came home early and went in. That was not part of it.`],
        ['t5', call, `A neighbour called it in.`],
      ),
      evidence: [
        {
          id: 'e1', type: 'physical', anchor: true, baseWeight: 60,
          linkedBeats: ['t2'],
          claim: `The seat of the fire is the under-stairs cupboard, at the consumer unit. The investigator's initial view was electrical — until they found the unit had been isolated at the main switch.`,
          vulnerability: `Tenants trip that main switch constantly in that house; you'd had two callouts for it this year. An isolated consumer unit in a property with a nuisance RCD is a Tuesday, not a confession.`,
        },
        {
          id: 'e2', type: 'circumstantial', anchor: true, baseWeight: 55,
          linkedBeats: ['t1'],
          claim: `${tenant} was £${arrears.toLocaleString()} in arrears and had successfully defended a possession claim six weeks ago.`,
          vulnerability: `You lost that hearing on a paperwork technicality and were told you could refile in two months. You had a legal route and a date. Burning the house down forfeits it.`,
        },
        {
          id: 'e3', type: 'digital', anchor: true, baseWeight: 50,
          linkedBeats: ['t1'],
          claim: `You messaged ${tenant} the previous evening asking whether they'd be in over the weekend.`,
          vulnerability: `You'd been trying to arrange the gas safety inspection for three weeks. There are nine messages in that thread about exactly that, and the engineer's booking confirmation is in your email.`,
        },
        {
          id: 'e4', type: 'physical', baseWeight: 70,
          linkedBeats: ['t1'],
          claim: `There's no sign of forced entry. Two people hold keys — you and ${tenant}.`,
          vulnerability: `The back door lock has been broken since the summer and the tenant refused access to fix it. It's in the repair log. Anyone who knew could lift it.`,
        },
        {
          id: 'e5', type: 'digital', baseWeight: 65,
          linkedBeats: ['t3'],
          claim: `Your car was picked up by a camera on Fenwick Street at ${addMinutes(start, 12)}, eight minutes' walk from the house.`,
          vulnerability: `Fenwick Street is the only road out of that side of town after midnight. Everyone who lives north of the river is on that camera every night.`,
        },
        {
          id: 'e6', type: 'financial', baseWeight: 55,
          linkedBeats: ['t2'],
          claim: `The policy on that property pays loss of rent for twelve months, which is more than you were getting from ${tenant}.`,
          vulnerability: `It also voids entirely on a finding of arson by the insured, and you'd read the policy — you quoted it at the possession hearing.`,
        },
        {
          id: 'e7', type: 'witness', baseWeight: 45,
          linkedBeats: ['t3'],
          claim: `${neighbour} opposite says she saw a man come out of the back gate and walk off "fast, not running."`,
          vulnerability: `It was dark, it was raining, and the gate is behind a six-foot hedge from her window. She told the first officer she'd seen "a shape."`,
        },
        {
          id: 'e8', type: 'physical', baseWeight: 50,
          linkedBeats: ['t2'],
          claim: `No accelerant was detected — but the investigator notes the fire load in that cupboard was too low to produce the observed spread on its own.`,
          vulnerability: `The cupboard is where the tenant kept the recycling, a chest freezer and, according to their own statement, "a lot of cardboard." The investigator never saw it full.`,
        },
      ],
      witnesses: [
        { id: 'w1', name: neighbour, relationship: 'neighbour opposite', claim: `Saw a man leave via the back gate at speed.`, accurate: false, flaw: 'View obstructed by a hedge; initially described only "a shape."' },
        { id: 'w2', name: tenant, relationship: 'tenant', claim: `Says you told them in the last argument that they'd "be out by Christmas one way or another."`, accurate: true },
      ],
      fatalFact: `Nobody forced that door, and the consumer unit was isolated before the fire started. Those two facts together only work with a key.`,
      opener: `${tenant} is in hospital. I want you to sit with that for a second before you say anything, because it changes what this is. Now — who else has a key to that house?`,
    }
  },
}

const workshop: Template = {
  id: 'arson-workshop',
  crime: 'arson',
  title: 'The Workshop',
  build: (r) => {
    const suspect = fullName(r)
    const rival = fullName(r)
    const apprentice = fullName(r)
    const start = hhmm(r.int(22, 23), r.int(0, 55))
    const call = addMinutes(start, r.int(25, 45))
    const end = addMinutes(call, 30)
    const contract = r.pick([85000, 140000, 210000, 275000])
    const trade = r.pick(['joinery', 'stonemasonry', 'boat repair', 'metal fabrication'])

    return {
      suspect: { name: suspect, occupation: `${trade}, self-employed` },
      victim: { name: rival, relationship: 'a competitor, and formerly your apprentice' },
      location: `${rival}'s workshop on the Loxley trading estate`,
      window: { start, end },
      truth: beats(
        ['t1', addMinutes(start, -40), `You'd been drinking. You drove there anyway.`],
        ['t2', start, `You got in through the side window he never latched — you knew about it because you taught him the trade in that building.`],
        ['t3', addMinutes(start, 4), `You pushed the offcut bin against the spray booth and lit it. You meant to damage the booth, not the building.`],
        ['t4', addMinutes(start, 9), `It took the extraction ducting and went into the roof void faster than you expected.`],
        ['t5', call, `You were already home when the estate's alarm company called it in.`],
      ),
      evidence: [
        {
          id: 'e1', type: 'circumstantial', anchor: true, baseWeight: 55,
          linkedBeats: ['t1'],
          claim: `${rival} took the £${contract.toLocaleString()} restoration contract off you four days earlier, and you'd told two people what you thought of it.`,
          vulnerability: `You lose contracts constantly — it's the trade. And you told those two people in a pub, loudly, which is not how a man who's planning something behaves.`,
        },
        {
          id: 'e2', type: 'physical', anchor: true, baseWeight: 60,
          linkedBeats: ['t2'],
          claim: `The side window was open. No damage to it. Whoever went in knew it didn't latch.`,
          vulnerability: `That window hasn't latched since the building was yours, and half the trade on that estate has worked in it at some point. It's common knowledge, not inside knowledge.`,
        },
        {
          id: 'e3', type: 'physical', anchor: true, baseWeight: 50,
          linkedBeats: ['t3', 't4'],
          claim: `The seat of the fire is an offcut bin that was found pushed up against the spray booth, not in its usual position against the far wall.`,
          vulnerability: `A fire moves things. Firefighters move things faster. Nobody photographed that bin before two crews had been through the building with hoses.`,
        },
        {
          id: 'e4', type: 'digital', baseWeight: 70,
          linkedBeats: ['t1', 't5'],
          claim: `Your van was on the estate's entrance camera at ${addMinutes(start, -6)} and leaving at ${addMinutes(start, 8)}.`,
          vulnerability: `The camera reads plates badly at night — the estate's own management company has complained about it twice — and there are two other vans of that model on that estate.`,
        },
        {
          id: 'e5', type: 'physical', baseWeight: 65,
          linkedBeats: ['t3'],
          claim: `There are traces of a nitrocellulose thinner on the bin remains.`,
          vulnerability: `It's a spray booth. The bin was full of offcuts from a spray booth. The presence of booth chemicals near a booth is the least surprising lab result imaginable.`,
        },
        {
          id: 'e6', type: 'witness', baseWeight: 45,
          linkedBeats: ['t2'],
          claim: `${apprentice}, working late two units down, says he heard a vehicle door around ${start}.`,
          vulnerability: `Eleven businesses on that estate and three of them run night shifts. He heard a door, not your door.`,
        },
        {
          id: 'e7', type: 'circumstantial', baseWeight: 50,
          linkedBeats: ['t1'],
          claim: `You'd been drinking. Two people put you in the Nag's Head until about ${addMinutes(start, -45)}.`,
          vulnerability: `Which also means two people can say you were in a pub, in public, up until three-quarters of an hour before, behaving like a man with nowhere to be.`,
        },
        {
          id: 'e8', type: 'digital', baseWeight: 40,
          linkedBeats: ['t1'],
          claim: `You'd looked at ${rival}'s company page on the contracts portal four times that week.`,
          vulnerability: `Everyone in that trade watches who's winning what. It's the only way to know what to bid.`,
        },
      ],
      witnesses: [
        { id: 'w1', name: apprentice, relationship: 'works two units down', claim: `Heard a vehicle door at around ${start}.`, accurate: false, flaw: 'Three businesses on the estate run night shifts.' },
      ],
      fatalFact: `Whoever got in knew that window. That narrows it from anyone to a short list, and you're at the top of it.`,
      opener: `Nobody broke into that building. They climbed through a window that's never latched. So let's start with who knows that about ${rival}'s workshop.`,
    }
  },
}

export const arsonTemplates: Template[] = [warehouse, rental, workshop]
