import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PlanBilling } from './PlanBilling'
import { api } from '../state/api'
import { seed } from '../domain/seed'
import { DAY_MS, monthBill, plusBill } from '../domain/billing'
import type { BillingView, InvoiceView } from '../domain/billing'
import type { BusinessState } from '../domain/model'

// NEXT-02: the SALEANE plan in Settings, for the owner.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const sample = seed('UK')
const real = { ...sample, operations: { ...sample.operations!, mode: 'local' as const } }
let state: BusinessState = real
let mode = 'server'
const reload = vi.fn(async () => {})
vi.mock('../state/context', () => ({
  useStore: () => ({ mode, state, reload, role: 'owner' }),
}))
const base = `/api/workspaces/${sample.organisation.id}/billing`
const now = Date.parse('2026-10-09T10:00:00.000Z')
const card = { brand: 'Visa', last4: '4242', expMonth: 12, expYear: 2029 }
const plan = (extra: Partial<BillingView> = {}): BillingView => ({
  status: 'trial',
  stopReason: null,
  region: 'UK',
  test: true,
  trialEndsAt: now + 5 * DAY_MS,
  periodStart: null,
  periodEnd: null,
  plus: false,
  plusNext: false,
  cancelAtPeriodEnd: false,
  card: null,
  locations: 1,
  nextBill: { at: now + 5 * DAY_MS, bill: monthBill('UK', 1, false) },
  overdue: null,
  checking: false,
  held: false,
  invoices: [],
  ai: {
    typed: { used: 12, of: 300 },
    guestChats: { used: 0, of: 200 },
    talkSeconds: { used: 0, of: 1800 },
  },
  ...extra,
})
const invoice = (extra: Partial<InvoiceView> = {}): InvoiceView => ({
  ...monthBill('UK', 1, false),
  id: 'bill-1',
  number: 'TEST-000001',
  kind: 'month',
  periodStart: Date.parse('2026-09-09T10:00:00.000Z'),
  periodEnd: Date.parse('2026-10-09T10:00:00.000Z'),
  currency: 'GBP',
  status: 'paid',
  test: true,
  detail: null,
  createdAt: Date.parse('2026-09-09T10:00:00.000Z'),
  paidAt: Date.parse('2026-09-09T10:00:00.000Z'),
  ...extra,
})
const open = (path = '/settings?section=billing') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PlanBilling />
    </MemoryRouter>,
  )
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
})
afterEach(() => {
  vi.useRealTimers()
  state = real
  mode = 'server'
  vi.resetAllMocks()
})

test('shows a trial with no card, the first bill and the AI so far, and opens the card page', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return plan() as never
    if (path === `${base}/card`) return { url: '#card-page' } as never
    throw new Error(`Unexpected route ${path}`)
  })
  open()
  expect(
    await screen.findByText(
      'Free trial until 14 October 2026, 5 days left. Add a card to carry on after that; nothing is taken until the trial ends.',
    ),
  ).toBeInTheDocument()
  expect(screen.getByText('Free trial')).toBeInTheDocument()
  expect(screen.getByText('Test mode: no card is charged and no money moves.')).toBeInTheDocument()
  const next = screen.getByRole('heading', { name: 'Your next bill, on 14 October 2026' })
  const lines = within(next.parentElement!)
  expect(lines.getByText('SALEANE, 1 location')).toBeInTheDocument()
  expect(lines.getByText('VAT at 20%')).toBeInTheDocument()
  expect(lines.getByText('£58.80')).toBeInTheDocument()
  expect(screen.getByText('12 of 300 used')).toBeInTheDocument()
  expect(screen.getByText('No card saved yet')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Add a card' }))
  expect(api).toHaveBeenCalledWith(`${base}/card`, { method: 'POST', body: {} })
})

test('adds Plus part way through a paid month, after saying what it costs now', async () => {
  const user = userEvent.setup()
  const start = Date.parse('2026-10-01T00:00:00.000Z')
  const end = Date.parse('2026-11-01T00:00:00.000Z')
  const paid = plan({
    status: 'active',
    card,
    periodStart: start,
    periodEnd: end,
    nextBill: { at: end, bill: monthBill('UK', 1, false) },
    invoices: [invoice()],
  })
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path === base) return paid as never
    if (path === `${base}/plus`) {
      expect(init).toEqual({ method: 'POST', body: { on: true } })
      return { outcome: 'paid', billing: { ...paid, plus: true, plusNext: true } } as never
    }
    throw new Error(`Unexpected route ${path}`)
  })
  open()
  expect(
    await screen.findByText(
      'Paid until 1 November 2026. The next bill, £58.80, is taken that day from the Visa ending 4242.',
    ),
  ).toBeInTheDocument()
  expect(
    screen.getByText('Added now, it is charged for the rest of this month.'),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Add Plus' }))
  const ask = screen.getByRole('dialog', { name: 'Add Plus now?' })
  // £39 for the part of the month that is left, plus VAT.
  const owed = `£${(plusBill('UK', 1, now, start, end).totalMinor / 100).toFixed(2)}`
  expect(owed).toBe('£34.09')
  expect(ask).toHaveTextContent(
    `${owed} is taken now from the Visa ending 4242, for the rest of this month. From 1 November 2026 Plus is part of your monthly bill.`,
  )
  await user.click(within(ask).getByRole('button', { name: `Add Plus for ${owed}` }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Plus is on, with its larger AI allowance.',
  )
  expect(screen.getByRole('button', { name: 'Turn Plus off' })).toBeInTheDocument()
  expect(reload).toHaveBeenCalled()
  // The paid bill is listed, marked as a test.
  const bills = within(screen.getByRole('heading', { name: 'Bills' }).parentElement!)
  expect(bills.getByText('TEST-000001')).toBeInTheDocument()
  expect(bills.getByText('Test')).toBeInTheDocument()
})

test('a declined payment says nothing was taken', async () => {
  const user = userEvent.setup()
  const since = now - DAY_MS
  const owed = plan({
    status: 'overdue',
    card,
    periodStart: since,
    periodEnd: since + 30 * DAY_MS,
    nextBill: { at: now + 2 * DAY_MS, bill: monthBill('UK', 1, false) },
    overdue: { since, graceEndsAt: since + 14 * DAY_MS, nextAttemptAt: now + 2 * DAY_MS },
  })
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return owed as never
    if (path === `${base}/pay`) return { outcome: 'open', billing: owed } as never
    throw new Error(`Unexpected route ${path}`)
  })
  open()
  expect(
    await screen.findByText(
      'We could not take £58.80. We will try the card again on 11 October 2026. Pay, or use another card, by 22 October 2026 to keep everything working.',
    ),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Pay £58.80 now' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'The payment did not go through. Nothing was taken. Try again or use another card.',
  )
})

test('a read only studio can pay for a month from today, and cannot add Plus or stop', async () => {
  vi.mocked(api).mockResolvedValue(
    plan({
      status: 'stopped',
      stopReason: 'unpaid',
      card,
      nextBill: { at: now, bill: monthBill('UK', 1, false) },
    }) as never,
  )
  open()
  expect(
    await screen.findByText(
      'The bill was not paid, so the studio is read only. Nothing has been lost, and guests can still book. To carry on, pay £58.80 for a month from today.',
    ),
  ).toBeInTheDocument()
  expect(screen.getByText('Read only')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Pay £58.80 now' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Add Plus' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: /^Stop/ })).not.toBeInTheDocument()
  expect(
    screen.getByText('Ask Saleane and the AI receptionist rest while the studio is read only.'),
  ).toBeInTheDocument()
})

test('asks before stopping, and says nothing is deleted', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base) return plan({ card }) as never
    if (path === `${base}/stop`)
      return {
        outcome: 'stopping',
        billing: plan({ card, cancelAtPeriodEnd: true, nextBill: null }),
      } as never
    throw new Error(`Unexpected route ${path}`)
  })
  open()
  await user.click(await screen.findByRole('button', { name: 'Stop when the trial ends' }))
  const ask = screen.getByRole('dialog', { name: 'Stop when the trial ends?' })
  expect(ask).toHaveTextContent(
    'On 14 October 2026 the studio becomes read only. Nothing is deleted',
  )
  await user.click(within(ask).getByRole('button', { name: 'Stop then' }))
  expect(await screen.findByRole('button', { name: 'Keep my plan' })).toBeInTheDocument()
  expect(
    screen.getByText(
      'Free trial until 14 October 2026, 5 days left. The plan stops then, and the studio becomes read only.',
    ),
  ).toBeInTheDocument()
})

test('says what happened on the card page when the owner comes back', async () => {
  vi.mocked(api).mockResolvedValue(plan({ card }) as never)
  open('/settings?section=billing&card=saved&paid=no')
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Your card is saved, but the payment did not go through. Nothing was taken. Try another card.',
  )
  expect(reload).toHaveBeenCalled()
})

test('sample studios and the browser demo are never charged', () => {
  state = sample
  open()
  expect(screen.getByText(/Sample studios are never charged/)).toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
  mode = 'demo'
  state = real
  open()
  expect(screen.getByText(/The browser demo is never charged/)).toBeInTheDocument()
})
