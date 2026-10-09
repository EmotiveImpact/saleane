import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
  expect(screen.getByText(/The studio will give back your £25.00 deposit/)).toBeInTheDocument()
  expect(screen.getByText(/nothing is refunded automatically/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Yes, cancel my visit' }))
  await screen.findByRole('heading', { name: 'Your visit is cancelled.' })
  expect(
    screen.getByText(/can see your cancellation. It will give back your £25.00/),
  ).toBeInTheDocument()
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
  expect(screen.getByText(/so the studio keeps your £25.00 deposit/)).toBeInTheDocument()
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

const moveTimes = (date: string, anyone = false) => ({
  days: [
    { date: '2026-10-06', open: true },
    { date: '2026-10-07', open: true },
    { date: '2026-10-08', open: true },
    { date: '2026-10-11', open: false },
  ],
  date,
  anyone,
  times:
    date === '2026-10-08'
      ? [
          { startMinutes: 600, staffId: 'staff-maya', professional: 'Maya' },
          {
            startMinutes: 840,
            staffId: anyone ? 'staff-sophia' : 'staff-maya',
            professional: anyone ? 'Sophia' : 'Maya',
          },
        ]
      : [],
})
const movable = (): GuestView => ({ ...view('refund_due'), move: { available: true } })
const movedTo = (date: string, startMinutes: number): GuestView => ({
  ...movable(),
  visit: { ...movable().visit, date, startMinutes },
})

test('moves the visit to a free time after showing the old and new side by side', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path, options) => {
    const body = options?.body as { date?: string; anyone?: boolean }
    if (path === '/api/guest/visit') return movable() as never
    if (path === '/api/guest/move-times')
      return moveTimes(body.date ?? '2026-10-07', body.anyone) as never
    return movedTo('2026-10-08', 840) as never
  })
  render(<ManageVisit />)
  expect(
    await screen.findByText(
      /move your visit to another free time online until Tuesday 6 October at 09:00/,
    ),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Move my visit' }))
  // The strip opens on the visit's own day, which has nothing else free.
  expect(
    await screen.findByText(
      'No free times with Maya on Wednesday 7 October. Try another day, or anyone available.',
    ),
  ).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Sun 11 Oct Closed' })).toBeDisabled()
  expect(screen.getByRole('radio', { name: 'Wed 7 Oct Your visit' })).toBeChecked()
  await user.click(screen.getByRole('radio', { name: /Thu 8 Oct/ }))
  // Times come a part of the day at a time.
  await user.click(await screen.findByRole('button', { name: /^Afternoon/ }))
  await user.click(screen.getByRole('radio', { name: '14:00' }))
  await user.click(screen.getByRole('button', { name: /Review the change/ }))
  expect(screen.getByRole('heading', { name: 'Check your new time' })).toBeInTheDocument()
  expect(
    within(screen.getByText('Now').parentElement!).getByText(/^Wednesday 7 October at 09:00$/),
  ).toBeInTheDocument()
  expect(
    within(screen.getByText('New time').parentElement!).getByText(/^Thursday 8 October at 14:00$/),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Yes, move my visit' }))
  expect(
    await screen.findByText(/Your visit has moved to Thursday 8 October at 14:00 with Maya/),
  ).toBeInTheDocument()
  const sent = vi.mocked(api).mock.calls.find(([path]) => path === '/api/guest/move')!
  expect(sent[1]).toEqual({
    method: 'POST',
    body: {
      token,
      date: '2026-10-08',
      startMinutes: 840,
      staffId: 'staff-maya',
      requestKey: expect.stringMatching(/^[A-Za-z0-9-]{16,100}$/),
    },
  })
  expect(sessionStorage.length).toBe(0)
})

test('offers anyone available, naming who each time is with', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path, options) => {
    const body = options?.body as { date?: string; anyone?: boolean }
    if (path === '/api/guest/visit') return movable() as never
    return moveTimes(body.date ?? '2026-10-08', body.anyone) as never
  })
  render(<ManageVisit />)
  await user.click(await screen.findByRole('button', { name: 'Move my visit' }))
  await user.click(await screen.findByRole('button', { name: /^Afternoon/ }))
  expect(screen.getByRole('radio', { name: '14:00' })).toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'Anyone available' }))
  expect(await screen.findByRole('radio', { name: '14:00 · Sophia' })).toBeInTheDocument()
  expect(vi.mocked(api)).toHaveBeenLastCalledWith('/api/guest/move-times', {
    method: 'POST',
    body: { token, date: '2026-10-08', anyone: true },
  })
})

test('keeps an unanswered move in the tab and checks it again before anything else', async () => {
  const user = userEvent.setup()
  let answer: 'lost' | 'moved' = 'lost'
  vi.mocked(api).mockImplementation(async (path, options) => {
    const body = options?.body as { date?: string; anyone?: boolean }
    if (path === '/api/guest/visit') return movable() as never
    if (path === '/api/guest/move-times') return moveTimes(body.date ?? '2026-10-08') as never
    if (answer === 'lost') throw new ApiError('The local server could not confirm this request.', 0)
    return movedTo('2026-10-08', 600) as never
  })
  const first = render(<ManageVisit />)
  await user.click(await screen.findByRole('button', { name: 'Move my visit' }))
  await user.click(await screen.findByRole('radio', { name: '10:00' }))
  await user.click(screen.getByRole('button', { name: /Review the change/ }))
  await user.click(screen.getByRole('button', { name: 'Yes, move my visit' }))
  expect(await screen.findByText(/We couldn’t confirm your move/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel this visit' })).toBeDisabled()
  const key = (vi.mocked(api).mock.calls.at(-1)![1]!.body as { requestKey: string }).requestKey

  // Reopening the page in this tab still knows, and sends the very same request.
  first.unmount()
  answer = 'moved'
  render(<ManageVisit />)
  expect(await screen.findByText(/We couldn’t confirm your move/)).toBeInTheDocument()
  expect(screen.getByText(/to Thursday 8 October at 10:00 with Maya/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel this visit' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Check again' }))
  expect(await screen.findByText(/Your visit has moved to Thursday 8 October/)).toBeInTheDocument()
  expect((vi.mocked(api).mock.calls.at(-1)![1]!.body as { requestKey: string }).requestKey).toBe(
    key,
  )
  expect(screen.getByRole('button', { name: 'Cancel this visit' })).toBeEnabled()
  expect(sessionStorage.length).toBe(0)
})

test('shows the times free now when the chosen one was just taken', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path, options) => {
    const body = options?.body as { date?: string; anyone?: boolean }
    if (path === '/api/guest/visit') return movable() as never
    if (path === '/api/guest/move-times') return moveTimes(body.date ?? '2026-10-08') as never
    throw new ApiError('That time is no longer free. Choose another time.', 409)
  })
  render(<ManageVisit />)
  await user.click(await screen.findByRole('button', { name: 'Move my visit' }))
  await user.click(await screen.findByRole('radio', { name: '10:00' }))
  await user.click(screen.getByRole('button', { name: /Review the change/ }))
  await user.click(screen.getByRole('button', { name: 'Yes, move my visit' }))
  expect(
    await screen.findByText('That time is no longer free. Choose another time.'),
  ).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Choose a new time' })).toBeInTheDocument()
  expect(screen.queryByText(/We couldn’t confirm your move/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel this visit' })).toBeEnabled()
  expect(sessionStorage.length).toBe(0)
})

test('sends the guest to the studio once moving online has closed', async () => {
  vi.mocked(api).mockResolvedValue({
    ...view('retained'),
    move: { available: false, reason: 'cutoff' },
  } as never)
  render(<ManageVisit />)
  expect(
    await screen.findByText(
      /less than 24 hours until your visit, so it can no longer be moved online. To change it, contact the studio./,
    ),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Move my visit' })).not.toBeInTheDocument()
  expect(screen.getByText('To get in touch, reply to your confirmation email.')).toBeInTheDocument()
})

test('after a cancellation, offers booking again and never says to contact the studio to move', async () => {
  vi.mocked(api).mockResolvedValue({
    ...view('none', 'cancelled'),
    bookAgain: { path: '/book/reference-studio?service=service-facial' },
  } as never)
  render(<ManageVisit />)
  expect(
    await screen.findByRole('heading', { name: 'Your visit is cancelled.' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Book again/ })).toHaveAttribute(
    'href',
    '/book/reference-studio?service=service-facial',
  )
  expect(screen.queryByText(/To move your visit/)).not.toBeInTheDocument()
  expect(screen.queryByText(/contact the studio/i)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Move my visit' })).not.toBeInTheDocument()
})

test('mentions a deposit only when there is one', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockResolvedValue({
    ...view('none'),
    deposit: { paidMinor: 0, simulated: false },
  } as never)
  render(<ManageVisit />)
  await user.click(await screen.findByRole('button', { name: 'Cancel this visit' }))
  expect(screen.getByText(/back on the studio’s calendar for someone else/)).toBeInTheDocument()
  expect(screen.queryByText(/deposit/i)).not.toBeInTheDocument()
})

test('wears the studio colours and photograph, like its booking page', async () => {
  vi.mocked(api).mockResolvedValue({
    ...view('none'),
    look: { first: '#7a6690', second: '#9a86b8' },
  } as never)
  const { container } = render(<ManageVisit />)
  await screen.findByText('Skin Renewal Facial')
  // The colours are applied just after the visit appears.
  await waitFor(() =>
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe('#7a6690'),
  )
  expect(container.querySelector('.visit-hero img')).toHaveAttribute(
    'src',
    '/images/library/rooms/studio-exterior.webp',
  )
  expect(screen.getAllByText('Reference Studio').length).toBeGreaterThan(0)
})

test('asks about coming in sooner only in the parts of the day the studio could offer', async () => {
  vi.mocked(api).mockResolvedValue({
    ...view('refund_due'),
    waitlist: { joined: null, offered: ['morning', 'afternoon'] },
  } as never)
  render(<ManageVisit />)
  expect(
    await screen.findByRole('heading', { name: 'Would you like to come in sooner?' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Mornings' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Afternoons' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'Evenings' })).not.toBeInTheDocument()
})

test('leaves out coming in sooner for a visit only a day or two away', async () => {
  vi.mocked(api).mockResolvedValue(view('refund_due') as never)
  render(<ManageVisit />)
  await screen.findByText('Skin Renewal Facial')
  expect(screen.queryByText(/come in sooner/)).not.toBeInTheDocument()
})

const testDeposit = (outcome: GuestView['cancellation']['outcome']): GuestView => ({
  ...view(outcome),
  deposit: { paidMinor: 2500, simulated: false, test: true },
})

test('says a test deposit took no money, before and after cancelling', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/api/guest/cancel'
      ? ({
          ...testDeposit('refund_due'),
          visit: { ...view('none').visit, status: 'cancelled' },
        } as never)
      : (testDeposit('refund_due') as never),
  )
  render(<ManageVisit />)
  expect(await screen.findByText('£25.00 test payment')).toBeInTheDocument()
  expect(screen.getByText('No money was taken.')).toBeInTheDocument()
  expect(
    screen.getByText(
      'Cancel before Tuesday 6 October at 09:00 and your £25.00 deposit would be given back. It was a test payment, so no money was taken.',
    ),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cancel this visit' }))
  expect(
    screen.getByText(
      'Your £25.00 deposit would be given back. It was a test payment, so no money was taken.',
    ),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Yes, cancel my visit' }))
  expect(
    await screen.findByText(
      'Reference Studio can see your cancellation. Your deposit was a test payment, so no money was taken.',
    ),
  ).toBeInTheDocument()
  expect(screen.queryByText(/will give back|refunded/)).not.toBeInTheDocument()
})

test('a late cancellation with a test deposit still says no money was taken', async () => {
  vi.mocked(api).mockResolvedValue(testDeposit('retained') as never)
  render(<ManageVisit />)
  expect(
    await screen.findByText(
      'It is less than 24 hours until your visit, so if you cancel now the studio would keep your £25.00 deposit. It was a test payment, so no money was taken.',
    ),
  ).toBeInTheDocument()
})

describe('coming back from the payment page', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    window.history.replaceState(null, '', '/')
  })
  const returning = () => window.history.replaceState(null, '', `/manage?payment=done#${token}`)

  test('says a test payment took no money, never that money went through', async () => {
    returning()
    vi.mocked(api).mockResolvedValue({ ...testDeposit('refund_due'), payment: null } as never)
    render(<ManageVisit />)
    expect(
      await screen.findByText('Thank you. That was a test payment, so no money was taken.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/went through/)).not.toBeInTheDocument()
  })

  test('while a test payment is confirmed, says no money is taken', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    returning()
    vi.mocked(api).mockResolvedValue({
      ...view('none'),
      deposit: { paidMinor: 0, simulated: false },
      payment: {
        testMode: true,
        depositDueMinor: 2500,
        saveCardOffered: false,
        savedCard: null,
        policy: 'Your card is saved for visits at Reference Studio.',
        pending: true,
      },
    } as never)
    render(<ManageVisit />)
    expect(
      await screen.findByText(
        'Thank you. Your test payment is being confirmed and will show here shortly. No money is taken.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/We’re confirming your test payment/)).toBeInTheDocument()
  })

  test('a real payment that landed says it went through', async () => {
    returning()
    vi.mocked(api).mockResolvedValue({ ...view('refund_due'), payment: null } as never)
    render(<ManageVisit />)
    expect(await screen.findByText('Thank you. That went through.')).toBeInTheDocument()
    expect(screen.getByText('£25.00 paid')).toBeInTheDocument()
  })
})

test('reads dates with the weekday and times on a 12-hour clock for a studio in the US', async () => {
  const user = userEvent.setup()
  const us = movable()
  us.organisation = {
    ...us.organisation,
    locale: 'en-US',
    timeZone: 'America/New_York',
    currency: 'USD',
    region: 'US',
  }
  us.cancellation = { ...us.cancellation, cutoffAt: '2026-10-06T13:00:00.000Z' }
  vi.mocked(api).mockImplementation(async (path, options) => {
    const body = options?.body as { date?: string; anyone?: boolean }
    if (path === '/api/guest/visit') return us as never
    return moveTimes(body.date ?? '2026-10-08', body.anyone) as never
  })
  render(<ManageVisit />)
  expect(await screen.findByText('Wednesday, October 7 at 09:00 AM')).toBeInTheDocument()
  expect(screen.getByText(/online until Tuesday, October 6 at 09:00 AM/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Move my visit' }))
  expect(await screen.findByRole('radio', { name: '10:00 AM' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /^Thu Oct 8/ })).toBeChecked()
  expect(
    screen.getByRole('group', { name: 'Free times on Thursday, October 8' }),
  ).toBeInTheDocument()
})
