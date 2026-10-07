// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'
import type { GuestView } from '../src/domain/guest'

// V1.5: private feedback through the guest's own link. Only owners and managers read answers;
// reception sees none, a practitioner sees only their own average, and staff cannot write one.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
const contact = {
  name: 'Link Guest',
  email: 'link.guest@example.invalid',
  phone: '+44 7700 900222',
  marketingConsent: false,
}
type Login = { cookie: string; csrf: string; orgId: string }
type Manage = { url: string; expiresAt: string; delivery: string }
let api: ApiHandler
let clock: number

beforeEach(() => {
  // 9:00 on 7 October in London is 08:00Z, so the 24-hour cutoff is 08:00Z on 6 October.
  // The sample studio's day, early in the morning, so its visits are still ahead.
  clock = Date.parse('2026-10-06T06:00:00.000Z')
  api = createApiHandler({ origin, databasePath: ':memory:', now: () => clock })
})
afterEach(() => api.close())

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
async function register(email = 'owner@example.invalid') {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Ada Owner',
      email,
      password,
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
async function book(slug: string, startMinutes = 540) {
  const held = await api.inject({
    method: 'POST',
    url: `/api/public/${slug}/holds`,
    payload: {
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date: '2026-10-06',
      startMinutes,
    },
  })
  expect(held.statusCode, held.body).toBe(201)
  const payload = { hold: held.json<{ hold: string }>().hold, contact, policy: true }
  const booked = await api.inject({ method: 'POST', url: `/api/public/${slug}/book`, payload })
  expect(booked.statusCode, booked.body).toBe(200)
  return { ...booked.json<{ appointmentId: string; manage: Manage }>(), payload }
}
const tokenOf = (manage: Manage) => manage.url.split('#')[1]
const visit = (token: string) =>
  api.inject({ method: 'POST', url: '/api/guest/visit', payload: { token } })
const run = (login: Login, revision: number, command: Command) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision, command },
  })

async function member(owner: Login, email: string, role: string, staffId?: string) {
  const invitation = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${owner.orgId}/invitations`,
    headers: headers(owner),
    payload: { email, role, staffId },
  })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Team Person',
      email,
      password,
      invitation: invitation.json<{ invitation: string }>().invitation,
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return {
    ...response.json<{ csrf: string; orgId: string }>(),
    orgId: owner.orgId,
    cookie: String(response.headers['set-cookie']).split(';')[0],
  }
}
const feedback = (token: string, extra: Record<string, unknown> = {}) =>
  api.inject({
    method: 'POST',
    url: '/api/guest/feedback',
    payload: {
      token,
      visitRating: 5,
      practitionerRating: 4,
      comment: 'Lovely, thank you',
      ...extra,
    },
  })
async function completed(owner: Login) {
  const { slug } = await studio(owner)
  // Maya's first free hour that afternoon in the sample studio.
  const booked = await book(slug, 990)
  const token = tokenOf(booked.manage)
  // Too early: the visit has not happened.
  expect((await feedback(token)).statusCode).toBe(409)
  clock = Date.parse('2026-10-06T15:45:00.000Z')
  let { state } = await studio(owner)
  const arrived = await run(owner, state.revision, {
    type: 'arrive',
    appointmentId: booked.appointmentId,
  })
  expect(arrived.statusCode, arrived.body).toBe(200)
  state = (await studio(owner)).state
  const done = await run(owner, state.revision, {
    type: 'checkout',
    appointmentId: booked.appointmentId,
    tipMinor: 0,
    method: 'demo_card',
  })
  expect(done.statusCode, done.body).toBe(200)
  return { token, appointmentId: booked.appointmentId }
}

describe('private guest feedback (V1.5)', () => {
  it('takes one answer through the guest link and shows it only to owners and managers', async () => {
    const owner = await register()
    const { token, appointmentId } = await completed(owner)
    const before = (await visit(token)).json<GuestView>()
    expect(before.feedback).toEqual({ open: true, given: null })
    const sent = await feedback(token)
    expect(sent.statusCode, sent.body).toBe(200)
    expect(sent.json<GuestView>().feedback).toEqual({
      open: false,
      given: { visitRating: 5, practitionerRating: 4 },
    })
    expect(sent.body).not.toContain('Lovely')
    // The same answer again lands once; a different one cannot replace it.
    expect((await feedback(token)).statusCode).toBe(200)
    expect((await feedback(token, { visitRating: 1 })).statusCode).toBe(409)
    const { state } = await studio(owner)
    expect(state.feedback!.filter((f) => f.appointmentId === appointmentId)).toEqual([
      expect.objectContaining({ visitRating: 5, comment: 'Lovely, thank you' }),
    ])
    const desk = await member(owner, 'desk@example.invalid', 'reception')
    const deskView = await api.inject({
      url: `/api/workspaces/${owner.orgId}`,
      headers: headers(desk),
    })
    expect(deskView.statusCode).toBe(200)
    expect(deskView.body).not.toContain('Lovely')
    expect(deskView.json<{ state: BusinessState }>().state.feedback).toBeUndefined()
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    const managerView = await api.inject({
      url: `/api/workspaces/${owner.orgId}`,
      headers: headers(manager),
    })
    expect(managerView.body).toContain('Lovely')
  })

  it('never lets the studio write feedback for a guest', async () => {
    const owner = await register()
    const { appointmentId } = await completed(owner)
    const { state } = await studio(owner)
    const forged = await run(owner, state.revision, {
      type: 'feedback',
      appointmentId,
      visitRating: 5,
      practitionerRating: 5,
      comment: '',
    })
    expect(forged.statusCode).toBe(403)
  })

  it('gives a practitioner only their own average, not answers', async () => {
    const owner = await register()
    const { token } = await completed(owner)
    await feedback(token)
    const maya = await member(owner, 'maya@example.invalid', 'practitioner', 'staff-maya')
    const view = await api.inject({ url: `/api/workspaces/${owner.orgId}`, headers: headers(maya) })
    expect(view.statusCode).toBe(200)
    expect(view.body).not.toContain('Lovely')
    // The sample studio's own fixture answers count towards Maya's average too.
    const rating = view.json<{
      practitioner: { rating: { count: number; average: number | null } }
    }>().practitioner.rating
    expect(rating.count).toBeGreaterThanOrEqual(1)
  })
})

describe('public review link (V1.5)', () => {
  it('offers every guest the same link after their visit, whatever they rated', async () => {
    const owner = await register()
    let { state } = await studio(owner)
    const saved = await run(owner, state.revision, {
      type: 'organisation',
      name: state.organisation.name,
      locationName: state.organisation.locationName,
      address: state.organisation.address,
      timeZone: state.organisation.timeZone,
      bookingEnabled: true,
      reviewUrl: 'https://reviews.example.invalid/reference',
    })
    expect(saved.statusCode, saved.body).toBe(200)
    const review = { url: 'https://reviews.example.invalid/reference' }
    const { token } = await completed(owner)
    expect((await visit(token)).json<GuestView>().review).toEqual(review)
    // A low private rating changes nothing about the invitation.
    const sent = await feedback(token, { visitRating: 1, practitionerRating: 1 })
    expect(sent.statusCode, sent.body).toBe(200)
    expect(sent.json<GuestView>().review).toEqual(review)
    state = (await studio(owner)).state
    const refused = await run(owner, state.revision, {
      type: 'organisation',
      name: state.organisation.name,
      locationName: state.organisation.locationName,
      address: state.organisation.address,
      timeZone: state.organisation.timeZone,
      bookingEnabled: true,
      reviewUrl: 'javascript:alert(1)',
    })
    expect(refused.statusCode).toBe(422)
  })
})

describe('guest forms (V1.5)', () => {
  const content = {
    title: 'Before your facial',
    intro: '',
    questions: [
      {
        id: 'q-goal',
        kind: 'choice' as const,
        label: 'What would you like most?',
        required: true,
        options: ['To relax', 'Brighter skin'],
      },
    ],
    agreement: 'I have read the cancellation policy.',
  }
  it('takes a form from the guest link and shows it to the desk and the practitioner', async () => {
    const owner = await register()
    let { state } = await studio(owner)
    const saved = await run(owner, state.revision, {
      type: 'form-save',
      content,
      settings: { serviceIds: ['service-facial'], when: 'every_visit' },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    const formId = saved.json<{ recordId: string }>().recordId
    const booked = await book((await studio(owner)).slug, 990)
    const token = tokenOf(booked.manage)
    const before = (await visit(token)).json<GuestView>()
    expect(before.forms).toEqual([{ formId, version: 1, content, done: false }])
    const send = (extra: Record<string, unknown> = {}) =>
      api.inject({
        method: 'POST',
        url: '/api/guest/form',
        payload: {
          token,
          formId,
          version: 1,
          answers: [{ questionId: 'q-goal', value: 'To relax' }],
          agreedName: 'L. Guest signature',
          ...extra,
        },
      })
    expect((await send({ agreedName: '' })).statusCode).toBe(409)
    const sent = await send()
    expect(sent.statusCode, sent.body).toBe(200)
    expect(sent.json<GuestView>().forms?.[0].done).toBe(true)
    // A retry is safe.
    expect((await send()).statusCode).toBe(200)
    state = (await studio(owner)).state
    expect(state.formResponses?.filter((r) => r.formId === formId)).toEqual([
      expect.objectContaining({
        appointmentId: booked.appointmentId,
        agreedName: 'L. Guest signature',
      }),
    ])
    // The studio cannot answer for the guest, and reception cannot change forms.
    const forged = await run(owner, state.revision, {
      type: 'form-submit',
      appointmentId: booked.appointmentId,
      formId,
      version: 1,
      answers: [{ questionId: 'q-goal', value: 'To relax' }],
      agreedName: 'Ada',
    })
    expect(forged.statusCode).toBe(403)
    const desk = await member(owner, 'desk2@example.invalid', 'reception')
    const deskEdit = await run(desk, state.revision, {
      type: 'form-archive',
      formId,
      archived: true,
    })
    expect(deskEdit.statusCode).toBe(403)
    const maya = await member(owner, 'maya2@example.invalid', 'practitioner', 'staff-maya')
    const mine = await api.inject({ url: `/api/workspaces/${owner.orgId}`, headers: headers(maya) })
    const visits = mine.json<{
      practitioner: {
        appointments: { id: string; forms?: { answers: { answer: string }[] }[] }[]
      }
    }>().practitioner.appointments
    expect(visits.find((a) => a.id === booked.appointmentId)?.forms).toEqual([
      {
        title: 'Before your facial',
        answers: [{ question: 'What would you like most?', answer: 'To relax' }],
      },
    ])
    expect(mine.body).not.toContain('L. Guest signature')
  })
})
