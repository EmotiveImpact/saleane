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
    address: '12 Example Mews, London',
  },
  visit: {
    serviceName: 'Skin Renewal Facial',
    professional: 'Maya',
    date: '2026-10-07',
    startMinutes: 540,
    durationMinutes: 60,
    status: status as GuestView['visit']['status'],
    calendarUid: 'visit-0123456789abcdef@saleane',
  },
  arrival: { studioNote: '', serviceNote: '' },
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

const EXPIRED = 'This link has expired or been replaced. Ask the studio for a new one.'

test('explains a broken link without asking the server', async () => {
  window.location.hash = '#badtoken'
  render(<ManageVisit />)
  expect(await screen.findByText(EXPIRED)).toBeInTheDocument()
  expect(screen.queryByText(/Check the required fields/)).not.toBeInTheDocument()
  expect(vi.mocked(api)).not.toHaveBeenCalled()
})

test.each([
  ['refused as malformed', 400, 'Check the required fields and try again.'],
  ['replaced or expired', 404, EXPIRED],
])('explains a link the server %s the same way', async (_, status, message) => {
  vi.mocked(api).mockRejectedValue(new ApiError(message, status))
  render(<ManageVisit />)
  expect(await screen.findByText(EXPIRED)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'We couldn’t open this visit.' })).toBeInTheDocument()
  expect(screen.queryByText(/Check the required fields/)).not.toBeInTheDocument()
})

test('keeps other failures in their own words, so the guest knows to try again', async () => {
  vi.mocked(api).mockRejectedValue(
    new ApiError('Too many requests. Wait before trying again.', 429),
  )
  render(<ManageVisit />)
  expect(await screen.findByText(/Too many requests/)).toBeInTheDocument()
  expect(screen.queryByText(EXPIRED)).not.toBeInTheDocument()
})

test('shows the studio notes and downloads a calendar file without the private link', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockResolvedValue({
    ...view('none'),
    arrival: {
      studioNote: 'Ring the bell at the blue door.',
      serviceNote: 'Come with clean skin.',
    },
  } as never)
  const files: Blob[] = []
  const createObjectURL = vi.fn((blob: Blob) => {
    files.push(blob)
    return 'blob:visit'
  })
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<ManageVisit />)
  expect(await screen.findByRole('heading', { name: 'Before you arrive' })).toBeInTheDocument()
  expect(screen.getByText('Ring the bell at the blue door.')).toBeInTheDocument()
  expect(screen.getByText('Come with clean skin.')).toBeInTheDocument()
  expect(screen.getByText('12 Example Mews, London')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Add to calendar' }))
  expect(click).toHaveBeenCalledOnce()
  const file = await files[0].text()
  expect(file).toContain('UID:visit-0123456789abcdef@saleane')
  expect(file).toContain('SUMMARY:Skin Renewal Facial at Reference Studio')
  expect(file).toContain('DTSTART:20261007T080000Z')
  expect(file).not.toContain(token)
  click.mockRestore()
})

test('shows how to reach the studio wherever the page says to contact it', async () => {
  const contactable = view('none', 'arrived')
  contactable.organisation = {
    ...contactable.organisation,
    phone: '020 7946 0123',
    email: 'hello@reference.example',
  }
  vi.mocked(api).mockResolvedValue(contactable as never)
  render(<ManageVisit />)
  expect(await screen.findByText(/Contact the studio/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Call 020 7946 0123' })).toHaveAttribute(
    'href',
    'tel:+442079460123',
  )
  expect(screen.getByRole('link', { name: 'Email hello@reference.example' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Directions/ })).toBeInTheDocument()
})

test('points to the confirmation email when the studio gave no phone or email', async () => {
  vi.mocked(api).mockResolvedValue(view('none', 'arrived') as never)
  render(<ManageVisit />)
  expect(await screen.findByText(/Contact the studio/)).toBeInTheDocument()
  expect(screen.getByText('To get in touch, reply to your confirmation email.')).toBeInTheDocument()
})

test('offers no calendar file or notes once a visit is cancelled', async () => {
  vi.mocked(api).mockResolvedValue({
    ...view('none', 'cancelled'),
    arrival: { studioNote: 'Ring the bell.', serviceNote: '' },
  } as never)
  render(<ManageVisit />)
  await screen.findByText('Skin Renewal Facial')
  expect(screen.queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument()
  expect(screen.queryByText('Ring the bell.')).not.toBeInTheDocument()
})
