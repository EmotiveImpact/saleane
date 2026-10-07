// @vitest-environment node
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { GuestView } from '../src/domain/guest'
import { testProvider } from './messaging/providers'
import { paymentProviderFromEnv, stripeProvider, testPaymentProvider } from './payments/providers'
import type { PaymentProvider } from './payments/providers'

// PILOT-02 acceptance: card money enters the record only when the provider confirms it, once.
const origin = 'http://127.0.0.1:5173'
const contact = {
  name: 'Rosa Guest',
  email: 'rosa.guest@example.invalid',
  phone: '+44 7700 900333',
  marketingConsent: false,
}
type Login = { cookie: string; csrf: string; orgId: string }
type Attempt = { id: string; status: string; detail: string | null; amountMinor: number }
let api: ApiHandler
let clock: number

function start(paymentProvider?: PaymentProvider) {
  api?.close()
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    providers: {
      email: testProvider('email'),
      sms: testProvider('sms'),
      receipt: () => null,
    },
    paymentProvider: paymentProvider ?? testPaymentProvider(origin),
  })
}
beforeEach(() => {
  // 07:00Z on 6 October is 08:00 in London.
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  start()
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(sample = false): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email: 'owner@example.invalid',
      password: 'Fictional local account 2026!',
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
const workspace = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    slug: string
    state: BusinessState
  }>()
async function send(login: Login, command: Command) {
  const { state } = await workspace(login)
  return api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: state.revision, command },
  })
}
async function run(login: Login, command: Command) {
  const response = await send(login, command)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
async function localStudio() {
  const owner = await register()
  await run(owner, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const serviceId = await run(owner, {
    type: 'service',
    input: {
      name: 'Restorative facial',
      description: 'A fictional service',
      category: 'Skin',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceMinor: 9500,
      depositMinor: 2000,
      resourceType: 'treatment',
    },
  })
  const staffId = await run(owner, {
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  await run(owner, { type: 'protection', settings: { saveCard: true, feePercent: 50 } })
  return { owner, serviceId, staffId, slug: (await workspace(owner)).slug }
}
async function book(
  slug: string,
  serviceId: string,
  staffId: string,
  date = '2026-10-06',
  startMinutes = 600,
) {
  const held = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: { serviceId, staffId, date, startMinutes },
  })
  expect(held.statusCode, held.body).toBe(201)
  const booked = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/book`,
    payload: { hold: held.json<{ hold: string }>().hold, contact, policy: true },
  })
  expect(booked.statusCode, booked.body).toBe(200)
  const result = booked.json<{ appointmentId: string; manage: { url: string } }>()
  return { appointmentId: result.appointmentId, token: result.manage.url.split('#')[1] }
}
const guestView = async (token: string) =>
  (
    await api.inject({ method: 'POST', url: '/api/guest/visit', payload: { token } })
  ).json<GuestView>()
async function guestPays(token: string, card: '4242' | '0002' = '4242', saveCard = true) {
  const opened = await api.inject({
    method: 'POST',
    url: '/api/guest/pay',
    payload: { token, purpose: 'deposit', saveCard },
  })
  expect(opened.statusCode, opened.body).toBe(200)
  const attemptId = opened.json<{ url: string }>().url.split('#')[1]
  const page = await api.inject({ url: `/api/test-payments/${attemptId}` })
  expect(page.json<{ amountMinor: number }>().amountMinor).toBe(2000)
  const paid = await api.inject({
    method: 'POST',
    url: `/api/test-payments/${attemptId}`,
    payload: { outcome: 'pay', card },
  })
  expect(paid.statusCode, paid.body).toBe(200)
  return { attemptId, result: paid.json<{ status: string; next: string }>() }
}
const pay = (login: Login, payload: Record<string, unknown>, key = crypto.randomUUID()) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/payments`,
    headers: { ...headers(login), 'idempotency-key': key },
    payload,
  })

describe('card payments (PILOT-02)', () => {
  it('lets a guest pay the deposit and save a card in test mode, recorded once', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const { appointmentId, token } = await book(slug, serviceId, staffId, '2026-10-09')
    const before = await guestView(token)
    expect(before.payment).toMatchObject({
      testMode: true,
      depositDueMinor: 2000,
      saveCardOffered: true,
      savedCard: null,
    })
    expect(before.payment!.policy).toContain('up to 50%')
    const { result } = await guestPays(token)
    expect(result).toEqual({ status: 'succeeded', next: '/manage?payment=done' })
    const after = await guestView(token)
    expect(after.deposit.paidMinor).toBe(2000)
    expect(after.payment).toMatchObject({ depositDueMinor: 0, savedCard: { last4: '4242' } })
    const { state } = await workspace(owner)
    const deposit = state.payments.find((p) => p.appointmentId === appointmentId)!
    expect(deposit).toMatchObject({
      kind: 'deposit',
      method: 'card',
      amountMinor: 2000,
      processor: { provider: 'test', live: false },
    })
    expect(state.events.some((e) => e.title === 'Deposit paid by card')).toBe(true)
    // Paying again is refused rather than charging twice.
    const again = await api.inject({
      method: 'POST',
      url: '/api/guest/pay',
      payload: { token, purpose: 'deposit', saveCard: false },
    })
    expect(again.statusCode).toBe(409)
  })

  it('opens one payment page at a time, and a guest who leaves it can start again', async () => {
    const { serviceId, staffId, slug } = await localStudio()
    const { token } = await book(slug, serviceId, staffId, '2026-10-09')
    const open = () =>
      api.inject({
        method: 'POST',
        url: '/api/guest/pay',
        payload: { token, purpose: 'deposit', saveCard: false },
      })
    expect((await open()).statusCode).toBe(200)
    expect((await guestView(token)).payment!.pending).toBe(true)
    expect((await open()).statusCode).toBe(409)
    const left = await api.inject({
      method: 'POST',
      url: '/api/guest/pay/cancel',
      payload: { token },
    })
    expect(left.statusCode).toBe(200)
    expect((await open()).statusCode).toBe(200)
  })

  it('records nothing when the test card declines', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const { token } = await book(slug, serviceId, staffId, '2026-10-09')
    const { result } = await guestPays(token, '0002')
    expect(result.status).toBe('failed')
    expect((await workspace(owner)).state.payments).toEqual([])
    expect((await guestView(token)).payment!.depositDueMinor).toBe(2000)
  })

  it('refuses card payments typed in as ordinary records', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const { appointmentId } = await book(slug, serviceId, staffId)
    const response = await send(owner, {
      type: 'deposit',
      appointmentId,
      amountMinor: 2000,
      method: 'card',
      reference: 'pi_made_up',
      processor: { provider: 'stripe', live: true },
    })
    expect(response.statusCode).toBe(403)
  })

  it('charges the saved card at checkout once, even when the request is repeated', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const { appointmentId, token } = await book(slug, serviceId, staffId)
    await guestPays(token)
    await run(owner, { type: 'arrive', appointmentId })
    // 9500 less the 2000 deposit, plus a 500 tip.
    const wrong = await pay(owner, {
      appointmentId,
      purpose: 'balance',
      route: 'saved_card',
      amountMinor: 9500,
      tipMinor: 500,
    })
    expect(wrong.statusCode).toBe(409)
    const key = crypto.randomUUID()
    const body = {
      appointmentId,
      purpose: 'balance',
      route: 'saved_card',
      amountMinor: 8000,
      tipMinor: 500,
    }
    const first = await pay(owner, body, key)
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json<Attempt>().status).toBe('succeeded')
    const repeat = await pay(owner, body, key)
    expect(repeat.json<Attempt>().id).toBe(first.json<Attempt>().id)
    const { state } = await workspace(owner)
    expect(state.sales).toHaveLength(1)
    expect(state.sales[0]).toMatchObject({ method: 'card', balanceMinor: 8000, tipMinor: 500 })
    expect(state.appointments.find((a) => a.id === appointmentId)!.status).toBe('completed')
    expect((await pay(owner, body)).statusCode).toBe(409)
  })

  it('charges the card for products bought with the visit and takes them out of stock', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const { appointmentId, token } = await book(slug, serviceId, staffId)
    await guestPays(token)
    await run(owner, {
      type: 'product',
      input: { name: 'Cleansing Balm', sku: '', priceMinor: 3200, reorderAt: 1, archived: false },
    })
    const productId = (await workspace(owner)).state.operations!.products[0].id
    await run(owner, {
      type: 'stock',
      productId,
      quantity: 2,
      reason: 'received',
      note: 'Delivery',
    })
    await run(owner, { type: 'arrive', appointmentId })
    const tooMany = await pay(owner, {
      appointmentId,
      purpose: 'balance',
      route: 'saved_card',
      amountMinor: 7500 + 9600,
      products: [{ productId, quantity: 3 }],
    })
    expect(tooMany.statusCode).toBe(422)
    // 9500 less the 2000 deposit, plus two balms.
    const body = {
      appointmentId,
      purpose: 'balance',
      route: 'saved_card',
      amountMinor: 7500 + 6400,
      products: [{ productId, quantity: 2 }],
    }
    const paid = await pay(owner, body)
    expect(paid.statusCode, paid.body).toBe(200)
    expect(paid.json<Attempt>().status).toBe('succeeded')
    const { state } = await workspace(owner)
    expect(state.sales[0]).toMatchObject({ method: 'card', balanceMinor: 13900 })
    expect(state.sales[0].retail!.subtotalMinor).toBe(6400)
    expect(
      state.operations!.movements.filter((m) => m.productId === productId).map((m) => m.quantity),
    ).toEqual([2, -2])
  })

  it('waits for a card reader and records the sale only when it is approved', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const { appointmentId } = await book(slug, serviceId, staffId)
    await run(owner, { type: 'arrive', appointmentId })
    const response = await pay(owner, {
      appointmentId,
      purpose: 'balance',
      route: 'reader',
      readerId: 'test-reader',
      amountMinor: 9500,
    })
    const attempt = response.json<Attempt>()
    expect(attempt.status).toBe('processing')
    expect((await workspace(owner)).state.sales).toEqual([])
    const tapped = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/payments/${attempt.id}/test-tap`,
      headers: headers(owner),
      payload: { approve: true },
    })
    expect(tapped.json<Attempt>().status).toBe('succeeded')
    expect((await workspace(owner)).state.sales).toHaveLength(1)
  })

  it('charges a card reader for what a gift card leaves, and records both on the receipt', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const { appointmentId } = await book(slug, serviceId, staffId)
    const giftCardId = await run(owner, {
      type: 'gift-card-sell',
      input: {
        kind: 'money',
        valueMinor: 3000,
        purchaserName: 'Lee Buyer',
        recipientName: '',
        message: '',
      },
      method: 'cash',
    })
    await run(owner, { type: 'arrive', appointmentId })
    const base = { appointmentId, purpose: 'balance', route: 'reader', readerId: 'test-reader' }
    // A gift card amount without the card, or more than it holds, is refused before any charge.
    expect((await pay(owner, { ...base, amountMinor: 6500, giftCardMinor: 3000 })).statusCode).toBe(
      422,
    )
    expect(
      (await pay(owner, { ...base, amountMinor: 5500, giftCardId, giftCardMinor: 4000 }))
        .statusCode,
    ).not.toBe(200)
    const response = await pay(owner, {
      ...base,
      amountMinor: 6500,
      giftCardId,
      giftCardMinor: 3000,
    })
    expect(response.statusCode, response.body).toBe(200)
    const attempt = response.json<Attempt>()
    // While the reader waits, the card's share is held: it cannot be cancelled or spent elsewhere.
    const cancel = await send(owner, {
      type: 'gift-card-cancel',
      giftCardId,
      reason: 'Changed their mind',
      refundMinor: 0,
    })
    expect(cancel.statusCode, cancel.body).toBe(409)
    const other = await book(slug, serviceId, staffId, '2026-10-06', 780)
    await run(owner, { type: 'arrive', appointmentId: other.appointmentId })
    const elsewhere = await send(owner, {
      type: 'checkout',
      appointmentId: other.appointmentId,
      tipMinor: 0,
      method: 'cash',
      giftCardId,
      giftCardMinor: 3000,
    })
    expect(elsewhere.statusCode, elsewhere.body).toBe(409)
    expect(elsewhere.body).toContain('held for a card payment')
    await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/payments/${attempt.id}/test-tap`,
      headers: headers(owner),
      payload: { approve: true },
    })
    const { state } = await workspace(owner)
    expect(state.sales.find((x) => x.appointmentId === appointmentId)).toMatchObject({
      method: 'card',
      giftCardId,
      giftCardMinor: 3000,
      balanceMinor: 6500,
    })
    expect(state.giftCards![0].redemptions).toHaveLength(1)
  })

  it('takes a missed-visit fee within the studio policy, then refunds it to the card', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const { appointmentId, token } = await book(slug, serviceId, staffId)
    await guestPays(token)
    await run(owner, { type: 'no-show', appointmentId, reason: 'Did not arrive' })
    const options = await api.inject({
      url: `/api/workspaces/${owner.orgId}/payments?appointmentId=${appointmentId}`,
      headers: headers(owner),
    })
    // Half of 9500, less the 2000 deposit already taken.
    expect(options.json<{ feeAllowedMinor: number }>().feeAllowedMinor).toBe(2750)
    const tooMuch = await pay(owner, {
      appointmentId,
      purpose: 'fee',
      route: 'saved_card',
      amountMinor: 3000,
    })
    expect(tooMuch.statusCode).toBe(409)
    const fee = await pay(owner, {
      appointmentId,
      purpose: 'fee',
      route: 'saved_card',
      amountMinor: 2750,
    })
    expect(fee.json<Attempt>().status).toBe('succeeded')
    const { state } = await workspace(owner)
    const charged = state.payments.find((p) => p.kind === 'fee')!
    expect(charged).toMatchObject({ amountMinor: 2750, method: 'card' })
    const refund = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/card-refunds`,
      headers: { ...headers(owner), 'idempotency-key': crypto.randomUUID() },
      payload: { paymentId: charged.id, amountMinor: 2750, reason: 'Fee waived as a courtesy' },
    })
    expect(refund.json<Attempt>().status).toBe('succeeded')
    const after = (await workspace(owner)).state
    expect(after.operations!.refunds.at(-1)).toMatchObject({
      paymentId: charged.id,
      method: 'card',
      amountMinor: 2750,
    })
    const twice = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/card-refunds`,
      headers: { ...headers(owner), 'idempotency-key': crypto.randomUUID() },
      payload: { paymentId: charged.id, amountMinor: 1, reason: 'One more' },
    })
    expect(twice.statusCode).toBe(409)
  })

  it('leaves money taken for a visit that changed meanwhile for the studio to review', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const { appointmentId, token } = await book(slug, serviceId, staffId, '2026-10-09')
    const opened = await api.inject({
      method: 'POST',
      url: '/api/guest/pay',
      payload: { token, purpose: 'deposit', saveCard: false },
    })
    const attemptId = opened.json<{ url: string }>().url.split('#')[1]
    await run(owner, { type: 'cancel', appointmentId, reason: 'Studio closed for the day' })
    const paid = await api.inject({
      method: 'POST',
      url: `/api/test-payments/${attemptId}`,
      payload: { outcome: 'pay', card: '4242' },
    })
    expect(paid.json<{ status: string }>().status).toBe('review')
    expect((await workspace(owner)).state.payments).toEqual([])
    const review = await api.inject({
      url: `/api/workspaces/${owner.orgId}/payments`,
      headers: headers(owner),
    })
    expect(review.json<{ attempts: Attempt[] }>().attempts[0].detail).toContain(
      'could not be added to the visit',
    )
  })

  it('never takes card payments for a sample studio', async () => {
    const owner = await register(true)
    const { state } = await workspace(owner)
    const visit = state.appointments.find((a) => a.status === 'confirmed')!
    const response = await pay(owner, {
      appointmentId: visit.id,
      purpose: 'deposit',
      route: 'reader',
      readerId: 'test-reader',
      amountMinor: 1000,
    })
    expect(response.statusCode).toBe(409)
  })
})

describe('Stripe adapter (unverified against a live account)', () => {
  const secret = 'whsec_fictional'
  const sign = (body: string, at: number) =>
    `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`

  it('accepts only signed, fresh events', async () => {
    const provider = stripeProvider({
      secretKey: 'sk_test_fictional',
      webhookSecret: secret,
      now: () => clock,
      fetcher: async () => new Response('{}', { status: 404 }),
    })
    expect(provider.live).toBe(false)
    const body = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', metadata: { attempt: 'a1' } } },
    })
    const at = Math.floor(clock / 1000)
    expect(
      await provider.events({ headers: { 'stripe-signature': sign(body, at) }, body }),
    ).toEqual([{ attemptId: 'a1', providerRef: 'pi_1', status: 'succeeded', card: undefined }])
    expect(
      await provider.events({ headers: { 'stripe-signature': sign(body, at - 600) }, body }),
    ).toBeNull()
    expect(
      await provider.events({ headers: { 'stripe-signature': sign(`${body} `, at) }, body }),
    ).toBeNull()
  })

  it('sends each charge with the attempt as its idempotency key', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const provider = stripeProvider({
      secretKey: 'sk_live_fictional',
      webhookSecret: secret,
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init! })
        return new Response(JSON.stringify({ id: 'pi_2', status: 'succeeded' }), { status: 200 })
      },
    })
    expect(provider.live).toBe(true)
    const outcome = await provider.chargeSaved({
      attemptId: 'attempt-1',
      amountMinor: 8000,
      currency: 'GBP',
      description: 'Facial',
      card: { customerRef: 'cus_1', methodRef: 'pm_1', last4: '4242' },
    })
    expect(outcome).toEqual({ status: 'succeeded', providerRef: 'pi_2' })
    expect(calls[0].url).toBe('https://api.stripe.com/v1/payment_intents')
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('attempt-1')
    expect(String(calls[0].init.body)).toContain('off_session=true')
  })

  it('applies a verified webhook to the attempt it names', async () => {
    const provider = stripeProvider({
      secretKey: 'sk_test_fictional',
      webhookSecret: secret,
      now: () => clock,
      readers: [{ id: 'tmr_1', label: 'Front desk' }],
      fetcher: async (url) =>
        String(url).includes('process_payment_intent')
          ? new Response('{}', { status: 200 })
          : new Response(JSON.stringify({ id: 'pi_reader', status: 'requires_payment_method' }), {
              status: 200,
            }),
    })
    start(provider)
    const { owner, serviceId, staffId, slug } = await localStudio()
    const { appointmentId } = await book(slug, serviceId, staffId)
    await run(owner, { type: 'arrive', appointmentId })
    const attempt = (
      await pay(owner, {
        appointmentId,
        purpose: 'balance',
        route: 'reader',
        readerId: 'tmr_1',
        amountMinor: 9500,
      })
    ).json<Attempt>()
    expect(attempt.status).toBe('processing')
    const body = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_reader', metadata: { attempt: attempt.id } } },
    })
    const forged = await api.inject({
      method: 'POST',
      url: '/api/hooks/stripe',
      headers: { 'stripe-signature': 't=1,v1=00' },
      rawPayload: body,
    })
    expect(forged.statusCode).toBe(403)
    const hook = await api.inject({
      method: 'POST',
      url: '/api/hooks/stripe',
      headers: { 'stripe-signature': sign(body, Math.floor(clock / 1000)) },
      rawPayload: body,
    })
    expect(hook.statusCode, hook.body).toBe(200)
    const sale = (await workspace(owner)).state.sales[0]
    expect(sale).toMatchObject({
      method: 'card',
      reference: 'pi_reader',
      processor: { provider: 'stripe', live: false },
    })
  })

  it('treats a Stripe server error as unclear, blocks a second charge, and checks with the same key', async () => {
    const keys: string[] = []
    let answer = 500
    const provider = stripeProvider({
      secretKey: 'sk_test_fictional',
      webhookSecret: secret,
      now: () => clock,
      fetcher: async (_url, init) => {
        keys.push((init!.headers as Record<string, string>)['Idempotency-Key'])
        return answer === 500
          ? new Response(JSON.stringify({ error: { type: 'api_error' } }), { status: 500 })
          : new Response(JSON.stringify({ id: 'pi_once', status: 'succeeded' }), { status: 200 })
      },
    })
    start(provider)
    const { owner, serviceId, staffId, slug } = await localStudio()
    const { appointmentId } = await book(slug, serviceId, staffId)
    await run(owner, { type: 'arrive', appointmentId })
    api.database.run(
      `INSERT INTO saved_cards(id,organisation_id,client_id,provider,customer_ref,method_ref,brand,last4,exp_month,exp_year,agreed,created_at)
       VALUES('card-1',?,?,'stripe','cus_1','pm_1','Visa','4242',12,2029,'Fictional terms',?)`,
      owner.orgId,
      (await workspace(owner)).state.appointments.find((a) => a.id === appointmentId)!.clientId,
      clock,
    )
    const body = { appointmentId, purpose: 'balance', route: 'saved_card', amountMinor: 9500 }
    const first = (await pay(owner, body)).json<Attempt>()
    expect(first.status).toBe('unknown')
    expect((await pay(owner, body)).statusCode).toBe(409)
    answer = 200
    const checked = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/payments/${first.id}/check`,
      headers: headers(owner),
      payload: {},
    })
    expect(checked.json<Attempt>().status).toBe('succeeded')
    expect(keys).toEqual([first.id, first.id])
    expect((await workspace(owner)).state.sales).toHaveLength(1)
  })

  it('refuses to start Stripe without its keys', () => {
    expect(() => paymentProviderFromEnv({ SALEANE_PAYMENTS_PROVIDER: 'stripe' })).toThrow(
      'STRIPE_SECRET_KEY',
    )
    expect(paymentProviderFromEnv({}).name).toBe('test')
  })
})
