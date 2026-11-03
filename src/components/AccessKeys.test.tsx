import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { AccessKeys } from './AccessKeys'
import { api } from '../state/api'
import { seed } from '../domain/seed'

// Stage 5: an access key may read, and when the owner ticks it, send things in.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const sample = seed('UK')
const state = {
  ...sample,
  operations: {
    ...sample.operations!,
    locations: [{ id: 'loc-islington', name: 'Islington', address: '1 Upper Street' }],
  },
}
vi.mock('../state/context', () => ({
  useStore: () => ({
    mode: 'server',
    session: { user: { id: 'account-ada', name: 'Ada Owner', email: 'ada@example.invalid' } },
    state,
    role: 'owner',
    today: '2026-10-06',
  }),
}))
afterEach(() => {
  vi.resetAllMocks()
})
const base = `/api/workspaces/${state.organisation.id}/api-keys`
const key = (scopes: string[], extra: Record<string, unknown> = {}) => ({
  id: 'key-1',
  name: 'Booking tool',
  prefix: '0a1b2c3d',
  scopes,
  createdBy: 'Ada Owner',
  createdAt: '2026-10-06T08:00:00.000Z',
  lastUsedAt: null,
  locationId: null,
  endsOn: null,
  ...extra,
})
const listing = (keys: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  keys,
  apiVersion: '2026-10-08',
  sample: false,
  ...extra,
})

test('explains each scope, tucks the changing ones away and sends what was ticked', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === base && !options) return listing() as never
    if (path === base)
      return listing([key(['appointments:read', 'appointments:write'])], {
        key: 'sal_0a1b2c3d_abcdefghijklmnopqrstuvwxyz012345',
        created: 'key-1',
      }) as never
    throw new Error(`Unexpected route ${path}`)
  })
  render(<AccessKeys />)
  expect(
    await screen.findByText(/send things in, such as a booking tool or a chain’s own tills/),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Make an access key' }))
  await user.type(screen.getByRole('textbox', { name: 'What it is for' }), 'Booking tool')
  const reads = screen.getByRole('group', { name: 'It may read' })
  expect(within(reads).getAllByRole('checkbox')).toHaveLength(4)
  expect(within(reads).getByRole('checkbox', { name: /Read visits/ })).toHaveAccessibleDescription(
    'Dates, times, treatments and who does them. No client names.',
  )
  // Changing things is tucked away until asked for.
  const more = screen.getByText('It may also change things')
  expect(more.closest('details')).not.toHaveAttribute('open')
  await user.click(more)
  const visits = screen.getByRole('checkbox', { name: /Add and change visits/ })
  expect(visits).toHaveAccessibleDescription(/Book, move and cancel visits/)
  expect(
    screen.getByRole('checkbox', { name: /Add and change clients/ }),
  ).toHaveAccessibleDescription(
    /Email news is only ever recorded when the software says who agreed, when and how/,
  )
  expect(screen.getByRole('checkbox', { name: /Send in till sales/ })).toHaveAccessibleDescription(
    /recorded as money taken outside SALEANE/,
  )
  expect(screen.getByText(/shows in Who changed what under this key’s name/)).toBeVisible()
  await user.click(visits)
  await user.click(screen.getByRole('button', { name: 'Make the key' }))
  expect(vi.mocked(api)).toHaveBeenCalledWith(base, {
    method: 'POST',
    body: { name: 'Booking tool', scopes: ['appointments:read', 'appointments:write'] },
  })
  expect(await screen.findByText('sal_0a1b2c3d_abcdefghijklmnopqrstuvwxyz012345')).toBeVisible()
  expect(screen.getByText(/May read visits, and add and change visits/)).toBeVisible()
  expect(screen.getByText('Its changes show in Who changed what under its name.')).toBeVisible()
})

test('a key for one location offers only what belongs to that location', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async () => listing() as never)
  render(<AccessKeys />)
  await user.click(await screen.findByRole('button', { name: 'Make an access key' }))
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Which locations' }),
    'Islington only',
  )
  expect(screen.getByText(/reads and books its own visits/)).toBeVisible()
  expect(screen.queryByRole('checkbox', { name: /Read clients/ })).toBeNull()
  expect(screen.queryByRole('checkbox', { name: /Read takings by day/ })).toBeNull()
  expect(screen.queryByRole('checkbox', { name: /Add and change clients/ })).toBeNull()
  expect(screen.getByRole('checkbox', { name: /Send in till sales/ })).toBeInTheDocument()
})

test('an old key keeps reading only, and says so', async () => {
  vi.mocked(api).mockImplementation(
    async () => listing([key(['appointments:read', 'takings:read'])]) as never,
  )
  render(<AccessKeys />)
  expect(await screen.findByText(/May read visits; read takings by day\./)).toBeVisible()
  expect(screen.queryByText('Its changes show in Who changed what under its name.')).toBeNull()
})
