import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ServerBooking } from './ServerBooking'
import { api } from '../state/api'
import { seed } from '../domain/seed'

// Stage 3: with the studio's patch test rule on, a treatment that needs one shows what comes first
// in place of "Choose a time", the same for every guest.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
vi.mock('../state/context', () => ({ useStore: () => ({ mode: 'demo' }) }))
const state = seed('UK'),
  base = '/api/public/review'
const hair = state.services.filter((s) => s.category === 'Hair')
const catalog = {
  organisation: { ...state.organisation, phone: '020 7946 0123', email: 'hello@atelier.example' },
  services: hair,
  staff: state.staff,
  today: '2026-10-06',
  sample: false,
  patchTestHours: 48,
  patchTestFirst: { testServiceId: 'service-patch-test' },
}
function view(path = '/book/review') {
  window.history.pushState({}, '', path)
  return render(
    <MemoryRouter initialEntries={['/book/review']}>
      <Routes>
        <Route path="/book/:slug" element={<ServerBooking />} />
      </Routes>
    </MemoryRouter>,
  )
}
function answer(served: Record<string, unknown>) {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return served as never
    if (path.startsWith(`${base}/availability`)) return { times: [600] } as never
    if (path.startsWith(`${base}/days`)) return { days: [] } as never
    if (path.startsWith(`${base}/next`)) return { next: null } as never
    throw new Error(`Unexpected route ${path}`)
  })
}
const asked = (part: string) => vi.mocked(api).mock.calls.filter(([path]) => path.includes(part))
afterEach(() => {
  window.history.pushState({}, '', '/')
  vi.resetAllMocks()
})

test('a colour shows that a patch test comes first, and the patch test is one tap away', async () => {
  const user = userEvent.setup()
  answer(catalog)
  view()
  await user.click(await screen.findByRole('button', { name: /Gloss & Tone/ }))
  const panel = await screen.findByRole('region', { name: 'A patch test comes first' })
  expect(panel).toHaveTextContent(
    'Gloss & Tone needs a quick patch test at least 48 hours before your visit, so Atelier House books it with you rather than online.',
  )
  expect(panel).toHaveTextContent(
    'Book your patch test here. If you have had one with us recently, call or email to book.',
  )
  expect(screen.queryByRole('button', { name: /Choose a time/ })).not.toBeInTheDocument()
  expect(within(panel).getByRole('link', { name: /Call 020 7946 0123/ })).toHaveAttribute(
    'href',
    'tel:+442079460123',
  )
  expect(within(panel).getByRole('link', { name: /Email us/ })).toHaveAttribute(
    'href',
    'mailto:hello@atelier.example',
  )
  const book = within(panel).getByRole('link', { name: /Book a patch test/ })
  expect(book).toHaveAttribute('href', '?service=service-patch-test')
  await user.click(book)
  await screen.findByRole('heading', { name: 'Find your moment.' })
  expect(asked('availability')[0][0]).toContain('serviceId=service-patch-test')
  // Nothing was ever asked about the colour, and nothing was held.
  expect(asked('service-gloss')).toEqual([])
  expect(asked('/holds')).toEqual([])
})

test('without a patch test online, guests are asked to get in touch, or shown the way', async () => {
  const user = userEvent.setup()
  answer({ ...catalog, patchTestFirst: { testServiceId: null } })
  const first = view()
  await user.click(await screen.findByRole('button', { name: /Gloss & Tone/ }))
  const panel = await screen.findByRole('region', { name: 'A patch test comes first' })
  expect(panel).toHaveTextContent(
    'Call or email to arrange your patch test, or to book if you have had one with us recently.',
  )
  expect(within(panel).queryByRole('link', { name: /Book a patch test/ })).not.toBeInTheDocument()
  first.unmount()
  vi.resetAllMocks()
  answer({
    ...catalog,
    organisation: state.organisation,
    patchTestFirst: { testServiceId: null },
  })
  view()
  await user.click(await screen.findByRole('button', { name: /Gloss & Tone/ }))
  const quiet = await screen.findByRole('region', { name: 'A patch test comes first' })
  expect(quiet).toHaveTextContent(
    `Pop in to arrange your patch test, or to book if you have had one with us recently. You will find us at ${state.organisation.address}.`,
  )
  expect(within(quiet).getByRole('link', { name: /Directions/ })).toHaveAttribute(
    'href',
    expect.stringContaining('google.com/maps'),
  )
})

test('with the rule off, a colour is booked online as before', async () => {
  const user = userEvent.setup()
  const off: Partial<typeof catalog> = { ...catalog }
  delete off.patchTestFirst
  answer(off)
  view()
  await user.click(await screen.findByRole('button', { name: /Gloss & Tone/ }))
  expect(await screen.findByRole('button', { name: /Choose a time/ })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'A patch test comes first' })).not.toBeInTheDocument()
})

test('a link with a time for a colour opens on the treatment, where the page says what comes first', async () => {
  answer(catalog)
  view('/book/review?service=service-gloss&staff=staff-theo&date=2026-10-08&start=600')
  expect(await screen.findByRole('region', { name: 'A patch test comes first' })).toBeVisible()
  expect(asked('availability')).toEqual([])
})

test('a link naming only a treatment opens with it chosen', async () => {
  answer(catalog)
  view('/book/review?service=service-patch-test')
  expect(await screen.findByRole('button', { name: /Choose a time/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Colour patch test/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
