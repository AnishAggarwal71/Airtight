import type { Template } from './shared'
import { beats, fullName } from './shared'
import { hhmm } from '../rng'

/**
 * Embezzlement — deliberately a different texture from the other two.
 * There is no alibi to defend and no timeline to protect. The detective is an
 * auditor, the questions are about approvals and access, and "I was at home"
 * buys you nothing. Having one white-collar type proves the engine handles
 * variety rather than reskinning the same interrogation three ways.
 */

const phantomVendor: Template = {
  id: 'embezzlement-vendor',
  crime: 'embezzlement',
  title: 'The Vendor That Wasn’t',
  build: (r) => {
    const suspect = fullName(r)
    const colleague = fullName(r)
    const auditor = fullName(r)
    const total = r.pick([184000, 236000, 311000, 405000])
    const months = r.int(19, 34)
    const vendorName = r.pick(['Arlen Facilities Ltd', 'Northgate Support Services', 'Kelmar Compliance', 'Bryce & Halloran Consulting'])
    const employer = r.pick(['a regional hospital trust', 'a mid-market logistics group', 'a university estates department', 'a housing association'])

    return {
      suspect: { name: suspect, occupation: 'procurement manager' },
      victim: { name: employer, relationship: 'your employer of nine years' },
      location: `Interview conducted under caution — no arrest`,
      window: { start: hhmm(9, 0), end: hhmm(17, 0) },
      truth: beats(
        ['t1', 'M-34', `You set up ${vendorName} using a registered address that is a mail forwarding service in Leeds.`],
        ['t2', 'M-33', `You onboarded it yourself, using a supplier form you signed as both requester and approver during a gap in the delegation matrix.`],
        ['t3', 'M-30', `You began raising purchase orders against it for "facilities support" — always between £4,000 and £4,900, under the £5,000 second-approval threshold.`],
        ['t4', 'M-06', `${colleague} queried one of the invoices. You told her it was a legacy arrangement from before her time and she left it.`],
        ['t5', 'M-00', `Internal audit ran a supplier-address duplication check and the Leeds address matched three other dormant entities.`],
      ),
      evidence: [
        {
          id: 'e1', type: 'financial', anchor: true, baseWeight: 65,
          linkedBeats: ['t3'],
          claim: `£${total.toLocaleString()} paid to ${vendorName} across ${months} months. Not one invoice over £5,000, and your second-approval threshold is £5,000.`,
          vulnerability: `That threshold shapes every small supplier's invoicing in the organisation — they're told to split work to stay under it because it's faster. Three other vendors show the identical pattern and nobody's accusing them.`,
        },
        {
          id: 'e2', type: 'financial', anchor: true, baseWeight: 60,
          linkedBeats: ['t1'],
          claim: `${vendorName}'s registered address is a mail forwarding service. It has no premises, no staff and no filed accounts beyond dormant ones.`,
          vulnerability: `Half the consultants the organisation uses are one man with a laptop and a virtual office. That's not fraud, that's the modern supplier base — and you don't run Companies House checks, finance does.`,
        },
        {
          id: 'e3', type: 'digital', anchor: true, baseWeight: 55,
          linkedBeats: ['t2'],
          claim: `The supplier onboarding form for ${vendorName} has your login in the requester field and your login in the approver field.`,
          vulnerability: `For four months during the system migration the delegation matrix was broken and dozens of forms went through self-approved. IT raised it as a known issue and there's a ticket number.`,
        },
        {
          id: 'e4', type: 'financial', baseWeight: 75,
          linkedBeats: ['t1'],
          claim: `${vendorName}'s bank account received those payments and then transferred, within days, to an account in your partner's name.`,
          vulnerability: `This one has no crack in it. If they can show the onward transfers, the only question left is what you say about them.`,
        },
        {
          id: 'e5', type: 'digital', baseWeight: 60,
          linkedBeats: ['t3'],
          claim: `Nobody in the estates team can identify a single piece of work ${vendorName} actually did.`,
          vulnerability: `Estates turns over constantly — four of the six people who'd have known left in the last two years. Nobody remembering is not the same as nobody doing it.`,
        },
        {
          id: 'e6', type: 'witness', baseWeight: 50,
          linkedBeats: ['t4'],
          claim: `${colleague} says she raised a query about one of these invoices and you told her it was a legacy arrangement predating her.`,
          vulnerability: `She raised it in passing, in a corridor, six months ago, and has no record of it. Her note was written last week, after audit started asking.`,
        },
        {
          id: 'e7', type: 'digital', baseWeight: 55,
          linkedBeats: ['t1'],
          claim: `The company was incorporated eleven days after you were passed over for the head of procurement post.`,
          vulnerability: `A coincidence of dates is a story auditors tell themselves. Companies get incorporated every day of the week.`,
        },
        {
          id: 'e8', type: 'financial', baseWeight: 45,
          linkedBeats: ['t5'],
          claim: `The same Leeds address appears behind three other dormant companies, two of which list a former colleague of yours as a director.`,
          vulnerability: `It's a mail forwarding service with thousands of registrations. Shared addresses at a forwarding service prove nothing about shared people.`,
        },
      ],
      witnesses: [
        { id: 'w1', name: colleague, relationship: 'finance business partner', claim: `Queried an invoice and was told it was a legacy arrangement.`, accurate: true },
        { id: 'w2', name: auditor, relationship: 'internal audit', claim: `Flagged the address duplication.`, accurate: true },
      ],
      fatalFact: `The money left ${vendorName} and landed in an account with your partner's name on it. Everything before that is argument.`,
      opener: `I've got nine years of you doing this job properly and ${months} months of you doing something else. Let's start with ${vendorName} — what did they actually do for you?`,
    }
  },
}

const ghostPayroll: Template = {
  id: 'embezzlement-payroll',
  crime: 'embezzlement',
  title: 'Still On The Books',
  build: (r) => {
    const suspect = fullName(r)
    const ghost = fullName(r)
    const hrLead = fullName(r)
    const total = r.pick([96000, 148000, 203000, 262000])
    const months = r.int(22, 40)
    const employer = r.pick(['a 400-bed care home group', 'a national coach operator', 'a contract catering firm', 'a facilities management company'])

    return {
      suspect: { name: suspect, occupation: 'payroll and HR systems lead' },
      victim: { name: employer, relationship: 'your employer' },
      location: `Interview conducted under caution — no arrest`,
      window: { start: hhmm(9, 0), end: hhmm(17, 0) },
      truth: beats(
        ['t1', 'M-40', `${ghost} resigned. You processed the leaver form and then never submitted it.`],
        ['t2', 'M-39', `You changed the bank details on the record to an account you control, in a two-field edit that the system logs but nobody reviews.`],
        ['t3', 'M-38', `The salary kept running. You suppressed the record from the monthly headcount report by tagging it as a long-term absence.`],
        ['t4', 'M-11', `You gave the record a cost-of-living increase in line with everyone else, because an unchanged salary would have stood out.`],
        ['t5', 'M-00', `A new finance director ran a bank-detail duplication report across payroll.`],
      ),
      evidence: [
        {
          id: 'e1', type: 'financial', anchor: true, baseWeight: 70,
          linkedBeats: ['t2'],
          claim: `${ghost}'s salary — £${total.toLocaleString()} over ${months} months — was paid into an account that also receives your own salary.`,
          vulnerability: `There isn't one. A shared destination account is the whole case in a single line.`,
        },
        {
          id: 'e2', type: 'digital', anchor: true, baseWeight: 55,
          linkedBeats: ['t1'],
          claim: `${ghost} left ${months} months ago. HR has the resignation email. Payroll never got the leaver form.`,
          vulnerability: `Leaver forms fail constantly in that organisation — there were nine unprocessed leavers in the backlog when you started, and you'd raised it in writing twice.`,
        },
        {
          id: 'e3', type: 'digital', anchor: true, baseWeight: 60,
          linkedBeats: ['t2'],
          claim: `The audit log shows the bank details on that record were edited by your login the week after the resignation.`,
          vulnerability: `Your login is used by the whole payroll team because the system only has two licences and the second one has been broken since the upgrade. IT knows. It's in a ticket.`,
        },
        {
          id: 'e4', type: 'digital', baseWeight: 65,
          linkedBeats: ['t3'],
          claim: `The record was tagged as long-term absence, which suppresses it from the monthly headcount report managers review.`,
          vulnerability: `There were fourteen records tagged that way. It's the tag people use when they don't know what else to do with someone.`,
        },
        {
          id: 'e5', type: 'financial', baseWeight: 60,
          linkedBeats: ['t4'],
          claim: `The record received the annual increase eleven months ago. Someone was maintaining it.`,
          vulnerability: `The increase runs automatically across every active record. Nobody touched it — the system did.`,
        },
        {
          id: 'e6', type: 'witness', baseWeight: 50,
          linkedBeats: ['t1'],
          claim: `${ghost} confirms they left, has a P45 dated ${months} months ago, and has never heard of the account in question.`,
          vulnerability: `They also confirm they never chased a final payslip and didn't check what happened after they walked out. Their recollection of the exit is vague.`,
        },
        {
          id: 'e7', type: 'digital', baseWeight: 45,
          linkedBeats: ['t3'],
          claim: `You declined the offer of a payroll assistant twice, on the grounds that training one would take longer than doing it yourself.`,
          vulnerability: `That's true, and it's also what every overworked systems lead in the country says when offered a junior in April and expected to deliver year-end in May.`,
        },
        {
          id: 'e8', type: 'financial', baseWeight: 55,
          linkedBeats: ['t2'],
          claim: `Your own spending over that period is around £2,000 a month above your net salary.`,
          vulnerability: `You'd had an inheritance, or a redundancy payment from a previous role, or your partner's business had a good two years. Unexplained spending has explanations.`,
        },
      ],
      witnesses: [
        { id: 'w1', name: ghost, relationship: 'former employee', claim: `Left ${months} months ago; knows nothing about the receiving account.`, accurate: true },
        { id: 'w2', name: hrLead, relationship: 'HR lead', claim: `Says the leaver form never reached payroll.`, accurate: true },
      ],
      fatalFact: `The salary of a person who doesn't work there goes into an account that also receives yours.`,
      opener: `${ghost} hasn't worked for you in ${months} months. You've paid them £${total.toLocaleString()} since. Where would you like to begin?`,
    }
  },
}

const restrictedFunds: Template = {
  id: 'embezzlement-grants',
  crime: 'embezzlement',
  title: 'Restricted Funds',
  build: (r) => {
    const suspect = fullName(r)
    const trustee = fullName(r)
    const funder = fullName(r)
    const total = r.pick([58000, 87000, 124000, 166000])
    const months = r.int(14, 28)
    const charity = r.pick(['a youth homelessness charity', 'a regional hospice', 'a literacy trust', 'a refugee support charity'])
    const consultancy = r.pick(['Redmayne Impact', 'Callow Programme Advisory', 'Thornfield Evaluation'])

    return {
      suspect: { name: suspect, occupation: 'chief executive' },
      victim: { name: charity, relationship: 'the charity you have run for six years' },
      location: `Interview conducted under caution — no arrest`,
      window: { start: hhmm(9, 0), end: hhmm(17, 0) },
      truth: beats(
        ['t1', 'M-28', `A restricted grant landed. The charity's unrestricted reserves were down to six weeks of payroll.`],
        ['t2', 'M-27', `You moved money out of the restricted pot to cover salaries, intending to put it back. You told yourself it was a timing problem.`],
        ['t3', 'M-20', `You engaged ${consultancy} — a company you incorporated — to produce "evaluation work" against the grant, and paid it from the restricted budget line.`],
        ['t4', 'M-08', `Roughly a third of what ${consultancy} received went to you personally. That was the point at which it stopped being a timing problem.`],
        ['t5', 'M-00', `The funder asked for the evaluation report. There isn't one.`],
      ),
      evidence: [
        {
          id: 'e1', type: 'financial', anchor: true, baseWeight: 60,
          linkedBeats: ['t2'],
          claim: `£${total.toLocaleString()} of restricted grant funding was spent on things outside the grant's terms, principally core salaries.`,
          vulnerability: `Misapplying restricted funds to keep the doors open is a governance failure that happens in a great many small charities, and it isn't theft. The Commission deals with it every year without anyone being arrested.`,
        },
        {
          id: 'e2', type: 'financial', anchor: true, baseWeight: 70,
          linkedBeats: ['t3'],
          claim: `${consultancy} was paid from the grant. You are its sole director and shareholder.`,
          vulnerability: `A declared related-party transaction is legal and common in the sector. The question is whether you declared it — and the trustee minutes are where that fight happens.`,
        },
        {
          id: 'e3', type: 'digital', anchor: true, baseWeight: 55,
          linkedBeats: ['t5'],
          claim: `The evaluation report ${consultancy} was paid to produce does not exist. No draft, no data, no fieldwork.`,
          vulnerability: `The evaluation depended on service-user access that collapsed when the outreach team was cut. There's a paper trail of the project stalling for reasons that had nothing to do with you.`,
        },
        {
          id: 'e4', type: 'financial', baseWeight: 75,
          linkedBeats: ['t4'],
          claim: `About a third of what ${consultancy} received went to your personal account and does not correspond to any declared salary or dividend.`,
          vulnerability: `Nothing defensible here. This is the line where governance failure becomes personal benefit.`,
        },
        {
          id: 'e5', type: 'witness', baseWeight: 50,
          linkedBeats: ['t3'],
          claim: `${trustee}, the chair, says the board was never told you owned ${consultancy}.`,
          vulnerability: `The board met four times a year, papers went out the night before, and the related-party register was last updated two chairs ago. "Never told" and "told in a paper nobody read" look identical afterwards.`,
        },
        {
          id: 'e6', type: 'digital', baseWeight: 55,
          linkedBeats: ['t3'],
          claim: `${consultancy} was incorporated three weeks before it was engaged.`,
          vulnerability: `Consultancies get incorporated when they get their first piece of work. That's the order it happens in.`,
        },
        {
          id: 'e7', type: 'financial', baseWeight: 45,
          linkedBeats: ['t1'],
          claim: `The charity's unrestricted reserves were at six weeks of payroll when the grant arrived.`,
          vulnerability: `Which is the strongest thing you've got. You were trying to keep twenty-two people in work and a service running. Motive cuts both ways here and you should make them feel it.`,
        },
        {
          id: 'e8', type: 'digital', baseWeight: 50,
          linkedBeats: ['t5'],
          claim: `${funder} at the grant-making trust says you told them in two quarterly updates that the evaluation was "on track."`,
          vulnerability: `Quarterly updates are written by whoever's free on the Friday. You didn't draft either of them.`,
        },
      ],
      witnesses: [
        { id: 'w1', name: trustee, relationship: 'chair of trustees', claim: `Says the board never knew about your interest in ${consultancy}.`, accurate: true },
        { id: 'w2', name: funder, relationship: 'grant manager at the funder', claim: `Was told the evaluation was on track, twice.`, accurate: false, flaw: 'The updates were drafted by someone else.' },
      ],
      fatalFact: `A third of the consultancy money reached you personally. Keeping the charity afloat explains the first transfer; it does not explain that one.`,
      opener: `I want to say at the start that I've read the accounts and I can see what this place does. That's not going to help you, but I wanted you to know I've seen it. Now — tell me about ${consultancy}.`,
    }
  },
}

export const embezzlementTemplates: Template[] = [
  phantomVendor,
  ghostPayroll,
  restrictedFunds,
]
