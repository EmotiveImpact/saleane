import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { seed } from '../domain/seed'
import { execute } from '../domain/commands'
import type { Command, ExecuteOptions } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import { defaultQuietOffers } from '../domain/quietOffersSchema'
import { storageKey } from '../state/storage'

// Stage 5, through the whole app: the invitation with a lower price waits in the Inbox with its
// price beside it, and a visit booked at a quiet-time price says so on the visit and its receipt.
let sequence = 0
function apply(s: BusinessState, command: Command, options: ExecuteOptions = {}) {
  const result = execute(s, command, new Date().toISOString(), () => `app-${++sequence}`, options)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
/** The sample studio offering 20% off quiet times, after Zoe's 13:30 facial was cancelled. */
function cancelled() {
  const s = seed('UK')
  s.waitlist = []
  s.operations = {
    ...s.operations!,
    quietOffers: { ...defaultQuietOffers, discount: 'percent' },
  } as BusinessState['operations']
  return apply(s, { type: 'cancel', appointmentId: 'visit-zoe', reason: 'Feeling unwell' })
}
const invitation = (s: BusinessState) =>
  s.operations!.messages.find((m) => m.opening && m.clientId === 'client-13')!
function show(s: BusinessState, route: string) {
  localStorage.setItem(storageKey('UK'), JSON.stringify(s))
  render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}
const WAIT = { timeout: 10000 }
const stored = () => JSON.parse(localStorage.getItem(storageKey('UK'))!) as BusinessState

describe('a quiet-time price in the studio', { timeout: 30000 }, () => {
  it('waits in the Inbox with the lower price beside it, and is approved as written', async () => {
    const user = userEvent.setup()
    const s = cancelled()
    show(s, '/inbox')
    await user.click(await screen.findByRole('button', { name: /Charlotte Hayes/ }, WAIT))
    const thread = screen.getByRole('list', { name: 'Conversation with Charlotte Hayes' })
    expect(thread).toHaveTextContent('[a private link to book this time at its lower price]')
    expect(thread).not.toHaveTextContent('{{')
    expect(within(thread).getByText(/^Quiet-time price:/).parentElement).toHaveTextContent(
      'Quiet-time price: £76 instead of the usual £95, open until Tuesday 6 October at 13:30.',
    )
    await user.click(within(thread).getByRole('button', { name: 'Approve and queue' }))
    expect(invitation(stored())).toMatchObject({
      status: 'queued',
      offer: invitation(s).offer,
    })
  })

  it('shows on the visit as booked below the usual price', async () => {
    const user = userEvent.setup()
    let s = cancelled()
    const messageId = invitation(s).id
    s = apply(s, { type: 'message-queue', messageId })
    s = apply(
      s,
      {
        type: 'book',
        input: {
          clientId: 'client-13',
          serviceId: 'service-facial',
          staffId: 'staff-maya',
          date: '2026-10-06',
          startMinutes: 810,
          source: 'online',
        },
      },
      { offer: { messageId } },
    )
    show(s, '/today')
    await user.click(
      await screen.findByRole('button', { name: /Charlotte Hayes Skin Renewal Facial/ }, WAIT),
    )
    const panel = screen.getByRole('dialog', { name: 'Skin Renewal Facial' })
    const money = panel.querySelector('.visit-money') as HTMLElement
    expect(within(money).getByText('Treatment').parentElement).toHaveTextContent('£76')
    expect(within(money).getByText('Quiet-time price').parentElement).toHaveTextContent(
      '£19 off £95',
    )
    // At checkout, the treatment is charged at the lower price and says why.
    await user.click(within(panel).getByRole('button', { name: 'Welcome client' }))
    await user.click(
      await within(panel).findByRole('button', { name: 'Continue to checkout' }, WAIT),
    )
    const line = await within(panel).findByText('Quiet-time price, £19 off £95', {}, WAIT)
    expect(line.closest('.visit-service-line')).toHaveTextContent('£76.00')
  })

  it('sits in Settings beside the messages to guests', async () => {
    show(cancelled(), '/settings?section=messages')
    const panel = await screen.findByRole('region', { name: 'A lower price for quiet times' }, WAIT)
    expect(within(panel).getByRole('radio', { name: /A percentage off/ })).toBeChecked()
    expect(within(panel).getByLabelText('Percentage off')).toHaveValue(20)
  })
})
