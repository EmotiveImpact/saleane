import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ServerBooking } from './ServerBooking'
import { api, ApiError } from '../state/api'
import { seed } from '../domain/seed'

// Stage 5: a guest follows the private link in an invitation with a quiet-time price. The page
// shows the lower price beside the usual one for that time only, holds and books it with the link,
// and when it cannot be had, says so plainly before they confirm and books at the usual price.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
vi.mock('../state/context', () => ({ useStore: () => ({ mode: 'demo' }) }))
const state = seed('UK'),
  base = '/api/public/review',
  token = 'Q'.repeat(43)
const catalog = {
  organisation: state.organisation,
  services: [state.services[0]],
  staff: state.staff,
  today: '2026-10-06',
  sample: false,
  depositPolicy: 'card',
  cardPayments: { testMode: true },
}
const offer = {
  serviceId: 'service-facial',
  staffId: 'staff-maya',
  date: '2026-10-07',
  startMinutes: 600,
  priceMinor: 7600,
  usualPriceMinor: 9500,
  endsAt: '2026-10-07T07:00:00.000Z',
  ends: 'Wednesday 7 October at 08:00',
  time: 'Wednesday 7 October at 10:00 with Maya',
}
const link = `/book/review?service=service-facial&staff=staff-maya&date=2026-10-07&start=600#offer=${token}`
function view(path = link) {
  window.history.pushState({}, '', path)
  return render(
    <MemoryRouter initialEntries={['/book/review']}>
      <Routes>
        <Route path="/book/:slug" element={<ServerBooking />} />
      </Routes>
    </MemoryRouter>,
  )
}
type Body = Record<string, unknown>
function answer(read: Body, book: (body: Body) => unknown = () => ({ appointmentId: 'visit-1' })) {
  let holds = 0
  vi.mocked(api).mockImplementation(async (path, init) => {
    const body = (init?.body ?? {}) as Body
    if (path === base) return catalog as never
    if (path === `${base}/offer`) return read as never
    if (path.startsWith(`${base}/availability`)) return { times: [600, 720] } as never
    if (path.startsWith(`${base}/days`)) return { days: [] } as never
    if (path.startsWith(`${base}/next`)) return { next: null } as never
    if (path === `${base}/holds`)
      return {
        hold: `${'h'.repeat(47)}${++holds}`,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        staffId: 'staff-maya',
        ...(body.offer === token && body.startMinutes === 600
          ? { offer: { priceMinor: 7600, usualPriceMinor: 9500 } }
          : {}),
      } as never
    if (path === `${base}/book`) return book(body) as never
    throw new Error(`Unexpected route ${path}`)
  })
}
const calls = (route: string) =>
  vi
    .mocked(api)
    .mock.calls.filter(([path]) => path === `${base}/${route}`)
    .map(([, init]) => init?.body as Body)
const notice = () => screen.findByText(/quiet-time price/, { selector: '.booking-offer-note p' })
async function details(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Full name'), 'Grace Chen')
  await user.type(screen.getByLabelText('Email'), 'grace@example.test')
  await user.type(screen.getByLabelText('Phone number'), '+44 7700 900123')
  await user.click(screen.getByRole('button', { name: 'Review your visit' }))
}
afterEach(() => {
  window.history.pushState({}, '', '/')
  sessionStorage.clear()
  vi.resetAllMocks()
})

test('shows the quiet-time price beside the usual one for its time only, and books it', async () => {
  const user = userEvent.setup()
  answer({ offer })
  view()
  expect(await notice()).toHaveTextContent(
    'Your quiet-time price: £76 instead of the usual £95, for Wednesday 7 October at 10:00 with Maya only. It is open until Wednesday 7 October at 08:00.',
  )
  expect(calls('offer')).toEqual([{ offer: token }])
  const summary = screen.getByRole('region', { name: 'Your visit' })
  expect(summary).toHaveTextContent('£76')
  expect(summary).toHaveTextContent('A quiet-time price, instead of the usual £95.')
  // Another time is at the usual price, and the guest can go back to theirs in one tap.
  await user.click(screen.getByRole('radio', { name: '12:00' }))
  expect(await notice()).toHaveTextContent(
    'Your quiet-time price of £76 instead of the usual £95 is for Wednesday 7 October at 10:00 with Maya only. Other times are at the usual price.',
  )
  expect(summary).not.toHaveTextContent('A quiet-time price')
  await user.click(screen.getByRole('button', { name: 'Choose that time' }))
  expect(screen.getByRole('radio', { name: '10:00' })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Hold this time' }))
  expect(calls('holds')).toEqual([
    expect.objectContaining({
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date: '2026-10-07',
      startMinutes: 600,
      offer: token,
    }),
  ])
  await details(user)
  const review = document.querySelector('.booking-review') as HTMLElement
  expect(within(review).getByText('Usual price').parentElement).toHaveTextContent('£95')
  expect(within(review).getByText('Quiet-time price').parentElement).toHaveTextContent('£76')
  // The deposit follows the treatment's rule and is never more than the lower price.
  expect(within(review).getByText('Deposit').parentElement).toHaveTextContent('£25')
  expect(within(review).getByText('Left to pay at the studio').parentElement).toHaveTextContent(
    '£51',
  )
  await user.click(screen.getByRole('checkbox', { name: /I agree to the deposit/ }))
  await user.click(screen.getByRole('button', { name: /Confirm visit/ }))
  expect(await screen.findByText('Saved in the studio calendar')).toBeInTheDocument()
  // The link itself never goes to the booking; the held time carries the lower price.
  expect(calls('book')[0]).not.toHaveProperty('offer')
})

test('says plainly when the link cannot give a lower price, and books at the usual price', async () => {
  const user = userEvent.setup()
  answer({ problem: 'This quiet-time price has already been used to book.' })
  view()
  expect(await notice()).toHaveTextContent(
    'This quiet-time price has already been used to book. You can still book at the usual price.',
  )
  expect(screen.getByRole('region', { name: 'Your visit' })).toHaveTextContent('£95')
  await user.click(screen.getByRole('button', { name: 'Hold this time' }))
  expect(calls('holds')[0]).not.toHaveProperty('offer')
})

test('when the lower price ends before confirming, holds the time again at the usual price', async () => {
  const user = userEvent.setup()
  answer({ offer }, () => {
    throw new ApiError(
      'This quiet-time price ended on Wednesday 7 October at 08:00. You can still book this time at the usual price.',
      409,
    )
  })
  view()
  await notice()
  await user.click(screen.getByRole('button', { name: 'Hold this time' }))
  await details(user)
  await user.click(screen.getByRole('checkbox', { name: /I agree to the deposit/ }))
  await user.click(screen.getByRole('button', { name: /Confirm visit/ }))
  expect(await notice()).toHaveTextContent(
    'This quiet-time price ended on Wednesday 7 October at 08:00. You can still book this time at the usual price. This time is now held at the usual price.',
  )
  // Held again without the link, replacing the old hold, and the guest reads the price again.
  const [, again] = calls('holds')
  expect(again).not.toHaveProperty('offer')
  expect(again).toMatchObject({ startMinutes: 600, replaces: expect.any(String) })
  const review = document.querySelector('.booking-review') as HTMLElement
  expect(within(review).queryByText('Quiet-time price')).toBeNull()
  expect(within(review).getByText('Treatment price').parentElement).toHaveTextContent('£95')
  expect(screen.getByRole('checkbox', { name: /I agree to the deposit/ })).not.toBeChecked()
  expect(screen.queryByText('Saved in the studio calendar')).toBeNull()
})
