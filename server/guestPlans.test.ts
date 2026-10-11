// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { guestViewSchema } from '../src/domain/guest'
import type { GuestView } from '../src/domain/guest'
import type { OfferInput } from '../src/domain/plansSchema'

// Stage 1: a guest sees the packages and memberships they hold on their own visit page, worked
// out on the server from the link's visit and its client only.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number

beforeEach(() => {
  // 07:00Z on Tuesday 6 October is 08:00 in London.
  clock = Date.parse('2026-10-06T07:00:00.000Z')
  api = createApiHandler({ origin, databasePath: ':memory:', now: () => clock, turnstile: null })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(sample: boolean, email = 'owner@example.invalid'): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password,
      workspace: { name: 'Linden Studio', locationName: 'London', region: 'UK', sample },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
/** Signs the owner in again, after the clock has moved past their session. */
async function signIn(login: Login, email = 'owner@example.invalid'): Promise<Login> {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  })
  expect(response.statusCode, response.body).toBe(200)
  return {
    ...login,
    csrf: response.json<{ csrf: string }>().csrf,
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
const studio = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    state: BusinessState
  }>().state
async function run(login: Login, command: Command) {
  const { revision } = await studio(login)
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision, command },
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ recordId: string }>().recordId
}
/** A private link for one visit, made at the desk. */
async function link(login: Login, appointmentId: string) {
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/guest-links`,
    headers: headers(login),
    payload: { appointmentId },
  })
  expect(response.statusCode, response.body).toBe(201)
  return response.json<{ url: string }>().url.split('#')[1]
}
async function visit(token: string) {
  const response = await api.inject({ method: 'POST', url: '/api/guest/visit', payload: { token } })
  expect(response.statusCode, response.body).toBe(200)
  return { view: guestViewSchema.parse(response.json<GuestView>()), body: response.body }
}

const pkg: OfferInput = {
  kind: 'package',
  name: 'Six facials',
  serviceIds: [],
  visits: 6,
  priceMinor: 48000,
  discountPercent: 0,
  validMonths: 6,
  archived: false,
}
const club: OfferInput = {
  kind: 'membership',
  name: 'Facial club',
  serviceIds: [],
  visits: 1,
  priceMinor: 7500,
  discountPercent: 10,
  validMonths: 1,
  archived: false,
}

/**
 * A studio of its own (not a sample), with a facial that takes no deposit, a facialist and two
 * clients, each with a facial booked at the desk.
 */
async function localStudio() {
  const owner = await register(false)
  await run(owner, { type: 'resource', input: { name: 'Room One', type: 'treatment' } })
  const serviceId = await run(owner, {
    type: 'service',
    input: {
      name: 'Restorative facial',
      description: 'A fictional service',
      category: 'Skin',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceMinor: 9500,
      depositMinor: 0,
      resourceType: 'treatment',
    },
  })
  const staffId = await run(owner, {
    type: 'staff',
    input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [serviceId], tone: 'sage' },
  })
  const book = (date: string, startMinutes: number, who: { clientId?: string; name?: string }) =>
    run(owner, {
      type: 'book',
      input: {
        serviceId,
        staffId,
        date,
        startMinutes,
        source: 'desk',
        ...(who.clientId
          ? { clientId: who.clientId }
          : {
              contact: {
                name: who.name!,
                email: `${who.name!.split(' ')[0].toLowerCase()}@example.invalid`,
                phone: '+44 7700 900444',
                marketingConsent: false,
              },
            }),
      },
    })
  const rosaVisit = await book('2026-10-09', 600, { name: 'Rosa Okafor' })
  const jonVisit = await book('2026-10-09', 720, { name: 'Jon Hale' })
  const state = await studio(owner)
  const clientOf = (id: string) => state.appointments.find((a) => a.id === id)!.clientId
  const sell = async (input: OfferInput, clientId = clientOf(rosaVisit)) => {
    const offerId = await run(owner, {
      type: 'offer',
      input: { ...input, serviceIds: [serviceId] },
    })
    return run(owner, { type: 'plan-sell', offerId, clientId, method: 'cash' })
  }
  return {
    owner,
    sell,
    book,
    rosa: { visitId: rosaVisit, clientId: clientOf(rosaVisit) },
    jon: { visitId: jonVisit, clientId: clientOf(jonVisit) },
  }
}

describe('a guest’s plans on their visit page', () => {
  it('shows a package with visits left, its last day and that it can pay for this visit', async () => {
    const { owner, sell, rosa } = await localStudio()
    const holdingId = await sell(pkg)
    const { view, body } = await visit(await link(owner, rosa.visitId))
    expect(view.plans).toEqual([
      {
        kind: 'package',
        name: 'Six facials',
        state: 'active',
        visits: 6,
        visitsLeft: 6,
        endsOn: '2027-04-05',
        thisVisit: { outcome: 'covers' },
      },
    ])
    // Nothing about money, payments, the plan's record or the client.
    // Stage 6: her first name is on her visit's label; her full name and record stay out.
    for (const secret of [holdingId, rosa.clientId, 'Okafor', '48000', '480', 'cash'])
      expect(body).not.toContain(secret)
    expect(JSON.stringify(view.plans)).not.toMatch(/Minor|pay|price/i)
  })

  it('shows a membership with this month’s visits, its discount and the next month', async () => {
    const { owner, sell, rosa } = await localStudio()
    await sell(club)
    const { view } = await visit(await link(owner, rosa.visitId))
    expect(view.plans).toEqual([
      {
        kind: 'membership',
        name: 'Facial club',
        state: 'active',
        visits: 1,
        visitsLeft: 1,
        discountPercent: 10,
        nextMonthOn: '2026-11-06',
        thisVisit: { outcome: 'covers' },
      },
    ])
  })

  it('says when a membership’s month is not paid yet, and shows it again once it is', async () => {
    const { owner, sell, book, rosa } = await localStudio()
    const holdingId = await sell(club)
    // A month on, nobody has taken November’s payment. The owner signs in again; `book` and
    // `sell` use the same login.
    clock = Date.parse('2026-11-10T10:00:00.000Z')
    Object.assign(owner, await signIn(owner))
    const later = await book('2026-11-13', 600, { clientId: rosa.clientId })
    const token = await link(owner, later)
    expect((await visit(token)).view.plans).toEqual([
      {
        kind: 'membership',
        name: 'Facial club',
        state: 'unpaid',
        discountPercent: 10,
        thisVisit: { outcome: 'covers_once_paid', monthOn: '2026-11-06' },
      },
    ])
    await run(owner, { type: 'plan-renew', holdingId, method: 'cash' })
    expect((await visit(token)).view.plans).toEqual([
      expect.objectContaining({
        state: 'active',
        visitsLeft: 1,
        nextMonthOn: '2026-12-06',
        thisVisit: { outcome: 'covers' },
      }),
    ])
  })

  it('leaves out a cancelled plan', async () => {
    const { owner, sell, rosa } = await localStudio()
    const holdingId = await sell(pkg)
    await run(owner, { type: 'plan-cancel', holdingId, reason: 'Moving away' })
    const { view, body } = await visit(await link(owner, rosa.visitId))
    expect(view.plans).toBeUndefined()
    expect(body).not.toContain('Six facials')
  })

  it('shows two plans, and only the one checkout offers first pays for this visit', async () => {
    const { owner, sell, rosa } = await localStudio()
    await sell(pkg)
    await sell(club)
    const { view } = await visit(await link(owner, rosa.visitId))
    expect(view.plans).toHaveLength(2)
    expect(view.plans![0]).toMatchObject({ kind: 'package', thisVisit: { outcome: 'covers' } })
    expect(view.plans![1]).toMatchObject({ kind: 'membership', visitsLeft: 1 })
    expect(view.plans![1].thisVisit).toBeUndefined()
  })

  it('never shows one client’s plans on another client’s visit', async () => {
    const { owner, sell, rosa, jon } = await localStudio()
    await sell(pkg)
    await sell(club, jon.clientId)
    const rosaView = await visit(await link(owner, rosa.visitId))
    const jonView = await visit(await link(owner, jon.visitId))
    expect(rosaView.view.plans!.map((p) => p.name)).toEqual(['Six facials'])
    expect(rosaView.body).not.toContain('Facial club')
    expect(jonView.view.plans!.map((p) => p.name)).toEqual(['Facial club'])
    expect(jonView.body).not.toContain('Six facials')
    // Another studio's guest sees none of them either.
    const other = await register(true, 'other@example.invalid')
    const theirs = (await studio(other)).appointments.find(
      (a) => a.status === 'confirmed' && a.date >= '2026-10-07',
    )!
    const { view, body } = await visit(await link(other, theirs.id))
    expect(view.plans).toBeUndefined()
    expect(body).not.toContain('Six facials')
  })

  it('keeps every visit page in the sample studios valid, with plans sold', async () => {
    const owner = await register(true)
    let shown = 0
    for (const region of ['UK', 'US'] as const) {
      const login =
        region === 'UK'
          ? owner
          : await (async () => {
              const made = await api.inject({
                method: 'POST',
                url: '/api/workspaces',
                headers: headers(owner),
                payload: {
                  workspace: {
                    name: 'Linden Studio New York',
                    locationName: 'West Village',
                    region: 'US',
                    sample: true,
                  },
                },
              })
              expect(made.statusCode, made.body).toBe(201)
              return { ...owner, orgId: made.json<{ orgId: string }>().orgId }
            })()
      const state = await studio(login)
      const upcoming = state.appointments.filter(
        (a) => a.status === 'confirmed' && a.date >= '2026-10-06',
      )
      const facial = state.services.find((s) => s.id === 'service-facial')!
      for (const [index, input] of [pkg, club].entries()) {
        const offerId = await run(login, {
          type: 'offer',
          input: { ...input, serviceIds: [facial.id] },
        })
        await run(login, {
          type: 'plan-sell',
          offerId,
          clientId: upcoming[index].clientId,
          method: 'demo_cash',
        })
      }
      for (const a of upcoming) {
        const { view } = await visit(await link(login, a.id))
        if (view.plans) shown += 1
      }
    }
    expect(shown).toBeGreaterThan(1)
  })
})
