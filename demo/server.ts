// The real SALEANE server (server/app.ts) running inside the page. Requests to /api/* are answered
// here instead of over the network, and the database is saved in this browser between visits.
import { createApiHandler } from '../server/app'
import type { ApiHandler } from '../server/app'
import { Buffer } from './shims/buffer'
import type { BusinessState } from '../src/domain/model'
import { catchUpSampleDay, moveSampleDay } from '../src/domain/sampleDay'
import { exportDatabase, initSqlite } from './shims/sqlite'

const ORIGIN = 'http://saleane.demo'
declare const __DEMO_BUILD__: string

const STORE_PREFIX = 'saleane.demo.database.'
const STORE = STORE_PREFIX + __DEMO_BUILD__
export const DEMO_EMAIL = 'owner@atelier.demo'
export const DEMO_PASSWORD = 'saleane-demo-2026'

let cookie = ''
let api: ApiHandler

function saved(): Uint8Array | undefined {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(STORE_PREFIX) && key !== STORE) localStorage.removeItem(key)
    const text = localStorage.getItem(STORE)
    return text ? Buffer.from(text, 'base64') : undefined
  } catch {
    return undefined
  }
}
function persist() {
  try {
    const bytes = exportDatabase()
    if (bytes) localStorage.setItem(STORE, Buffer.from(bytes).toString('base64'))
  } catch {
    // Storage can be full or blocked; the demo still works until the tab closes.
  }
}
export function resetDemo() {
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    // Nothing stored.
  }
}

/** Runs the message outbox in test mode after a change, as the local server does on a timer. */
function sendSoon() {
  void api.outbox
    .tick()
    .then(persist)
    .catch(() => {})
}

async function call(
  method: string,
  url: string,
  body?: string,
  extra: Record<string, string> = {},
) {
  const result = await api.inject({
    method,
    url,
    headers: { ...extra, ...(cookie ? { cookie } : {}) },
    rawPayload: body,
  })
  const set = result.headers['set-cookie']
  for (const line of Array.isArray(set) ? set : set ? [set] : []) {
    const pair = line.split(';')[0]
    cookie = /Max-Age=0/.test(line) || pair.endsWith('=') ? '' : pair
  }
  if (!['GET', 'HEAD'].includes(method)) {
    persist()
    sendSoon()
  }
  return result
}

/**
 * London runs as a real studio in test mode, so card payments, deposits and messages behave as a
 * pilot studio's would. A real studio cannot hold the sample's simulated payments, so its visits
 * start without payment history; anything paid in the demo is then recorded in test mode.
 * New York stays a sample studio with simulated payments.
 */
function makeTestModeStudio(orgId: string) {
  const row = api.database.get<{ state: string }>(
    'SELECT state FROM organisations WHERE id=?',
    orgId,
  )
  if (!row) return
  const state = JSON.parse(row.state) as {
    operations: {
      mode: string
      refunds: unknown[]
      movements?: { saleId?: string; counterSaleId?: string }[]
      receptionist?: { enabled: boolean; handOver: boolean }
    }
    sales: unknown[]
    payments: unknown[]
    events: { saleId?: string; type?: string }[]
    counterSales?: unknown[]
    giftCards?: { payment: { method: string }; refunds: { method: string }[] }[]
  }
  state.operations.mode = 'local'
  // A real studio follows the real calendar, so move the sample's 6 October day to today.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
  Object.assign(state, moveSampleDay(state as unknown as BusinessState, today))
  state.operations.refunds = []
  // Product sales belong to the stripped receipts, so their stock movements go with them.
  if (state.operations.movements)
    state.operations.movements = state.operations.movements.filter(
      (movement) => !movement.saleId && !movement.counterSaleId,
    )
  if (state.counterSales) state.counterSales = []
  // The sample gift cards were paid with simulated cards; a real studio records them as cash.
  for (const card of state.giftCards ?? [])
    for (const record of [card.payment, ...card.refunds])
      if (record.method.startsWith('demo_')) record.method = 'cash'
  // The AI receptionist is off for a new studio; the demo switches it on so the booking page shows it.
  state.operations.receptionist = { enabled: true, handOver: true }
  state.sales = []
  state.payments = []
  state.events = state.events.filter((event) => !event.saleId)
  // The sample day stood at 10:45; on the real calendar the real time of day decides what happened.
  catchUpSampleDay(state as unknown as BusinessState, Date.now())
  api.database.run('UPDATE organisations SET state=? WHERE id=?', JSON.stringify(state), orgId)
}

type DemoState = {
  revision: number
  services: { id: string; name: string; priceMinor: number }[]
  clients: { id: string }[]
  appointments: { clientId: string; status: string }[]
  offers?: { id: string; name: string }[]
}

/** Two sample plans per studio, each already held by one client, so the plan screens show something. */
async function seedPlans(orgId: string, csrf: string, sample: boolean) {
  let state = (await call('GET', `/api/workspaces/${orgId}`)).json<{ state: DemoState }>().state
  let n = 0
  const send = async (command: Record<string, unknown>) => {
    const result = await call(
      'POST',
      `/api/workspaces/${orgId}/commands`,
      JSON.stringify({ revision: state.revision, command }),
      { 'x-csrf-token': csrf, 'idempotency-key': `demo-plans-${orgId}-${n++}` },
    )
    if (result.statusCode !== 200) throw new Error(`Demo plans: ${result.body}`)
    state = result.json<{ state: DemoState }>().state
  }
  const facial = state.services.find((s) => /facial/i.test(s.name)) ?? state.services[0]
  const massages = state.services.filter((s) => /massage/i.test(s.name))
  if (!facial) return
  const round = (minor: number) => Math.round(minor / 500) * 500
  await send({
    type: 'offer',
    input: {
      kind: 'package',
      name: `${facial.name}, course of five`,
      serviceIds: [facial.id],
      visits: 5,
      priceMinor: round(facial.priceMinor * 5 * 0.85),
      discountPercent: 0,
      validMonths: 6,
      archived: false,
    },
  })
  await send({
    type: 'offer',
    input: {
      kind: 'membership',
      name: 'Monthly ritual',
      serviceIds: (massages.length ? massages : [facial]).map((s) => s.id),
      visits: 1,
      priceMinor: round((massages[0] ?? facial).priceMinor * 0.9),
      discountPercent: 10,
      validMonths: 1,
      archived: false,
    },
  })
  // Clients with a visit still to come, so the plan can be used at checkout.
  const upcoming = [
    ...new Set(state.appointments.filter((a) => a.status === 'confirmed').map((a) => a.clientId)),
  ]
  const method = sample ? 'demo_card' : 'cash'
  for (const [index, offer] of (state.offers ?? []).entries()) {
    const clientId = upcoming[index] ?? state.clients[index]?.id
    if (clientId) await send({ type: 'plan-sell', offerId: offer.id, clientId, method })
  }
}

async function seed() {
  const register = await call(
    'POST',
    '/api/auth/register',
    JSON.stringify({
      name: 'Amara Okafor',
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      workspace: {
        name: 'Atelier House',
        region: 'UK',
        locationName: 'Marylebone',
        address: '14 Ivory Lane, London W1',
        timeZone: 'Europe/London',
        sample: true,
      },
    }),
  )
  if (register.statusCode !== 201) throw new Error(`Demo setup failed: ${register.body}`)
  const { csrf, orgId } = register.json<{ csrf: string; orgId: string }>()
  makeTestModeStudio(orgId)
  await seedPlans(orgId, csrf, false).catch((error: unknown) => console.warn(error))
  const created = await call(
    'POST',
    '/api/workspaces',
    JSON.stringify({
      workspace: {
        name: 'Atelier House New York',
        region: 'US',
        locationName: 'West Village',
        address: '88 Bank Street, New York, NY',
        timeZone: 'America/New_York',
        sample: true,
      },
    }),
    { 'x-csrf-token': csrf },
  )
  if (created.statusCode === 201) {
    const newYork = created.json<{ orgId: string }>().orgId
    await seedPlans(newYork, csrf, true).catch((error: unknown) => console.warn(error))
  }
}

let appBase = ''

export async function startDemoServer(base = '') {
  appBase = base
  const restored = saved()
  try {
    await initSqlite(restored)
    api = createApiHandler({ origin: ORIGIN, databasePath: ':memory:', turnstile: null })
  } catch {
    // An unreadable or older saved demo starts again from fresh fictional data.
    resetDemo()
    await initSqlite()
    api = createApiHandler({ origin: ORIGIN, databasePath: ':memory:', turnstile: null })
  }
  try {
    cookie = sessionStorage.getItem('saleane.demo.cookie') ?? ''
  } catch {
    cookie = ''
  }
  const fresh = !api.database.get('SELECT id FROM accounts LIMIT 1')
  if (fresh) await seed()
  else if (!cookie || (await call('GET', '/api/session')).statusCode !== 200) {
    const login = await call(
      'POST',
      '/api/auth/login',
      JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    )
    if (login.statusCode !== 200) cookie = ''
  }

  // Open the fictional London studio from the server, as a signed-in owner would see it.
  try {
    if (fresh || !sessionStorage.getItem('saleane.workspace')) {
      const session = (await call('GET', '/api/session')).json<{
        workspaces: { id: string; region: string }[]
      }>()
      const studio = session.workspaces.find((w) => w.region === 'UK') ?? session.workspaces[0]
      if (studio) sessionStorage.setItem('saleane.workspace', studio.id)
    }
    sessionStorage.setItem('saleane.demo.cookie', cookie)
  } catch {
    // Without session storage the app opens its browser-only sample instead.
  }

  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      location.href,
    )
    if (url.origin !== location.origin || !url.pathname.includes('/api/'))
      return realFetch(input, init)
    const path = url.pathname.slice(url.pathname.indexOf('/api/')) + url.search
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value
    })
    const result = await call(
      (init.method ?? 'GET').toUpperCase(),
      path,
      typeof init.body === 'string' ? init.body : undefined,
      headers,
    )
    try {
      sessionStorage.setItem('saleane.demo.cookie', cookie)
    } catch {
      // The session simply lasts until the tab closes.
    }
    const responseHeaders = new Headers()
    for (const [key, value] of Object.entries(result.headers))
      if (key !== 'set-cookie')
        responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value)
    // Links the server writes (such as a guest's manage link) point back into this demo page.
    const body = result.body.split(ORIGIN).join(`${location.origin}${appBase}`)
    return new Response(result.statusCode === 204 ? null : body, {
      status: result.statusCode,
      headers: responseHeaders,
    })
  }
}
