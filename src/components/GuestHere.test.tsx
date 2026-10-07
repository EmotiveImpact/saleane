import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { GuestHere } from './GuestHere'
import type { GuestView } from '../domain/guest'

const view = (opensAt: string): GuestView => ({
  organisation: {
    name: 'Reference Studio',
    locationName: 'London',
    locale: 'en-GB',
    timeZone: 'Europe/London',
    currency: 'GBP',
    region: 'UK',
    address: '',
  },
  visit: {
    serviceName: 'Skin Renewal Facial',
    professional: 'Maya',
    date: '2026-10-07',
    startMinutes: 600,
    durationMinutes: 60,
    status: 'confirmed',
    calendarUid: 'visit-0123456789abcdef@saleane',
  },
  arrival: { studioNote: '', serviceNote: '' },
  deposit: { paidMinor: 0, simulated: false },
  cancellation: { available: true, cutoffAt: '2026-10-06T09:00:00.000Z', outcome: 'none' },
  here: { open: false, opensAt, saidAt: null, welcomed: false },
})
afterEach(() => vi.useRealTimers())

test('a page opened early shows "I\'ve arrived" once the time comes, without a reload', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-07T08:20:00.000Z'))
  render(<GuestHere token="t" view={view('2026-10-07T08:30:00.000Z')} onChange={() => {}} />)
  expect(screen.getByText(/From 09:30 you can let us know here/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'I’ve arrived' })).toBeNull()
  act(() => vi.advanceTimersByTime(10 * 60000))
  expect(screen.getByRole('button', { name: 'I’ve arrived' })).toBeInTheDocument()
})
