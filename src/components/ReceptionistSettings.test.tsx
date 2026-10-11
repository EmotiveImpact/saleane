import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { ReceptionistSettings } from './ReceptionistSettings'
import { api } from '../state/api'
import { seed } from '../domain/seed'

// NEXT-17: the choice to answer calls the desk misses, and what it does today.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const sample = seed('UK')
const state = {
  ...sample,
  operations: {
    ...sample.operations!,
    mode: 'local' as const,
    receptionist: { enabled: true, handOver: true },
  },
}
const commit = vi.fn(async () => ({ ok: true as const }))
vi.mock('../state/context', () => ({
  useStore: () => ({
    state,
    mode: 'server',
    slug: 'linden',
    session: { workspaces: [{ slug: 'linden', id: 'org-1' }] },
    role: 'owner',
    blocked: false,
    commit,
  }),
}))
const mocked = vi.mocked(api)
let phone: Record<string, unknown>
beforeEach(() => {
  mocked.mockReset()
  commit.mockClear()
  mocked.mockImplementation(
    async (path: string) => (path.endsWith('/phone') ? phone : { mode: 'live' }) as never,
  )
})
const show = () =>
  render(
    <MemoryRouter>
      <ReceptionistSettings />
    </MemoryRouter>,
  )
const choice = () => screen.getByRole('checkbox', { name: /Also answer calls the desk misses/ })

test('cannot be chosen until phone calls are connected', async () => {
  phone = {
    connected: false,
    included: false,
    chosen: false,
    answering: false,
    minutes: { used: 0, of: 0 },
  }
  show()
  expect(
    await screen.findByText(
      'Phone calls are not connected yet, so calls the desk misses are written down for a call back, as now.',
    ),
  ).toBeInTheDocument()
  expect(choice()).toBeDisabled()
})

test('asks for the add-on first, then saves the choice and says how many minutes are left', async () => {
  const user = userEvent.setup()
  phone = {
    connected: true,
    included: false,
    chosen: false,
    answering: false,
    minutes: { used: 0, of: 0 },
  }
  const first = show()
  expect(
    await screen.findByText(/^Add the phone receptionist in Plan and billing first\./),
  ).toBeInTheDocument()
  expect(choice()).toBeDisabled()
  first.unmount()

  // Chosen during the free trial: it can be ticked now, and starts once paid for.
  phone = { ...phone, chosen: true }
  const trial = show()
  expect(
    await screen.findByText(/^The phone receptionist starts with your first paid month\./),
  ).toBeInTheDocument()
  expect(choice()).toBeEnabled()
  trial.unmount()

  phone = {
    connected: true,
    included: true,
    chosen: true,
    answering: false,
    minutes: { used: 0, of: 300 },
  }
  show()
  expect(await screen.findByText('Off. 300 minutes of calls a month are included.')).toBeVisible()
  await user.click(choice())
  phone = {
    connected: true,
    included: true,
    chosen: true,
    answering: true,
    minutes: { used: 12, of: 300 },
  }
  await user.click(screen.getByRole('button', { name: 'Save receptionist settings' }))
  expect(commit).toHaveBeenCalledWith({
    type: 'receptionist',
    settings: { enabled: true, handOver: true, texts: false, social: false, calls: true },
  })
  expect(
    await screen.findByText(
      'On: 12 of 300 minutes used this month. Once they are used, missed calls are written down for a call back.',
    ),
  ).toBeInTheDocument()
})
