import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { ProtectAccount } from './ProtectAccount'
import { api } from '../state/api'
import type { Session } from '../state/api'

// Stage 6: "Protect your account", shown in place of a studio that asks everyone for two-step
// sign-in until it is set up.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
let store: Record<string, unknown>
vi.mock('../state/context', () => ({ useStore: () => store }))
const session = (twoStep: boolean, role = 'manager', others = false): Session => ({
  user: {
    id: 'account-2',
    name: 'Sam Okoro',
    email: 'sam@example.invalid',
    twoStep: twoStep ? { since: 1, recoveryLeft: 10 } : null,
  },
  csrf: 'csrf',
  workspaces: [
    {
      id: 'studio-1',
      slug: 'fernleaf',
      name: 'Fernleaf Rooms',
      region: 'UK',
      mode: 'local',
      role: role as Session['workspaces'][number]['role'],
      twoStepRequired: true,
    },
    ...(others
      ? [
          {
            id: 'studio-2',
            slug: 'willow',
            name: 'Willow House',
            region: 'UK' as const,
            mode: 'local' as const,
            role: 'reception' as const,
          },
        ]
      : []),
  ],
  services: { email: false, payments: false },
  localOnly: true,
})
function setUp(current: Session) {
  store = {
    hold: { workspaceId: 'studio-1', message: 'Fernleaf Rooms asks everyone.' },
    session: current,
    state: { organisation: { locale: 'en-GB' } },
    refreshSession: vi.fn().mockResolvedValue(current),
    openWorkspace: vi.fn().mockResolvedValue(undefined),
    releaseHold: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <MemoryRouter initialEntries={['/today']}>
      <Routes>
        <Route path="*" element={<ProtectAccount />} />
        <Route path="/account" element={<p>Account page</p>} />
        <Route path="/practice/:id" element={<p>Practitioner day</p>} />
      </Routes>
    </MemoryRouter>,
  )
}
beforeEach(() => vi.mocked(api).mockReset())

test('names the studio that asks, with one way forward', async () => {
  setUp(session(false))
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Protect your account')
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  expect(screen.getByText(/Fernleaf Rooms asks everyone to use two-step sign-in/)).toBeVisible()
  expect(document.querySelectorAll('.button-primary')).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Set up two-step sign-in' })).toHaveClass(
    'button-primary',
  )
  // Nothing of the studio is shown, and there is nowhere else to go but signing out.
  expect(screen.queryByRole('button', { name: 'Choose another studio' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(store.logout).toHaveBeenCalled()
})

test('opens the studio once two-step sign-in is on, and only then lets the hold go', async () => {
  setUp(session(true))
  await userEvent.click(screen.getByRole('button', { name: /Open Fernleaf Rooms/ }))
  expect(store.openWorkspace).toHaveBeenCalledWith('studio-1')
  expect(store.releaseHold).toHaveBeenCalled()
})

test('sends a practitioner back to their own day', async () => {
  setUp(session(true, 'practitioner'))
  await userEvent.click(screen.getByRole('button', { name: /Open Fernleaf Rooms/ }))
  expect(await screen.findByText('Practitioner day')).toBeVisible()
  expect(store.openWorkspace).not.toHaveBeenCalled()
})

test('lets someone in another studio choose it instead', async () => {
  setUp(session(false, 'manager', true))
  await userEvent.click(screen.getByRole('button', { name: 'Choose another studio' }))
  expect(store.releaseHold).toHaveBeenCalled()
  expect(await screen.findByText('Account page')).toBeVisible()
})
