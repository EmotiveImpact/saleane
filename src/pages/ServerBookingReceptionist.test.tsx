import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ServerBooking } from './ServerBooking'
import { api } from '../state/api'
import { seed } from '../domain/seed'

// V4 and V2: a time the AI receptionist offers opens the booking steps at its location.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
vi.mock('../state/context', () => ({ useStore: () => ({ mode: 'demo' }) }))
// The chat keeps its newest message in view; jsdom does not scroll.
Element.prototype.scrollTo ??= () => {}
const state = seed('UK'),
  base = '/api/public/review',
  main = state.organisation.locationId,
  islington = 'loc-islington'
const catalog = {
  organisation: state.organisation,
  services: [state.services[0]],
  staff: state.staff.map((p) => ({
    ...p,
    locationIds: p.id === 'staff-maya' ? [main, islington] : [main],
  })),
  locations: [
    { id: main, name: state.organisation.locationName, address: state.organisation.address },
    { id: islington, name: 'Islington', address: '1 Upper Street, London' },
  ],
  today: '2026-10-06',
  sample: false,
  receptionist: true,
}
afterEach(() => {
  vi.resetAllMocks()
})

test('a time the receptionist offers at another location opens the booking steps there', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return catalog as never
    if (path.startsWith(`${base}/availability`)) return { times: [600] } as never
    if (path === `${base}/receptionist`)
      return {
        text: 'Here it is.',
        chat: 'chat-1',
        proposals: [
          {
            id: 'offer-1',
            summary: 'Skin Renewal Facial at Islington, Thursday 8 October at 10:00',
            kind: 'time',
            expiresAt: '2026-10-06T09:00:00.000Z',
          },
        ],
      } as never
    if (path === `${base}/receptionist/proposals/offer-1`)
      return {
        kind: 'time',
        serviceId: state.services[0].id,
        staffId: 'any',
        date: '2026-10-08',
        startMinutes: 600,
        locationId: islington,
      } as never
    throw new Error(`Unexpected route ${path}`)
  })
  render(
    <MemoryRouter initialEntries={['/book/review']}>
      <Routes>
        <Route path="/book/:slug" element={<ServerBooking />} />
      </Routes>
    </MemoryRouter>,
  )
  await user.click(await screen.findByRole('button', { name: 'Ask a question' }))
  await user.type(screen.getByLabelText('Your question'), 'Book a facial on Thursday at 10am')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await user.click(await screen.findByRole('button', { name: 'Choose this time' }))
  await waitFor(() =>
    expect(
      vi
        .mocked(api)
        .mock.calls.some(
          ([path]) =>
            path.startsWith(`${base}/availability?`) &&
            new URLSearchParams(path.split('?')[1]).get('locationId') === islington &&
            new URLSearchParams(path.split('?')[1]).get('date') === '2026-10-08',
        ),
    ).toBe(true),
  )
})
