import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Account } from './Account'
import { api, ApiError } from '../state/api'
import type { Session } from '../state/api'

vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const store: { session: Session | null } = { session: null }
vi.mock('../state/context', () => ({
  useStore: () => ({
    session: store.session,
    refreshSession: async () => store.session,
    openWorkspace: vi.fn(),
    enterDemo: vi.fn(),
    logout: vi.fn(),
  }),
}))

const raw = 'i'.repeat(43)
const general = {
  studio: 'Fernleaf Rooms',
  role: 'general',
  location: 'Frome',
  email: 'gm@example.invalid',
}
function join() {
  return render(
    <MemoryRouter initialEntries={[`/join?invitation=${raw}`]}>
      <Routes>
        <Route path="/join" element={<Account />} />
      </Routes>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  store.session = null
})
afterEach(() => vi.resetAllMocks())

test('the join page names the studio, the role and its location, and fills in the invited email', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/api/invitations/preview') return general as never
    throw new ApiError('Sign in to continue.', 401)
  })
  join()
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Join Fernleaf Rooms.' }),
  ).toBeInTheDocument()
  const summary = screen.getByRole('region', { name: 'Your invitation' })
  expect(within(summary).getByText('General manager')).toBeInTheDocument()
  expect(within(summary).getByText('Frome')).toBeInTheDocument()
  expect(screen.getByLabelText(/Email/)).toHaveValue('gm@example.invalid')
  expect(screen.getByText('Your invitation was sent to this address.')).toBeInTheDocument()
  // The link itself is sent once, in the body, and only to read the invitation.
  expect(vi.mocked(api)).toHaveBeenCalledWith('/api/invitations/preview', {
    method: 'POST',
    body: { invitation: raw },
  })
  // Signing in instead keeps the invitation in view.
  await userEvent.click(screen.getByRole('button', { name: 'Already have an account? Sign in' }))
  expect(
    screen.getByText('Sign in with gm@example.invalid to join Fernleaf Rooms.'),
  ).toBeInTheDocument()
  expect(screen.getByLabelText(/Email/)).toHaveValue('gm@example.invalid')
})

test('says plainly when the invitation can no longer be used', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/api/invitations/preview')
      throw new ApiError(
        'This invitation has expired or has already been used. Ask the studio owner for a new link.',
        404,
      )
    throw new ApiError('Sign in to continue.', 401)
  })
  join()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This invitation has expired or has already been used.',
  )
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Join your studio.')
  expect(screen.getByLabelText(/Email/)).toHaveValue('')
})

test('someone signed in with another address is told which address the invitation needs', async () => {
  store.session = {
    user: { id: 'account-1', name: 'Imogen Hart', email: 'imogen@example.invalid' },
    csrf: 'csrf',
    workspaces: [],
    services: { email: false, payments: false },
    localOnly: true,
  }
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/api/invitations/preview') return general as never
    throw new Error(`Unexpected route ${path}`)
  })
  join()
  expect(
    await screen.findByText(/This invitation was sent to gm@example.invalid/),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Join Fernleaf Rooms' })).toBeDisabled()
})

test('a new studio of their own opens on the setup screens; a sample one opens on Today', async () => {
  const owner = (orgId: string): Session => ({
    user: { id: 'account-1', name: 'Amara Okafor', email: 'amara@example.invalid' },
    csrf: 'csrf',
    workspaces: [{ id: orgId, name: 'Linden Studio', role: 'owner' }] as Session['workspaces'],
    services: { email: false, payments: false },
    localOnly: true,
  })
  for (const [sample, landing] of [
    [false, 'Set up your studio'],
    [true, 'Today'],
  ] as const) {
    store.session = null
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/api/auth/register') {
        store.session = owner('org-1')
        return { orgId: 'org-1' } as never
      }
      throw new ApiError('Sign in to continue.', 401)
    })
    const shown = render(
      <MemoryRouter initialEntries={['/account']}>
        <Routes>
          <Route path="/account" element={<Account />} />
          <Route path="/setup" element={<p>Set up your studio</p>} />
          <Route path="/today" element={<p>Today</p>} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }))
    await userEvent.type(screen.getByLabelText(/Email/), 'amara@example.invalid')
    await userEvent.type(screen.getByLabelText('Your name'), 'Amara Okafor')
    await userEvent.type(screen.getByLabelText(/Password/), 'Fictional local account 2026!')
    await userEvent.type(screen.getByLabelText('Business name'), 'Linden Studio')
    await userEvent.type(screen.getByLabelText('Location name'), 'Bath')
    if (sample)
      await userEvent.click(screen.getByLabelText('Start with made-up sample clients and visits'))
    await userEvent.click(screen.getByRole('button', { name: /Create your studio/ }))
    expect(await screen.findByText(landing)).toBeInTheDocument()
    shown.unmount()
  }
})
