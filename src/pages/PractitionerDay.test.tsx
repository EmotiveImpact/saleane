import { webcrypto } from 'node:crypto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PractitionerDay } from './PractitionerDay'
import { api, ApiError } from '../state/api'
import { seed } from '../domain/seed'
import { DEMO_DATE } from '../domain/model'
import { execute } from '../domain/commands'
import { practitionerView } from '../domain/practitioner'
import { addDays, dateLabel } from '../domain/format'

vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const openWorkspace = vi.fn()
const logout = vi.fn()
const session = {
  user: { id: 'account-maya', name: 'Maya Lewis', email: 'maya@example.invalid' },
}
vi.mock('../state/context', () => ({
  useStore: () => ({
    session,
    refreshSession: async () => session,
    openWorkspace,
    logout,
    connection: 'online',
    syncDaySheet: async () => {},
  }),
}))

const studio = seed('UK')
const orgId = studio.organisation.id
const base = `/api/workspaces/${orgId}`
const mine = studio.appointments.filter((a) => a.staffId === 'staff-maya')
const visit = mine.find((a) => a.date === DEMO_DATE && a.status === 'confirmed')!
const client = studio.clients.find((c) => c.id === visit.clientId)!
const record = (state = studio) => ({
  id: orgId,
  role: 'practitioner',
  view: 'practitioner',
  practitioner: practitionerView(state, 'staff-maya', DEMO_DATE),
})
function view() {
  return render(
    <MemoryRouter initialEntries={[`/practice/${orgId}`]}>
      <Routes>
        <Route path="/practice/:orgId" element={<PractitionerDay />} />
        <Route path="/today" element={<p>Studio workspace</p>} />
        <Route path="/account" element={<p>Sign in to SALEANE</p>} />
      </Routes>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  sessionStorage.clear()
  vi.stubGlobal('crypto', webcrypto)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.resetAllMocks()
})

test('shows only the practitioner’s own visits, without prices or contact details', async () => {
  vi.mocked(api).mockResolvedValue(record() as never)
  view()
  const list = await screen.findByRole('list', { name: 'Assigned to you' })
  const today = mine.filter((a) => a.date === DEMO_DATE)
  expect(within(list).getAllByRole('listitem')).toHaveLength(today.length)
  for (const other of studio.appointments.filter(
    (a) => a.date === DEMO_DATE && a.staffId !== 'staff-maya',
  )) {
    const name = studio.clients.find((c) => c.id === other.clientId)!.name
    if (!today.some((a) => a.clientId === other.clientId))
      expect(screen.queryByText(name)).not.toBeInTheDocument()
  }
  expect(document.body.textContent).not.toMatch(/£/)
  expect(document.body.textContent).not.toContain(client.email)
})

test('welcomes their client with a saved retry key and shows the updated status', async () => {
  const user = userEvent.setup()
  const arrived = execute(studio, { type: 'arrive', appointmentId: visit.id })
  if (!arrived.ok) throw new Error(arrived.error)
  let attempts = 0
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return record() as never
    if (path === `${base}/commands`) {
      attempts++
      if (attempts === 1) throw new ApiError('The local server could not confirm this request.', 0)
      return record(arrived.state) as never
    }
    throw new Error(`Unexpected route ${path}`)
  })
  view()
  await user.click(await screen.findByRole('button', { name: new RegExp(client.name) }))
  const first = client.name.split(' ')[0]
  await user.click(screen.getByRole('button', { name: `Welcome ${first}` }))
  await screen.findByText('The local server could not confirm this request.')
  await user.click(screen.getByRole('button', { name: `Welcome ${first}` }))
  await screen.findByText(`${first} is marked as in the studio.`)
  const calls = vi.mocked(api).mock.calls.filter(([path]) => path === `${base}/commands`)
  expect(calls).toHaveLength(2)
  expect(calls[0][1]?.key).toBeTruthy()
  expect(calls[1][1]?.key).toBe(calls[0][1]?.key)
  expect(calls[1][1]?.body).toEqual({
    revision: studio.revision,
    command: { type: 'arrive', appointmentId: visit.id },
  })
  expect(screen.queryByRole('button', { name: `Welcome ${first}` })).not.toBeInTheDocument()
  expect(JSON.parse(sessionStorage.getItem('saleane.pending-practitioner.v1')!)).toEqual([])
})

test('reloads their day when the studio changed first', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return record() as never
    throw new ApiError('This workspace changed. Reload before saving.', 409)
  })
  view()
  await user.click(await screen.findByRole('button', { name: new RegExp(client.name) }))
  await user.type(screen.getByLabelText('Add a note for the studio'), 'Prefers a quiet room')
  await user.click(screen.getByRole('button', { name: 'Save note' }))
  await screen.findByText('Your day changed at the studio. The latest visits are shown; try again.')
  expect(vi.mocked(api).mock.calls.filter(([path]) => path === base)).toHaveLength(2)
  expect(screen.getByLabelText('Add a note for the studio')).toHaveValue('Prefers a quiet room')
})

test('sends a desk or management role to the studio workspace instead', async () => {
  vi.mocked(api).mockResolvedValue({ id: orgId, view: 'studio', state: studio } as never)
  view()
  await screen.findByText('Studio workspace')
  await waitFor(() => expect(openWorkspace).toHaveBeenCalledWith(orgId))
})

test('pocket view: next up first, then a brief before the visit and back to the day', async () => {
  // 10:45 in London: Amelia's 09:30 facial is over, Noor's 11:00 facial is next.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T09:45:00Z'))
  // Behave as a phone, where the brief replaces the list.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width') }))
  const user = userEvent.setup()
  const noor = mine.find((a) => a.clientId === 'client-4' && a.date === DEMO_DATE)!
  const person = studio.clients.find((c) => c.id === 'client-4')!
  vi.mocked(api).mockResolvedValue(record() as never)
  view()
  const next = await screen.findByRole('region', { name: 'Next up' })
  const card = within(next).getByRole('button')
  expect(card).toHaveTextContent('11:00')
  expect(card).toHaveTextContent('In 15 min')
  expect(card).toHaveTextContent('Noor')
  expect(card).not.toHaveTextContent(person.name)
  expect(card).toHaveTextContent('Skin Renewal Facial')
  expect(card).toHaveTextContent('Treatment room 1')

  await user.click(card)
  const brief = screen.getByRole('region', { name: person.name })
  await waitFor(() => expect(within(brief).getByRole('heading', { level: 2 })).toHaveFocus())
  expect(within(brief).getByText('Good to remember').nextSibling).toHaveTextContent(
    person.preferences,
  )
  // Her last visit with Maya, not Sophia's more recent massage.
  const last = studio.appointments
    .filter(
      (a) =>
        a.clientId === 'client-4' &&
        a.staffId === 'staff-maya' &&
        a.status === 'completed' &&
        a.date < DEMO_DATE,
    )
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  expect(
    studio.appointments.some(
      (a) => a.clientId === 'client-4' && a.staffId !== 'staff-maya' && a.date > last.date,
    ),
  ).toBe(true)
  expect(within(brief).getByText('Last time with you').nextSibling).toHaveTextContent(
    `${dateLabel(last.date, 'en-GB')} · Skin Renewal Facial`,
  )
  expect(within(brief).getByLabelText('Add a note for the studio')).toBeInTheDocument()

  await user.click(within(brief).getByRole('button', { name: 'Back to your day' }))
  await waitFor(() => expect(card).toHaveFocus())
  expect(card.dataset.visit).toBe(noor.id)
})

test('pocket view: moves between days with buttons and a today shortcut', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockResolvedValue(record() as never)
  view()
  await screen.findByRole('region', { name: 'Next up' })
  await user.click(screen.getByRole('button', { name: 'Previous day' }))
  expect(screen.queryByRole('region', { name: 'Next up' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your visits')
  await user.click(screen.getByRole('button', { name: 'Today' }))
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your day, Maya.')
  expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled()
})

test('on another day the brief opens the next visit to come, never a cancelled one', async () => {
  const at = `${DEMO_DATE}T08:00:00.000Z`
  const tomorrow = addDays(DEMO_DATE, 1)
  let state = studio
  const book = (clientId: string, startMinutes: number) => {
    const result = execute(
      state,
      {
        type: 'book',
        input: {
          serviceId: 'service-facial',
          staffId: 'staff-maya',
          date: tomorrow,
          startMinutes,
          clientId,
          source: 'desk',
        },
      },
      at,
    )
    if (!result.ok) throw new Error(result.error)
    state = result.state
    return result.recordId
  }
  const early = book('client-14', 600)
  book('client-15', 720)
  const cancelled = execute(state, { type: 'cancel', appointmentId: early, reason: 'Unwell' }, at)
  if (!cancelled.ok) throw new Error(cancelled.error)
  vi.mocked(api).mockResolvedValue(record(cancelled.state) as never)
  const user = userEvent.setup()
  view()
  await screen.findByRole('list', { name: 'Assigned to you' })
  await user.click(screen.getByRole('button', { name: 'Next day' }))
  const [gone, next] = ['client-14', 'client-15'].map(
    (id) => studio.clients.find((c) => c.id === id)!.name,
  )
  expect(screen.getByRole('button', { name: new RegExp(gone) })).toHaveTextContent('Cancelled')
  expect(screen.getByRole('region', { name: next })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: gone })).not.toBeInTheDocument()
  // A day that has passed opens no brief until a visit is chosen: back to Maya's latest one.
  await user.click(screen.getByRole('button', { name: 'Today' }))
  await user.click(screen.getByRole('button', { name: 'Previous day' }))
  for (let back = 1; back < 14 && !screen.queryByRole('list', { name: 'Assigned to you' }); back++)
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
  const past = screen.getByRole('list', { name: 'Assigned to you' })
  expect(within(past).getAllByRole('listitem').length).toBeGreaterThan(0)
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
    'Assigned to you',
  ])
})

test('signs out from the day as from the account page', async () => {
  logout.mockResolvedValue(undefined)
  vi.mocked(api).mockResolvedValue(record() as never)
  const user = userEvent.setup()
  view()
  await user.click(await screen.findByRole('button', { name: 'Sign out' }))
  await screen.findByText('Sign in to SALEANE')
  expect(logout).toHaveBeenCalledTimes(1)
})

test('keeps the day open and says so when sign out cannot be confirmed', async () => {
  logout.mockRejectedValue(new ApiError('The local server could not confirm this request.', 0))
  vi.mocked(api).mockResolvedValue(record() as never)
  const user = userEvent.setup()
  view()
  await user.click(await screen.findByRole('button', { name: 'Sign out' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The local server could not confirm this request.',
  )
  expect(screen.getByRole('list', { name: 'Assigned to you' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
})
