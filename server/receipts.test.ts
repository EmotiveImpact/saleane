// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { BROWSER_DRAWER } from '../src/domain/till'
import { testProvider } from './messaging/providers'
import { testPaymentProvider } from './payments/providers'
import type { PaymentProvider } from './payments/providers'
import { DRAWER_PULSE } from './till/escpos'
import type { PrintJob, PrintOutcome, PrinterTransport } from './till/printers'

// Stage 2: receipts on paper or by email, the cash drawer, and products back after a card refund.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string }
type Opening = {
  id: string
  kind: 'drawer' | 'print'
  cause: string
  locationId: string
  receipt: string | null
  receiptNumber: string | null
  amountMinor: number | null
  reason: string | null
  printer: 'network' | 'test'
  status: string
  detail: string | null
  actorName: string
  preview?: { lines: { text: string }[]; cut: boolean; drawer: boolean }
}
let api: ApiHandler
let clock: number
/** A pretend network printer: it keeps what it was sent and answers as told. */
let network: PrinterTransport & { jobs: PrintJob[]; answer: PrintOutcome }

function start(paymentProvider?: PaymentProvider) {
  api?.close()
  network = {
    name: 'network',
    jobs: [],
    answer: { ok: true },
    async send(job) {
      network.jobs.push(job)
      return network.answer
    },
  }
  api = createApiHandler({
    origin,
    databasePath: ':memory:',
    now: () => clock,
    turnstile: null,
    providers: { email: testProvider('email'), sms: testProvider('sms'), receipt: () => null },
    paymentProvider: paymentProvider ?? testPaymentProvider(origin),
    printers: { network },
  })
}
beforeEach(() => {
  // 07:00Z on 6 October is 08:00 in London.
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  start()
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(
  options: { sample?: boolean; email?: string; invitation?: string; name?: string } = {},
): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: options.name ?? 'Ada Owner',
      email: options.email ?? 'owner@example.invalid',
      password,
      ...(options.invitation
        ? { invitation: options.invitation }
        : {
            workspace: {
              name: 'Linden Studio',
              locationName: 'London',
              region: 'UK',
              sample: !!options.sample,
            },
          }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
const post = (login: Login, path: string, payload: unknown, extra: Record<string, string> = {}) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}${path}`,
    headers: { ...headers(login), ...extra },
    payload,
  })
const get = (login: Login, path: string) =>
  api.inject({ url: `/api/workspaces/${login.orgId}${path}`, headers: headers(login) })
const studio = async (login: Login) =>
  (await get(login, '')).json<{ slug: string; state: BusinessState }>()
async function send(login: Login, command: Command) {
  const { state } = await studio(login)
  return post(
    login,
    '/commands',
    { revision: state.revision, command },
    { 'idempotency-key': crypto.randomUUID() },
  )
}
async function run(login: Login, command: Command) {
  const response = await send(login, command)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
async function invite(owner: Login, payload: Record<string, unknown>, name: string) {
  const invitation = await post(owner, '/invitations', payload)
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register({
    email: String(payload.email),
    invitation: invitation.json<{ invitation: string }>().invitation,
    name,
  })
  return { ...login, orgId: owner.orgId }
}
const printer = (
  login: Login,
  input: Record<string, unknown>,
  locationId?: string,
  taxNumber?: string,
) =>
  run(login, {
    type: 'till-settings',
    ...(locationId ? { locationId } : {}),
    printer: { paper: '80', drawer: false, ...input },
    ...(taxNumber !== undefined ? { taxNumber } : {}),
  } as Command)
const noSale = (login: Login, reason: string, locationId?: string) =>
  post(login, '/till/drawer', { reason, ...(locationId ? { locationId } : {}) })
const drawerDay = async (login: Login, date = '2026-10-06') => {
  const response = await get(login, `/till/drawer?date=${date}`)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ openings: Opening[]; summary: string }>()
}
const print = (login: Login, receipt: string) => post(login, '/till/print', { receipt })
const email = (login: Login, receipt: string, key = crypto.randomUUID()) =>
  post(login, '/till/email', { receipt }, { 'idempotency-key': key })

/** A studio of its own with one treatment, one practitioner and a guest booked for 10:00. */
async function localStudio() {
  const owner = await register()
  await run(owner, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const serviceId = await run(owner, {
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
  const staffId = await run(owner, {
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  const { name, locationName, address, timeZone } = (await studio(owner)).state.organisation
  await run(owner, {
    type: 'organisation',
    name,
    locationName,
    address,
    timeZone,
    bookingEnabled: true,
  })
  return { owner, serviceId, staffId, slug: (await studio(owner)).slug }
}
async function book(slug: string, serviceId: string, staffId: string, startMinutes = 600) {
  const held = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: { serviceId, staffId, date: '2026-10-06', startMinutes },
  })
  expect(held.statusCode, held.body).toBe(201)
  const booked = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/book`,
    payload: {
      hold: held.json<{ hold: string }>().hold,
      contact: {
        name: 'Rosa Guest',
        email: 'rosa.guest@example.invalid',
        phone: '+44 7700 900333',
        marketingConsent: false,
      },
      policy: true,
    },
  })
  expect(booked.statusCode, booked.body).toBe(200)
  return booked.json<{ appointmentId: string }>().appointmentId
}
/** A visit paid in cash at the desk: its receipt key. */
async function cashVisit(login: Login, slug: string, serviceId: string, staffId: string) {
  const appointmentId = await book(slug, serviceId, staffId)
  await run(login, { type: 'arrive', appointmentId })
  await run(login, { type: 'checkout', appointmentId, tipMinor: 0, method: 'cash' })
  const sale = (await studio(login)).state.sales.find((s) => s.appointmentId === appointmentId)!
  return `visit:${sale.id}`
}

describe('the cash drawer (Stage 2)', () => {
  it('is set up by owners and managers only, never through the print window', async () => {
    const { owner } = await localStudio()
    const reception = await invite(
      owner,
      { email: 'desk@example.invalid', role: 'reception' },
      'Rey Desk',
    )
    expect((await noSale(owner, 'Change for a £20')).json<{ error: string }>().error).toBe(
      BROWSER_DRAWER,
    )
    // The print window cannot open a drawer, so asking for one there is refused.
    expect(
      (
        await send(owner, {
          type: 'till-settings',
          printer: { mode: 'browser', paper: '58', drawer: true },
        })
      ).statusCode,
    ).toBe(200)
    expect((await studio(owner)).state.operations!.till!.printers[0]).toMatchObject({
      mode: 'browser',
      drawer: false,
    })
    // Only a printer on the studio's network is accepted.
    const outside = await send(owner, {
      type: 'till-settings',
      printer: { mode: 'network', paper: '80', host: '8.8.8.8', port: 9100, drawer: true },
    })
    expect(outside.statusCode).toBe(422)
    expect(outside.body).toContain('your own network')
    const settings = await send(reception, {
      type: 'till-settings',
      printer: { mode: 'test', paper: '80', drawer: true },
    })
    expect(settings.statusCode, settings.body).toBe(403)
    await printer(owner, { mode: 'test', drawer: false }, undefined, 'GB 123 4567 89')
    const off = await noSale(owner, 'Change for a £20')
    expect(off.statusCode).toBe(409)
    expect(off.body).toContain('turned off')
  })

  it('opens for cash taken at checkout and writes down who, when and which sale', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    await printer(owner, { mode: 'test', drawer: true })
    const key = await cashVisit(owner, slug, serviceId, staffId)
    await api.till.run()
    const day = await drawerDay(owner)
    expect(day.openings).toHaveLength(1)
    expect(day.openings[0]).toMatchObject({
      kind: 'drawer',
      cause: 'cash',
      receipt: key,
      amountMinor: 9500,
      printer: 'test',
      status: 'test',
      actorName: 'Ada Owner',
    })
    // The test printer keeps what it would have sent: the drawer pulse, nothing on paper.
    expect(day.openings[0].preview).toEqual({ lines: [], cut: false, drawer: true })
    expect(day.summary).toBe('The test drawer would have opened once: 1 cash payment.')
    // Money that is not cash opens nothing.
    await run(owner, {
      type: 'gift-card-sell',
      input: {
        kind: 'money',
        valueMinor: 3000,
        purchaserName: 'Lee Buyer',
        recipientName: '',
        message: '',
      },
      method: 'external_card',
      reference: 'T-1001',
    })
    await api.till.run()
    expect((await drawerDay(owner)).openings).toHaveLength(1)
    // A gift card sold for cash opens it again.
    await run(owner, {
      type: 'gift-card-sell',
      input: {
        kind: 'money',
        valueMinor: 2500,
        purchaserName: 'Lee Buyer',
        recipientName: '',
        message: '',
      },
      method: 'cash',
    })
    await api.till.run()
    const after = await drawerDay(owner)
    expect(after.openings.map((o) => [o.cause, o.receipt?.split(':')[0], o.amountMinor])).toEqual([
      ['cash', 'visit', 9500],
      ['cash', 'gift-card', 2500],
    ])
  })

  it('opens without a sale only with a reason, and only for people who take payments', async () => {
    const { owner, staffId } = await localStudio()
    await run(owner, { type: 'location', input: { name: 'Islington', address: '1 Upper Street' } })
    let { state } = await studio(owner)
    const [main, islington] = [state.organisation.locationId, state.operations!.locations![0].id]
    await printer(owner, { mode: 'test', drawer: true })
    await printer(owner, { mode: 'test', drawer: true }, islington)
    await run(owner, { type: 'region', input: { name: 'London', locationIds: [main, islington] } })
    state = (await studio(owner)).state
    const reception = await invite(
      owner,
      { email: 'desk@example.invalid', role: 'reception' },
      'Rey Desk',
    )
    const practitioner = await invite(
      owner,
      { email: 'maya@example.invalid', role: 'practitioner', staffId },
      'Maya Lind',
    )
    const general = await invite(
      owner,
      { email: 'gm@example.invalid', role: 'general', locationId: islington },
      'Gia General',
    )
    const regional = await invite(
      owner,
      { email: 'rm@example.invalid', role: 'regional', areaId: state.operations!.regions![0].id },
      'Rae Area',
    )

    expect((await noSale(owner, '')).statusCode).toBe(400)
    expect((await noSale(owner, 'x'.repeat(81))).statusCode).toBe(400)
    const opened = await noSale(owner, 'Change for a £20')
    expect(opened.statusCode, opened.body).toBe(200)
    expect(opened.json<Opening>()).toMatchObject({
      cause: 'no_sale',
      reason: 'Change for a £20',
      locationId: main,
      status: 'test',
      actorName: 'Ada Owner',
    })
    expect((await noSale(reception, 'Float for the day')).statusCode).toBe(200)
    // A practitioner never takes payments, so never opens the drawer; a regional manager sees
    // their area's view only.
    expect((await noSale(practitioner, 'Change for a £20')).statusCode).toBe(403)
    expect((await noSale(regional, 'Change for a £20')).statusCode).toBe(403)
    // A general manager opens their own location's drawer, and no other.
    const own = await noSale(general, 'Change for a £10')
    expect(own.statusCode, own.body).toBe(200)
    expect(own.json<Opening>().locationId).toBe(islington)
    const elsewhere = await noSale(general, 'Change for a £10', main)
    expect(elsewhere.statusCode).toBe(403)

    const day = await drawerDay(owner)
    expect(day.openings.map((o) => [o.actorName, o.reason])).toEqual([
      ['Ada Owner', 'Change for a £20'],
      ['Rey Desk', 'Float for the day'],
      ['Gia General', 'Change for a £10'],
    ])
    expect(day.summary).toBe(
      'The test drawer would have opened 3 times: 3 no sales (Ada Owner: change for a £20; Rey Desk: float for the day; Gia General: change for a £10).',
    )
    // A general manager's till count lists their own location's drawer only.
    expect((await drawerDay(general)).openings.map((o) => o.actorName)).toEqual(['Gia General'])
    expect((await get(practitioner, '/till/drawer')).statusCode).toBe(403)
    // Each no-sale opening is in the change history.
    const audit = api.database.all<{ action: string; record_id: string }>(
      "SELECT action,record_id FROM audit_events WHERE action='till.drawer'",
    )
    expect(audit).toHaveLength(3)
  })

  it('sends the pulse to a network printer, and says so honestly when it does not answer', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    await printer(owner, { mode: 'network', host: '192.168.1.50', drawer: true })
    expect((await studio(owner)).state.operations!.till!.printers[0]).toMatchObject({
      mode: 'network',
      host: '192.168.1.50',
      port: 9100,
    })
    await cashVisit(owner, slug, serviceId, staffId)
    await api.till.run()
    expect(network.jobs).toHaveLength(1)
    expect(network.jobs[0]).toMatchObject({ host: '192.168.1.50', port: 9100 })
    expect([...network.jobs[0].bytes]).toEqual([0x1b, 0x40, ...DRAWER_PULSE])
    network.answer = { ok: false, detail: 'The printer at 192.168.1.50 did not answer.' }
    const failed = await noSale(owner, 'Change for a £20')
    expect(failed.json<Opening>()).toMatchObject({
      status: 'failed',
      detail: 'The printer at 192.168.1.50 did not answer.',
    })
    const day = await drawerDay(owner)
    expect(day.openings.map((o) => o.status)).toEqual(['sent', 'failed'])
    expect(day.summary).toContain('did not answer, so the drawer may not have opened')
  })

  it('does not open a drawer long after the cash was taken', async () => {
    const { owner } = await localStudio()
    await printer(owner, { mode: 'network', host: '192.168.1.50', drawer: true })
    const { state } = await studio(owner)
    api.database.run(
      `INSERT INTO till_events(id,organisation_id,location_id,kind,cause,printer,host,port,status,actor_name,created_at,updated_at)
       VALUES('late',?,?,'drawer','cash','network','192.168.1.50',9100,'pending','Ada Owner',?,?)`,
      owner.orgId,
      state.organisation.locationId,
      clock - 120_000,
      clock - 120_000,
    )
    await api.till.run()
    expect(network.jobs).toEqual([])
    expect(
      api.database.get<{ status: string; detail: string }>(
        "SELECT status,detail FROM till_events WHERE id='late'",
      ),
    ).toEqual({
      status: 'skipped',
      detail: 'Too late to open the drawer by the time the printer was free.',
    })
  })

  it('never reaches a real printer or drawer from a sample studio', async () => {
    const owner = await register({ sample: true })
    await printer(owner, { mode: 'network', host: '192.168.1.50', drawer: true })
    const opened = await noSale(owner, 'Change for a £20')
    expect(opened.json<Opening>()).toMatchObject({ printer: 'test', status: 'test' })
    const { state } = await studio(owner)
    const sale = state.sales[0]
    expect(sale).toBeDefined()
    const printed = await print(owner, `visit:${sale.id}`)
    expect(printed.json<Opening>()).toMatchObject({ printer: 'test', status: 'test' })
    expect(network.jobs).toEqual([])
    expect((await email(owner, `visit:${sale.id}`)).statusCode).toBe(409)
  })
})

describe('printing and emailing a receipt (Stage 2)', () => {
  it('prints to the test printer with a preview, and refuses people who may not see it', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    await run(owner, { type: 'location', input: { name: 'Islington', address: '1 Upper Street' } })
    const islington = (await studio(owner)).state.operations!.locations![0].id
    const key = await cashVisit(owner, slug, serviceId, staffId)
    // Through the print window by default: the page prints it, not the server.
    expect((await print(owner, key)).statusCode).toBe(409)
    await printer(owner, { mode: 'test', drawer: false }, undefined, 'GB 123 4567 89')
    expect((await print(owner, 'visit')).statusCode).toBe(400)
    expect((await print(owner, 'visit:nothing-here')).statusCode).toBe(404)
    const printed = await print(owner, key)
    expect(printed.statusCode, printed.body).toBe(200)
    const job = printed.json<Opening>()
    expect(job).toMatchObject({ kind: 'print', cause: 'receipt', status: 'test', receipt: key })
    const text = job.preview!.lines.map((l) => l.text)
    expect(text[0]).toBe('Linden Studio')
    expect(text.some((l) => /^Restorative facial +£95\.00$/.test(l))).toBe(true)
    expect(text.some((l) => /^Total +£95\.00$/.test(l))).toBe(true)
    expect(text.some((l) => /^Paid: Cash +£95\.00$/.test(l))).toBe(true)
    expect(text).toContain('VAT number: GB 123 4567 89')
    expect(job.preview!.cut).toBe(true)
    // Its history: the print, kept with the receipt.
    const events = await get(owner, `/till/events?receipt=${encodeURIComponent(key)}`)
    expect(events.json<{ events: Opening[] }>().events.map((e) => e.cause)).toEqual(['receipt'])

    const practitioner = await invite(
      owner,
      { email: 'maya@example.invalid', role: 'practitioner', staffId },
      'Maya Lind',
    )
    expect((await print(practitioner, key)).statusCode).toBe(403)
    const general = await invite(
      owner,
      { email: 'gm@example.invalid', role: 'general', locationId: islington },
      'Gia General',
    )
    const refused = await print(general, key)
    expect(refused.statusCode).toBe(403)
    expect(refused.body).toContain('another location')
    expect((await get(general, `/till/events?receipt=${encodeURIComponent(key)}`)).statusCode).toBe(
      403,
    )
  })

  it('prints on a network printer, and a test page from settings for owners only', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const key = await cashVisit(owner, slug, serviceId, staffId)
    await printer(owner, { mode: 'network', host: '192.168.1.50', port: 9101 })
    const printed = await print(owner, key)
    expect(printed.json<Opening>()).toMatchObject({ printer: 'network', status: 'sent' })
    expect(printed.json<Opening>().preview).toBeUndefined()
    expect(network.jobs).toHaveLength(1)
    expect(network.jobs[0].port).toBe(9101)
    expect(Buffer.from(network.jobs[0].bytes).toString('latin1')).toContain('Linden Studio')
    const page = await post(owner, '/till/test', {})
    expect(page.json<Opening>()).toMatchObject({ cause: 'test_page', status: 'sent' })
    const reception = await invite(
      owner,
      { email: 'desk@example.invalid', role: 'reception' },
      'Rey Desk',
    )
    expect((await post(reception, '/till/test', {})).statusCode).toBe(403)
    expect((await print(reception, key)).statusCode).toBe(200)
  })

  it('queues an emailed receipt as a test message, never claiming it was sent', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const key = await cashVisit(owner, slug, serviceId, staffId)
    const idem = crypto.randomUUID()
    const queued = await email(owner, key, idem)
    expect(queued.statusCode, queued.body).toBe(200)
    const body = queued.json<{ id: string; status: string; recipient: string; testMode: boolean }>()
    expect(body).toMatchObject({
      status: 'pending',
      recipient: 'rosa.guest@example.invalid',
      testMode: true,
    })
    // Asking again with the same key is the same message.
    expect((await email(owner, key, idem)).json<{ id: string }>().id).toBe(body.id)
    await api.outbox.tick()
    const row = api.database.get<{ kind: string; status: string; subject: string; body: string }>(
      'SELECT kind,status,subject,body FROM outbox WHERE id=?',
      body.id,
    )!
    expect(row.kind).toBe('receipt')
    expect(row.status).toBe('test')
    expect(row.subject).toMatch(/^Your receipt from Linden Studio \(/)
    expect(row.body).toContain('Dear Rosa,')
    expect(row.body).toContain('Restorative facial')
    // At most three times for one receipt.
    expect((await email(owner, key)).statusCode).toBe(200)
    expect((await email(owner, key)).statusCode).toBe(200)
    expect((await email(owner, key)).statusCode).toBe(429)
    expect(
      api.database.all("SELECT id FROM audit_events WHERE action='receipt.emailed'"),
    ).toHaveLength(3)
  })

  it('does not email a receipt to an address the client has changed since', async () => {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const key = await cashVisit(owner, slug, serviceId, staffId)
    const queued = (await email(owner, key)).json<{ id: string }>()
    const { state } = await studio(owner)
    const client = state.clients.find((c) => c.email === 'rosa.guest@example.invalid')!
    await run(owner, {
      type: 'client-edit',
      clientId: client.id,
      contact: {
        name: client.name,
        email: 'rosa.new@example.invalid',
        phone: client.phone,
        marketingConsent: false,
      },
      preferences: '',
    })
    await api.outbox.tick()
    expect(
      api.database.get<{ status: string; detail: string }>(
        'SELECT status,detail FROM outbox WHERE id=?',
        queued.id,
      ),
    ).toEqual({
      status: 'skipped',
      detail: 'The client’s email address changed before it went out.',
    })
  })

  it('cannot email a walk-in receipt with no client on it', async () => {
    const { owner } = await localStudio()
    const productId = await run(owner, {
      type: 'product',
      input: { name: 'Cleansing Balm', sku: '', priceMinor: 3200, reorderAt: 1, archived: false },
    })
    await run(owner, { type: 'stock', productId, quantity: 2, reason: 'received', note: 'In' })
    const saleId = await run(owner, {
      type: 'counter-sale',
      products: [{ productId, quantity: 1 }],
      method: 'cash',
    })
    const refused = await email(owner, `walk-in:${saleId}`)
    expect(refused.statusCode).toBe(409)
    expect(refused.body).toContain('no email address')
  })
})

describe('products back on the shelf after a card refund (Stage 2)', () => {
  /** A visit paid on a saved card with two balms: its sale and the balm. */
  async function cardSaleWithBalms() {
    const { owner, serviceId, staffId, slug } = await localStudio()
    const appointmentId = await book(slug, serviceId, staffId)
    const productId = await run(owner, {
      type: 'product',
      input: { name: 'Cleansing Balm', sku: '', priceMinor: 3200, reorderAt: 1, archived: false },
    })
    await run(owner, { type: 'stock', productId, quantity: 2, reason: 'received', note: 'In' })
    await run(owner, { type: 'arrive', appointmentId })
    const paid = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/payments`,
      headers: { ...headers(owner), 'idempotency-key': crypto.randomUUID() },
      payload: {
        appointmentId,
        purpose: 'balance',
        route: 'reader',
        readerId: 'test-reader',
        amountMinor: 9500 + 6400,
        products: [{ productId, quantity: 2 }],
      },
    })
    expect(paid.statusCode, paid.body).toBe(200)
    await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/payments/${paid.json<{ id: string }>().id}/test-tap`,
      headers: headers(owner),
      payload: { approve: true },
    })
    const sale = (await studio(owner)).state.sales.find((s) => s.appointmentId === appointmentId)!
    expect(sale.method).toBe('card')
    return { owner, saleId: sale.id, productId }
  }
  const refund = (login: Login, payload: Record<string, unknown>) =>
    post(login, '/card-refunds', payload, { 'idempotency-key': crypto.randomUUID() })
  const balms = async (login: Login, productId: string) =>
    (await studio(login)).state
      .operations!.movements.filter((m) => m.productId === productId)
      .map((m) => [m.reason, m.quantity, m.refundId ?? null])

  it('puts the products back once the provider confirms, and checks them first', async () => {
    const { owner, saleId, productId } = await cardSaleWithBalms()
    const base = { saleId, amountMinor: 3200, reason: 'Balm returned unopened' }
    expect(
      (await refund(owner, { ...base, restock: [{ productId, quantity: 3 }] })).statusCode,
    ).toBe(422)
    expect(
      (await refund(owner, { ...base, restock: [{ productId: 'not-sold', quantity: 1 }] }))
        .statusCode,
    ).toBe(422)
    const done = await refund(owner, { ...base, restock: [{ productId, quantity: 1 }] })
    expect(done.statusCode, done.body).toBe(200)
    expect(done.json<{ status: string }>().status).toBe('succeeded')
    const { state } = await studio(owner)
    const refunded = state.operations!.refunds.at(-1)!
    expect(refunded).toMatchObject({ saleId, method: 'card', amountMinor: 3200 })
    expect(await balms(owner, productId)).toEqual([
      ['received', 2, null],
      ['retail', -2, null],
      ['returned', 1, refunded.id],
    ])
    // Only what is left on the receipt can come back.
    expect(
      (await refund(owner, { ...base, restock: [{ productId, quantity: 2 }] })).statusCode,
    ).toBe(422)
  })

  it('puts nothing back when the refund fails, or until an unclear one is confirmed', async () => {
    let answers: ('failed' | 'unknown' | 'succeeded')[] = ['failed']
    const base = testPaymentProvider(origin)
    start({
      ...base,
      async refund(input) {
        const answer = answers.shift() ?? 'succeeded'
        if (answer === 'succeeded') return base.refund(input)
        return answer === 'failed'
          ? { status: 'failed', detail: 'The provider could not refund this payment.' }
          : { status: 'unknown', detail: 'The provider did not answer.' }
      },
    })
    const { owner, saleId, productId } = await cardSaleWithBalms()
    const payload = {
      saleId,
      amountMinor: 3200,
      reason: 'Balm returned unopened',
      restock: [{ productId, quantity: 1 }],
    }
    const failed = await refund(owner, payload)
    expect(failed.json<{ status: string }>().status).toBe('failed')
    expect(await balms(owner, productId)).toEqual([
      ['received', 2, null],
      ['retail', -2, null],
    ])
    answers = ['unknown']
    const unclear = await refund(owner, payload)
    const attempt = unclear.json<{ id: string; status: string }>()
    expect(attempt.status).toBe('unknown')
    expect((await balms(owner, productId)).length).toBe(2)
    const checked = await post(owner, `/payments/${attempt.id}/check`, {})
    expect(checked.json<{ status: string }>().status).toBe('succeeded')
    const after = await balms(owner, productId)
    expect(after.map(([reason, quantity]) => [reason, quantity])).toEqual([
      ['received', 2],
      ['retail', -2],
      ['returned', 1],
    ])
  })

  it('takes products back only from a receipt, not from a deposit or fee', async () => {
    const { owner, productId } = await cardSaleWithBalms()
    const refused = await refund(owner, {
      paymentId: 'some-payment',
      amountMinor: 100,
      reason: 'Fee waived',
      restock: [{ productId, quantity: 1 }],
    })
    expect(refused.statusCode).toBe(400)
    expect(refused.body).toContain('Only products on a receipt')
  })
})
