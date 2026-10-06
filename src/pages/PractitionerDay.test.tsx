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

vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const openWorkspace = vi.fn()
const session = {
  user: { id: 'account-maya', name: 'Maya Lewis', email: 'maya@example.invalid' },
}
vi.mock('../state/context', () => ({
  useStore: () => ({ session, refreshSession: async () => session, openWorkspace }),
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
