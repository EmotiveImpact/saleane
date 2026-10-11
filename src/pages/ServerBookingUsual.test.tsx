import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ServerBooking } from './ServerBooking'
import { api } from '../state/api'
import { seed } from '../domain/seed'

// Stage 5: "Book your usual" from the guest's visit page opens the booking page with their usual
// treatment, professional and next usual day chosen, and no time: the guest picks one.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
vi.mock('../state/context', () => ({ useStore: () => ({ mode: 'demo' }) }))
const state = seed('UK'),
  base = '/api/public/review'
const facial = state.services.find((s) => s.id === 'service-facial')!
const maya = state.staff.find((p) => p.serviceIds.includes(facial.id))!
const catalog = {
  organisation: { ...state.organisation, phone: '020 7946 0123', email: 'hello@atelier.example' },
  services: state.services,
  staff: state.staff,
  today: '2026-10-06',
  sample: false,
}
function view(path: string) {
  window.history.pushState({}, '', path)
  return render(
    <MemoryRouter initialEntries={['/book/review']}>
      <Routes>
        <Route path="/book/:slug" element={<ServerBooking />} />
      </Routes>
    </MemoryRouter>,
  )
}
function answer() {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return catalog as never
    if (path.startsWith(`${base}/availability`)) return { times: [600, 660] } as never
    if (path.startsWith(`${base}/days`)) return { days: [] } as never
    if (path.startsWith(`${base}/next`)) return { next: null } as never
    throw new Error(`Unexpected route ${path}`)
  })
}
const asked = (part: string) =>
  vi
    .mocked(api)
    .mock.calls.map(([path]) => path)
    .filter((path) => path.includes(part))
afterEach(() => {
  window.history.pushState({}, '', '/')
  vi.resetAllMocks()
})

test('a usual link opens on the times for that day, with the treatment and professional chosen', async () => {
  answer()
  view(`/book/review?service=${facial.id}&staff=${maya.id}&date=2026-11-04`)
  expect(await screen.findByRole('heading', { name: 'Find your moment.' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Your professional' })).toHaveValue(maya.id)
  expect(await screen.findByRole('group', { name: 'Times on Wednesday 4 November' })).toBeVisible()
  const availability = asked('/availability')
  expect(availability.length).toBeGreaterThan(0)
  const query = new URLSearchParams(availability.at(-1)!.split('?')[1])
  expect(Object.fromEntries(query)).toMatchObject({
    serviceId: facial.id,
    staffId: maya.id,
    date: '2026-11-04',
  })
  // No time was in the link, so none is chosen, held or said to be gone.
  expect(screen.queryByText(/is no longer free/)).not.toBeInTheDocument()
  for (const time of ['10:00', '11:00'])
    expect(screen.getByRole('radio', { name: time })).not.toBeChecked()
  expect(asked('/holds')).toEqual([])
})

test('a usual link with anyone opens with no preference chosen', async () => {
  answer()
  view(`/book/review?service=${facial.id}&staff=any&date=2026-11-04`)
  expect(await screen.findByRole('heading', { name: 'Find your moment.' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Your professional' })).toHaveValue('any')
})

test('a link with a day in the past opens on the treatment instead', async () => {
  answer()
  view(`/book/review?service=${facial.id}&staff=${maya.id}&date=2026-10-01`)
  expect(await screen.findByRole('heading', { name: 'What brings you in?' })).toBeInTheDocument()
  expect(asked('/availability')).toEqual([])
})
