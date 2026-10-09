// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { cardAgreementWording } from '../src/domain/planCards'
import { planStanding } from '../src/domain/plans'
import { moneyInAndOut } from '../src/domain/accounts'
import { cashForDay } from '../src/domain/tillCount'
import { testProvider } from './messaging/providers'
import { testPaymentProvider } from './payments/providers'
import type { PayOutcome, PaymentProvider } from './payments/providers'
import type { ChargeRow } from './payments/memberships'
import type { OutboxRow } from './messaging/outbox'
import { restoreDatabase } from './backup'

// Stage 1: a membership paid each month from a saved card, in the payment provider's test mode.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string }
type Charge = {
  id: string
  status: string
  try: number
  detail: string | null
  nextTryAt: string | null
  periodStart: string
  amountMinor: number
  kind: string
}
let api: ApiHandler
let clock: number
/** Scripted answers from the provider; when empty, the test provider answers as usual. */
let charges: PayOutcome[] = []
let refunds: PayOutcome[] = []
let calls: { kind: 'charge' | 'refund'; attemptId: string; amountMinor: number }[] = []
let folder = ''

function provider(): PaymentProvider {
  const base = testPaymentProvider(origin)
  return {
    ...base,
    async chargeSaved(input) {
      calls.push({ kind: 'charge', attemptId: input.attemptId, amountMinor: input.amountMinor })
      return charges.shift() ?? base.chargeSaved(input)
    },
    async refund(input) {
      calls.push({ kind: 'refund', attemptId: input.attemptId, amountMinor: input.amountMinor })
      return refunds.shift() ?? base.refund(input)
    },
  }
}
function start(databasePath = ':memory:') {
  api = createApiHandler({
    origin,
    databasePath,
    now: () => clock,
    turnstile: null,
    providers: { email: testProvider('email'), sms: testProvider('sms'), receipt: () => null },
    paymentProvider: provider(),
  })
}
beforeEach(() => {
  // 07:00Z on 6 October is 08:00 in London.
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  charges = []
  refunds = []
  calls = []
  start()
})
afterEach(() => {
  api.close()
  if (folder) rmSync(folder, { recursive: true, force: true })
  folder = ''
})

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email: string, invitation?: string, sample = false) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: invitation ? 'Team Member' : 'Ada Owner',
      email,
      password,
      ...(invitation
        ? { invitation }
        : {
            workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample },
          }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
}
const get = (login: Login, path = '') =>
  api.inject({ url: `/api/workspaces/${login.orgId}${path}`, headers: headers(login) })
const post = (login: Login, path: string, payload: unknown, extra: Record<string, string> = {}) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: { ...headers(login), ...extra },
    payload,
  })
const studio = async (login: Login) => (await get(login)).json<{ state: BusinessState }>().state
async function send(login: Login, owner: Login, command: Command) {
  const { revision } = await studio(owner)
  return post(login, '/commands', { revision, command }, { 'idempotency-key': crypto.randomUUID() })
}
async function run(login: Login, command: Command) {
  const response = await send(login, login, command)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
async function member(owner: Login, email: string, role: string, extra: object = {}) {
  const invitation = await post(owner, '/invitations', { email, role, ...extra })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}

/** A real studio with Rosa holding the £75 Facial club, sold today for cash, and a saved card. */
async function studioWithMember(last4 = '4242', sample = false) {
  const owner = await register('owner@example.invalid', undefined, sample)
  let state = await studio(owner)
  let serviceId = state.services[0]?.id
  if (!sample)
    serviceId = await run(owner, {
      type: 'service',
      input: {
        name: 'Restorative facial',
        description: 'A fictional treatment',
        category: 'Skin',
        durationMinutes: 60,
        bufferMinutes: 15,
        priceMinor: 9500,
        depositMinor: 0,
        resourceType: 'treatment',
      },
    })
  const clientId = sample
    ? state.clients[0].id
    : await run(owner, {
        type: 'client',
        contact: {
          name: 'Rosa Okafor',
          email: 'rosa@example.invalid',
          phone: '+44 7700 900333',
          marketingConsent: false,
        },
      })
  await run(owner, {
    type: 'offer',
    input: {
      kind: 'membership',
      name: 'Facial club',
      serviceIds: [serviceId!],
      visits: 1,
      priceMinor: 7500,
      discountPercent: 10,
      validMonths: 1,
      archived: false,
    },
  })
  state = await studio(owner)
  const holdingId = await run(owner, {
    type: 'plan-sell',
    offerId: state.offers!.at(-1)!.id,
    clientId,
    method: sample ? 'demo_cash' : 'cash',
  })
  return { owner, clientId, holdingId, cardId: savedCard(owner.orgId, clientId, last4) }
}
/** A card the client saved from the link to their visit, as the provider would leave it. */
function savedCard(orgId: string, clientId: string, last4: string) {
  const cardId = crypto.randomUUID()
  api.database.run(
    `INSERT INTO saved_cards(id,organisation_id,client_id,provider,customer_ref,method_ref,brand,last4,exp_month,exp_year,agreed,created_at)
     VALUES(?,?,?,'test',?,?,'Visa',?,12,2029,'Saved for visits.',?)`,
    cardId,
    orgId,
    clientId,
    `test_customer_${clientId}`,
    `test_card_${cardId}`,
    last4,
    clock,
  )
  return cardId
}
const holdingIn = (state: BusinessState, id: string) => state.holdings!.find((h) => h.id === id)!
async function wordingFor(login: Login, holdingId: string, last4 = '4242') {
  const state = await studio(login)
  return cardAgreementWording(state, holdingIn(state, holdingId), { brand: 'Visa', last4 })
}
async function setUp(login: Login, holdingId: string, cardId: string, last4 = '4242') {
  return post(login, `/plan-cards/${holdingId}`, {
    cardId,
    wording: await wordingFor(login, holdingId, last4),
    agreed: true,
  })
}
/** Moves the clock; sessions are kept alive so the same people can look after the jump. */
const move = (when: string) => {
  clock = Date.parse(when)
  api.database.run('UPDATE sessions SET expires_at=?', clock + 12 * 60 * 60 * 1000)
}
const at = async (when: string) => {
  move(when)
  await api.memberships.tick()
}
/** The reminder three days before, then the due date at 09:00. */
const due = async (month: string) => {
  await at(`${month}-03T10:00:00.000Z`)
  await at(`${month}-06T09:00:00.000Z`)
}
const rows = () =>
  api.database.all<ChargeRow>('SELECT * FROM membership_charges ORDER BY created_at,try_number')
const outbox = () => api.database.all<OutboxRow>('SELECT * FROM outbox ORDER BY created_at,channel')
const list = async (login: Login, query = '') =>
  (await get(login, `/plan-cards${query}`)).json<{
    provider: { live: boolean }
    held: boolean
    cards: { id: string; last4: string }[]
    charges: Charge[]
  }>()

describe('memberships paid from a saved card (Stage 1)', () => {
  it('records the agreement, reminds three days before and takes the month once', async () => {
    const { owner, clientId, holdingId, cardId } = await studioWithMember()
    const wording = await wordingFor(owner, holdingId)
    expect(wording).toBe(
      'Rosa Okafor agrees that Linden Studio may take £75.00 from their Visa card ending 4242 on the 6th of each month for Facial club, until they cancel. They will get a reminder three days before each payment.',
    )
    // The page must show the words and the staff member must confirm the client agreed.
    expect((await post(owner, `/plan-cards/${holdingId}`, { cardId, wording })).statusCode).toBe(
      400,
    )
    expect(
      (
        await post(owner, `/plan-cards/${holdingId}`, {
          cardId,
          wording: `${wording} Also more.`,
          agreed: true,
        })
      ).statusCode,
    ).toBe(422)
    const done = await setUp(owner, holdingId, cardId)
    expect(done.statusCode, done.body).toBe(200)
    let state = await studio(owner)
    const agreement = holdingIn(state, holdingId).cardAgreements![0]
    expect(agreement).toMatchObject({
      cardId,
      brand: 'Visa',
      last4: '4242',
      wording,
      agreedAt: '2026-10-06T07:00:00.000Z',
      recordedBy: 'Ada Owner',
      // Sold today and paid for this month by hand, so the card first pays on 6 November.
      startsOn: '2026-11-06',
    })
    expect(state.events.find((e) => e.title === 'Card payments set up')!.detail).toContain(
      'starting Friday 6 November',
    )
    // Setting it up again with the same card changes nothing.
    expect((await setUp(owner, holdingId, cardId)).statusCode).toBe(200)
    expect(holdingIn(await studio(owner), holdingId).cardAgreements).toHaveLength(1)

    // Nothing happens before the reminder window, then one reminder by email and one by text.
    await at('2026-11-02T12:00:00.000Z')
    expect(outbox()).toEqual([])
    await at('2026-11-03T08:30:00.000Z')
    expect(outbox()).toEqual([])
    await at('2026-11-03T09:30:00.000Z')
    await at('2026-11-03T11:30:00.000Z')
    const reminders = outbox()
    expect(reminders.map((r) => [r.kind, r.channel, r.status])).toEqual([
      ['plan_reminder', 'email', 'pending'],
      ['plan_reminder', 'sms', 'pending'],
    ])
    expect(reminders[0]).toMatchObject({
      client_id: clientId,
      recipient: 'rosa@example.invalid',
      subject: 'Your Facial club payment on 6 November',
    })
    expect(reminders[0].body).toContain(
      'On Friday 6 November, Linden Studio will take £75.00 from your Visa card ending 4242 for Facial club',
    )
    expect(reminders[0].body).toContain('please contact us before then')
    // Test mode writes it down and never claims it went.
    await api.outbox.tick()
    expect(outbox().map((r) => r.status)).toEqual(['test', 'test'])
    const messages = (await get(owner, `/outbox?clientId=${clientId}`)).json<{
      messages: { kind: string }[]
    }>().messages
    expect(messages.map((m) => m.kind)).toContain('plan_reminder')

    // Not before 09:00 on the due date, then once.
    await at('2026-11-06T08:59:00.000Z')
    expect(rows()).toEqual([])
    await at('2026-11-06T09:00:00.000Z')
    await at('2026-11-06T09:05:00.000Z')
    await at('2026-11-07T10:00:00.000Z')
    expect(calls).toHaveLength(1)
    const [row] = rows()
    expect(row).toMatchObject({
      kind: 'charge',
      period_start: '2026-11-06',
      amount_minor: 7500,
      card_id: cardId,
      card_last4: '4242',
      try_number: 1,
      status: 'succeeded',
      next_try_at: null,
    })
    // The attempt's own id is the provider's idempotency key.
    expect(calls[0].attemptId).toBe(row.id)
    state = await studio(owner)
    const holding = holdingIn(state, holdingId)
    const paid = holding.payments.at(-1)!
    expect(paid).toMatchObject({
      method: 'card',
      amountMinor: 7500,
      periodStart: '2026-11-06',
      processor: { provider: 'test', live: false },
      reference: row.provider_ref,
    })
    expect(row.ledger_id).toBe(paid.id)
    expect(holding.paidUntil).toBe('2026-12-06')
    expect(planStanding(holding, '2026-11-07').state).toBe('active')
    expect(
      state.events.find((e) => e.title === 'Membership paid' && e.detail.includes('November'))!
        .detail,
    ).toContain(
      'Test payment, no money moved. Taken from the saved Visa card ending 4242 in test mode.',
    )
    // Card takings are never expected in the till, and the accountant sees a test card payment.
    expect(cashForDay(state, '2026-11-06').cashIn).toBe(0)
    expect(moneyInAndOut(state, '2026-11-06', '2026-11-06')).toEqual([
      expect.objectContaining({
        kind: 'Membership',
        method: 'card',
        amountMinor: 7500,
        test: true,
      }),
    ])
    const view = await list(owner, `?clientId=${clientId}`)
    expect(view.charges).toEqual([
      expect.objectContaining({ status: 'succeeded', periodStart: '2026-11-06', try: 1 }),
    ])
    expect(view.cards.map((c) => c.last4)).toEqual(['4242'])
  })

  it('tries a declined card again 1, 3 and 7 days later, then stops and tells the client', async () => {
    const { owner, holdingId, cardId } = await studioWithMember('0002')
    expect((await setUp(owner, holdingId, cardId, '0002')).statusCode).toBe(200)
    await due('2026-11')
    let [first] = rows()
    expect(first).toMatchObject({ status: 'failed', try_number: 1 })
    expect(first.detail).toContain('declined')
    expect(first.next_try_at).toBe(Date.parse('2026-11-07T09:00:00.000Z'))
    let state = await studio(owner)
    expect(state.events.find((e) => e.title === 'Membership card payment declined')!.detail).toBe(
      'Facial club: £75.00 for the month from Friday 6 November was declined on the Visa card ending 0002. SALEANE will try again on Saturday 7 November.',
    )
    // The record stays unpaid and nothing was charged twice.
    expect(planStanding(holdingIn(state, holdingId), '2026-11-06').state).toBe('unpaid')
    await at('2026-11-07T08:59:00.000Z')
    expect(rows()).toHaveLength(1)
    await at('2026-11-07T09:00:00.000Z')
    await at('2026-11-09T09:00:00.000Z')
    await at('2026-11-13T09:00:00.000Z')
    await at('2026-11-20T09:00:00.000Z')
    const tries = rows()
    expect(tries.map((r) => [r.try_number, r.status, r.next_try_at])).toEqual([
      [1, 'failed', null],
      [2, 'failed', null],
      [3, 'failed', null],
      [4, 'failed', null],
    ])
    expect(tries.map((r) => new Date(r.created_at).toISOString().slice(0, 10))).toEqual([
      '2026-11-06',
      '2026-11-07',
      '2026-11-09',
      '2026-11-13',
    ])
    expect(calls).toHaveLength(4)
    state = await studio(owner)
    expect(state.events.filter((e) => e.title === 'Membership card payment declined')).toHaveLength(
      3,
    )
    expect(
      state.events.find((e) => e.title === 'Membership card payments stopped for the month')!
        .detail,
    ).toContain('was declined four times on the Visa card ending 0002, so SALEANE stopped trying')
    expect(planStanding(holdingIn(state, holdingId), '2026-11-20').state).toBe('unpaid')
    const notes = outbox().filter((r) => r.kind === 'plan_declined')
    expect(notes.map((r) => r.channel)).toEqual(['email', 'sms'])
    expect(notes[0].subject).toBe('Your Facial club payment did not go through')
    expect(notes[0].body).toContain(
      'Please contact us to pay for this month or to use another card',
    )
    // Staff see the stop and when each try was.
    first = rows()[0]
    expect((await list(owner)).charges.map((c) => c.status)).toEqual([
      'failed',
      'failed',
      'failed',
      'failed',
    ])
    expect(first.detail).toContain('declined')
  })

  it('stops further tries once the month is paid by hand, the card is removed or it is turned off', async () => {
    const { owner, holdingId, cardId } = await studioWithMember('0002')
    expect((await setUp(owner, holdingId, cardId, '0002')).statusCode).toBe(200)
    await due('2026-11')
    expect(rows()[0].next_try_at).not.toBeNull()
    // Paid by hand at the desk before the next try.
    await run(owner, { type: 'plan-renew', holdingId, method: 'cash' })
    await at('2026-11-07T09:00:00.000Z')
    expect(calls).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ next_try_at: null })
    expect(rows()[0].detail).toContain('No more tries: This month has been paid another way.')

    // December: declined, then the card is removed; no further try.
    await due('2026-12')
    expect(calls).toHaveLength(2)
    const removed = await post(owner, `/cards/${cardId}/remove`, {})
    expect(removed.statusCode, removed.body).toBe(200)
    const state = await studio(owner)
    expect(holdingIn(state, holdingId).cardAgreements![0]).toMatchObject({
      endReason: 'card_removed',
      endedBy: 'Ada Owner',
    })
    expect(state.events.some((e) => e.detail.includes('ending 0002 was removed'))).toBe(true)
    await at('2026-12-07T09:00:00.000Z')
    expect(calls).toHaveLength(2)
    expect(rows().at(-1)!.detail).toContain('No more tries: Card payments were turned off.')
  })

  it('never takes a month whose reminder did not go out, and reminds before the next', async () => {
    const { owner, holdingId, cardId } = await studioWithMember()
    expect((await setUp(owner, holdingId, cardId)).statusCode).toBe(200)
    // The server was off for the three days before 6 November.
    await at('2026-11-06T09:00:00.000Z')
    await at('2026-11-07T09:00:00.000Z')
    expect(calls).toEqual([])
    const [row] = rows()
    expect(row).toMatchObject({ status: 'failed', try_number: 1, next_try_at: null })
    expect(row.detail).toContain('Not taken: no reminder went out three days before')
    let state = await studio(owner)
    expect(state.events.find((e) => e.title === 'Membership card payment not taken')!.detail).toBe(
      'Facial club: £75.00 for the month from Friday 6 November was not taken from the Visa card ending 4242, because no reminder went out three days before. The month stays unpaid until it is paid by hand.',
    )
    expect(planStanding(holdingIn(state, holdingId), '2026-11-07').state).toBe('unpaid')
    const view = await list(owner, `?clientId=${(await studio(owner)).clients[0].id}`)
    expect(view.charges[0]).toMatchObject({ status: 'failed', nextTryAt: null })
    // November stays unpaid, and December is still reminded about before it is taken.
    await at('2026-12-03T10:00:00.000Z')
    expect(
      outbox()
        .filter((r) => r.kind === 'plan_reminder')
        .map((r) => r.slot),
    ).toEqual([`${holdingId}:2026-12-06`, `${holdingId}:2026-12-06`])
    await at('2026-12-06T09:00:00.000Z')
    expect(calls).toHaveLength(1)
    state = await studio(owner)
    expect(holdingIn(state, holdingId).payments.at(-1)).toMatchObject({
      method: 'card',
      periodStart: '2026-12-06',
    })
  })

  it('turns card payments off on request, recorded, and never charges an ended plan', async () => {
    const { owner, holdingId, cardId } = await studioWithMember()
    expect((await setUp(owner, holdingId, cardId)).statusCode).toBe(200)
    const off = await post(owner, `/plan-cards/${holdingId}/off`, {})
    expect(off.statusCode, off.body).toBe(200)
    let state = await studio(owner)
    expect(holdingIn(state, holdingId).cardAgreements![0]).toMatchObject({
      endReason: 'turned_off',
      endedBy: 'Ada Owner',
    })
    expect(state.events.some((e) => e.title === 'Card payments turned off')).toBe(true)
    await at('2026-11-03T10:00:00.000Z')
    await at('2026-11-06T10:00:00.000Z')
    expect(rows()).toEqual([])
    expect(outbox()).toEqual([])
    // On again, then the plan ends: the agreement closes with it.
    expect((await setUp(owner, holdingId, cardId)).statusCode).toBe(200)
    await run(owner, { type: 'plan-cancel', holdingId, reason: 'Moving away' })
    state = await studio(owner)
    expect(holdingIn(state, holdingId).cardAgreements!.at(-1)).toMatchObject({
      endReason: 'plan_ended',
    })
    await at('2026-12-06T10:00:00.000Z')
    expect(rows()).toEqual([])
  })

  it('keeps an unclear answer for staff to check again, and never tries it by itself', async () => {
    const { owner, holdingId, cardId } = await studioWithMember()
    expect((await setUp(owner, holdingId, cardId)).statusCode).toBe(200)
    charges = [
      { status: 'unknown', detail: 'The connection dropped before the provider answered.' },
    ]
    await due('2026-11')
    const [row] = rows()
    expect(row.status).toBe('unknown')
    await at('2026-11-07T09:00:00.000Z')
    expect(calls).toHaveLength(1)
    // Nothing is recorded by hand for the month while the card's answer is unclear.
    const byHand = await send(owner, owner, { type: 'plan-renew', holdingId, method: 'cash' })
    expect(byHand.statusCode).toBe(409)
    expect(byHand.json<{ error: string }>().error).toContain('Check it first')
    const turnOff = await post(owner, `/plan-cards/${holdingId}/off`, {})
    expect(turnOff.statusCode).toBe(409)
    // Nor is the card taken off file until the unclear payment is checked.
    const remove = await post(owner, `/cards/${cardId}/remove`, {})
    expect(remove.statusCode).toBe(409)
    expect(remove.json<{ error: string }>().error).toBe(
      'A membership payment from this card is still under way or unclear. Check it first.',
    )
    // "Check again" asks the same request under the same key.
    const checked = await post(owner, `/plan-cards/charges/${row.id}/check`, {})
    expect(checked.statusCode, checked.body).toBe(200)
    expect(checked.json<Charge>().status).toBe('succeeded')
    expect(calls.map((c) => c.attemptId)).toEqual([row.id, row.id])
    const holding = holdingIn(await studio(owner), holdingId)
    expect(holding.payments.filter((p) => p.periodStart === '2026-11-06')).toHaveLength(1)
  })

  it('keeps money taken for a membership that ended mid-charge for review, never forced in', async () => {
    const { owner, holdingId, cardId } = await studioWithMember()
    expect((await setUp(owner, holdingId, cardId)).statusCode).toBe(200)
    charges = [{ status: 'processing', providerRef: 'pi_slow' }]
    await due('2026-11')
    expect(rows()[0].status).toBe('processing')
    // The confirmation arrives as a provider event after the plan was ended elsewhere.
    const state = await studio(owner)
    const holding = holdingIn(state, holdingId)
    holding.status = 'cancelled'
    holding.cancelled = { at: '2026-11-06T09:01:00.000Z', actor: 'Test', reason: 'Ended' }
    holding.cardAgreements![0] = {
      ...holding.cardAgreements![0],
      endedAt: '2026-11-06T09:01:00.000Z',
      endedBy: 'Test',
      endReason: 'plan_ended',
    }
    state.revision += 1
    api.database.run(
      'UPDATE organisations SET state=?,revision=? WHERE id=?',
      JSON.stringify(state),
      state.revision,
      owner.orgId,
    )
    expect(
      api.memberships.apply({
        attemptId: rows()[0].id,
        providerRef: 'pi_slow',
        status: 'succeeded',
      }),
    ).toBe(true)
    expect(rows()[0].status).toBe('review')
    expect(rows()[0].detail).toContain(
      'The test payment went through but could not be added to the membership: This plan has already ended.',
    )
  })

  it('refunds a card-paid month to the card when the membership ends, once confirmed', async () => {
    const { owner, holdingId, cardId } = await studioWithMember()
    expect((await setUp(owner, holdingId, cardId)).statusCode).toBe(200)
    await due('2026-11')
    expect(rows()[0].status).toBe('succeeded')
    move('2026-11-10T10:00:00.000Z')
    // By hand is refused: a card-paid month goes back to the card.
    const byHand = await send(owner, owner, {
      type: 'plan-cancel',
      holdingId,
      reason: 'Moving away',
      refundMinor: 7500,
      method: 'cash',
      reference: 'CASH-1',
    })
    expect(byHand.statusCode).toBe(422)
    expect(byHand.json<{ error: string }>().error).toContain('goes back to that card')
    const key = crypto.randomUUID()
    const end = (refundMinor: number, k = key) =>
      post(
        owner,
        `/plan-cards/${holdingId}/end`,
        { reason: 'Moving away', refundMinor },
        {
          'idempotency-key': k,
        },
      )
    // The cap stays: never more than the unused part paid by card.
    expect((await end(7501, crypto.randomUUID())).statusCode).toBe(409)
    refunds = [
      { status: 'unknown', detail: 'The connection dropped before the provider answered.' },
    ]
    const first = await end(5000)
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json<Charge>()).toMatchObject({ kind: 'refund', status: 'unknown' })
    // A repeated click returns the same refund rather than starting another.
    expect((await end(5000)).json<Charge>().id).toBe(first.json<Charge>().id)
    expect(calls.filter((c) => c.kind === 'refund')).toHaveLength(1)
    let state = await studio(owner)
    expect(holdingIn(state, holdingId).status).toBe('active')
    // No second refund while the first is unclear.
    expect((await end(5000, crypto.randomUUID())).statusCode).toBe(409)
    const checked = await post(owner, `/plan-cards/charges/${first.json<Charge>().id}/check`, {})
    expect(checked.json<Charge>().status).toBe('succeeded')
    state = await studio(owner)
    const holding = holdingIn(state, holdingId)
    expect(holding.status).toBe('cancelled')
    expect(holding.refunds).toEqual([
      expect.objectContaining({
        amountMinor: 5000,
        method: 'card',
        processor: { provider: 'test', live: false },
        actor: 'Ada Owner',
      }),
    ])
    expect(state.events.find((e) => e.title === 'Membership ended')!.detail).toBe(
      'Facial club: Moving away. £50.00 returned to the Visa card ending 4242 through the payment provider. Test refund, no money moved. Card payments stopped.',
    )
    expect(moneyInAndOut(state, '2026-11-10', '2026-11-10')).toEqual([
      expect.objectContaining({ kind: 'Membership refund', amountMinor: -5000, test: true }),
    ])
    // A membership paid by hand ends as before, recorded by hand.
    const other = await studioWithMemberInSame(owner)
    const plain = await send(owner, owner, {
      type: 'plan-cancel',
      holdingId: other,
      reason: 'Moving away',
      refundMinor: 7500,
      method: 'cash',
      reference: 'CASH-2',
    })
    expect(plain.statusCode, plain.body).toBe(200)
  })

  it('lets only owners, managers and general managers at the selling location set it up', async () => {
    const { owner, holdingId, cardId } = await studioWithMember()
    let state = await studio(owner)
    const staffId = await run(owner, {
      type: 'staff',
      input: {
        name: 'Maya Lind',
        role: 'Facialist',
        serviceIds: [state.services[0].id],
        tone: 'sage',
      },
    })
    const desk = await member(owner, 'desk@example.invalid', 'reception')
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    const maya = await member(owner, 'maya@example.invalid', 'practitioner', { staffId })
    await run(owner, {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street' },
    })
    state = await studio(owner)
    const islington = state.operations!.locations![0].id
    await run(owner, {
      type: 'region',
      input: { name: 'London', locationIds: [state.organisation.locationId] },
    })
    state = await studio(owner)
    const rae = await member(owner, 'rae@example.invalid', 'regional', {
      areaId: state.operations!.regions![0].id,
    })
    const gia = await member(owner, 'gia@example.invalid', 'general', { locationId: islington })
    const wording = await wordingFor(owner, holdingId)
    const attempt = (login: Login) =>
      post(login, `/plan-cards/${holdingId}`, { cardId, wording, agreed: true })
    expect((await attempt(desk)).statusCode).toBe(403)
    expect((await attempt(maya)).statusCode).toBe(403)
    expect((await attempt(rae)).statusCode).toBe(403)
    // Sold at the main location, so not Islington's general manager's.
    const elsewhere = await attempt(gia)
    expect(elsewhere.statusCode).toBe(403)
    expect(elsewhere.json<{ error: string }>().error).toBe(
      'That membership was sold at another location.',
    )
    expect((await get(maya, '/plan-cards')).statusCode).toBe(403)
    expect((await get(rae, '/plan-cards')).statusCode).toBe(403)
    // A page's own command can never name the card or set it up.
    for (const login of [owner, manager, gia]) {
      const forged = await send(login, owner, {
        type: 'plan-card',
        holdingId,
        card: { id: cardId, brand: 'Visa', last4: '4242' },
        wording,
      })
      expect(forged.statusCode).toBe(403)
      const tried = await send(login, owner, {
        type: 'plan-card-try',
        holdingId,
        periodStart: '2026-11-06',
        amountMinor: 7500,
        try: 1,
      })
      expect(tried.statusCode).toBe(403)
      const renew = await send(login, owner, {
        type: 'plan-renew',
        holdingId,
        method: 'card',
        reference: 'pi_forged',
        periodStart: '2026-10-06',
      })
      expect(renew.statusCode).toBe(403)
    }
    expect((await attempt(manager)).statusCode).toBe(200)
    expect((await post(desk, `/plan-cards/${holdingId}/off`, {})).statusCode).toBe(403)
    expect((await post(manager, `/plan-cards/${holdingId}/off`, {})).statusCode).toBe(200)

    // A membership sold at Islington is theirs.
    const noor = await run(owner, {
      type: 'client',
      contact: {
        name: 'Noor Fictional',
        email: 'noor@example.invalid',
        phone: '+44 7700 900444',
        marketingConsent: false,
      },
    })
    const sold = await send(gia, owner, {
      type: 'plan-sell',
      offerId: state.offers![0].id,
      clientId: noor,
      method: 'cash',
      locationId: islington,
    })
    expect(sold.statusCode, sold.body).toBe(200)
    const theirs = sold.json<{ recordId: string }>().recordId
    const noorsCard = savedCard(owner.orgId, noor, '4444')
    expect((await setUp(gia, theirs, noorsCard, '4444')).statusCode).toBe(200)
    expect((await post(gia, `/plan-cards/${theirs}/off`, {})).statusCode).toBe(200)
    // The desk may still see how a membership is paid.
    expect((await get(desk, '/plan-cards')).statusCode).toBe(200)
  })

  it('checks the card is the client’s, still saved and from this server’s provider', async () => {
    const { owner, clientId, holdingId, cardId } = await studioWithMember()
    const wording = await wordingFor(owner, holdingId)
    const other = await run(owner, {
      type: 'client',
      contact: {
        name: 'Noor Fictional',
        email: 'noor@example.invalid',
        phone: '+44 7700 900444',
        marketingConsent: false,
      },
    })
    const insert = (id: string, client: string, provider: string, removed: number | null) =>
      api.database.run(
        `INSERT INTO saved_cards(id,organisation_id,client_id,provider,customer_ref,method_ref,brand,last4,exp_month,exp_year,agreed,created_at,removed_at)
         VALUES(?,?,?,?,?,?,'Visa','4242',12,2029,'Saved.',?,?)`,
        id,
        owner.orgId,
        client,
        provider,
        `c_${id}`,
        `m_${id}`,
        clock,
        removed,
      )
    insert('noors-card', other, 'test', null)
    insert('old-card', clientId, 'test', clock)
    insert('stripe-card', clientId, 'stripe', null)
    for (const id of ['noors-card', 'old-card', 'stripe-card', 'nowhere']) {
      const response = await post(owner, `/plan-cards/${holdingId}`, {
        cardId: id,
        wording,
        agreed: true,
      })
      expect(response.statusCode, id).toBe(409)
      expect(response.json<{ error: string }>().error).toBe(
        'Choose one of this client’s saved cards.',
      )
    }
    expect((await setUp(owner, holdingId, cardId)).statusCode).toBe(200)
  })

  it('never charges or reminds in a sample studio', async () => {
    const { owner, holdingId, cardId } = await studioWithMember('4242', true)
    const response = await post(owner, `/plan-cards/${holdingId}`, {
      cardId,
      wording: await wordingFor(owner, holdingId),
      agreed: true,
    })
    expect(response.statusCode).toBe(409)
    await at('2026-11-06T10:00:00.000Z')
    expect(rows()).toEqual([])
    expect(calls).toEqual([])
  })

  it('marks a try cut short by a restart as unclear, and holds card payments after a restore', async () => {
    folder = mkdtempSync(join(tmpdir(), 'saleane-plan-cards-'))
    api.close()
    start(join(folder, 'live.sqlite'))
    const { owner, holdingId, cardId } = await studioWithMember()
    expect((await setUp(owner, holdingId, cardId)).statusCode).toBe(200)
    await at('2026-11-03T10:00:00.000Z')
    // The server stops while the provider is still answering.
    let release!: () => void
    charges = []
    const waiting = new Promise<void>((resolve) => (release = resolve))
    const slow = provider()
    const original = slow.chargeSaved
    api.close()
    api = createApiHandler({
      origin,
      databasePath: join(folder, 'live.sqlite'),
      now: () => clock,
      turnstile: null,
      providers: { email: testProvider('email'), sms: testProvider('sms'), receipt: () => null },
      paymentProvider: {
        ...slow,
        async chargeSaved(input) {
          await waiting
          return original(input)
        },
      },
    })
    clock = Date.parse('2026-11-06T09:00:00.000Z')
    const pass = api.memberships.tick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(rows()[0].status).toBe('started')
    api.close()
    release()
    await pass.catch(() => null)
    start(join(folder, 'live.sqlite'))
    clock = Date.parse('2026-11-06T09:10:00.000Z')
    await api.memberships.tick()
    expect(rows()).toHaveLength(1)
    expect(rows()[0].status).toBe('unknown')
    expect(rows()[0].detail).toContain('Check again')
    // A backup restored later holds card payments until the team checks the provider.
    api.close()
    const restored = join(folder, 'restored.sqlite')
    const result = restoreDatabase(join(folder, 'live.sqlite'), restored)
    expect(result).toMatchObject({ membershipCardPaymentsHeld: 1 })
    start(restored)
    const login = await api.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'owner@example.invalid', password },
    })
    const again = { ...login.json<{ csrf: string }>(), cookie: cookie(login), orgId: owner.orgId }
    expect((await list(again)).held).toBe(true)
    await at('2026-12-06T10:00:00.000Z')
    expect(rows()).toHaveLength(1)
    const resumed = await post(again, '/plan-cards/resume', {})
    expect(resumed.statusCode, resumed.body).toBe(200)
    expect((await list(again)).held).toBe(false)
  })
})

/** A second membership for Rosa in the same studio, sold and paid by hand. */
async function studioWithMemberInSame(owner: Login) {
  let state = await studio(owner)
  await run(owner, {
    type: 'offer',
    input: {
      kind: 'membership',
      name: 'Brow club',
      serviceIds: [state.services[0].id],
      visits: 1,
      priceMinor: 7500,
      discountPercent: 0,
      validMonths: 1,
      archived: false,
    },
  })
  state = await studio(owner)
  return run(owner, {
    type: 'plan-sell',
    offerId: state.offers!.at(-1)!.id,
    clientId: state.clients[0].id,
    method: 'cash',
  })
}
