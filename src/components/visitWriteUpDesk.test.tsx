import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppointmentDialog } from './AppointmentDialog'
import type { Command, CommandResult } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import type { Role } from '../domain/operations'
import { seed } from '../domain/seed'
import { api } from '../state/api'

// NEXT-16: reception and managers write up a visit that went ahead from the visit itself.
type Shown = {
  state: BusinessState
  role: Role
  mode: 'demo' | 'server'
  today: string
  blocked: boolean
  saving: boolean
  commit: (command: Command) => Promise<CommandResult>
}
let store: Shown
vi.mock('../state/context', () => ({ useStore: () => store }))
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
afterEach(() => vi.resetAllMocks())

const commit = vi.fn<(command: Command) => Promise<CommandResult>>()
function show(patch: Partial<Shown> = {}, appointmentId = 'visit-amelia') {
  const state = seed('UK')
  store = {
    state,
    role: 'reception',
    mode: 'server',
    today: state.appointments.find((a) => a.id === 'visit-amelia')!.date,
    blocked: false,
    saving: false,
    commit,
    ...patch,
  }
  return render(
    <MemoryRouter>
      <AppointmentDialog appointmentId={appointmentId} onClose={vi.fn()} />
    </MemoryRouter>,
  )
}

test('reception writes up a visit the guest has arrived for, and it saves with a note', async () => {
  const user = userEvent.setup()
  commit.mockResolvedValue({ ok: true } as CommandResult)
  vi.mocked(api).mockImplementation(async (url) => {
    if (!String(url).includes('/visits/')) return { mode: 'test', listens: false } as never
    return {
      heard: 'Facial with a calming mask. Drink plenty of water today.',
      note: 'Facial with a calming mask.',
      aftercare: 'Drink plenty of water today.',
    } as never
  })
  show()
  const panel = screen.getByRole('dialog')
  await user.type(
    await within(panel).findByLabelText('What you would say'),
    'Facial with a calming mask. Drink plenty of water today.',
  )
  await user.click(within(panel).getByRole('button', { name: 'Write it up' }))
  expect(await within(panel).findByLabelText('Aftercare for Amelia')).toHaveValue(
    'Drink plenty of water today.',
  )
  await user.click(within(panel).getByRole('button', { name: 'Save' }))
  expect(commit).toHaveBeenCalledWith({
    type: 'visit-write-up',
    appointmentId: 'visit-amelia',
    note: 'Facial with a calming mask.',
    aftercare: 'Drink plenty of water today.',
  })
  expect(
    await screen.findByText('Saved. The aftercare is added to Amelia’s aftercare email.'),
  ).toBeInTheDocument()
  expect(vi.mocked(api).mock.calls[0][0]).toBe(
    `/api/workspaces/${encodeURIComponent(store.state.organisation.id)}/write-up`,
  )
})

test('it is offered only once the visit went ahead, and only on a studio with a server', async () => {
  vi.mocked(api).mockResolvedValue({ mode: 'test', listens: false } as never)
  const { unmount } = show({ mode: 'demo' })
  expect(screen.queryByText('After the visit')).not.toBeInTheDocument()
  unmount()
  const state = seed('UK')
  const booked = state.appointments.find((a) => a.status === 'confirmed')!
  show({}, booked.id)
  expect(screen.queryByText('After the visit')).not.toBeInTheDocument()
})
