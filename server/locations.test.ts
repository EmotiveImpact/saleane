// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import { bookingLink } from './messaging/receptionistText'

// V2: a guest books at a second location through the public booking API.
const origin = 'http://127.0.0.1:5173'
const contact = {
  name: 'New Guest',
  email: 'new.guest@example.invalid',
  phone: '+44 7700 900111',
  marketingConsent: false,
}
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
let clock: number

beforeEach(() => {
  clock = Date.parse('2026-10-06T08:00:00.000Z')
  api = createApiHandler({ origin, databasePath: ':memory:', now: () => clock, turnstile: null })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register() {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email: 'owner@example.invalid',
      password: 'Fictional local account 2026!',
      workspace: { name: 'Reference Studio', locationName: 'London', region: 'UK', sample: true },
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
async function studio(login: Login) {
  return (
    await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })
  ).json<{ slug: string; state: BusinessState }>()
}
async function run(login: Login, command: Command) {
  const { state } = await studio(login)
  const response = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision: state.revision, command },
  })
  expect(response.statusCode, response.body).toBe(200)
  return (await studio(login)).state
}

describe('booking at another location', () => {
  it('offers the location, finds its times and books the visit there', async () => {
    const owner = await register()
    let state = await run(owner, {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street, London' },
    } as Command)
    const islington = state.operations!.locations![0].id
    state = await run(owner, {
      type: 'resource',
      input: { name: 'Islington room', type: 'treatment', locationId: islington },
    } as Command)
    const hours = state.operations!.hours.map((h) => ({ ...h, locationId: islington }))
    state = await run(owner, {
      type: 'staff',
      input: {
        name: 'Nia Fictional',
        role: 'Facialist',
        serviceIds: ['service-facial'],
        tone: 'sage',
        hours,
      },
    } as Command)
    const nia = state.staff.find((p) => p.name === 'Nia Fictional')!.id
    // The facial costs more in Islington.
    const facial = state.services.find((x) => x.id === 'service-facial')!
    const { id: _id, organisationId: _org, ...facialInput } = facial
    void [_id, _org]
    await run(owner, {
      type: 'service',
      id: facial.id,
      input: { ...facialInput, locationPrices: [{ locationId: islington, priceMinor: 12500 }] },
    } as Command)
    const { slug } = await studio(owner)

    const page = (await api.inject({ url: `/api/public/${slug}` })).json<{
      locations: { id: string; name: string }[]
      staff: { id: string; locationIds: string[] }[]
    }>()
    expect(page.locations.map((l) => l.name)).toEqual(['London', 'Islington'])
    // Guests choosing Islington are offered only the people who work there.
    expect(page.staff.find((p) => p.id === nia)?.locationIds).toEqual([islington])
    expect(page.staff.find((p) => p.id !== nia)?.locationIds).not.toContain(islington)

    const times = (query: Record<string, string>) =>
      api
        .inject({
          url: `/api/public/${slug}/availability?${new URLSearchParams({
            serviceId: 'service-facial',
            date: '2026-10-08',
            ...query,
          })}`,
        })
        .then((r) => r.json<{ times: number[] }>().times)
    // A time the AI receptionist texts opens the booking page where Nia works that day.
    const offered = {
      kind: 'time' as const,
      serviceId: 'service-facial',
      staffId: nia,
      date: '2026-10-08',
      startMinutes: 600,
    }
    expect(bookingLink(origin, slug, offered, (await studio(owner)).state)).toContain(
      `location=${islington}`,
    )
    // Nia only works in Islington, so she has no times at the main location.
    const main = page.locations[0].id
    expect(await times({ staffId: nia, locationId: main })).toEqual([])
    expect(await times({ staffId: nia })).toContain(600)
    expect(await times({ staffId: nia, locationId: islington })).toContain(600)

    const hold = await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/holds`,
      payload: {
        serviceId: 'service-facial',
        staffId: 'any',
        date: '2026-10-08',
        startMinutes: 600,
        locationId: islington,
      },
    })
    expect(hold.statusCode, hold.body).toBe(201)
    // The held time is taken: Islington has one room, so 10:00 is gone there.
    expect(await times({ staffId: 'any', locationId: islington })).not.toContain(600)
    const booked = await api.inject({
      method: 'POST',
      url: `/api/public/${slug}/book`,
      payload: { hold: hold.json<{ hold: string }>().hold, contact, policy: true },
    })
    expect(booked.statusCode, booked.body).toBe(200)
    const visit = (await studio(owner)).state.appointments.find(
      (a) => a.id === booked.json<{ appointmentId: string }>().appointmentId,
    )!
    expect(visit).toMatchObject({ locationId: islington, staffId: nia, bookedPriceMinor: 12500 })
  })
})

describe('moving a visit to another location', () => {
  /** A sample studio with Islington open, a room there and Nia working there every day. */
  async function twoSites() {
    const owner = await register()
    let state = await run(owner, {
      type: 'location',
      input: { name: 'Islington', address: '1 Upper Street, London' },
    } as Command)
    const islington = state.operations!.locations![0].id
    state = await run(owner, {
      type: 'resource',
      input: { name: 'Islington room', type: 'treatment', locationId: islington },
    } as Command)
    state = await run(owner, {
      type: 'staff',
      input: {
        name: 'Nia Fictional',
        role: 'Facialist',
        serviceIds: ['service-facial'],
        tone: 'sage',
        hours: state.operations!.hours.map((h) => ({ ...h, locationId: islington })),
      },
    } as Command)
    const nia = state.staff.find((p) => p.name === 'Nia Fictional')!.id
    return { owner, islington, nia, main: state.organisation.locationId }
  }
  async function book(login: Login, staffId: string, startMinutes: number, locationId?: string) {
    const { state } = await studio(login)
    const response = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${login.orgId}/commands`,
      headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
      payload: {
        revision: state.revision,
        command: {
          type: 'book',
          input: {
            serviceId: 'service-facial',
            staffId,
            date: '2026-10-08',
            startMinutes,
            clientId: 'client-1',
            source: 'desk',
            ...(locationId ? { locationId } : {}),
          },
        },
      },
    })
    expect(response.statusCode, response.body).toBe(200)
    return response.json<{ recordId: string }>().recordId
  }
  async function send(login: Login, command: Command) {
    const { state } = await studio(login)
    return api.inject({
      method: 'POST',
      url: `/api/workspaces/${login.orgId}/commands`,
      headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
      payload: { revision: state.revision, command },
    })
  }
  const visitOf = async (login: Login, id: string) =>
    (await studio(login)).state.appointments.find((a) => a.id === id)!

  it('moves to someone working at the other location, and refuses a time not free there', async () => {
    const { owner, islington, nia, main } = await twoSites()
    const first = await book(owner, 'staff-maya', 600)
    expect((await visitOf(owner, first)).locationId).toBe(main)
    const moved = await send(owner, {
      type: 'reschedule',
      appointmentId: first,
      staffId: nia,
      date: '2026-10-08',
      startMinutes: 600,
      locationId: islington,
    })
    expect(moved.statusCode, moved.body).toBe(200)
    expect(await visitOf(owner, first)).toMatchObject({
      locationId: islington,
      staffId: nia,
      startMinutes: 600,
    })
    // Islington has one room and Nia is there at 10:00, so another visit cannot join her.
    const second = await book(owner, 'staff-maya', 900)
    const clash = await send(owner, {
      type: 'reschedule',
      appointmentId: second,
      staffId: nia,
      date: '2026-10-08',
      startMinutes: 600,
      locationId: islington,
    })
    expect(clash.statusCode).toBe(409)
    expect(await visitOf(owner, second)).toMatchObject({
      locationId: main,
      staffId: 'staff-maya',
      startMinutes: 900,
    })
  })

  it('moves a visit to another location inside an approved plan', async () => {
    const { owner, islington, nia } = await twoSites()
    const first = await book(owner, 'staff-maya', 600)
    const second = await book(owner, 'staff-maya', 900)
    const plan = await send(owner, {
      type: 'batch',
      label: 'Move the morning to Islington',
      commands: [
        {
          type: 'reschedule',
          appointmentId: first,
          staffId: nia,
          date: '2026-10-08',
          startMinutes: 660,
          locationId: islington,
        },
      ],
    } as Command)
    expect(plan.statusCode, plan.body).toBe(200)
    expect(await visitOf(owner, first)).toMatchObject({ locationId: islington, staffId: nia })
    // A plan that moves into a time already taken there is refused as a whole.
    const clash = await send(owner, {
      type: 'batch',
      label: 'Move the afternoon to Islington',
      commands: [
        {
          type: 'reschedule',
          appointmentId: second,
          staffId: nia,
          date: '2026-10-08',
          startMinutes: 660,
          locationId: islington,
        },
      ],
    } as Command)
    expect(clash.statusCode).toBe(409)
    expect((await visitOf(owner, second)).staffId).toBe('staff-maya')
  })
})
