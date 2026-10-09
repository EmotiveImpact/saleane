import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { LockedStudio } from './LockedStudio'
import { api } from '../state/api'
import { seed } from '../domain/seed'
import type { BillingSummary } from '../domain/billing'

// NEXT-02: the owner's page while the studio is locked.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const sample = seed('UK')
const state = { ...sample, operations: { ...sample.operations!, mode: 'local' as const } }
let billing: BillingSummary = { readOnly: true, locked: true, stopReason: 'unpaid', hasCard: true }
vi.mock('../state/context', () => ({
  useStore: () => ({ mode: 'demo', state, billing, reload: vi.fn(), role: 'owner' }),
}))
afterEach(() => {
  billing = { readOnly: true, locked: true, stopReason: 'unpaid', hasCard: true }
  vi.resetAllMocks()
})

test('says why the studio is locked, and downloads its records', async () => {
  const user = userEvent.setup()
  const saved: Blob[] = []
  URL.createObjectURL = vi.fn((blob: Blob) => {
    saved.push(blob)
    return 'blob:records'
  })
  URL.revokeObjectURL = vi.fn()
  vi.mocked(api).mockResolvedValue({ export: { studio: 'records' } } as never)
  render(
    <MemoryRouter>
      <LockedStudio />
    </MemoryRouter>,
  )
  expect(
    screen.getByRole('heading', { name: `${state.organisation.name} is locked` }),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      'The SALEANE bill is unpaid, so the studio is locked. Your team cannot open it, and online booking is closed; bookings already made still stand. Nothing has been deleted. Pay below to open it again for everyone.',
    ),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Download the studio’s records' }))
  expect(api).toHaveBeenCalledWith(
    `/api/workspaces/${state.organisation.id}/privacy/studio/export`,
    { method: 'POST', body: {} },
  )
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Downloaded. This export is recorded in the studio’s audit log.',
  )
  expect(await saved[0].text()).toContain('"studio": "records"')
})

test('names an ended trial or a stopped plan as the reason', () => {
  billing = { readOnly: true, locked: true, stopReason: 'trial_ended', hasCard: false }
  const { unmount } = render(
    <MemoryRouter>
      <LockedStudio />
    </MemoryRouter>,
  )
  expect(
    screen.getByText(/^The free trial ended without a card, so the studio is locked/),
  ).toBeVisible()
  unmount()
  billing = { readOnly: true, locked: true, stopReason: 'cancelled', hasCard: true }
  render(
    <MemoryRouter>
      <LockedStudio />
    </MemoryRouter>,
  )
  expect(screen.getByText(/^The SALEANE plan stopped, so the studio is locked/)).toBeVisible()
})
