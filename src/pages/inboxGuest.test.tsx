import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { seed } from '../domain/seed'
import { DEMO_DATE } from '../domain/model'
import type { BusinessState } from '../domain/model'
import { storageKey } from '../state/storage'

// Stage 6: a guest booked under two records reads as one conversation in the Inbox.
const at = (time: string) => `${DEMO_DATE}T${time}:00.000Z`
function studio(): BusinessState {
  const s = seed('UK')
  const olivia = s.clients.find((c) => c.id === 'client-2')!
  // She booked online again, which opened a second record with her email and a new number.
  s.clients.push({
    ...olivia,
    id: 'client-online',
    email: olivia.email.toUpperCase(),
    phone: '+44 7700 900777',
    createdAt: at('06:00'),
  })
  const reply = (id: string, clientId: string, from: string, body: string, time: string) => ({
    id,
    organisationId: s.organisation.id,
    clientId,
    channel: 'sms' as const,
    from,
    body,
    receivedAt: at(time),
    providerRef: `ref-${id}`,
    actor: 'Text line',
  })
  s.replies = [
    ...(s.replies ?? []),
    reply('r-first', olivia.id, '+447700900002', 'Is Thursday still fine?', '06:10'),
    reply('r-online', 'client-online', '+447700900777', 'Booked online for next week.', '06:20'),
  ]
  return s
}
function show(state: BusinessState) {
  localStorage.setItem(storageKey('UK'), JSON.stringify(state))
  render(
    <MemoryRouter initialEntries={['/inbox']}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}
const stored = () => JSON.parse(localStorage.getItem(storageKey('UK'))!) as BusinessState

describe('one conversation per guest in the Inbox', { timeout: 20000 }, () => {
  afterEach(() => localStorage.clear())

  it('lists the guest once, holds both records’ messages and answers the number she last used', async () => {
    const user = userEvent.setup()
    show(studio())
    const rows = await screen.findAllByRole('button', { name: /Olivia James/ })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('2 new replies')
    await user.click(rows[0])
    const thread = await screen.findByRole('list', { name: 'Conversation with Olivia James' })
    expect(
      within(thread)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('p')?.textContent),
    ).toEqual(['Is Thursday still fine?', 'Booked online for next week.'])
    expect(screen.getByText(/Booked under 2 client records with this email/)).toBeInTheDocument()
    // The details shown, and the answer, are those of the record she last wrote under.
    const header = screen.getByRole('heading', { name: 'Olivia James' }).closest('header')!
    expect(header).toHaveTextContent('+44 7700 900777')
    const box = screen.getByRole('textbox', { name: 'Reply to Olivia' })
    expect(screen.getByLabelText('Reply by')).toHaveValue('sms')
    await user.type(box, 'Of course, see you then.')
    await user.click(screen.getByRole('button', { name: 'Save as draft' }))
    expect(stored().operations!.messages.at(-1)).toMatchObject({
      clientId: 'client-online',
      channel: 'sms',
      status: 'draft',
    })
    // Opening it read both replies.
    expect(
      stored()
        .replies!.filter((r) => r.id === 'r-first' || r.id === 'r-online')
        .every((r) => r.readAt),
    ).toBe(true)
  })
})
