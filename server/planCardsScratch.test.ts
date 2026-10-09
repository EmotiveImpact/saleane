// @vitest-environment node
// Stage 1: scripts/plan-cards-scratch.mjs moves a scratch membership's dates so the real loop,
// on the real clock, reminds about a card payment and then takes it. This checks the recipe the
// evidence file gives for rehearsing it in a browser.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import { testProvider } from './messaging/providers'
import { testPaymentProvider } from './payments/providers'
import { cardAgreementWording } from '../src/domain/planCards'
import type { BusinessState } from '../src/domain/model'

const origin = 'http://127.0.0.1:5173'
const script = fileURLToPath(new URL('../scripts/plan-cards-scratch.mjs', import.meta.url))
let clock = Date.parse('2026-10-09T08:30:00.000Z')
const folder = mkdtempSync(join(tmpdir(), 'saleane-scratch-'))
const file = join(folder, 'scratch.sqlite')
afterAll(() => rmSync(folder, { recursive: true, force: true }))
let api: ApiHandler
const open = () =>
  (api = createApiHandler({
    origin,
    databasePath: file,
    now: () => clock,
    turnstile: null,
    providers: { email: testProvider('email'), sms: testProvider('sms'), receipt: () => null },
    paymentProvider: testPaymentProvider(origin),
  }))

it('moves a scratch membership so the real loop reminds, then charges', async () => {
  open()
  const reg = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email: 'owner@example.invalid',
      password: 'Fictional local account 2026!',
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK' },
    },
  })
  const login = {
    ...reg.json<{ csrf: string; orgId: string }>(),
    cookie: String((reg as InjectResponse).headers['set-cookie']).split(';')[0],
  }
  const headers = { cookie: login.cookie, 'x-csrf-token': login.csrf }
  const studio = async () =>
    (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers })).json<{
      state: BusinessState
    }>().state
  const run = async (command: object) => {
    const { revision } = await studio()
    const r = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${login.orgId}/commands`,
      headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
      payload: { revision, command },
    })
    expect(r.statusCode, r.body).toBe(200)
    return r.json<{ recordId: string }>().recordId
  }
  const serviceId = await run({
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
  const clientId = await run({
    type: 'client',
    contact: {
      name: 'Rosa Okafor',
      email: 'rosa@example.invalid',
      phone: '+44 7700 900333',
      marketingConsent: false,
    },
  })
  await run({
    type: 'offer',
    input: {
      kind: 'membership',
      name: 'Facial club',
      serviceIds: [serviceId],
      visits: 1,
      priceMinor: 7500,
      discountPercent: 10,
      validMonths: 1,
      archived: false,
    },
  })
  const holdingId = await run({
    type: 'plan-sell',
    offerId: (await studio()).offers![0].id,
    clientId,
    method: 'cash',
  })
  const cardId = crypto.randomUUID()
  api.database.run(
    `INSERT INTO saved_cards(id,organisation_id,client_id,provider,customer_ref,method_ref,brand,last4,exp_month,exp_year,agreed,created_at)
     VALUES(?,?,?,'test',?,?,'Visa','4242',12,2029,'Saved.',?)`,
    cardId,
    login.orgId,
    clientId,
    'c',
    'm',
    clock,
  )
  const state = await studio()
  const set = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/plan-cards/${holdingId}`,
    headers,
    payload: {
      cardId,
      wording: cardAgreementWording(
        state,
        state.holdings!.find((h) => h.id === holdingId)!,
        { brand: 'Visa', last4: '4242' },
      ),
      agreed: true,
    },
  })
  expect(set.statusCode, set.body).toBe(200)
  api.close()
  // Only a database whose path says it is a scratch copy.
  expect(() =>
    execFileSync('node', [script, join(folder, 'live.sqlite'), holdingId, 'due'], {
      stdio: 'pipe',
    }),
  ).toThrow()
  expect(
    execFileSync('node', [script, file, holdingId, 'remind', '2026-10-09']).toString(),
  ).toContain('next card payment 2026-10-12')
  open()
  clock = Date.parse('2026-10-09T09:30:00.000Z')
  await api.memberships.tick()
  const reminders = api.database.all<{ slot: string }>(
    "SELECT slot FROM outbox WHERE kind='plan_reminder'",
  )
  expect(reminders.map((r) => r.slot)).toEqual([
    `${holdingId}:2026-10-12`,
    `${holdingId}:2026-10-12`,
  ])
  api.close()
  expect(
    execFileSync('node', [script, file, 'rosa@example.invalid', 'due', '2026-10-09']).toString(),
  ).toContain('Reminders moved to it: 2.')
  open()
  await api.memberships.tick()
  const rows = api.database.all<{ status: string; period_start: string }>(
    'SELECT status,period_start FROM membership_charges',
  )
  expect(rows).toEqual([{ status: 'succeeded', period_start: '2026-10-09' }])
  const after = await studio()
  expect(after.holdings![0].payments.at(-1)).toMatchObject({
    method: 'card',
    periodStart: '2026-10-09',
  })
  api.close()
})
