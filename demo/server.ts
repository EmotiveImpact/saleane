// The real SALEANE server (server/app.ts) running inside the page. Requests to /api/* are answered
// here instead of over the network, and the database is saved in this browser between visits.
import { createApiHandler } from '../server/app'
import type { ApiHandler } from '../server/app'
import { Buffer } from './shims/buffer'
import { exportDatabase, initSqlite } from './shims/sqlite'

const ORIGIN = 'http://saleane.demo'
const STORE = 'saleane.demo.database.v1'
export const DEMO_EMAIL = 'owner@atelier.demo'
export const DEMO_PASSWORD = 'saleane-demo-2026'

let cookie = ''
let api: ApiHandler

function saved(): Uint8Array | undefined {
  try {
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
  if (!['GET', 'HEAD'].includes(method)) persist()
  return result
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
  const csrf = register.json<{ csrf: string }>().csrf
  await call(
    'POST',
    '/api/workspaces',
    JSON.stringify({
      name: 'Atelier House New York',
      region: 'US',
      locationName: 'West Village',
      address: '88 Bank Street, New York, NY',
      timeZone: 'America/New_York',
      sample: true,
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
    if (!sessionStorage.getItem('saleane.workspace')) {
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
