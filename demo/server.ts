// The real SALEANE server (server/app.ts) running inside the page. Requests to /api/* are answered
// here instead of over the network, and the database is saved in this browser between visits.
import { createApiHandler } from '../server/app'
import type { ApiHandler } from '../server/app'
import { Buffer } from './shims/buffer'
import { DEMO_DATE } from '../src/domain/model'
import { exportDatabase, initSqlite } from './shims/sqlite'

const ORIGIN = 'http://saleane.demo'
const STORE = 'saleane.demo.database.v2'
export const DEMO_EMAIL = 'owner@atelier.demo'
export const DEMO_PASSWORD = 'saleane-demo-2026'

let cookie = ''
let api: ApiHandler

function saved(): Uint8Array | undefined {
  try {
    localStorage.removeItem('saleane.demo.database.v1')
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
    operations: { mode: string; refunds: unknown[] }
    sales: unknown[]
    payments: unknown[]
    events: { saleId?: string; type?: string }[]
  }
  state.operations.mode = 'local'
  // A real studio follows the real calendar, so move the sample's 6 October day to today.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
  const shift = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${DEMO_DATE}T00:00:00Z`)
  const move = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(move)
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, move(item)]))
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(value)) return value
    const moved = new Date(Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value) + shift)
    return value.length === 10 ? moved.toISOString().slice(0, 10) : moved.toISOString()
  }
  Object.assign(state, move(state))
  state.operations.refunds = []
  state.sales = []
  state.payments = []
  state.events = state.events.filter((event) => !event.saleId)
  api.database.run('UPDATE organisations SET state=? WHERE id=?', JSON.stringify(state), orgId)
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
  await call(
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
