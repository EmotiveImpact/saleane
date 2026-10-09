import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { SocialAccounts } from './SocialAccounts'
import { api } from '../state/api'
import { seed } from '../domain/seed'

// V4: an Instagram, Facebook or WhatsApp account waits until the owner confirms it is theirs.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const state = seed('UK')
vi.mock('../state/context', () => ({
  useStore: () => ({
    mode: 'server',
    session: { user: { id: 'account-ada', name: 'Ada Owner', email: 'ada@example.invalid' } },
    state,
    role: 'owner',
    blocked: false,
  }),
}))
const base = `/api/workspaces/${state.organisation.id}/social`
const waiting = {
  channel: 'instagram',
  accountId: '17841400000000001',
  confirmed: false,
  connectedAt: '2026-10-06T08:00:00.000Z',
}
afterEach(() => {
  vi.resetAllMocks()
})

test('shows a waiting account and confirms it with the labelled test-mode step', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return { mode: 'test', sample: false, accounts: [waiting] } as never
    if (path === `${base}/confirm`)
      return {
        mode: 'test',
        sample: false,
        accounts: [{ ...waiting, confirmed: true }],
      } as never
    throw new Error(`Unexpected route ${path}`)
  })
  render(<SocialAccounts />)
  expect(await screen.findByText('Waiting to be confirmed')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove Instagram' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Confirm Instagram (test)' }))
  expect(vi.mocked(api)).toHaveBeenCalledWith(`${base}/confirm`, {
    method: 'POST',
    body: { channel: 'instagram' },
  })
  expect(
    await screen.findByText('Instagram confirmed. Messages to it now arrive in the Inbox.'),
  ).toBeInTheDocument()
  expect(screen.getByText('Connected')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Disconnect Instagram' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /\(test\)/ })).toBeNull()
})

test('offers no confirm step until signing in with Meta is ready', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return { mode: 'off', sample: false, accounts: [waiting] } as never
    throw new Error(`Unexpected route ${path}`)
  })
  render(<SocialAccounts />)
  expect(await screen.findByText('Waiting to be confirmed')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull()
  expect(screen.getByText(/confirm it is yours by signing in with Meta/)).toBeInTheDocument()
})
