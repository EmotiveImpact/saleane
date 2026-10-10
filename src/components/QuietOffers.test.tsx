import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { QuietOffers } from './QuietOffers'
import { CancelledTimes } from './CancelledTimes'
import { SmartInsights } from './SmartInsights'
import { seed } from '../domain/seed'
import { dispatch } from '../domain/commands'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import { defaultQuietOffers } from '../domain/quietOffersSchema'
import type { QuietOfferSettings } from '../domain/quietOffersSchema'

// Stage 5: the owner's lower price for quiet times in Settings, and the price an invitation to a
// cancelled time or to one of Today's open times carries.
let state: BusinessState
let role = 'owner'
const commit = vi.fn(async (command: Command) => {
  const result = dispatch(state, command, 'Ada Owner')
  if (result.ok) state = result.state
  return result
})
vi.mock('../state/context', () => ({
  useStore: () => ({ state, role, blocked: false, today: '2026-10-06', commit }),
}))
function studio(settings?: Partial<QuietOfferSettings>) {
  const s = seed('UK')
  s.waitlist = []
  if (settings)
    s.operations = {
      ...s.operations!,
      quietOffers: { ...defaultQuietOffers, ...settings },
    } as BusinessState['operations']
  return s
}
const panel = () => screen.getByRole('region', { name: 'A lower price for quiet times' })
beforeEach(() => {
  role = 'owner'
  commit.mockClear()
})

test('the owner sets a percentage off, a floor, how long it stays open and what is left out', async () => {
  const user = userEvent.setup()
  state = studio()
  render(<QuietOffers />)
  const kinds = within(panel()).getByRole('radiogroup', { name: 'Lower price' })
  expect(within(kinds).getByRole('radio', { name: /No lower price/ })).toBeChecked()
  expect(within(panel()).queryByLabelText('Percentage off')).toBeNull()
  const save = within(panel()).getByRole('button', { name: 'Save lower price' })
  expect(save).toBeDisabled()
  await user.click(within(kinds).getByRole('radio', { name: /A percentage off/ }))
  const percent = within(panel()).getByLabelText('Percentage off')
  await user.clear(percent)
  await user.type(percent, '25')
  expect(panel()).toHaveTextContent(
    'For example, Skin Renewal Facial at £95 would be offered at £71.25.',
  )
  await user.type(within(panel()).getByLabelText(/Never below/), '75')
  expect(panel()).toHaveTextContent(
    'For example, Skin Renewal Facial at £95 would be offered at £75.',
  )
  await user.selectOptions(within(panel()).getByLabelText('Each lower price stays open for'), '48')
  await user.click(within(panel()).getByText('Treatments left out'))
  await user.click(within(panel()).getByRole('checkbox', { name: 'Gloss & Tone' }))
  expect(within(panel()).getByText('Treatments left out (1)')).toBeVisible()
  await user.click(save)
  expect(commit).toHaveBeenCalledWith({
    type: 'quiet-offers',
    settings: {
      discount: 'percent',
      offPercent: 25,
      offMinor: 1000,
      floorMinor: 7500,
      openHours: 48,
      leftOutIds: ['service-gloss'],
    },
  })
  expect(within(panel()).getByRole('status')).toHaveTextContent(
    'Saved. Invitations written from now on carry this lower price. Any already written keep theirs.',
  )
})

test('refuses an amount it cannot use, before anything is saved', async () => {
  const user = userEvent.setup()
  state = studio()
  render(<QuietOffers />)
  await user.click(within(panel()).getByRole('radio', { name: /An amount off/ }))
  const amount = within(panel()).getByLabelText('Amount off (GBP)')
  await user.clear(amount)
  await user.type(amount, '0')
  await user.click(within(panel()).getByRole('button', { name: 'Save lower price' }))
  expect(within(panel()).getByRole('alert')).toHaveTextContent('Enter an amount off above zero.')
  expect(commit).not.toHaveBeenCalled()
})

test('everyone else reads it, and only the owner changes it', () => {
  role = 'manager'
  state = studio({ discount: 'amount', offMinor: 1500 })
  render(<QuietOffers />)
  expect(panel()).toHaveTextContent('Only the owner sets a lower price. You can read it here.')
  expect(within(panel()).getByRole('radio', { name: /An amount off/ })).toBeChecked()
  expect(within(panel()).getByRole('radio', { name: /An amount off/ })).toBeDisabled()
  expect(within(panel()).queryByRole('button', { name: 'Save lower price' })).toBeNull()
})

test('a cancelled time says the lower price its invitations carry, and who was invited at it', () => {
  role = 'reception'
  state = studio({ discount: 'percent' })
  const cancelled = dispatch(
    state,
    { type: 'cancel', appointmentId: 'visit-zoe', reason: 'Feeling unwell' },
    'Rae Desk',
  )
  if (!cancelled.ok) throw new Error(cancelled.error)
  state = cancelled.state
  render(
    <MemoryRouter>
      <CancelledTimes />
    </MemoryRouter>,
  )
  const card = screen.getByText('Tuesday 6 October at 13:30').closest('li')!
  expect(within(card).getByText('Invited').parentElement).toHaveTextContent(
    'Charlotte Hayes: waiting in the Inbox for approval, written by SALEANE, at a quiet-time price of £76 instead of £95',
  )
})

test('an invitation to one of Today’s open times carries the lower price, saved unsent', async () => {
  const user = userEvent.setup()
  role = 'reception'
  state = studio({ discount: 'percent' })
  render(<SmartInsights onBook={() => {}} />)
  const jamie = screen.getByText('Jamie Morgan').closest('li')!
  await user.click(within(jamie).getByRole('button', { name: 'Prepare an invitation' }))
  expect(jamie).toHaveTextContent('For that time only, it is £60 instead of the usual £75.')
  expect(jamie).toHaveTextContent('[a private link to book this time at its lower price]')
  expect(jamie).toHaveTextContent('Quiet-time price: £60 instead of the usual £75')
  await user.click(within(jamie).getByRole('button', { name: 'Save as unsent draft' }))
  expect(commit).toHaveBeenCalledWith({
    type: 'offer-invite',
    clientId: 'client-15',
    serviceId: 'service-cut',
    staffId: 'staff-theo',
    date: '2026-10-06',
    startMinutes: 735,
  })
  expect(within(jamie).getByRole('status')).toHaveTextContent(
    'Invitation saved in the Inbox, unsent.',
  )
})

test('without a lower price, the invitation to an open time is as it always was', async () => {
  const user = userEvent.setup()
  state = studio()
  render(<SmartInsights onBook={() => {}} />)
  const jamie = screen.getByText('Jamie Morgan').closest('li')!
  await user.click(within(jamie).getByRole('button', { name: 'Prepare an invitation' }))
  expect(jamie).not.toHaveTextContent('Quiet-time price')
  await user.click(within(jamie).getByRole('button', { name: 'Save as unsent draft' }))
  expect(commit).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'message',
      input: expect.objectContaining({ clientId: 'client-15', purpose: 'marketing' }),
    }),
  )
})
