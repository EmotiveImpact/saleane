import { describe, expect, it } from 'vitest'
import { execute } from '../commands'
import type { Command } from '../commands'
import type { BusinessState } from '../model'
import { createWorkspace } from '../workspace'
import { seed } from '../seed'
import { operations } from '../operations'
import { findGiftCard } from '../giftCards'
import { readDelimited } from './sheet'
import { reviewClients, understandFile } from './clients'
import {
  codeAndExpiry,
  countFrom,
  moneyParts,
  moneyRows,
  moneyStatus,
  packageKey,
  reviewMoney,
} from './money'
import type { MoneyChoices } from './money'

// Moving in, stage 3: gift cards, packages and credit from the old system's own files.
// 08:00 UTC on Tuesday 6 October 2026 is 09:00 in London.
const now = '2026-10-06T08:00:00.000Z'
let n = 0
const makeId = () => `money-move-${++n}`
function studio(): BusinessState {
  const s = createWorkspace({ name: 'Moving test studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, makeId)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const file = (name: string, lines: string[]) =>
  understandFile({ fileName: name, rows: readDelimited(name, lines.join('\n')) })
const none: MoneyChoices = { packages: {}, signs: {} }

// Timely's reports, as the field map describes them, filled with the sample studio's clients.
const TIMELY_CLIENTS = [
  'FirstName,LastName,CompanyName,isVIP,SMS Number,Email Address,Date of Birth,Gender,SMS marketing',
  'Femi,Adeyemi,,TRUE,07700 900311,femi.adeyemi@example.com,14/02/1990,Male,TRUE',
  'Lucy,Hart,,FALSE,07700 900312,lucy.hart@example.com,,Female,FALSE',
  'Sam,Okafor,,FALSE,07700 900313,sam.okafor@example.com,03/06/1987,Male,FALSE',
]
const TIMELY_VOUCHERS = [
  'Customer,Gift Voucher,Recipient,Status,Code,Amount,Redeemed,Outstanding',
  'Olivia James,£50 Gift Voucher,Hannah James,Active,GV58214 (expires 31/03/2027),£50.00,£20.00,£30.00',
  'Nina Patel,£100 Gift Voucher,,Active,GV33107 (expires never),£100.00,£0.00,£100.00',
  'Femi Adeyemi,Skin Renewal Facial voucher,Tola Adeyemi,Active,GV40981 (expires 14/02/2027),£95.00,£0.00,£95.00',
  'Lucy Hart,£40 Gift Voucher,,Redeemed,GV27765 (expires 30/11/2026),£40.00,£40.00,£0.00',
  'Grace Chen,£60 Gift Voucher,Mei Chen,Active,GV11873 (expires 01/09/2026),£60.00,£0.00,£60.00',
  'Total,,,,,£345.00,£60.00,£285.00',
]
const TIMELY_CREDIT = [
  'Customer,Reason,Status,Expiry,Amount,Redeemed,Outstanding',
  'Charlotte Hayes,Refund for a cancelled visit,Active,never,£25.00,£0.00,£25.00',
  'Sam Okafor,Paid twice by mistake,Active,31/12/2026,£15.00,£5.00,£10.00',
  'Ruby Taylor,Goodwill,Redeemed,never,£10.00,£10.00,£0.00',
  'Total,,,,£50.00,£15.00,£35.00',
]
const TIMELY_PACKAGES = [
  'Customer,Package,Status,Expiry,Payment,Visits available,Visits redeemed',
  'Nina Patel,Course of 6 Skin Renewal Facials,Active,30/06/2027,£480.00,4,2',
  'Femi Adeyemi,Massage course of 3,Active,31/01/2027,£210.00,3,0',
  'Zoe Miller,Brow Lamination x4,Active,31/03/2027,£120.00,2,2',
  'Olivia James,Course of 3 Gloss & Tone,Expired,31/08/2026,£165.00,1,2',
  'Total,,,,£975.00,10,6',
]

function timely(choices: MoneyChoices = none) {
  const s = studio()
  const files = [
    file('customers.csv', TIMELY_CLIENTS),
    file('Customer gift voucher details.csv', TIMELY_VOUCHERS),
    file('Customer credit details.csv', TIMELY_CREDIT),
    file('Customer package details.csv', TIMELY_PACKAGES),
  ]
  const clients = reviewClients(files, s, 'timely')
  const review = reviewMoney(files, s, clients.ready, choices, 'timely', now)
  return { s, files, clients, review }
}

describe('reading money as old systems write it', () => {
  it('reads codes that carry their last day, counts and statuses', () => {
    expect(codeAndExpiry('GV58214 (expires 31/03/2027)')).toEqual({
      code: 'GV58214',
      expiry: '31/03/2027',
    })
    expect(codeAndExpiry('GV33107 (expires never)')).toEqual({ code: 'GV33107', expiry: 'never' })
    expect(codeAndExpiry('LAKE-7K4M-2QHN')).toEqual({ code: 'LAKE-7K4M-2QHN', expiry: null })
    expect(countFrom('4')).toBe(4)
    expect(countFrom('4.0')).toBe(4)
    expect(countFrom('3 sessions')).toBe(3)
    expect(countFrom('Unlimited')).toBe('unlimited')
    expect(countFrom('lots')).toBeNull()
    expect(moneyStatus('Active')).toBe('active')
    expect(moneyStatus('Partially redeemed')).toBe('active')
    expect(moneyStatus('Redeemed')).toBe('used')
    expect(moneyStatus('Expired')).toBe('expired')
    expect(moneyStatus('Refunded')).toBe('cancelled')
  })

  it('finds the treatment inside a package’s name', () => {
    expect(packageKey('Course of 6 Skin Renewal Facials')).toBe('skin renewal facial')
    expect(packageKey('Skin Renewal Facial')).toBe('skin renewal facial')
    expect(packageKey('Course of 3 Gloss & Tone')).toBe(packageKey('Gloss & Tone'))
    expect(packageKey('Brow Lamination x4')).toBe('brow lamination')
    expect(packageKey('5 x Lymphatic Massage sessions')).toBe('lymphatic massage')
  })

  it('recognises each money file and what its columns mean', () => {
    const vouchers = file('Customer gift voucher details.csv', TIMELY_VOUCHERS)
    expect(vouchers).toMatchObject({ system: 'timely', kind: 'giftCards', unread: null })
    expect(vouchers.rows).toHaveLength(5)
    expect(vouchers.totals).toHaveLength(1)
    const field = (f: typeof vouchers, heading: string) =>
      f.moneyMatches.find((m) => m.heading === heading)?.field
    expect(field(vouchers, 'Code')).toBe('code')
    expect(field(vouchers, 'Outstanding')).toBe('balance')
    expect(file('c.csv', TIMELY_CREDIT)).toMatchObject({ kind: 'credit' })
    expect(file('p.csv', TIMELY_PACKAGES)).toMatchObject({ kind: 'packages' })
    expect(
      file('liability.csv', [
        'Liability type,Opening balance,Collections,Redemptions,Expirations,Refunds,Closing balance,Net change',
        'Gift card,£400.00,£100.00,£80.00,£0.00,£0.00,£420.00,£20.00',
      ]),
    ).toMatchObject({ system: 'fresha', kind: 'totals' })
    expect(
      file('activity.csv', [
        'Date,Ref.,Liability type,Client,Sale number,Location,Activity,Amount',
        '01/10/2026,GC1,Gift card,Ann Lee,1001,Main,Sale,£50.00',
      ]).unread,
    ).toMatch(/not what is left on each card/)
    expect(
      file('members.csv', ['Customer,Membership Card ID,Membership Name', 'Ann,M1,Gold']).kind,
    ).toBe('memberships')
    // A file SALEANE has no layout for is read by meaning.
    const generic = file('Store credit.csv', [
      'Client name,Credit balance,Note',
      'Ann Lee,£12.00,Overpaid',
    ])
    expect(generic.kind).toBe('credit')
    expect(field(generic, 'Credit balance')).toBe('credit')
  })
})

describe('reviewing money from Timely', () => {
  it('keeps each gift card’s code and what is left, and leaves used and expired cards behind', () => {
    const { review } = timely()
    const card = (line: number) =>
      review.rows.find((r) => r.kind === 'giftCards' && r.line === line)!
    expect(card(2)).toMatchObject({
      status: 'ready',
      label: 'GV58214 · £30.00 left · Olivia James',
      detail: 'Keeps its code. £30.00 to spend until 31 March 2027.',
    })
    expect(card(3).notes).toContain('No last day in Timely, so SALEANE keeps it for ten years.')
    expect(card(4).notes.join(' ')).toMatch(/Bought as “Skin Renewal Facial voucher”/)
    expect(card(5)).toMatchObject({ status: 'used', detail: 'Nothing left to spend.' })
    expect(card(6)).toMatchObject({ status: 'expired', detail: 'Expired on 1 September 2026.' })
    expect(review.cards).toEqual([
      {
        code: 'GV58214',
        balanceMinor: 3000,
        valueBeforeMinor: 5000,
        client: { id: 'client-2' },
        purchaserName: 'Olivia James',
        recipientName: 'Hannah James',
        expiresOn: '2027-03-31',
      },
      {
        code: 'GV33107',
        balanceMinor: 10000,
        valueBeforeMinor: 10000,
        client: { id: 'client-8' },
        purchaserName: 'Nina Patel',
        recipientName: '',
      },
      {
        code: 'GV40981',
        balanceMinor: 9500,
        valueBeforeMinor: 9500,
        client: {
          arriving: {
            name: 'Femi Adeyemi',
            email: 'femi.adeyemi@example.com',
            phone: '+447700900311',
          },
        },
        purchaserName: 'Femi Adeyemi',
        recipientName: 'Tola Adeyemi',
        expiresOn: '2027-02-14',
      },
    ])
    expect(review.cardsMinor).toBe(22500)
  })

  it('checks what comes across against Timely’s own totals', () => {
    const { review } = timely()
    const cards = review.checks.find((c) => c.kind === 'giftCards')!
    expect(cards).toEqual({
      kind: 'giftCards',
      unit: 'money',
      source: 'the total in Customer gift voucher details.csv',
      theirs: 28500,
      rows: 28500,
      coming: 22500,
      behind: [{ status: 'expired', count: 1, amount: 6000 }],
      unreadable: 0,
      agrees: true,
    })
    expect(review.checks.find((c) => c.kind === 'credit')).toMatchObject({
      theirs: 3500,
      rows: 3500,
      coming: 3500,
      behind: [],
      agrees: true,
    })
    expect(review.checks.find((c) => c.kind === 'packages')).toMatchObject({
      unit: 'visits',
      theirs: 10,
      rows: 10,
      agrees: true,
    })
  })

  it('says when the rows do not add up to the old system’s total', () => {
    const s = studio()
    const short = TIMELY_VOUCHERS.filter((line) => !line.startsWith('Nina'))
    const review = reviewMoney(
      [file('Customer gift voucher details.csv', short)],
      s,
      [],
      none,
      'timely',
      now,
    )
    expect(review.checks[0]).toMatchObject({ theirs: 28500, rows: 18500, agrees: false })
  })

  it('matches each package to a treatment, asking only when unsure', () => {
    const { review } = timely()
    expect(review.treatments.map((t) => [t.name, t.how, t.id])).toEqual([
      ['Brow Lamination x4', 'none', undefined],
      ['Course of 6 Skin Renewal Facials', 'same', 'service-facial'],
      ['Massage course of 3', 'none', undefined],
    ])
    const row = (line: number) => review.rows.find((r) => r.kind === 'packages' && r.line === line)!
    expect(row(2)).toMatchObject({
      status: 'ready',
      detail: '4 visits of Skin Renewal Facial left, until 30 June 2027.',
    })
    expect(row(2).notes).toContain('Bought for £480.00; the 4 visits left are worth £320.00.')
    expect(row(3).detail).toBe('Choose which of your treatments “Massage course of 3” is for.')
    expect(row(5)).toMatchObject({ status: 'expired', detail: 'Ended on 31 August 2026.' })
    expect(review.packages).toEqual([
      {
        client: { id: 'client-8' },
        name: 'Course of 6 Skin Renewal Facials',
        serviceIds: ['service-facial'],
        visitsLeft: 4,
        visitsBefore: 6,
        valueMinor: 32000,
        endsOn: '2027-06-30',
      },
    ])

    const answered = timely({
      packages: { massage: 'service-lymphatic', 'brow lamination': null },
      signs: {},
    }).review
    expect(answered.rows.find((r) => r.kind === 'packages' && r.line === 4)).toMatchObject({
      status: 'skipped',
      detail: 'You chose to leave “Brow Lamination x4” packages behind.',
    })
    expect(answered.packages).toHaveLength(2)
    expect(answered.packages[1]).toMatchObject({
      name: 'Massage course of 3',
      serviceIds: ['service-lymphatic'],
      visitsLeft: 3,
      visitsBefore: 3,
      valueMinor: 21000,
    })
    expect(answered.packageVisits).toBe(7)
  })

  it('records credit for the desk, with its reason and last day', () => {
    const { review } = timely()
    expect(review.credit).toEqual([
      {
        client: { id: 'client-13' },
        kind: 'credit',
        amountMinor: 2500,
        note: 'Refund for a cancelled visit',
      },
      {
        client: {
          arriving: { name: 'Sam Okafor', email: 'sam.okafor@example.com', phone: '+447700900313' },
        },
        kind: 'credit',
        amountMinor: 1000,
        note: 'Paid twice by mistake. Expires 31 December 2026 in Timely',
      },
    ])
    expect(review.rows.find((r) => r.kind === 'credit' && r.line === 4)).toMatchObject({
      status: 'used',
      detail: 'Nothing left.',
    })
    expect(review.creditMinor).toBe(3500)
    expect(review.signs).toEqual([])
  })

  it('brings every card, package and credit across once the clients are saved', () => {
    const {
      s,
      clients,
      review: first,
    } = timely({
      packages: { massage: 'service-lymphatic' },
      signs: {},
    })
    let saved = apply(s, {
      type: 'import-clients',
      source: 'Timely client list',
      contacts: [...clients.ready, ...first.newClients],
      reviewed: true,
    })
    const { cards, packages, credit, lost } = moneyRows(first, saved)
    expect(lost).toBe(0)
    expect(cards[2].clientId).toBe(saved.clients.find((c) => c.name === 'Femi Adeyemi')!.id)
    saved = apply(saved, { type: 'import-gift-cards', source: 'Timely', cards, reviewed: true })
    saved = apply(saved, { type: 'import-packages', source: 'Timely', packages, reviewed: true })
    saved = apply(saved, {
      type: 'import-balances',
      source: 'Timely',
      balances: credit,
      reviewed: true,
    })
    expect(findGiftCard(saved, 'gv58214')).toMatchObject({ valueMinor: 3000 })
    expect(saved.holdings).toHaveLength(2)
    expect(operations(saved).balances).toHaveLength(2)

    // Adding the same files again finds everything already here.
    const again = reviewMoney(
      [
        file('Customer gift voucher details.csv', TIMELY_VOUCHERS),
        file('Customer credit details.csv', TIMELY_CREDIT),
        file('Customer package details.csv', TIMELY_PACKAGES),
      ],
      saved,
      [],
      { packages: { massage: 'service-lymphatic' }, signs: {} },
      'timely',
      now,
    )
    expect(again.cards).toEqual([])
    expect(again.packages).toEqual([])
    expect(again.credit).toEqual([])
    expect(again.counts.here).toBe(7)
  })
})

describe('money from other systems', () => {
  it('gives Square’s cards new codes and keeps their last digits', () => {
    const review = reviewMoney(
      [
        file('gift-cards.csv', [
          'PAN Suffix,Current outstanding Amount',
          '4821,£25.00',
          '9930,£0.00',
        ]),
      ],
      studio(),
      [],
      none,
      'square',
      now,
    )
    expect(review.cards).toEqual([
      {
        codeBefore: 'ending 4821',
        balanceMinor: 2500,
        purchaserName: 'A Square customer',
        recipientName: '',
      },
    ])
    expect(review.rows[0].notes[0]).toMatch(/Square shares only the last digits/)
    expect(review.counts.used).toBe(1)
  })

  it('finds Square’s cards already here when the file is added again', () => {
    const squareFile = () =>
      file('gift-cards.csv', [
        'PAN Suffix,Current outstanding Amount',
        '4821,£25.00',
        '4821,£25.00',
        '7310,£40.00',
      ])
    const first = reviewMoney([squareFile()], studio(), [], none, 'square', now)
    expect(first.cards).toHaveLength(3)
    // Only the first part was saved before the owner tried again.
    const s = studio()
    const { cards } = moneyRows(first, s)
    const saved = apply(s, {
      type: 'import-gift-cards',
      source: 'Square',
      cards: cards.slice(0, 2),
      reviewed: true,
    })
    const again = reviewMoney([squareFile()], saved, [], none, 'square', now)
    expect(again.rows.map((r) => r.status)).toEqual(['here', 'here', 'ready'])
    expect(again.rows[0].detail).toBe(
      'This gift card came across before, with a new code. It stays as it is.',
    )
    expect(again.cards).toEqual([
      {
        codeBefore: 'ending 7310',
        balanceMinor: 4000,
        purchaserName: 'A Square customer',
        recipientName: '',
      },
    ])
  })

  it('leaves a card whose code is already here, and a card listed twice, alone', () => {
    const s = studio()
    const sold = apply(s, {
      type: 'import-gift-cards',
      source: 'Phorest',
      cards: [{ code: 'PH-1001', balanceMinor: 1000, purchaserName: 'Ann Lee', recipientName: '' }],
      reviewed: true,
    })
    const review = reviewMoney(
      [
        file('Vouchers Outstanding.csv', [
          'Serial Number,Client,Branch Sold,Remaining,Issue Date,Expiry Date',
          'PH1001,Amelia Carter,Main,£10.00,01/02/2026,01/02/2027',
          'PH2002,Amelia Carter,Main,£15.00,01/03/2026,',
          'ph-2002,Amelia Carter,Main,£15.00,01/03/2026,',
        ]),
      ],
      sold,
      [],
      none,
      'phorest',
      now,
    )
    expect(review.rows.map((r) => r.status)).toEqual(['here', 'ready', 'combined'])
    expect(review.cards).toEqual([
      {
        code: 'PH2002',
        balanceMinor: 1500,
        client: { id: 'client-1' },
        purchaserName: 'Amelia Carter',
        recipientName: '',
        issuedOn: '2026-03-01',
      },
    ])
  })

  it('keeps two alike packages in one report as two, and a report added twice once', () => {
    const report = (name: string) =>
      file(name, [
        'Customer,Package,Status,Expiry,Payment,Visits available,Visits redeemed',
        'Nina Patel,Course of 6 Skin Renewal Facials,Active,30/06/2027,£480.00,4,2',
        'Nina Patel,Course of 6 Skin Renewal Facials,Active,30/06/2027,£480.00,4,2',
      ])
    const review = reviewMoney(
      [report('Customer package details.csv'), report('Customer package details (1).csv')],
      studio(),
      [],
      none,
      'timely',
      now,
    )
    expect(review.rows.map((r) => r.status)).toEqual(['ready', 'ready', 'combined', 'combined'])
    expect(review.packages.map((p) => p.name)).toEqual([
      'Course of 6 Skin Renewal Facials',
      'Course of 6 Skin Renewal Facials (2)',
    ])
    expect(review.packageVisits).toBe(8)
  })

  it('finds the very package already saved when a package report is added again', () => {
    const report = () =>
      file('Customer package details.csv', [
        'Customer,Package,Status,Expiry,Payment,Visits available,Visits redeemed',
        'Nina Patel,Course of 6 Skin Renewal Facials,Active,30/06/2027,£480.00,4,2',
        'Nina Patel,Course of 6 Skin Renewal Facials,Active,31/12/2027,£480.00,6,0',
      ])
    const s = studio()
    const first = reviewMoney([report()], s, [], none, 'timely', now)
    expect(first.packages.map((p) => [p.name, p.visitsLeft])).toEqual([
      ['Course of 6 Skin Renewal Facials', 4],
      ['Course of 6 Skin Renewal Facials (2)', 6],
    ])
    // Only the second was saved before the owner tried again.
    const { packages } = moneyRows(first, s)
    let saved = apply(s, {
      type: 'import-packages',
      source: 'Timely',
      packages: packages.slice(1),
      reviewed: true,
    })
    const again = reviewMoney([report()], saved, [], none, 'timely', now)
    expect(again.rows.map((r) => r.status)).toEqual(['ready', 'here'])
    expect(again.packages.map((p) => [p.name, p.visitsLeft])).toEqual([
      ['Course of 6 Skin Renewal Facials', 4],
    ])
    saved = apply(saved, {
      type: 'import-packages',
      source: 'Timely',
      packages: moneyRows(again, saved).packages,
      reviewed: true,
    })
    expect(saved.holdings!.map((h) => [h.name, h.visits])).toEqual([
      ['Course of 6 Skin Renewal Facials (2)', 6],
      ['Course of 6 Skin Renewal Facials', 4],
    ])
    const third = reviewMoney([report()], saved, [], none, 'timely', now)
    expect(third.rows.map((r) => r.status)).toEqual(['here', 'here'])
  })

  it('asks which way round a credit file’s amounts go, suggesting Phorest’s own way', () => {
    const credit = file('Client credit.csv', [
      'Client,Account balance',
      'Amelia Carter,-£20.00',
      'Ellie Brooks,£12.50',
    ])
    expect(credit.kind).toBe('credit')
    const s = studio()
    const review = reviewMoney([credit], s, [], none, 'phorest', now)
    expect(review.signs).toEqual([
      {
        fileName: 'Client credit.csv',
        positive: 'owed',
        how: 'suggested',
        samples: ['-£20.00', '£12.50'],
      },
    ])
    expect(review.credit.map((c) => [c.client, c.kind, c.amountMinor])).toEqual([
      [{ id: 'client-1' }, 'credit', 2000],
      [{ id: 'client-3' }, 'owed', 1250],
    ])
    const chosen = reviewMoney(
      [credit],
      s,
      [],
      { packages: {}, signs: { 'Client credit.csv': 'credit' } },
      'phorest',
      now,
    )
    expect(chosen.signs[0]).toMatchObject({ positive: 'credit', how: 'chosen' })
    expect(chosen.credit.map((c) => c.kind)).toEqual(['owed', 'credit'])
  })

  it('reads credit kept in a client list, and adds up two rows for one client', () => {
    const s = studio()
    const files = [
      file('clients.csv', [
        'First name,Last name,Email,Mobile,Account credit',
        'Ann,Lee,ann@example.com,07700 900123,£15.00',
        'Bo,Diaz,bo@example.com,,',
      ]),
      file('More credit.csv', ['Customer,Credit balance,Reason', 'Ann Lee,£5.00,Gift']),
    ]
    const clients = reviewClients(files, s, 'other')
    const review = reviewMoney(files, s, clients.ready, none, 'other', now)
    expect(review.rows.map((r) => [r.fileName, r.status])).toEqual([
      ['clients.csv', 'ready'],
      ['More credit.csv', 'combined'],
    ])
    expect(review.credit).toEqual([
      {
        client: { arriving: { name: 'Ann Lee', email: 'ann@example.com', phone: '+447700900123' } },
        kind: 'credit',
        amountMinor: 2000,
        note: 'Gift',
      },
    ])
  })

  it('adds a client named with an email only when something of theirs comes across', () => {
    const review = reviewMoney(
      [
        file('packages.csv', [
          'Client,Email,Package,Sessions remaining,Total sessions,Price',
          'Kemi Bello,kemi@example.com,Gloss & Tone course,2,3,£150.00',
          'Tom Hale,tom@example.com,Hot stone course,2,3,£150.00',
          'Ivy Shaw,,Gloss & Tone course,1,3,£150.00',
          'Ruby Taylor,,Unlimited Gloss & Tone,Unlimited,,£90.00',
        ]),
      ],
      studio(),
      [],
      none,
      'other',
      now,
    )
    expect(review.newClients.map((c) => c.name)).toEqual(['Kemi Bello'])
    expect(review.rows.map((r) => r.status)).toEqual(['ready', 'problem', 'problem', 'problem'])
    expect(review.rows[1].detail).toBe('Choose which of your treatments “Hot stone course” is for.')
    expect(review.rows[2].detail).toMatch(/Add your client list too/)
    expect(review.rows[3].detail).toMatch(/makes it a membership/)
    expect(review.packages[0]).toMatchObject({ valueMinor: 10000, visitsBefore: 3 })
  })

  it('checks gift cards against Fresha’s liability summary', () => {
    const files = [
      file('liability summary.csv', [
        'Liability type,Opening balance,Collections,Redemptions,Expirations,Refunds,Closing balance,Net change',
        'Gift card,£400.00,£100.00,£80.00,£0.00,£0.00,£75.00,£20.00',
        'Client balance,£0.00,£0.00,£0.00,£0.00,£0.00,£0.00,£0.00',
      ]),
      file('gift cards.csv', [
        'Gift card code,Client,Original amount,Redeemed,Expiry date',
        'FR-AAAA-1111,Amelia Carter,£50.00,£25.00,01/12/2026',
        'FR-BBBB-2222,Ellie Brooks,£50.00,£0.00,',
      ]),
    ]
    const review = reviewMoney(files, studio(), [], none, 'fresha', now)
    expect(review.cards.map((c) => [c.code, c.balanceMinor])).toEqual([
      ['FRAAAA1111', 2500],
      ['FRBBBB2222', 5000],
    ])
    expect(review.checks).toEqual([
      {
        kind: 'giftCards',
        unit: 'money',
        source: 'Fresha’s liability summary',
        theirs: 7500,
        rows: 7500,
        coming: 7500,
        behind: [],
        unreadable: 0,
        agrees: true,
      },
    ])
  })

  it('reads a list of emails and amounts as credit, as the old balances file did', () => {
    const review = reviewMoney(
      [
        file('balances.csv', [
          'email,amount,type,note',
          'amelia.carter@example.com,25.00,credit,Gift card',
          'olivia.james@example.com,10,owed,',
          'amelia.carter@example.com,5,credit,',
          'ellie.brooks@example.com,0,credit,',
        ]),
      ],
      studio(),
      [],
      none,
      'other',
      now,
    )
    expect(review.rows.map((r) => r.status)).toEqual(['ready', 'ready', 'combined', 'used'])
    expect(review.credit).toEqual([
      { client: { id: 'client-1' }, kind: 'credit', amountMinor: 3000, note: 'Gift card' },
      { client: { id: 'client-2' }, kind: 'owed', amountMinor: 1000, note: '' },
    ])
  })

  it('sends at most 200 cards or packages in each part', () => {
    expect(
      moneyParts(
        Array.from({ length: 450 }, (_, i) => i),
        200,
      ).map((p) => p.length),
    ).toEqual([200, 200, 50])
  })
})
