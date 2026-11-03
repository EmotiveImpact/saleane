import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can } from './operations'
import type { Role } from './operations'
import { branchRefusal } from './branch'
import { createWorkspace } from './workspace'
import { seed } from './seed'
import { holdings, openCardAgreement } from './plans'
import {
  cardAgreementWording,
  cardChargeProblem,
  cardMonthDue,
  dueDayWords,
  firstCardMonth,
  nextCardPayment,
  nextTryAt,
  ordinal,
  planCardChannels,
  planCardMessage,
  reminderWindow,
  upcomingCardPayment,
} from './planCards'
import { moneyInAndOut } from './accounts'
import { cashForDay } from './tillCount'
import { clientExport } from './privacy'
import { changeWords } from './changeRecord'

// Stage 1: a membership paid each month from a saved card. The server takes the money; these
// rules decide what is due, what the client agreed to and what the record may hold.
const now = '2026-10-06T08:00:00.000Z'
const test = { provider: 'test', live: false }
const visa = { id: 'card-1', brand: 'Visa', last4: '4242' }
let sequence = 0
function local(): BusinessState {
  const s = createWorkspace({ name: 'Linden Studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `card-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const club = {
  kind: 'membership' as const,
  name: 'Facial club',
  serviceIds: ['service-facial'],
  visits: 1,
  priceMinor: 7500,
  discountPercent: 10,
  validMonths: 1,
  archived: false,
}
/** Amelia's Facial club, sold on 6 October for cash. */
function member(input = club, sold = now) {
  let s = apply(local(), { type: 'offer', input })
  s = apply(
    s,
    { type: 'plan-sell', offerId: s.offers![0].id, clientId: 'client-1', method: 'cash' },
    sold,
  )
  return { s, holdingId: holdings(s)[0].id }
}
function withCard(card = visa, at = now) {
  const { s, holdingId } = member()
  const holding = holdings(s)[0]
  return {
    s: apply(
      s,
      {
        type: 'plan-card',
        holdingId,
        card,
        wording: cardAgreementWording(s, holding, card),
      },
      at,
    ),
    holdingId,
  }
}
const holdingOf = (s: BusinessState) => holdings(s)[0]
const cardMonth = (holdingId: string, periodStart: string, reference = `pi_${periodStart}`) =>
  ({
    type: 'plan-renew',
    holdingId,
    method: 'card',
    reference,
    processor: test,
    periodStart,
  }) as Command

describe('the words a client agrees to', () => {
  it('names the client, studio, amount, card, day, membership and the reminder', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30, 31].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '30th',
      '31st',
    ])
    const { s } = member()
    expect(cardAgreementWording(s, holdingOf(s), visa)).toBe(
      'Amelia Carter agrees that Linden Studio may take £75.00 from their Visa card ending 4242 on the 6th of each month for Facial club, until they cancel. They will get a reminder three days before each payment.',
    )
    // A day some months do not have says what happens in those months.
    expect(dueDayWords({ startedOn: '2026-01-31' })).toBe(
      'the 31st of each month (or the last day of a shorter month)',
    )
    expect(dueDayWords({ startedOn: '2026-01-28' })).toBe('the 28th of each month')
  })

  it('keeps the card, the exact words, when and who, and refuses words that differ', () => {
    const { s, holdingId } = member()
    const wording = cardAgreementWording(s, holdingOf(s), visa)
    const changed = run(s, {
      type: 'plan-card',
      holdingId,
      card: visa,
      wording: wording.replace('£75.00', '£70.00'),
    })
    expect(changed.ok).toBe(false)
    if (!changed.ok)
      expect(changed.error).toBe('The wording to agree has changed. Read it to the client again.')
    const done = dispatch(
      s,
      { type: 'plan-card', holdingId, card: visa, wording },
      'Ada Owner',
      now,
    )
    if (!done.ok) throw new Error(done.error)
    const agreement = openCardAgreement(holdingOf(done.state))!
    expect(agreement).toMatchObject({
      cardId: 'card-1',
      brand: 'Visa',
      last4: '4242',
      wording,
      agreedAt: now,
      recordedBy: 'Ada Owner',
      startsOn: '2026-11-06',
    })
    expect(done.state.events.at(-1)).toMatchObject({
      title: 'Card payments set up',
      detail:
        'Facial club: £75.00 from the Visa card ending 4242 on the 6th of each month, starting Friday 6 November. The client agreed to the words shown.',
    })
    // The same card again changes nothing; another card replaces it, and both stay on record.
    const again = run(done.state, { type: 'plan-card', holdingId, card: visa, wording })
    expect(again.ok && again.state).toBe(done.state)
    const other = { id: 'card-2', brand: 'Mastercard', last4: '4444' }
    const swapped = apply(done.state, {
      type: 'plan-card',
      holdingId,
      card: other,
      wording: cardAgreementWording(done.state, holdingOf(done.state), other),
    })
    expect(holdingOf(swapped).cardAgreements!.map((a) => [a.last4, a.endReason])).toEqual([
      ['4242', 'replaced'],
      ['4444', undefined],
    ])
  })

  it('needs a way to remind the client before each payment', () => {
    const { s, holdingId } = member()
    const unreachable = structuredClone(s)
    unreachable.clients[0] = { ...unreachable.clients[0], email: '', noTextReminders: true }
    const refused = run(unreachable, {
      type: 'plan-card',
      holdingId,
      card: visa,
      wording: cardAgreementWording(unreachable, holdingOf(unreachable), visa),
    })
    expect(!refused.ok && refused.error).toBe(
      'Add the client’s email address, or a mobile number they allow texts on, so they can be reminded before each payment.',
    )
  })

  it('applies to memberships of real studios only, while they run', () => {
    let s = apply(local(), {
      type: 'offer',
      input: {
        ...club,
        kind: 'package',
        name: 'Five facials',
        visits: 5,
        discountPercent: 0,
        validMonths: 6,
      },
    })
    s = apply(s, {
      type: 'plan-sell',
      offerId: s.offers![0].id,
      clientId: 'client-1',
      method: 'cash',
    })
    const pkg = holdingOf(s)
    const refused = run(s, {
      type: 'plan-card',
      holdingId: pkg.id,
      card: visa,
      wording: cardAgreementWording(s, pkg, visa),
    })
    expect(!refused.ok && refused.error).toBe('Only a membership is paid month by month.')
    const { s: ended, holdingId } = member()
    const cancelled = apply(ended, { type: 'plan-cancel', holdingId, reason: 'Moving away' })
    const late = run(cancelled, {
      type: 'plan-card',
      holdingId,
      card: visa,
      wording: cardAgreementWording(cancelled, holdingOf(cancelled), visa),
    })
    expect(late.ok).toBe(false)
    const { s: sample, holdingId: theirs } = member()
    sample.operations = { ...sample.operations!, mode: 'sandbox' }
    const demo = run(sample, {
      type: 'plan-card',
      holdingId: theirs,
      card: visa,
      wording: cardAgreementWording(sample, holdingOf(sample), visa),
    })
    expect(!demo.ok && demo.error).toBe('Sample studios never take card payments.')
  })

  it('is turned off on request, recorded, and stays off when the plan ends', () => {
    const { s, holdingId } = withCard()
    const off = dispatch(
      s,
      { type: 'plan-card', holdingId, reason: 'turned_off' },
      'Ben Manager',
      now,
    )
    if (!off.ok) throw new Error(off.error)
    expect(holdingOf(off.state).cardAgreements![0]).toMatchObject({
      endReason: 'turned_off',
      endedBy: 'Ben Manager',
      endedAt: now,
    })
    expect(off.state.events.at(-1)!.title).toBe('Card payments turned off')
    // Turning it off again changes nothing.
    const again = run(off.state, { type: 'plan-card', holdingId, reason: 'turned_off' })
    expect(again.ok && again.state).toBe(off.state)
    expect(nextCardPayment(holdingOf(off.state), '2026-11-06')).toBeNull()
    // Ending the plan closes an open agreement with it.
    const ended = apply(s, { type: 'plan-cancel', holdingId, reason: 'Moving away' })
    expect(holdingOf(ended).cardAgreements![0].endReason).toBe('plan_ended')
    expect(ended.events.at(-1)!.detail).toBe(
      'Facial club: Moving away. No money returned. Card payments stopped.',
    )
  })
})

describe('when the card is charged', () => {
  it('starts with the first month at least three days away, so a reminder always goes first', () => {
    const h = { startedOn: '2026-10-06' }
    expect(firstCardMonth(h, '2026-10-06')).toBe('2026-11-06')
    expect(firstCardMonth(h, '2026-11-03')).toBe('2026-11-06')
    expect(firstCardMonth(h, '2026-11-04')).toBe('2026-12-06')
    // A month shorter than the start day falls due on its last day.
    expect(firstCardMonth({ startedOn: '2026-01-31' }, '2026-02-10')).toBe('2026-02-28')
    expect(firstCardMonth({ startedOn: '2026-01-31' }, '2026-02-26')).toBe('2026-03-31')
  })

  it('reminds about the next payment ahead, even while an earlier month stays unpaid', () => {
    const { s, holdingId } = withCard()
    const h = holdingOf(s)
    expect(upcomingCardPayment(h, '2026-10-07')).toBe('2026-11-06')
    // November was not taken; on 3 December the reminder is about 6 December.
    expect(upcomingCardPayment(h, '2026-12-04')).toBe('2026-12-06')
    const reminder = planCardMessage(
      s,
      'plan_reminder',
      holdingId,
      '2026-12-06',
      'email',
      '2026-12-03T10:00:00.000Z',
    )
    expect(reminder?.subject).toBe('Your Facial club payment on 6 December')
    expect(
      planCardMessage(s, 'plan_reminder', holdingId, '2026-11-06', 'email', '2026-12-03T10:00:00Z'),
    ).toBeNull()
    const off = apply(s, { type: 'plan-card', holdingId, reason: 'turned_off' })
    expect(upcomingCardPayment(holdingOf(off), '2026-10-07')).toBeNull()
  })

  it('notes a month not taken because no reminder went out', () => {
    const { s, holdingId } = withCard()
    const missed = apply(s, {
      type: 'plan-card-try',
      holdingId,
      periodStart: '2026-11-06',
      amountMinor: 7500,
      try: 1,
      missedReminder: true,
    })
    expect(missed.events.at(-1)).toMatchObject({
      title: 'Membership card payment not taken',
      detail:
        'Facial club: £75.00 for the month from Friday 6 November was not taken from the Visa card ending 4242, because no reminder went out three days before. The month stays unpaid until it is paid by hand.',
    })
  })

  it('is due on the month’s first day from 09:00 on the studio’s clock, once', () => {
    const { s } = withCard()
    const h = holdingOf(s)
    expect(nextCardPayment(h, '2026-10-20')).toBe('2026-11-06')
    // London is on GMT in November, so 09:00 there is 09:00Z.
    expect(cardMonthDue(s, h, '2026-11-05T12:00:00.000Z')).toBeNull()
    expect(cardMonthDue(s, h, '2026-11-06T08:59:00.000Z')).toBeNull()
    expect(cardMonthDue(s, h, '2026-11-06T09:00:00.000Z')).toBe('2026-11-06')
    const paid = apply(s, cardMonth(h.id, '2026-11-06'), '2026-11-06T09:00:00.000Z')
    expect(cardMonthDue(paid, holdingOf(paid), '2026-11-06T09:05:00.000Z')).toBeNull()
    expect(nextCardPayment(holdingOf(paid), '2026-11-06')).toBe('2026-12-06')
  })

  it('tries a declined card again 1, 3 and 7 days after the first try, at 09:00', () => {
    const { s } = withCard()
    const first = '2026-11-06T09:00:00.000Z'
    expect([1, 2, 3].map((n) => nextTryAt(s, first, n)!.day)).toEqual([
      '2026-11-07',
      '2026-11-09',
      '2026-11-13',
    ])
    expect(nextTryAt(s, first, 1)!.at).toBe(Date.parse('2026-11-07T09:00:00.000Z'))
    expect(nextTryAt(s, first, 4)).toBeNull()
  })

  it('checks again before every try, so paying by hand, ending or turning off stops it', () => {
    const { s, holdingId } = withCard()
    const at = '2026-11-06T09:00:00.000Z'
    expect(cardChargeProblem(s, holdingId, '2026-11-06', 'card-1', at)).toBeNull()
    expect(cardChargeProblem(s, holdingId, '2026-11-06', 'card-2', at)).toBe(
      'Card payments were set to another card.',
    )
    expect(cardChargeProblem(s, 'nowhere', '2026-11-06', 'card-1', at)).toBe(
      'The membership is no longer in the studio record.',
    )
    expect(cardChargeProblem(s, holdingId, '2026-10-06', 'card-1', '2026-10-06T09:00:00Z')).toBe(
      'This month has been paid another way.',
    )
    expect(cardChargeProblem(s, holdingId, '2026-11-06', 'card-1', '2026-12-07T09:00:00Z')).toBe(
      'The month ended before the card could be tried again.',
    )
    const byHand = apply(s, { type: 'plan-renew', holdingId, method: 'cash' }, at)
    expect(cardChargeProblem(byHand, holdingId, '2026-11-06', 'card-1', at)).toBe(
      'This month has been paid another way.',
    )
    const off = apply(s, { type: 'plan-card', holdingId, reason: 'card_removed' }, at)
    expect(cardChargeProblem(off, holdingId, '2026-11-06', 'card-1', at)).toBe(
      'Card payments were turned off.',
    )
    expect(off.events.at(-1)!.detail).toContain('the Visa card ending 4242 was removed')
    const ended = apply(s, { type: 'plan-cancel', holdingId, reason: 'Moving away' }, at)
    expect(cardChargeProblem(ended, holdingId, '2026-11-06', 'card-1', at)).toBe(
      'The membership has ended.',
    )
    // A card set up after the reminder date waits for the following month.
    const late = withCard(visa, '2026-11-04T10:00:00.000Z')
    expect(openCardAgreement(holdingOf(late.s))!.startsOn).toBe('2026-12-06')
    expect(
      cardChargeProblem(late.s, late.holdingId, '2026-11-06', 'card-1', '2026-11-06T09:00:00Z'),
    ).toBe('Card payments start with a later month.')
  })

  it('never charges in a sample studio', () => {
    const { s, holdingId } = withCard()
    const sample = structuredClone(s)
    sample.operations = { ...sample.operations!, mode: 'sandbox' }
    expect(
      cardChargeProblem(sample, holdingId, '2026-11-06', 'card-1', '2026-11-06T09:00:00Z'),
    ).toBe('Sample studios never take card payments.')
  })
})

describe('what the record holds', () => {
  it('records a month the provider took as a card payment for that month, and nothing else', () => {
    const { s, holdingId } = withCard()
    const at = '2026-11-06T09:00:00.000Z'
    // Only with the provider's confirmation, and only naming its month.
    expect(
      run(s, { ...cardMonth(holdingId, '2026-11-06'), processor: undefined } as Command, at).ok,
    ).toBe(false)
    const unnamed = run(
      s,
      { type: 'plan-renew', holdingId, method: 'card', reference: 'pi_1', processor: test },
      at,
    )
    expect(!unnamed.ok && unnamed.error).toBe(
      'Only a card payment taken by SALEANE names its month.',
    )
    const named = run(
      s,
      { type: 'plan-renew', holdingId, method: 'cash', periodStart: '2026-11-06' },
      at,
    )
    expect(named.ok).toBe(false)
    expect(run(s, cardMonth(holdingId, '2026-12-06'), at).ok).toBe(false)
    expect(run(s, cardMonth(holdingId, '2026-11-07'), at).ok).toBe(false)
    expect(run(s, cardMonth(holdingId, '2026-09-06'), at).ok).toBe(false)
    const paid = apply(s, cardMonth(holdingId, '2026-11-06'), at)
    const h = holdingOf(paid)
    expect(h.payments.at(-1)).toMatchObject({
      method: 'card',
      amountMinor: 7500,
      periodStart: '2026-11-06',
      reference: 'pi_2026-11-06',
      processor: test,
    })
    expect(h.paidUntil).toBe('2026-12-06')
    expect(paid.events.at(-1)!.detail).toBe(
      'Facial club: £75.00 for the month from Friday 6 November. Test payment, no money moved. Taken from the saved Visa card ending 4242 in test mode.',
    )
    // The same month twice adds nothing, and a provider reference is never used twice.
    const twice = run(paid, cardMonth(holdingId, '2026-11-06', 'pi_other'), at)
    expect(twice.ok && holdingOf(twice.state).payments.length).toBe(2)
    expect(
      run(paid, cardMonth(holdingId, '2026-12-06', 'pi_2026-11-06'), '2026-12-06T09:00:00Z').ok,
    ).toBe(false)
    // Card takings never count as cash in the till; the accounts show a test card payment.
    expect(cashForDay(paid, '2026-11-06').cashIn).toBe(0)
    expect(moneyInAndOut(paid, '2026-11-06', '2026-11-06')).toEqual([
      expect.objectContaining({ method: 'card', amountMinor: 7500, test: true }),
    ])
  })

  it('accepts card payments only in that shape when the record is read back', () => {
    const { s, holdingId } = withCard()
    const paid = apply(s, cardMonth(holdingId, '2026-11-06'), '2026-11-06T09:00:00.000Z')
    expect(() => parseState(paid, 'UK')).not.toThrow()
    const noProcessor = structuredClone(paid)
    delete holdingOf(noProcessor).payments.at(-1)!.processor
    expect(() => parseState(noProcessor, 'UK')).toThrow()
    const noMonth = structuredClone(paid)
    delete holdingOf(noMonth).payments.at(-1)!.periodStart
    expect(() => parseState(noMonth, 'UK')).toThrow()
    const cashWithProcessor = structuredClone(paid)
    holdingOf(cashWithProcessor).payments[0].processor = test
    expect(() => parseState(cashWithProcessor, 'UK')).toThrow()
    const twoOpen = structuredClone(paid)
    const first = holdingOf(twoOpen).cardAgreements![0]
    holdingOf(twoOpen).cardAgreements!.push({ ...first, id: 'second' })
    expect(() => parseState(twoOpen, 'UK')).toThrow()
    const openAfterEnd = structuredClone(paid)
    holdingOf(openAfterEnd).status = 'cancelled'
    holdingOf(openAfterEnd).cancelled = { at: now, actor: 'Test', reason: 'Ended' }
    expect(() => parseState(openAfterEnd, 'UK')).toThrow()
    const endedNoReason = structuredClone(paid)
    holdingOf(endedNoReason).cardAgreements![0].endedAt = now
    expect(() => parseState(endedNoReason, 'UK')).toThrow()
  })

  it('returns a card-paid month to the card through the provider, capped, never by hand', () => {
    const { s, holdingId } = withCard()
    const paid = apply(s, cardMonth(holdingId, '2026-11-06'), '2026-11-06T09:00:00.000Z')
    const at = '2026-11-10T10:00:00.000Z'
    const byHand = run(
      paid,
      {
        type: 'plan-cancel',
        holdingId,
        reason: 'Moving away',
        refundMinor: 5000,
        method: 'cash',
        reference: 'CASH-1',
      },
      at,
    )
    expect(!byHand.ok && byHand.error).toBe(
      'This month was paid by card through SALEANE, so the money goes back to that card.',
    )
    const refund = (refundMinor: number) =>
      run(
        paid,
        {
          type: 'plan-cancel',
          holdingId,
          reason: 'Moving away',
          refundMinor,
          method: 'card',
          reference: 're_1',
          processor: test,
        },
        at,
      )
    expect(refund(7501).ok).toBe(false)
    const done = refund(5000)
    if (!done.ok) throw new Error(done.error)
    const h = holdingOf(done.state)
    expect(h.refunds[0]).toMatchObject({ method: 'card', amountMinor: 5000, processor: test })
    expect(h.cardAgreements![0].endReason).toBe('plan_ended')
    expect(done.state.events.at(-1)!.detail).toBe(
      'Facial club: Moving away. £50.00 returned to the Visa card ending 4242 through the payment provider. Test refund, no money moved. Card payments stopped.',
    )
    expect(moneyInAndOut(done.state, '2026-11-10', '2026-11-10')).toEqual([
      expect.objectContaining({ kind: 'Membership refund', amountMinor: -5000, test: true }),
    ])
    // A month paid by hand is never refunded to a card.
    const { s: plain, holdingId: other } = member()
    const toCard = run(
      plain,
      {
        type: 'plan-cancel',
        holdingId: other,
        reason: 'Moving away',
        refundMinor: 5000,
        method: 'card',
        reference: 're_2',
        processor: test,
      },
      '2026-10-10T10:00:00.000Z',
    )
    expect(!toCard.ok && toCard.error).toBe(
      'Only a month paid by card through SALEANE goes back to the card, up to what it paid.',
    )
  })

  it('notes each declined try in the client’s timeline', () => {
    const { s, holdingId } = withCard()
    const declined = apply(s, {
      type: 'plan-card-try',
      holdingId,
      periodStart: '2026-11-06',
      amountMinor: 7500,
      try: 1,
      nextTryOn: '2026-11-07',
    })
    expect(declined.events.at(-1)).toMatchObject({
      title: 'Membership card payment declined',
      detail:
        'Facial club: £75.00 for the month from Friday 6 November was declined on the Visa card ending 4242. SALEANE will try again on Saturday 7 November.',
    })
    const stopped = apply(s, {
      type: 'plan-card-try',
      holdingId,
      periodStart: '2026-11-06',
      amountMinor: 7500,
      try: 4,
    })
    expect(stopped.events.at(-1)!.detail).toBe(
      'Facial club: £75.00 for the month from Friday 6 November was declined four times on the Visa card ending 4242, so SALEANE stopped trying. The month stays unpaid until it is paid by hand.',
    )
    expect(changeWords['plan-card-try'][1]).toBe('Noted a declined card payment for a membership')
  })

  it('puts what the client agreed to in their own export', () => {
    const { s } = withCard()
    const file = clientExport(s, 'client-1', {} as never)
    expect(file.plans[0]).toMatchObject({
      cardPayments: [
        {
          card: 'Visa ending 4242',
          agreed: expect.stringContaining('Amelia Carter agrees that Linden Studio'),
          agreedAt: now,
        },
      ],
    })
  })
})

describe('who may set it up', () => {
  it('is the owner, managers and general managers; a declined try is noted only by the server', () => {
    const roles: Role[] = ['owner', 'manager', 'general', 'reception', 'practitioner', 'regional']
    expect(roles.filter((r) => can(r, 'plan-card'))).toEqual(['owner', 'manager', 'general'])
    expect(roles.filter((r) => can(r, 'plan-card-try'))).toEqual([])
  })

  it('lets a general manager change only memberships sold at their location', () => {
    const { s, holdingId } = withCard()
    const home = s.organisation.locationId
    const off: Command = { type: 'plan-card', holdingId, reason: 'turned_off' }
    expect(branchRefusal(s, home, off)).toBeNull()
    expect(branchRefusal(s, 'location-elsewhere', off)).toBe(
      'That membership was sold at another location.',
    )
    expect(branchRefusal(s, home, { type: 'plan-card', holdingId: 'nowhere' })).toBe(
      'That membership was sold at another location.',
    )
  })
})

describe('messages about the card', () => {
  it('reminds by email whenever there is an address, and by text only when allowed', () => {
    const { s, holdingId } = withCard()
    const client = s.clients[0]
    expect(planCardChannels(s, client)).toEqual(['email', 'sms'])
    expect(planCardChannels(s, { ...client, noTextReminders: true })).toEqual(['email'])
    expect(planCardChannels(s, { ...client, noEmailReminders: true })).toEqual(['email', 'sms'])
    expect(planCardChannels(s, { ...client, email: '', phone: '020 7946 0000' })).toEqual([])
    const quiet = structuredClone(s)
    quiet.operations = {
      ...quiet.operations!,
      reminders: { ...quiet.operations!.reminders!, sms: false },
    }
    expect(planCardChannels(quiet, client)).toEqual(['email'])
    // Three days before, in the daytime, while the month is still unpaid.
    expect(reminderWindow(s, '2026-11-06', '2026-11-02T12:00:00.000Z')).toBe(false)
    expect(reminderWindow(s, '2026-11-06', '2026-11-03T08:59:00.000Z')).toBe(false)
    expect(reminderWindow(s, '2026-11-06', '2026-11-03T09:00:00.000Z')).toBe(true)
    expect(reminderWindow(s, '2026-11-06', '2026-11-05T18:59:00.000Z')).toBe(true)
    expect(reminderWindow(s, '2026-11-06', '2026-11-05T19:00:00.000Z')).toBe(false)
    expect(reminderWindow(s, '2026-11-06', '2026-11-06T10:00:00.000Z')).toBe(false)
    const email = planCardMessage(
      s,
      'plan_reminder',
      holdingId,
      '2026-11-06',
      'email',
      '2026-11-03T10:00:00.000Z',
    )!
    expect(email.subject).toBe('Your Facial club payment on 6 November')
    expect(email.body).toContain(
      'On Friday 6 November, Linden Studio will take £75.00 from your Visa card ending 4242 for Facial club, as you agreed.',
    )
    expect(email.body).not.toMatch(/[–—]/)
    const text = planCardMessage(
      s,
      'plan_reminder',
      holdingId,
      '2026-11-06',
      'sms',
      '2026-11-03T10:00:00.000Z',
    )!
    expect(text.body).toBe(
      'Linden Studio: on 6 November we will take £75.00 from your Visa ending 4242 for Facial club. To stop this, please contact us before then.',
    )
    // Nothing goes once the month is paid, card payments are off or the plan has ended.
    const paid = apply(s, { type: 'plan-renew', holdingId, method: 'cash' }, '2026-11-03T10:00:00Z')
    expect(
      planCardMessage(
        paid,
        'plan_reminder',
        holdingId,
        '2026-11-06',
        'email',
        '2026-11-03T10:00:00Z',
      ),
    ).toBeNull()
    const off = apply(s, { type: 'plan-card', holdingId, reason: 'turned_off' })
    expect(
      planCardMessage(
        off,
        'plan_reminder',
        holdingId,
        '2026-11-06',
        'email',
        '2026-11-03T10:00:00Z',
      ),
    ).toBeNull()
  })

  it('tells the client after the last decline, unless the month was paid since', () => {
    const { s, holdingId } = withCard()
    const at = '2026-11-13T09:00:00.000Z'
    const note = planCardMessage(s, 'plan_declined', holdingId, '2026-11-06', 'email', at)!
    expect(note.subject).toBe('Your Facial club payment did not go through')
    expect(note.body).toContain(
      'We tried to take £75.00 from your Visa card ending 4242 for Facial club, for the month from Friday 6 November, but the payment did not go through, so we have stopped trying.',
    )
    const paid = apply(s, { type: 'plan-renew', holdingId, method: 'cash' }, at)
    expect(planCardMessage(paid, 'plan_declined', holdingId, '2026-11-06', 'email', at)).toBeNull()
    const sample = structuredClone(s)
    sample.operations = { ...sample.operations!, mode: 'sandbox' }
    expect(
      planCardMessage(sample, 'plan_declined', holdingId, '2026-11-06', 'email', at),
    ).toBeNull()
  })
})
