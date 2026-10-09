import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ServerBooking } from './ServerBooking'
import { api, ApiError } from '../state/api'
import { seed } from '../domain/seed'
import { addDays } from '../domain/format'

vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
vi.mock('../state/context', () => ({ useStore: () => ({ mode: 'demo' }) }))
const state = seed('UK'),
  base = '/api/public/review',
  journal = `saleane.guest-confirmation:${base}`
const catalog = {
  organisation: state.organisation,
  services: [state.services[0]],
  staff: state.staff,
  today: '2026-10-06',
  sample: false,
}
const payload = {
  hold: 'a'.repeat(48),
  contact: {
    name: 'Guest Review',
    email: 'guest@example.test',
    phone: '+44 7700 900123',
    marketingConsent: false,
  },
  policy: true,
}
function view() {
  return render(
    <MemoryRouter initialEntries={['/book/review']}>
      <Routes>
        <Route path="/book/:slug" element={<ServerBooking />} />
      </Routes>
    </MemoryRouter>,
  )
}
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})
/** A fortnight from a day, as the server answers the day strip: three times a day unless said. */
function fortnight(from: string, special: Record<string, { closed?: boolean; times?: number }>) {
  return Array.from({ length: 14 }, (_, i) => {
    const date = addDays(from, i)
    return { date, closed: special[date]?.closed ?? false, times: special[date]?.times ?? 3 }
  })
}
const queryOf = (path: string) => new URLSearchParams(path.split('?')[1] ?? '')
/** Every date the page asked the server about, for a day or as the first of a run. */
const datesAsked = () =>
  vi
    .mocked(api)
    .mock.calls.flatMap(([path]) => ['date', 'from'].map((key) => queryOf(path).get(key)))
    .filter((date): date is string => !!date)

test('unknown confirmation retains its exact snapshot through expiry and reload, then safely replays', async () => {
  const user = userEvent.setup()
  let succeed = false
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return catalog as never
    if (path.startsWith(`${base}/availability`)) return { times: [600] } as never
    if (path === `${base}/holds`)
      return { hold: payload.hold, expiresAt: new Date(Date.now() + 300000).toISOString() } as never
    if (path === `${base}/book`) {
      if (!succeed) throw new ApiError('Connection interrupted; confirmation is uncertain.', 0)
      return { appointmentId: 'visit-recovered' } as never
    }
    throw new Error(`Unexpected route ${path}`)
  })
  const first = view()
  await user.click(await screen.findByRole('button', { name: 'Choose a time' }))
  await user.click(await screen.findByRole('radio', { name: '10:00' }))
  await user.click(screen.getByRole('button', { name: 'Hold this time' }))
  await user.type(await screen.findByLabelText('Full name'), payload.contact.name)
  await user.type(screen.getByLabelText('Email'), payload.contact.email)
  await user.type(screen.getByLabelText('Phone number'), payload.contact.phone)
  await user.click(screen.getByRole('button', { name: 'Review your visit' }))
  await user.click(
    screen.getByRole('checkbox', { name: /I agree to the deposit and cancellation terms/ }),
  )
  await user.click(screen.getByRole('button', { name: 'Confirm visit' }))
  await screen.findByText('Connection interrupted; confirmation is uncertain.')
  expect(screen.getByRole('button', { name: 'Edit details' })).toBeDisabled()
  const saved = JSON.parse(sessionStorage.getItem(journal)!)
  expect(saved.payload).toEqual(payload)
  first.unmount()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(Date.parse(saved.expiresAt) + 60000))
  view()
  const retry = await screen.findByRole('button', { name: 'Check booking status' })
  expect(retry).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Hold it again' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit details' })).toBeDisabled()
  succeed = true
  await user.click(retry)
  await screen.findByText('Saved in the studio calendar')
  expect(sessionStorage.getItem(journal)).toBeNull()
  const confirmations = vi.mocked(api).mock.calls.filter(([path]) => path === `${base}/book`)
  expect(confirmations).toHaveLength(2)
  expect(confirmations[0][1]?.body).toEqual(confirmations[1][1]?.body)
  expect(confirmations[1][1]?.body).toEqual(payload)
})

test('a recovered confirmation still says who the visit is with when the guest had no preference', async () => {
  const user = userEvent.setup()
  let succeed = false
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return catalog as never
    if (path.startsWith(`${base}/availability`)) return { times: [600] } as never
    if (path === `${base}/holds`)
      return {
        hold: payload.hold,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        staffId: 'staff-maya',
      } as never
    if (path === `${base}/book`) {
      if (!succeed) throw new ApiError('Connection interrupted; confirmation is uncertain.', 0)
      return { appointmentId: 'visit-recovered' } as never
    }
    throw new Error(`Unexpected route ${path}`)
  })
  const first = view()
  await user.click(await screen.findByRole('button', { name: 'Choose a time' }))
  await user.click(await screen.findByRole('radio', { name: '10:00' }))
  await user.click(screen.getByRole('button', { name: 'Hold this time' }))
  await user.type(await screen.findByLabelText('Full name'), payload.contact.name)
  await user.type(screen.getByLabelText('Email'), payload.contact.email)
  await user.type(screen.getByLabelText('Phone number'), payload.contact.phone)
  await user.click(screen.getByRole('button', { name: 'Review your visit' }))
  await user.click(
    screen.getByRole('checkbox', { name: /I agree to the deposit and cancellation terms/ }),
  )
  await user.click(screen.getByRole('button', { name: 'Confirm visit' }))
  await screen.findByText('Connection interrupted; confirmation is uncertain.')
  // The exact submitted snapshot is unchanged; who the time is with is kept beside it.
  expect(JSON.parse(sessionStorage.getItem(journal)!).payload).toEqual(payload)
  first.unmount()
  view()
  succeed = true
  await user.click(await screen.findByRole('button', { name: 'Check booking status' }))
  await screen.findByText('Saved in the studio calendar')
  const summary = screen.getByRole('region', { name: 'Your visit' })
  expect(within(summary).getByText('With').closest('div')).toHaveTextContent('Maya Lewis')
})

test('a definitive expired unconsumed reservation unlocks a new time; inaccessible studio keeps retry protected', async () => {
  const saved = {
    payload,
    serviceId: state.services[0].id,
    staffId: 'any',
    date: '2026-10-07',
    start: 600,
    expiresAt: new Date(Date.now() - 60000).toISOString(),
  }
  sessionStorage.setItem(journal, JSON.stringify(saved))
  let code = 404
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return catalog as never
    throw new ApiError(
      code === 404
        ? 'Studio is temporarily unavailable.'
        : 'This reservation expired. Choose a time again.',
      code,
    )
  })
  const user = userEvent.setup()
  view()
  await user.click(await screen.findByRole('button', { name: 'Check booking status' }))
  await screen.findByText('Studio is temporarily unavailable.')
  expect(sessionStorage.getItem(journal)).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Edit details' })).toBeDisabled()
  code = 409
  await user.click(screen.getByRole('button', { name: 'Check booking status' }))
  await screen.findByText('This reservation expired. Choose a time again.')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit details' })).toBeEnabled())
  expect(screen.getByRole('button', { name: 'Confirm visit' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Hold it again' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Choose another time' })).toBeEnabled()
  expect(sessionStorage.getItem(journal)).toBeNull()
})

test('corrupt pending confirmation fails closed instead of offering another booking', async () => {
  sessionStorage.setItem(journal, 'not JSON')
  vi.mocked(api).mockResolvedValue(catalog as never)
  await act(async () => {
    view()
  })
  expect(await screen.findByText(/unfinished confirmation could not be recovered/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Choose a time' })).toBeDisabled()
})

test('a studio bot check gates the hold and sends a fresh single-use token each attempt', async () => {
  let issued = 0
  const callbacks: ((token: string) => void)[] = []
  window.turnstile = {
    render: (_element, options) => {
      callbacks.push(options.callback)
      return `widget-${callbacks.length}`
    },
    remove: vi.fn(),
  }
  let refuse = true
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base)
      return { ...catalog, botCheck: { siteKey: '1x00000000000000000000AA' } } as never
    if (path.startsWith(`${base}/availability`)) return { times: [600] } as never
    if (path === `${base}/holds`) {
      if (refuse) {
        refuse = false
        throw new ApiError('Complete the quick check below, then reserve your time again.', 403)
      }
      return { hold: payload.hold, expiresAt: new Date(Date.now() + 300000).toISOString() } as never
    }
    throw new Error(`Unexpected route ${path}`)
  })
  const user = userEvent.setup()
  view()
  await user.click(await screen.findByRole('button', { name: 'Choose a time' }))
  await user.click(await screen.findByRole('radio', { name: '10:00' }))
  const holdButton = screen.getByRole('button', { name: 'Hold this time' })
  expect(holdButton).toBeDisabled()
  act(() => callbacks.at(-1)!(`token-${++issued}`))
  expect(holdButton).toBeEnabled()
  await user.click(holdButton)
  await screen.findByText('Complete the quick check below, then reserve your time again.')
  // The used token is discarded and a new widget is rendered for the retry.
  await waitFor(() => expect(callbacks).toHaveLength(2))
  expect(screen.getByRole('button', { name: 'Hold this time' })).toBeDisabled()
  act(() => callbacks.at(-1)!(`token-${++issued}`))
  await user.click(screen.getByRole('button', { name: 'Hold this time' }))
  await screen.findByLabelText('Full name')
  const holds = vi.mocked(api).mock.calls.filter(([path]) => path === `${base}/holds`)
  expect(holds.map(([, init]) => (init?.body as { botCheck: string }).botCheck)).toEqual([
    'token-1',
    'token-2',
  ])
  delete window.turnstile
})

test('a local phone number is accepted and kept international; rubbish gets a friendly message', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return catalog as never
    if (path.startsWith(`${base}/availability`)) return { times: [600] } as never
    if (path === `${base}/holds`)
      return { hold: payload.hold, expiresAt: new Date(Date.now() + 300000).toISOString() } as never
    if (path === `${base}/book`) return { appointmentId: 'visit-local-phone' } as never
    throw new Error(`Unexpected route ${path}`)
  })
  view()
  await user.click(await screen.findByRole('button', { name: 'Choose a time' }))
  await user.click(await screen.findByRole('radio', { name: '10:00' }))
  await user.click(screen.getByRole('button', { name: 'Hold this time' }))
  await user.type(await screen.findByLabelText('Full name'), payload.contact.name)
  await user.type(screen.getByLabelText('Email'), payload.contact.email)
  const phone = screen.getByLabelText('Phone number')
  await user.type(phone, 'call me maybe')
  await user.click(screen.getByRole('button', { name: 'Review your visit' }))
  expect(
    await screen.findByText(
      'Enter a phone number we can reach you on, such as 07700 900456 or +44 7700 900456.',
    ),
  ).toBeVisible()
  expect(phone).toHaveAttribute('aria-invalid', 'true')
  expect(phone).toHaveFocus()
  expect(screen.queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument()
  await user.clear(phone)
  await user.type(phone, '07700 900456')
  expect(phone).toHaveAttribute('aria-invalid', 'false')
  await user.click(screen.getByRole('button', { name: 'Review your visit' }))
  expect(await screen.findByText(/\+44 7700 900456/)).toBeVisible()
  await user.click(
    screen.getByRole('checkbox', { name: /I agree to the deposit and cancellation terms/ }),
  )
  await user.click(screen.getByRole('button', { name: 'Confirm visit' }))
  await screen.findByText('Saved in the studio calendar')
  const sent = vi.mocked(api).mock.calls.find(([path]) => path === `${base}/book`)!
  expect((sent[1]?.body as typeof payload).contact.phone).toBe('+44 7700 900456')
})

test('a real studio shows its deposit and cancellation rule before confirming, then offers to pay', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // Noon on Monday 5 October: the visit is on Wednesday 7 October at 10:00.
  vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
  const user = userEvent.setup()
  const token = 't'.repeat(43)
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base)
      return {
        ...catalog,
        depositPolicy: 'card',
        cardPayments: { testMode: true },
        emailsLive: false,
        cancellation: { cutoffHours: 24, feePercent: 0 },
      } as never
    if (path.startsWith(`${base}/availability`)) return { times: [600] } as never
    if (path === `${base}/holds`)
      return { hold: payload.hold, expiresAt: new Date(Date.now() + 300000).toISOString() } as never
    if (path === `${base}/book`)
      return {
        appointmentId: 'visit-with-deposit',
        manage: { url: `http://localhost:3000/manage#${token}` },
        payment: {
          testMode: true,
          depositDueMinor: 2500,
          saveCardOffered: false,
          savedCard: null,
          policy: '',
          pending: false,
        },
      } as never
    if (path === '/api/guest/pay') return { url: 'http://localhost:3000/pay/test#attempt' } as never
    throw new Error(`Unexpected route ${path}`)
  })
  view()
  // The deposit is on the treatment itself.
  expect(
    await screen.findByText(/£25 deposit when you book, the rest at the studio\./),
  ).toBeVisible()
  expect(
    screen.getByText('Card payments are in test mode, so no money moves. Emails are not sent yet.'),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Choose a time' }))
  await user.click(await screen.findByRole('radio', { name: '10:00' }))
  await user.click(screen.getByRole('button', { name: 'Hold this time' }))
  await user.type(await screen.findByLabelText('Full name'), payload.contact.name)
  await user.type(screen.getByLabelText('Email'), payload.contact.email)
  await user.type(screen.getByLabelText('Phone number'), payload.contact.phone)
  await user.click(screen.getByRole('button', { name: 'Review your visit' }))
  const terms = await screen.findByRole('region', { name: 'Deposit and cancellation' })
  expect(terms).toHaveTextContent(
    '£25 deposit, which you can pay by card as soon as you confirm. It comes off your bill on the day. Card payments are in test mode, so no money moves.',
  )
  expect(terms).toHaveTextContent(
    'Free to cancel until Tuesday 6 October at 10:00, and the studio refunds your deposit. After that it keeps the deposit.',
  )
  expect(screen.getByText('Left to pay at the studio').nextSibling).toHaveTextContent('£70')
  await user.click(
    screen.getByRole('checkbox', { name: 'I agree to the deposit and cancellation terms.' }),
  )
  await user.click(screen.getByRole('button', { name: 'Confirm visit' }))
  const pay = await screen.findByRole('button', { name: 'Pay your £25.00 deposit now' })
  expect(
    screen.getByText(
      'Test mode: the payment page is a test page. No card is asked for and no money moves.',
    ),
  ).toBeVisible()
  await user.click(pay)
  await waitFor(() =>
    expect(vi.mocked(api)).toHaveBeenCalledWith('/api/guest/pay', {
      method: 'POST',
      body: { token, purpose: 'deposit', saveCard: false },
    }),
  )
  // The guest comes back to their own visit after the payment page.
  expect(sessionStorage.getItem('saleane-manage-token')).toBe(token)
})

test('the day strip starts on the studio’s today, shows closed and full days, and finds free times', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T07:00:00.000Z'))
  const user = userEvent.setup()
  const free: Record<string, number[]> = {
    '2026-10-06': [990],
    '2026-10-07': [],
    '2026-10-08': [600, 840, 1080],
  }
  vi.mocked(api).mockImplementation(async (path) => {
    const query = queryOf(path)
    if (path === base) return catalog as never
    if (path.startsWith(`${base}/days?`))
      return {
        days: fortnight(query.get('from')!, {
          '2026-10-07': { times: 0 },
          '2026-10-11': { closed: true, times: 0 },
        }),
      } as never
    if (path.startsWith(`${base}/availability?`))
      return { times: free[query.get('date')!] ?? [600] } as never
    if (path.startsWith(`${base}/next?`))
      return {
        next:
          query.get('from') === '2026-10-06'
            ? { date: '2026-10-06', startMinutes: 990 }
            : { date: '2026-10-08', startMinutes: 840 },
      } as never
    throw new Error(`Unexpected route ${path}`)
  })
  view()
  await user.click(await screen.findByRole('button', { name: 'Choose a time' }))
  const days = screen.getByRole('radiogroup', { name: 'Choose a day' })
  // Tomorrow is chosen to begin with. It is full, so the next free time is offered instead.
  expect(
    await within(days).findByRole('radio', { name: 'Wednesday 7 October, full' }),
  ).toBeChecked()
  expect(within(days).getByRole('radio', { name: /^Today, Tuesday 6 October/ })).toBeEnabled()
  expect(within(days).getByRole('radio', { name: 'Sunday 11 October, closed' })).toBeDisabled()
  expect(within(days).queryByRole('radio', { name: /Monday 5 October/ })).not.toBeInTheDocument()
  expect(within(days).getAllByRole('radio')).toHaveLength(14)
  expect(
    await screen.findByText('Nothing is free on Wednesday 7 October. The next free time is:'),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Thursday 8 October at 14:00' }))
  expect(
    within(days).getByRole('radio', { name: 'Thursday 8 October, 3 times free' }),
  ).toBeChecked()
  // The day's times, in the studio's own 24-hour clock, by part of the day.
  const list = await screen.findByRole('group', { name: 'Times on Thursday 8 October' })
  expect(within(list).getByRole('radio', { name: '14:00' })).toBeChecked()
  expect(within(list).getByText('Morning')).toBeInTheDocument()
  expect(within(list).getByText('Afternoon')).toBeInTheDocument()
  expect(within(list).getByText('Evening')).toBeInTheDocument()
  // The first free time from today, in one tap.
  await user.click(screen.getByRole('button', { name: 'First available' }))
  expect(
    await within(days).findByRole('radio', { name: /^Today, Tuesday 6 October/ }),
  ).toBeChecked()
  expect(await screen.findByRole('radio', { name: '16:30' })).toBeChecked()
  // A further fortnight on request.
  await user.click(screen.getByRole('button', { name: 'More dates' }))
  expect(
    await within(days).findByRole('radio', { name: 'Tuesday 20 October, 3 times free' }),
  ).toBeEnabled()
  expect(within(days).getAllByRole('radio')).toHaveLength(28)
  // Nothing before the studio's today is ever asked about.
  expect(datesAsked().filter((date) => date < '2026-10-06')).toEqual([])
})

// The countdown runs on real seconds and the hold runs out twice, so this journey needs longer.
test('when a hold runs out one tap holds the same time again; a time that has gone offers the nearest', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T07:00:00.000Z'))
  const user = userEvent.setup()
  let holds = 0,
    taken = false
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return catalog as never
    if (path.startsWith(`${base}/days?`))
      return { days: fortnight(queryOf(path).get('from')!, {}) } as never
    if (path.startsWith(`${base}/availability?`))
      // Once 10:00 is taken a listing may still show it for a moment; it is never offered back.
      return { times: taken ? [540, 570, 600, 660, 900, 1020] : [600] } as never
    if (path === `${base}/holds`) {
      holds += 1
      if (taken && holds === 3)
        throw new ApiError('That time was just taken. Choose another time or professional.', 409)
      return {
        hold: String(holds).repeat(48),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        staffId: 'staff-maya',
      } as never
    }
    if (path === `${base}/book`) return { appointmentId: 'visit-held-again' } as never
    throw new Error(`Unexpected route ${path}`)
  })
  view()
  await user.click(await screen.findByRole('button', { name: 'Choose a time' }))
  await user.click(await screen.findByRole('radio', { name: '10:00' }))
  await user.click(screen.getByRole('button', { name: 'Hold this time' }))
  await user.type(await screen.findByLabelText('Full name'), payload.contact.name)
  await user.type(screen.getByLabelText('Email'), payload.contact.email)
  await user.type(screen.getByLabelText('Phone number'), payload.contact.phone)
  await user.click(screen.getByRole('button', { name: 'Review your visit' }))
  // A guest with no preference sees who the held time is with.
  await screen.findByRole('checkbox', { name: /I agree to the deposit/ })
  expect(screen.getByText(/Maya Lewis/, { selector: '.booking-review p' })).toBeVisible()
  await user.click(screen.getByRole('checkbox', { name: /I agree to the deposit/ }))
  expect(screen.getByRole('button', { name: 'Confirm visit' })).toBeEnabled()
  // Six minutes later the hold has run out.
  vi.setSystemTime(new Date('2026-10-06T07:06:00.000Z'))
  const again = await screen.findByRole('button', { name: 'Hold it again' }, { timeout: 3000 })
  expect(
    screen.getByText(
      'We kept Wednesday 7 October at 10:00 for you for five minutes. Hold it again to carry on; your details are kept.',
    ),
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Confirm visit' })).toBeDisabled()
  await user.click(again)
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Hold it again' })).not.toBeInTheDocument(),
  )
  const held = vi.mocked(api).mock.calls.filter(([path]) => path === `${base}/holds`)
  expect(held[1][1]?.body).toEqual({
    serviceId: state.services[0].id,
    staffId: 'any',
    date: '2026-10-07',
    startMinutes: 600,
    replaces: '1'.repeat(48),
  })
  // The same time and the terms already agreed stand.
  expect(screen.getByRole('checkbox', { name: /I agree to the deposit/ })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Confirm visit' })).toBeEnabled()
  // It runs out again, and this time someone else has booked 10:00 meanwhile.
  taken = true
  vi.setSystemTime(new Date('2026-10-06T07:12:00.000Z'))
  await user.click(await screen.findByRole('button', { name: 'Hold it again' }, { timeout: 3000 }))
  expect(
    await screen.findByText(
      'Wednesday 7 October at 10:00 is no longer free. These are the nearest free times that day. Choose one to hold it, and your details are kept.',
    ),
  ).toBeVisible()
  const nearest = screen
    .getAllByRole('button', { name: /^Hold .* instead$/ })
    .map((button) => button.textContent)
  expect(nearest).toEqual(['09:00', '09:30', '11:00', '15:00'])
  expect(screen.queryByRole('button', { name: 'Hold 10:00 instead' })).not.toBeInTheDocument()
  // The summary says so too, and gives the rule without a time to count back from.
  const summary = screen.getByRole('region', { name: 'Your visit' })
  const row = (label: string) => within(summary).getByText(label).closest('div')!
  const bar = within(summary).getByRole('button', { name: /Skin Renewal Facial/ })
  expect(row('When')).toHaveTextContent(
    'Wednesday 7 October10:00 is no longer free. Choose another time.',
  )
  expect(row('Cancelling')).toHaveTextContent(
    'Free to cancel until 24 hours before your visit, and the studio refunds your deposit.',
  )
  expect(bar).toHaveTextContent('Wed 7 Oct · ')
  expect(bar).not.toHaveTextContent('10:00')
  await user.click(screen.getByRole('button', { name: 'Hold 09:30 instead' }))
  expect(await screen.findByText(/Wednesday 7 October at 09:30/)).toBeVisible()
  expect(row('When')).toHaveTextContent('Wednesday 7 October09:30 to 10:30')
  expect(bar).toHaveTextContent('Wed 7 Oct at 09:30 · ')
  // A different time has its own cutoff, so the terms are agreed again.
  const terms = screen.getByRole('checkbox', { name: /I agree to the deposit/ })
  expect(terms).not.toBeChecked()
  await user.click(terms)
  await user.click(screen.getByRole('button', { name: 'Confirm visit' }))
  await screen.findByText('Saved in the studio calendar')
  const booked = vi.mocked(api).mock.calls.find(([path]) => path === `${base}/book`)!
  expect((booked[1]?.body as typeof payload).hold).toBe('4'.repeat(48))
  expect((booked[1]?.body as typeof payload).contact.name).toBe(payload.contact.name)
}, 15_000)

test('a time from an earlier day is never offered again; choosing another starts on the studio’s today', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T07:00:00.000Z'))
  sessionStorage.setItem(
    journal,
    JSON.stringify({
      payload,
      serviceId: state.services[0].id,
      staffId: 'any',
      date: '2026-10-02',
      start: 600,
      expiresAt: '2026-10-02T09:05:00.000Z',
    }),
  )
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return catalog as never
    if (path === `${base}/book`)
      throw new ApiError('This reservation expired. Choose a time again.', 409)
    if (path === `${base}/holds/release`) return { released: false } as never
    if (path.startsWith(`${base}/days?`))
      return { days: fortnight(queryOf(path).get('from')!, {}) } as never
    if (path.startsWith(`${base}/availability?`)) return { times: [600] } as never
    throw new Error(`Unexpected route ${path}`)
  })
  const user = userEvent.setup()
  view()
  await user.click(await screen.findByRole('button', { name: 'Check booking status' }))
  expect(await screen.findByText('That time has passed')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Hold it again' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Choose another time' }))
  const days = await screen.findByRole('radiogroup', { name: 'Choose a day' })
  expect(within(days).getByRole('radio', { name: /^Today, Tuesday 6 October/ })).toBeChecked()
  expect(within(days).queryByRole('radio', { name: /Friday 2 October/ })).not.toBeInTheDocument()
  expect(await screen.findByRole('group', { name: 'Times on Tuesday 6 October' })).toBeVisible()
  expect(datesAsked().filter((date) => date < '2026-10-06')).toEqual([])
})

test('one summary of the visit follows the guest through every step and onto the confirmation', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // Noon on Monday 5 October: the visit is on Wednesday 7 October at 10:00.
  vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
  const user = userEvent.setup()
  const token = 'm'.repeat(43),
    manage = `http://localhost:3000/manage#${token}`
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base)
      return {
        ...catalog,
        organisation: { ...state.organisation, arrivalNote: 'Ring the bell by the blue door.' },
        services: [{ ...state.services[0], prepNote: 'Come with a clean face.' }],
        tax: { label: 'VAT', rateBps: 2000, inclusive: true },
        depositPolicy: 'card',
        cardPayments: { testMode: true },
        emailsLive: false,
        cancellation: { cutoffHours: 24, feePercent: 0 },
      } as never
    if (path.startsWith(`${base}/days?`))
      return { days: fortnight(queryOf(path).get('from')!, {}) } as never
    if (path.startsWith(`${base}/availability?`)) return { times: [600] } as never
    if (path === `${base}/holds`)
      return {
        hold: payload.hold,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        staffId: 'staff-maya',
      } as never
    if (path === `${base}/book`)
      return { appointmentId: 'visit-1a2b3c4d', manage: { url: manage } } as never
    throw new Error(`Unexpected route ${path}`)
  })
  view()
  await user.click(await screen.findByRole('button', { name: 'Choose a time' }))
  const summary = screen.getByRole('region', { name: 'Your visit' })
  const row = (label: string) => within(summary).getByText(label).closest('div')!
  expect(summary.querySelector('.your-visit-treatment')).toHaveTextContent(
    'SkinSkin Renewal Facial60 minutes',
  )
  expect(row('With')).toHaveTextContent('Any available professional')
  expect(row('Where')).toHaveTextContent('Marylebone, London24 Devonshire Place, London W1G')
  expect(row('When')).toHaveTextContent('Wednesday 7 OctoberChoose a time')
  expect(row('Price')).toHaveTextContent('£95Including VAT')
  expect(row('Deposit')).toHaveTextContent('£25Paid by card once you confirm.')
  expect(row('Cancelling')).toHaveTextContent(
    'Free to cancel until 24 hours before your visit, and the studio refunds your deposit. After that it keeps the deposit.',
  )
  // On a phone the summary is a bar that opens to the whole of it.
  const bar = within(summary).getByRole('button', { name: /Skin Renewal Facial/ })
  expect(bar).toHaveAttribute('aria-expanded', 'false')
  expect(bar).toHaveTextContent('Wed 7 Oct · £95')
  await user.click(bar)
  expect(bar).toHaveAttribute('aria-expanded', 'true')
  // Choosing a time fills it in, with the cutoff on the studio's clock.
  await user.click(await screen.findByRole('radio', { name: '10:00' }))
  expect(row('When')).toHaveTextContent('Wednesday 7 October10:00 to 11:00')
  expect(bar).toHaveTextContent('Wed 7 Oct at 10:00 · £95')
  expect(row('Cancelling')).toHaveTextContent(
    'Free to cancel until Tuesday 6 October at 10:00, and the studio refunds your deposit.',
  )
  await user.click(screen.getByRole('button', { name: 'Hold this time' }))
  // The details step says what is being booked, and the summary says who it is with.
  expect(
    await screen.findByText(
      'You’re booking Skin Renewal Facial on Wednesday 7 October at 10:00. Atelier House uses your details to confirm the visit and to reach you if anything changes.',
    ),
  ).toBeVisible()
  expect(row('With')).toHaveTextContent('Maya Lewis')
  await user.type(screen.getByLabelText('Full name'), payload.contact.name)
  await user.type(screen.getByLabelText('Email'), payload.contact.email)
  await user.type(screen.getByLabelText('Phone number'), payload.contact.phone)
  await user.click(screen.getByRole('button', { name: 'Review your visit' }))
  expect(screen.getByRole('region', { name: 'Your visit' })).toBe(summary)
  await user.click(screen.getByRole('checkbox', { name: /I agree to the deposit/ }))
  await user.click(screen.getByRole('button', { name: 'Confirm visit' }))
  await screen.findByText('Saved in the studio calendar')
  // The guest's own next steps, and no way into the studio's workspace.
  expect(screen.queryByRole('button', { name: /workspace/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /workspace/i })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View my visit' })).toHaveAttribute('href', manage)
  expect(screen.getByRole('button', { name: 'Add to calendar' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Copy link' }))
  expect(await screen.findByText('Link copied. Keep it somewhere safe.')).toBeVisible()
  expect(await navigator.clipboard.readText()).toBe(manage)
  expect(screen.getByText(/Your booking reference is 1A2B3C4D\./)).toBeVisible()
  // The whole visit again, with the address and what to know before arriving.
  const receipt = screen.getByRole('region', { name: 'Your visit' })
  expect(receipt).not.toBe(summary)
  expect(within(receipt).getByText('24 Devonshire Place, London W1G')).toBeVisible()
  expect(within(receipt).getByText('10:00 to 11:00')).toBeVisible()
  expect(within(receipt).getByText('Maya Lewis')).toBeVisible()
  const arrive = screen.getByRole('region', { name: 'Before you arrive' })
  expect(arrive).toHaveTextContent('Ring the bell by the blue door.')
  expect(arrive).toHaveTextContent('Come with a clean face.')
})

test('a booking page that is not there says so kindly, with no way into the workspace', async () => {
  vi.mocked(api).mockRejectedValue(
    new ApiError('Online booking is not available for this studio.', 404),
  )
  view()
  expect(
    await screen.findByRole('heading', { name: 'This booking page isn’t available' }),
  ).toBeVisible()
  expect(screen.getByText(/check the link with the studio/)).toBeVisible()
  expect(screen.queryAllByRole('link')).toEqual([])
  expect(screen.queryByText(/workspace/i)).not.toBeInTheDocument()
})

test('a booking page that fails to load can be tried again', async () => {
  const user = userEvent.setup()
  let fail = true
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) {
      if (fail) throw new ApiError('The service is busy.', 503)
      return catalog as never
    }
    throw new Error(`Unexpected route ${path}`)
  })
  view()
  expect(await screen.findByRole('heading', { name: 'This page didn’t load' })).toBeVisible()
  expect(screen.queryAllByRole('link')).toEqual([])
  fail = false
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('button', { name: 'Choose a time' })).toBeVisible()
})

test('with two locations, guests choose where, or are told where when only one offers it', async () => {
  const user = userEvent.setup()
  const locations = [
    { id: 'loc-london', name: 'Marylebone, London', address: '24 Devonshire Place, London W1G' },
    { id: 'loc-islington', name: 'Islington', address: '1 Upper Street, London' },
  ]
  const studioWith = (sophiaAt: string) => ({
    ...catalog,
    locations,
    staff: state.staff.map((person) => ({
      ...person,
      locationIds: [person.id === 'staff-sophia' ? sophiaAt : 'loc-london'],
    })),
  })
  let page = studioWith('loc-london')
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return page as never
    if (path.startsWith(`${base}/days?`))
      return { days: fortnight(queryOf(path).get('from')!, {}) } as never
    if (path.startsWith(`${base}/availability?`)) return { times: [600] } as never
    throw new Error(`Unexpected route ${path}`)
  })
  const first = view()
  await user.click(await screen.findByRole('button', { name: 'Choose a time' }))
  expect(
    await screen.findByText('Skin Renewal Facial is offered at Marylebone, London only.'),
  ).toBeVisible()
  expect(
    screen.queryByRole('group', { name: 'Where would you like to come?' }),
  ).not.toBeInTheDocument()
  first.unmount()
  page = studioWith('loc-islington')
  view()
  await user.click(await screen.findByRole('button', { name: 'Choose a time' }))
  const where = await screen.findByRole('group', { name: 'Where would you like to come?' })
  expect(within(where).getAllByRole('button')).toHaveLength(2)
  expect(screen.queryByText(/is offered at .* only\./)).not.toBeInTheDocument()
})
