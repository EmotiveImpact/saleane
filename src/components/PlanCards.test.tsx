import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ClientPlans, PlansLedger } from './Plans'
import { api } from '../state/api'
import { execute } from '../domain/commands'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import { createWorkspace } from '../domain/workspace'
import { seed } from '../domain/seed'
import { holdings } from '../domain/plans'
import { cardAgreementWording } from '../domain/planCards'
import type { Role } from '../domain/operations'
import type { PlanCharge } from './usePlanCards'

// Stage 1: a membership paid each month from a saved card, as the desk and managers see it.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
let store: {
  mode: 'server'
  session: object
  state: BusinessState
  role: Role
  blocked: boolean
  branch: string | null
  commit: ReturnType<typeof vi.fn>
  reload: ReturnType<typeof vi.fn>
}
vi.mock('../state/context', () => ({ useStore: () => store }))

const visa = { id: 'card-1', brand: 'Visa', last4: '4242' }
let sequence = 0
function apply(s: BusinessState, command: Command, at = '2026-10-06T08:00:00.000Z') {
  const result = execute(s, command, at, () => `id-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
/** Amelia holds the £75 Facial club, sold on 6 October; optionally paid from her Visa. */
function studio(withCard: boolean) {
  let s = createWorkspace({ name: 'Linden Studio', region: 'UK' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  s = apply(s, {
    type: 'offer',
    input: {
      kind: 'membership',
      name: 'Facial club',
      serviceIds: ['service-facial'],
      visits: 1,
      priceMinor: 7500,
      discountPercent: 10,
      validMonths: 1,
      archived: false,
    },
  })
  s = apply(s, {
    type: 'plan-sell',
    offerId: s.offers![0].id,
    clientId: 'client-1',
    method: 'cash',
  })
  const holding = holdings(s)[0]
  if (withCard)
    s = apply(s, {
      type: 'plan-card',
      holdingId: holding.id,
      card: visa,
      wording: cardAgreementWording(s, holding, visa),
    })
  return s
}
const reply = (state: BusinessState, extra: object = {}) => ({
  provider: { name: 'test', live: false },
  available: true,
  held: false,
  cards: [
    {
      id: 'card-1',
      brand: 'Visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2029,
      createdAt: '2026-10-01T10:00:00.000Z',
    },
  ],
  charges: [] as PlanCharge[],
  ...extra,
  _: state.revision,
})
const charge = (patch: Partial<PlanCharge>): PlanCharge => ({
  id: 'try-1',
  holdingId: '',
  clientId: 'client-1',
  kind: 'charge',
  periodStart: '2026-11-06',
  amountMinor: 7500,
  card: { brand: 'Visa', last4: '4242' },
  try: 1,
  status: 'succeeded',
  detail: null,
  nextTryAt: null,
  testMode: true,
  createdAt: '2026-11-06T09:00:00.000Z',
  updatedAt: '2026-11-06T09:00:00.000Z',
  ...patch,
})
function use(state: BusinessState, role: Role = 'owner', branch: string | null = null) {
  store = {
    mode: 'server',
    session: { user: { id: 'account-ada', name: 'Ada Owner', email: 'ada@example.invalid' } },
    state,
    role,
    blocked: false,
    branch,
    commit: vi.fn(),
    reload: vi.fn(async () => undefined),
  }
}
const base = (s: BusinessState) => `/api/workspaces/${s.organisation.id}/plan-cards`
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-07T10:00:00.000Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

test('shows how a membership is paid and the last try, and turns it off after a confirm', async () => {
  const user = userEvent.setup()
  const state = studio(true)
  const holdingId = holdings(state)[0].id
  use(state)
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === `${base(state)}?clientId=client-1`)
      return reply(state, {
        charges: [
          charge({
            holdingId,
            status: 'failed',
            nextTryAt: '2026-11-09T09:00:00.000Z',
            detail: 'The card was declined.',
          }),
        ],
      }) as never
    if (path === `${base(state)}/${holdingId}/off`) return { ok: true } as never
    throw new Error(`Unexpected route ${path}`)
  })
  render(<ClientPlans clientId="client-1" />)
  expect(
    await screen.findByText(
      /Paid by Visa ending 4242 each month\. Next payment £75\.00 on 6 December\./,
    ),
  ).toBeInTheDocument()
  expect(screen.getByText('Last payment: Declined, next try 9 November')).toBeInTheDocument()
  expect(
    screen.getByText('Declined on 6 November. SALEANE will try again on 9 November.'),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Turn off card payments' }))
  expect(
    screen.getByText('The card will not be charged again. Each month is then paid at the desk.'),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Yes, turn off card payments' }))
  expect(vi.mocked(api)).toHaveBeenCalledWith(`${base(state)}/${holdingId}/off`, {
    method: 'POST',
    body: {},
  })
  expect(store.reload).toHaveBeenCalled()
})

test('sets it up only after the exact words are shown and the client’s agreement confirmed', async () => {
  const user = userEvent.setup()
  const state = studio(false)
  const holding = holdings(state)[0]
  use(state)
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === `${base(state)}?clientId=client-1`) return reply(state) as never
    if (path === `${base(state)}/${holding.id}`) return { ok: true } as never
    throw new Error(`Unexpected route ${path}`)
  })
  render(<ClientPlans clientId="client-1" />)
  await user.click(await screen.findByRole('button', { name: 'Pay each month from a saved card' }))
  const dialog = screen.getByRole('dialog')
  expect(
    within(dialog).getByText('Test mode: no card is charged and no money moves.'),
  ).toBeInTheDocument()
  const wording =
    'Amelia Carter agrees that Linden Studio may take £75.00 from their Visa card ending 4242 on the 6th of each month for Facial club, until they cancel. They will get a reminder three days before each payment.'
  expect(within(dialog).getByText(wording)).toBeInTheDocument()
  expect(
    within(dialog).getByText(/The first payment from the card is £75\.00 on Sunday 6 December/),
  ).toBeInTheDocument()
  const save = within(dialog).getByRole('button', { name: 'Set up card payments' })
  expect(save).toBeDisabled()
  await user.click(within(dialog).getByLabelText('Amelia Carter has agreed to these words.'))
  await user.click(save)
  expect(vi.mocked(api)).toHaveBeenCalledWith(`${base(state)}/${holding.id}`, {
    method: 'POST',
    body: { cardId: 'card-1', wording, agreed: true },
  })
})

test('says how to save a card when the client has none', async () => {
  const user = userEvent.setup()
  const state = studio(false)
  use(state)
  vi.mocked(api).mockImplementation(async () => reply(state, { cards: [] }) as never)
  render(<ClientPlans clientId="client-1" />)
  await user.click(await screen.findByRole('button', { name: 'Pay each month from a saved card' }))
  expect(
    screen.getByText(
      'Amelia Carter has no saved card yet. They can save one from the link to their visit, once the studio offers it in Settings, Payments. Then set this up here.',
    ),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Set up card payments' })).toBeNull()
})

test('asks the provider again about an unclear payment, and only for those who may', async () => {
  const user = userEvent.setup()
  const state = studio(true)
  const holdingId = holdings(state)[0].id
  const unclear = charge({
    id: 'try-9',
    holdingId,
    status: 'unknown',
    detail: 'The connection dropped before the provider answered.',
  })
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === `${base(state)}?clientId=client-1`)
      return reply(state, { charges: [unclear] }) as never
    if (path === `${base(state)}/charges/try-9/check`)
      return { ...unclear, status: 'succeeded' } as never
    throw new Error(`Unexpected route ${path}`)
  })
  use(state, 'reception')
  const { unmount } = render(<ClientPlans clientId="client-1" />)
  expect(await screen.findByText('Last payment: Unclear')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Turn off card payments' })).toBeNull()
  unmount()
  use(state, 'manager')
  render(<ClientPlans clientId="client-1" />)
  await user.click(await screen.findByRole('button', { name: 'Check again' }))
  expect(vi.mocked(api)).toHaveBeenCalledWith(`${base(state)}/charges/try-9/check`, {
    method: 'POST',
    body: {},
  })
})

test('leaves a membership sold at another location to that location’s general manager', async () => {
  const state = studio(true)
  vi.mocked(api).mockImplementation(async () => reply(state) as never)
  use(state, 'general', 'location-elsewhere')
  render(<ClientPlans clientId="client-1" />)
  expect(await screen.findByText(/Paid by Visa ending 4242 each month/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Turn off card payments' })).toBeNull()
})

test('returns a card-paid month to the card when the membership ends, keeping one request', async () => {
  const user = userEvent.setup()
  let state = studio(true)
  const holdingId = holdings(state)[0].id
  state = apply(
    state,
    {
      type: 'plan-renew',
      holdingId,
      method: 'card',
      reference: 'pi_1',
      processor: { provider: 'test', live: false },
      periodStart: '2026-11-06',
    },
    '2026-11-06T09:00:00.000Z',
  )
  use(state)
  const keys: string[] = []
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === `${base(state)}?clientId=client-1`) return reply(state) as never
    if (path === `${base(state)}/${holdingId}/end`) {
      keys.push(options!.key!)
      return charge({
        id: 'refund-1',
        kind: 'refund',
        holdingId,
        status: 'unknown',
        amountMinor: 5000,
      }) as never
    }
    if (path === `${base(state)}/charges/refund-1/check`)
      return charge({
        id: 'refund-1',
        kind: 'refund',
        holdingId,
        status: 'succeeded',
        amountMinor: 5000,
      }) as never
    throw new Error(`Unexpected route ${path}`)
  })
  render(<ClientPlans clientId="client-1" />)
  await user.click(await screen.findByRole('button', { name: 'End Facial club' }))
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Why it is ending'), 'Moving away')
  const amount = within(dialog).getByLabelText(/Money returned/)
  await user.clear(amount)
  await user.type(amount, '50')
  expect(
    within(dialog).getByText(/goes back to that card through the payment provider, up to £75\.00/),
  ).toBeInTheDocument()
  expect(within(dialog).queryByLabelText('Returned by')).toBeNull()
  await user.click(within(dialog).getByRole('button', { name: 'Refund to the card and end' }))
  expect(await within(dialog).findByText(/Unclear, check the provider/)).toBeInTheDocument()
  // Sending it again reuses the same key, so it can never refund twice.
  await user.click(within(dialog).getByRole('button', { name: 'Refund to the card and end' }))
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
  await user.click(within(dialog).getByRole('button', { name: 'Check again' }))
  expect(store.reload).toHaveBeenCalled()
})

test('lists this month’s card payments on Money, and a restore pause for the owner to lift', async () => {
  const user = userEvent.setup()
  const state = studio(true)
  const holdingId = holdings(state)[0].id
  const rows = [
    charge({ id: 'a', holdingId, status: 'succeeded' }),
    charge({
      id: 'b',
      holdingId: 'other',
      clientId: 'client-2',
      periodStart: '2026-11-02',
      status: 'failed',
      nextTryAt: '2026-11-08T09:00:00.000Z',
    }),
    charge({
      id: 'c',
      holdingId: 'third',
      clientId: 'client-3',
      periodStart: '2026-11-03',
      status: 'unknown',
    }),
  ]
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === base(state)) return reply(state, { charges: rows, held: true, cards: [] }) as never
    if (path === `${base(state)}/resume`) return { ok: true } as never
    throw new Error(`Unexpected route ${path}`)
  })
  use(state)
  render(<PlansLedger />)
  expect(
    await screen.findByText('Membership payments from saved cards this month'),
  ).toBeInTheDocument()
  expect(screen.getByText('Taken (1)')).toBeInTheDocument()
  expect(screen.getByText('Declined or not taken (1)')).toBeInTheDocument()
  expect(screen.getByText('Unclear or waiting (1)')).toBeInTheDocument()
  expect(screen.getByText('Declined, next try 8 November')).toBeInTheDocument()
  expect(screen.getByText('Taken on 6 November. Test payment, no money moved.')).toBeInTheDocument()
  expect(
    screen.getByText('Card payments for memberships are paused after a restore.'),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Turn card payments back on' }))
  expect(vi.mocked(api)).toHaveBeenCalledWith(`${base(state)}/resume`, { method: 'POST', body: {} })
})

test('shows the desk this month’s card payments without the owner’s controls', async () => {
  // November was taken from the card; December is still to come.
  const sold = studio(true)
  const state = apply(
    sold,
    {
      type: 'plan-renew',
      holdingId: holdings(sold)[0].id,
      method: 'card',
      reference: 'pi_1',
      processor: { provider: 'test', live: false },
      periodStart: '2026-11-06',
    },
    '2026-11-06T09:00:00.000Z',
  )
  vi.mocked(api).mockImplementation(async () => reply(state, { held: true, cards: [] }) as never)
  use(state, 'reception')
  // A month due later this month is listed as upcoming.
  vi.setSystemTime(new Date('2026-12-01T10:00:00.000Z'))
  render(<PlansLedger />)
  expect(await screen.findByText('Upcoming (1)')).toBeInTheDocument()
  expect(
    screen.getByText(/Due on Sunday 6 December from the Visa card ending 4242/),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Turn card payments back on' })).toBeNull()
})

test('says card payments are paused while the studio is read only for its SALEANE bill', async () => {
  const sold = studio(true)
  const state = apply(
    sold,
    {
      type: 'plan-renew',
      holdingId: holdings(sold)[0].id,
      method: 'card',
      reference: 'pi_1',
      processor: { provider: 'test', live: false },
      periodStart: '2026-11-06',
    },
    '2026-11-06T09:00:00.000Z',
  )
  vi.mocked(api).mockImplementation(async () => reply(state, { paused: true, cards: [] }) as never)
  use(state, 'owner')
  vi.setSystemTime(new Date('2026-12-01T10:00:00.000Z'))
  render(<PlansLedger />)
  expect(
    await screen.findByText(
      'Card payments for memberships are paused while the studio is read only.',
    ),
  ).toBeInTheDocument()
  expect(screen.getByText('Paused')).toBeInTheDocument()
  expect(screen.queryByText('Upcoming')).toBeNull()
  // There is nothing to turn back on: paying the SALEANE bill opens the studio again.
  expect(screen.queryByRole('button', { name: 'Turn card payments back on' })).toBeNull()
})

test('offers the saved card when selling a membership, then shows the words to agree', async () => {
  const user = userEvent.setup()
  const state = studio(false)
  // Amelia's first membership ended, so she can buy it again.
  const before = apply(state, {
    type: 'plan-cancel',
    holdingId: holdings(state)[0].id,
    reason: 'Paused',
  })
  use(before)
  store.commit.mockImplementation(async (command: Command) => {
    const result = execute(before, command, '2026-11-07T10:00:00.000Z', () => 'new-holding')
    if (result.ok) store.state = result.state
    return result
  })
  vi.mocked(api).mockImplementation(async () => reply(before) as never)
  render(<ClientPlans clientId="client-1" />)
  await user.click(await screen.findByRole('button', { name: 'Sell a package or membership' }))
  const dialog = screen.getByRole('dialog')
  await user.click(within(dialog).getByLabelText('Take it from their saved card each month'))
  expect(
    within(dialog).getByText(/Next, read the client the exact words of the agreement/),
  ).toBeInTheDocument()
  await user.click(
    within(dialog).getByLabelText(
      'I confirm this money has already been received outside SALEANE.',
    ),
  )
  await user.click(within(dialog).getByRole('button', { name: 'Record £75.00' }))
  expect(store.commit).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'plan-sell', method: 'cash' }),
  )
  expect(
    await screen.findByRole('dialog', { name: 'Pay Facial club from a saved card' }),
  ).toBeInTheDocument()
  expect(
    screen.getByText(/may take £75\.00 from their Visa card ending 4242 on the 7th of each month/),
  ).toBeInTheDocument()
})
