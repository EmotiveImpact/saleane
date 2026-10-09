// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import { testBillingProvider } from './billing'
import type { PaymentProvider, PayOutcome } from './payments/providers'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { BillingSummary, BillingView } from '../src/domain/billing'

// NEXT-02: studios paying for SALEANE, in test mode.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
const DAY = 86400000
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number
const start = Date.parse('2026-10-06T07:00:00.000Z')
const trialEnd = start + 14 * DAY

function open(billingProvider?: PaymentProvider) {
  api?.close()
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    ...(billingProvider ? { billingProvider } : {}),
  })
}
beforeEach(() => {
  clock = start
  open()
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
const accounts = new Map<string, string>()
/** A real studio (or a sample one), as its owner. */
async function register(email = 'owner@example.invalid', real = true) {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password,
      workspace: { name: 'Fernleaf Rooms', locationName: 'Bath', region: 'UK', sample: !real },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  const login = { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
  accounts.set(email, login.orgId)
  return login
}
/** Signs in again: sessions last twelve hours and these tests cross weeks. */
async function signIn(email = 'owner@example.invalid'): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  })
  expect(response.statusCode, response.body).toBe(200)
  return {
    csrf: response.json<{ csrf: string }>().csrf,
    cookie: cookie(response),
    orgId: accounts.get(email)!,
  }
}
const get = (login: Login, path = '') =>
  api.inject({ url: `/api/workspaces/${login.orgId}${path}`, headers: headers(login) })
const post = (login: Login, path: string, payload: unknown = {}, extra = {}) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: { ...headers(login), ...extra },
    payload,
  })
const record = async (login: Login) =>
  (await get(login)).json<{ state: BusinessState; billing: BillingSummary | null }>()
const billing = async (login: Login) => {
  const response = await get(login, '/billing')
  expect(response.statusCode, response.body).toBe(200)
  return response.json<BillingView>()
}
const command = async (login: Login, command: Command) =>
  post(
    login,
    '/commands',
    { revision: (await record(login)).state.revision, command },
    { 'idempotency-key': crypto.randomUUID() },
  )
/** Saves a test card on the stand-in card page and says where the page sends the owner back to. */
async function saveCard(login: Login, card: '4242' | '0002') {
  const started = await post(login, '/billing/card')
  expect(started.statusCode, started.body).toBe(200)
  const { url } = started.json<{ url: string }>()
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:5173\/billing\/test-card#[0-9a-f-]{36}$/)
  const id = url.split('#')[1]
  expect((await api.inject({ url: `/api/test-billing/${id}` })).json()).toMatchObject({
    studio: 'Fernleaf Rooms',
    status: 'started',
  })
  const saved = await api.inject({
    method: 'POST',
    url: `/api/test-billing/${id}`,
    payload: { outcome: 'save', card },
  })
  expect(saved.statusCode, saved.body).toBe(200)
  return saved.json<{ next: string }>().next
}
const mail = () =>
  api.database.all<{ subject: string; status: string }>(
    "SELECT subject,status FROM account_mail WHERE kind='billing' ORDER BY created_at,rowid",
  )
const at = async (time: number) => {
  clock = time
  await api.billing.run()
}
/** A small change any studio can make: a new location, by name. */
const place = (name: string): Command => ({ type: 'location', input: { name, address: '' } })
/** A treatment, a professional and a room, with online booking on, for a guest to book. */
async function bookable(login: Login) {
  const ok = async (c: Command) => {
    const response = await command(login, c)
    expect(response.statusCode, response.body).toBe(200)
    return response.json<{ recordId: string }>().recordId
  }
  await ok({ type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const serviceId = await ok({
    type: 'service',
    input: {
      name: 'Restorative facial',
      description: 'A fictional service',
      category: 'Skin',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceMinor: 9500,
      depositMinor: 0,
      resourceType: 'treatment',
    },
  })
  const staffId = await ok({
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  const { name, locationName, address, timeZone } = (await record(login)).state.organisation
  await ok({ type: 'organisation', name, locationName, address, timeZone, bookingEnabled: true })
  return { serviceId, staffId }
}

describe('a studio’s plan (NEXT-02)', () => {
  it('starts a real studio on a free trial, and never charges a sample studio', async () => {
    const sample = await register('sample@example.invalid', false)
    expect((await record(sample)).billing).toBeNull()
    const refused = await get(sample, '/billing')
    expect(refused.statusCode).toBe(409)
    expect(refused.json<{ error: string }>().error).toBe('Sample studios are never charged.')

    const owner = await register()
    expect((await record(owner)).billing).toEqual({
      readOnly: false,
      status: 'trial',
      stopReason: null,
      trialEndsAt: trialEnd,
      hasCard: false,
    })
    const plan = await billing(owner)
    expect(plan).toMatchObject({
      status: 'trial',
      test: true,
      locations: 1,
      card: null,
      nextBill: { at: trialEnd },
      ai: { typed: { used: 0, of: 300 }, guestChats: { of: 200 }, talkSeconds: { of: 1800 } },
    })
    expect(plan.nextBill!.bill).toMatchObject({
      lines: [{ text: 'SALEANE, 1 location', quantity: 1, unitMinor: 4900, amountMinor: 4900 }],
      taxLabel: 'VAT at 20%',
      taxMinor: 980,
      totalMinor: 5880,
    })

    // The team sees only whether the studio is read only; the plan is the owner's.
    const invitation = await post(owner, '/invitations', {
      email: 'manager@example.invalid',
      role: 'manager',
    })
    const joined = await api.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Max Manager',
        email: 'manager@example.invalid',
        password,
        invitation: invitation.json<{ invitation: string }>().invitation,
      },
    })
    const manager = {
      ...joined.json<{ csrf: string }>(),
      cookie: cookie(joined),
      orgId: owner.orgId,
    }
    expect((await record(manager)).billing).toEqual({ readOnly: false })
    expect((await get(manager, '/billing')).statusCode).toBe(403)
    expect((await post(manager, '/billing/pay')).statusCode).toBe(403)
  })

  it('takes the first month when the trial ends, for each open location, then each month after', async () => {
    let owner = await register()
    expect(await saveCard(owner, '4242')).toBe('/settings?section=billing&card=saved')
    expect((await billing(owner)).card).toEqual({
      brand: 'Visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2029,
    })
    expect(
      (await command(owner, { type: 'location', input: { name: 'Clifton', address: '' } }))
        .statusCode,
    ).toBe(200)
    expect((await billing(owner)).nextBill!.bill.totalMinor).toBe(11760)
    // Twice the AI for twice the locations.
    expect((await billing(owner)).ai.typed.of).toBe(600)

    // Three days' notice, once.
    await at(trialEnd - 3 * DAY)
    await at(trialEnd - 2 * DAY)
    expect(mail()).toEqual([
      { subject: 'Your SALEANE free trial ends on 20 October 2026', status: 'test' },
    ])

    await at(trialEnd)
    owner = await signIn()
    const paid = await billing(owner)
    expect(paid).toMatchObject({
      status: 'active',
      periodStart: trialEnd,
      periodEnd: Date.parse('2026-11-20T07:00:00.000Z'),
      overdue: null,
    })
    expect(paid.invoices).toEqual([
      expect.objectContaining({
        number: 'TEST-000001',
        kind: 'month',
        status: 'paid',
        test: true,
        totalMinor: 11760,
        lines: [expect.objectContaining({ text: 'SALEANE, 2 locations', amountMinor: 9800 })],
      }),
    ])
    expect(mail().at(-1)).toEqual({
      subject: 'SALEANE bill TEST-000001 settled in test mode',
      status: 'test',
    })
    // Running again bills nothing more.
    await at(trialEnd + 60000)
    expect((await billing(owner)).invoices).toHaveLength(1)

    await at(Date.parse('2026-11-20T07:00:00.000Z'))
    owner = await signIn()
    const second = await billing(owner)
    expect(second.invoices.map((i) => [i.number, i.status])).toEqual([
      ['TEST-000002', 'paid'],
      ['TEST-000001', 'paid'],
    ])
    expect(second.periodEnd).toBe(Date.parse('2026-12-20T07:00:00.000Z'))
    // Each settled bill is in the owner's change record, as a test that moved no money.
    const changes = (await get(owner, '/changes?group=settings')).json<{
      entries: { what: string; who: string }[]
    }>().entries
    expect(changes.filter((e) => e.what.startsWith('Settled a test SALEANE bill'))).toHaveLength(2)
  })

  it('tries a declined card again, then makes the studio read only after the grace days', async () => {
    let owner = await register()
    const { serviceId, staffId } = await bookable(owner)
    await saveCard(owner, '0002')
    await at(trialEnd)
    owner = await signIn()
    let plan = await billing(owner)
    expect(plan).toMatchObject({
      status: 'overdue',
      overdue: { since: trialEnd, graceEndsAt: trialEnd + 14 * DAY, nextAttemptAt: trialEnd + DAY },
    })
    expect(plan.invoices[0]).toMatchObject({
      status: 'open',
      detail: expect.stringMatching(/0002/),
    })
    expect(mail().at(-1)!.subject).toBe('We could not take the SALEANE payment for Fernleaf Rooms')
    // The studio keeps working through the grace days.
    expect((await command(owner, place('Still open'))).statusCode).toBe(200)

    for (const [day, next] of [
      [1, 3],
      [3, 7],
    ]) {
      await at(trialEnd + day * DAY)
      owner = await signIn()
      expect((await billing(owner)).overdue!.nextAttemptAt).toBe(trialEnd + next * DAY)
    }
    await at(trialEnd + 7 * DAY)
    owner = await signIn()
    expect((await billing(owner)).overdue!.nextAttemptAt).toBeNull()
    const tries = api.database.get<{ attempts: number }>('SELECT attempts FROM studio_invoices')!
    expect(tries.attempts).toBe(4)

    await at(trialEnd + 14 * DAY)
    owner = await signIn()
    plan = await billing(owner)
    expect(plan).toMatchObject({ status: 'stopped', stopReason: 'unpaid', overdue: null })
    expect(plan.invoices[0]).toMatchObject({
      status: 'void',
      detail: 'Not charged: the studio became read only.',
    })
    expect(mail().at(-1)!.subject).toBe('Fernleaf Rooms is now read only')
    expect((await record(owner)).billing).toMatchObject({ readOnly: true, stopReason: 'unpaid' })

    // Nobody can change anything, the AI rests, and what keeps people safe still works.
    const refused = await command(owner, place('Read only'))
    expect(refused.statusCode).toBe(402)
    expect(refused.json<{ error: string }>().error).toMatch(/^This studio is read only until/)
    expect((await post(owner, '/assistant', { text: 'What is on today?' })).statusCode).toBe(402)
    expect((await get(owner, '/assistant')).json()).toMatchObject({
      usage: { allowance: { typed: 0, guestChats: 0 } },
    })
    expect((await post(owner, '/privacy/studio/export')).statusCode).toBe(200)
    // Guests can still book.
    const { slug } = (await get(owner)).json<{ slug: string }>()
    const held = await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/holds`,
      payload: { serviceId, staffId, date: '2026-11-11', startMinutes: 600 },
    })
    expect(held.statusCode, held.body).toBe(201)
    const booked = await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/book`,
      payload: {
        hold: held.json<{ hold: string }>().hold,
        contact: {
          name: 'Page Guest',
          email: 'page.guest@example.invalid',
          phone: '+44 7700 900456',
          marketingConsent: false,
        },
        policy: true,
      },
    })
    expect(booked.statusCode, booked.body).toBe(200)

    // A card that works pays a fresh month from today, and the studio opens again.
    const next = await saveCard(owner, '4242')
    expect(next).toBe('/settings?section=billing&card=saved&paid=yes')
    const back = await billing(owner)
    expect(back).toMatchObject({
      status: 'active',
      periodStart: trialEnd + 14 * DAY,
      periodEnd: Date.parse('2026-12-03T07:00:00.000Z'),
    })
    expect(back.invoices.map((i) => [i.number, i.status])).toEqual([
      ['TEST-000002', 'paid'],
      ['TEST-000001', 'void'],
    ])
    expect((await command(owner, place('Open again'))).statusCode).toBe(200)
  })

  it('makes a studio read only when its trial ends without a card, until it pays', async () => {
    await register()
    await at(trialEnd)
    const owner = await signIn()
    expect(await billing(owner)).toMatchObject({ status: 'stopped', stopReason: 'trial_ended' })
    expect(api.database.get<{ n: number }>('SELECT count(*) AS n FROM studio_invoices')!.n).toBe(0)
    expect((await post(owner, '/billing/pay')).json<{ error: string }>().error).toBe(
      'Add a card first.',
    )
    // A declined card starts nothing, and nothing is owed for trying.
    expect(await saveCard(owner, '0002')).toBe('/settings?section=billing&card=saved&paid=no')
    const declined = await billing(owner)
    expect(declined).toMatchObject({ status: 'stopped', stopReason: 'trial_ended' })
    expect(declined.invoices[0]).toMatchObject({ status: 'void' })
    expect(declined.invoices[0].detail).toMatch(/^Not charged: /)
    await saveCard(owner, '4242')
    expect((await billing(owner)).status).toBe('active')
  })

  it('adds Plus for the days left of a paid month, and lets it run to the month’s end when turned off', async () => {
    let owner = await register()
    await saveCard(owner, '4242')
    // During the trial, Plus waits for the first bill and the allowance stays as it is.
    expect((await post(owner, '/billing/plus', { on: true })).statusCode).toBe(200)
    expect(await billing(owner)).toMatchObject({ plus: false, plusNext: true })
    expect((await billing(owner)).ai.typed.of).toBe(300)
    expect((await billing(owner)).nextBill!.bill.totalMinor).toBe(10560)
    expect((await post(owner, '/billing/plus', { on: false })).statusCode).toBe(200)

    await at(trialEnd)
    // Ten days into a 31-day month.
    clock = trialEnd + 10 * DAY
    owner = await signIn()
    const added = await post(owner, '/billing/plus', { on: true })
    expect(added.statusCode, added.body).toBe(200)
    const plan = added.json<{ outcome: string; billing: BillingView }>()
    expect(plan.outcome).toBe('paid')
    expect(plan.billing).toMatchObject({ plus: true, plusNext: true })
    expect(plan.billing.ai.typed.of).toBe(800)
    expect(plan.billing.invoices[0]).toMatchObject({
      kind: 'plus',
      status: 'paid',
      // £39 for 21 of 31 days, plus VAT.
      subtotalMinor: Math.round((3900 * 21) / 31),
      lines: [expect.objectContaining({ text: 'Plus, 1 location, for the 21 days left of 31' })],
    })

    // Off: Plus lasts to the end of the paid month, and the next bill leaves it out.
    expect((await post(owner, '/billing/plus', { on: false })).statusCode).toBe(200)
    expect(await billing(owner)).toMatchObject({ plus: true, plusNext: false })
    await at(Date.parse('2026-11-20T07:00:00.000Z'))
    owner = await signIn()
    const later = await billing(owner)
    expect(later).toMatchObject({ plus: false, plusNext: false })
    expect(later.invoices[0]).toMatchObject({ kind: 'month', totalMinor: 5880 })
    expect(later.ai.typed.of).toBe(300)
  })

  it('does not add Plus when the card is declined', async () => {
    let owner = await register()
    await saveCard(owner, '4242')
    await at(trialEnd)
    owner = await signIn()
    // The card is swapped for one that will be declined.
    await saveCard(owner, '0002')
    const refused = await post(owner, '/billing/plus', { on: true })
    expect(refused.statusCode).toBe(402)
    expect(refused.json<{ error: string }>().error).toBe(
      'The card was declined, so Plus was not added. Nothing was taken.',
    )
    const plan = await billing(owner)
    expect(plan).toMatchObject({ status: 'active', plus: false, plusNext: false })
    expect(plan.invoices[0]).toMatchObject({ kind: 'plus', status: 'void' })
  })

  it('gives a month that is owed only the Plus its bill has', async () => {
    let owner = await register()
    await saveCard(owner, '4242')
    await post(owner, '/billing/plus', { on: true })
    await at(trialEnd)
    owner = await signIn()
    const paid = await billing(owner)
    expect(paid).toMatchObject({ status: 'active', plus: true })
    // Plus off for next month, then that month's payment is declined.
    await post(owner, '/billing/plus', { on: false })
    await saveCard(owner, '0002')
    await at(paid.periodEnd!)
    owner = await signIn()
    const owed = await billing(owner)
    expect(owed).toMatchObject({ status: 'overdue', plus: false, plusNext: false })
    expect(owed.nextBill!.bill.totalMinor).toBe(5880)
    expect(owed.ai.typed.of).toBe(300)
  })

  it('stops at the end of the month when asked, and keeps going when the owner changes their mind', async () => {
    let owner = await register()
    await saveCard(owner, '4242')
    expect((await post(owner, '/billing/stop', { stop: true })).statusCode).toBe(200)
    expect(await billing(owner)).toMatchObject({ cancelAtPeriodEnd: true, nextBill: null })
    expect((await post(owner, '/billing/stop', { stop: false })).statusCode).toBe(200)
    await at(trialEnd)
    owner = await signIn()
    expect((await post(owner, '/billing/stop', { stop: true })).statusCode).toBe(200)
    await at(Date.parse('2026-11-20T07:00:00.000Z'))
    owner = await signIn()
    const stopped = await billing(owner)
    expect(stopped).toMatchObject({ status: 'stopped', stopReason: 'cancelled' })
    expect(stopped.invoices).toHaveLength(1)
    expect((await post(owner, '/billing/stop', { stop: false })).statusCode).toBe(409)
    // Paying starts again.
    const paid = await post(owner, '/billing/pay')
    expect(paid.json<{ outcome: string }>().outcome).toBe('paid')
  })

  it('never charges one bill twice, and asks again with the same key when an answer is unclear', async () => {
    const keys: string[] = []
    let answer: PayOutcome['status'] = 'unknown'
    const base = testBillingProvider(origin)
    open({
      ...base,
      async chargeSaved(input) {
        keys.push(input.attemptId)
        return answer === 'unknown'
          ? { status: 'unknown', detail: 'The connection dropped.' }
          : base.chargeSaved(input)
      },
    })
    let owner = await register()
    await saveCard(owner, '4242')
    clock = trialEnd
    await Promise.all([api.billing.run(), api.billing.run()])
    expect(keys).toHaveLength(1)
    owner = await signIn()
    const waiting = await billing(owner)
    expect(waiting).toMatchObject({ status: 'trial', checking: true })
    expect(waiting.invoices[0].status).toBe('charging')
    // Nothing more is taken while the first answer is unknown.
    await at(trialEnd + 60000)
    expect(keys).toHaveLength(1)
    answer = 'succeeded'
    await at(trialEnd + 11 * 60000)
    expect(keys).toEqual([keys[0], keys[0]])
    owner = await signIn()
    expect(await billing(owner)).toMatchObject({ status: 'active', checking: false })
    // A late answer about the same charge changes nothing.
    await api.billing.apply({ attemptId: keys[0], providerRef: 'late', status: 'failed' })
    expect((await billing(owner)).invoices[0].status).toBe('paid')
  })

  it('pays only once when the owner presses pay twice', async () => {
    let owner = await register()
    await saveCard(owner, '4242')
    await post(owner, '/billing/stop', { stop: true })
    await at(trialEnd)
    owner = await signIn()
    expect(await billing(owner)).toMatchObject({ status: 'stopped', stopReason: 'cancelled' })
    const answers = await Promise.all([post(owner, '/billing/pay'), post(owner, '/billing/pay')])
    expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 409])
    const plan = await billing(owner)
    expect(plan.invoices.filter((i) => i.status === 'paid')).toHaveLength(1)
  })
})
