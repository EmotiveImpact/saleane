import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ManageVisit } from './ManageVisit'
import { api, ApiError } from '../state/api'
import type { GuestView } from '../domain/guest'

vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const token = 'a'.repeat(43)
const view = (outcome: GuestView['cancellation']['outcome'], status = 'confirmed'): GuestView => ({
  organisation: {
    name: 'Reference Studio',
    locationName: 'London',
    locale: 'en-GB',
    timeZone: 'Europe/London',
    currency: 'GBP',
    region: 'UK',
  },
  visit: {
    serviceName: 'Skin Renewal Facial',
    professional: 'Maya',
    date: '2026-10-07',
    startMinutes: 540,
    durationMinutes: 60,
    status: status as GuestView['visit']['status'],
  },
  deposit: { paidMinor: 2500, simulated: false },
  cancellation: {
    available: status === 'confirmed',
    cutoffAt: '2026-10-06T08:00:00.000Z',
    outcome,
  },
})
beforeEach(() => {
  window.location.hash = `#${token}`
})
afterEach(() => {
  window.location.hash = ''
  vi.resetAllMocks()
})

test('shows the refund terms and cancels with the terms the guest saw', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(
    async (path) =>
      (path === '/api/guest/visit' ? view('refund_due') : view('refund_due', 'cancelled')) as never,
  )
  render(<ManageVisit />)
  expect(await screen.findByText('Skin Renewal Facial')).toBeInTheDocument()
  expect(screen.getByText(/Cancel before Tuesday 6 October at 09:00/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cancel this visit' }))
  expect(screen.getByText(/deposit of £25.00 will be flagged for refund/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Yes, cancel my visit' }))
  await screen.findByRole('heading', { name: 'Your visit is cancelled.' })
  expect(vi.mocked(api)).toHaveBeenLastCalledWith('/api/guest/cancel', {
    method: 'POST',
    body: { token, expected: 'refund_due' },
  })
})

test('reloads the terms when they changed before the guest confirmed', async () => {
  const user = userEvent.setup()
  let reads = 0
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/api/guest/visit')
      return (reads++ ? view('retained') : view('refund_due')) as never
    throw new ApiError(
      'The cancellation terms changed while you were deciding. Review them again.',
      409,
    )
  })
  render(<ManageVisit />)
  await user.click(await screen.findByRole('button', { name: 'Cancel this visit' }))
  await user.click(screen.getByRole('button', { name: 'Yes, cancel my visit' }))
  await screen.findByText(/terms changed while you were deciding/)
  await user.click(screen.getByRole('button', { name: 'Cancel this visit' }))
  expect(screen.getByText(/so the studio keeps your deposit of £25.00/)).toBeInTheDocument()
})

test('never asks the server without a token and explains the broken link', async () => {
  window.location.hash = ''
  render(<ManageVisit />)
  expect(await screen.findByText(/This link is incomplete/)).toBeInTheDocument()
  expect(vi.mocked(api)).not.toHaveBeenCalled()
})
