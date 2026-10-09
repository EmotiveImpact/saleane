import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { seed } from '../domain/seed'
import { InboxReply } from './InboxReply'
import { defaultQuickReplies, quickReplies } from './quickReplies'

function show(route = '/inbox') {
  render(
    <MemoryRouter initialEntries={[route]}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}
const stored = () => JSON.parse(localStorage.getItem('saleane.demo.v1.UK')!)

// Each test drives the whole app, which can take several seconds on a busy machine.
describe('replying under a conversation', { timeout: 20000 }, () => {
  it('saves a reply started from a saved reply as a draft for approval, never as sent', async () => {
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: /Ellie Brooks/ }))
    const box = await screen.findByRole('textbox', { name: 'Reply to Ellie' })
    // Ellie wrote by text, so the answer goes the same way.
    expect(screen.getByLabelText('Reply by')).toHaveValue('sms')
    const chips = screen.getByRole('group', { name: 'Saved replies' })
    expect(
      within(chips)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual(['Thanks, back soon', 'Moving a visit', 'Running late'])
    expect(within(chips).getByRole('link', { name: 'Edit saved replies' })).toHaveAttribute(
      'href',
      '/settings?section=messages',
    )

    await user.click(screen.getByRole('button', { name: 'Save as draft' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write a reply to Ellie first')

    await user.click(within(chips).getByRole('button', { name: 'Moving a visit' }))
    expect(box).toHaveValue(
      'Of course. We can move you to a time that suits. Let us know which day works best and we will change it for you.',
    )
    expect(box).toHaveFocus()
    await user.type(box, ' See you Thursday.')
    await user.click(screen.getByRole('button', { name: 'Save as draft' }))
    expect(
      screen.getByText(
        'Draft saved in the conversation, waiting for approval. Nothing has been sent.',
      ),
    ).toBeInTheDocument()
    expect(box).toHaveValue('')
    expect(stored().operations.messages.at(-1)).toMatchObject({
      clientId: 'client-3',
      channel: 'sms',
      purpose: 'appointment',
      status: 'draft',
      body: 'Of course. We can move you to a time that suits. Let us know which day works best and we will change it for you. See you Thursday.',
    })
    const thread = screen.getByRole('list', { name: 'Conversation with Ellie Brooks' })
    expect(within(thread).getByText(/Draft, waiting for you · text/)).toBeInTheDocument()
    expect(within(thread).getByRole('button', { name: 'Approve and queue' })).toBeEnabled()
  })

  it('answers an email by email, with a plain subject', async () => {
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: /Amelia Carter/ }))
    const box = await screen.findByRole('textbox', { name: 'Reply to Amelia' })
    expect(screen.getByLabelText('Reply by')).toHaveValue('email')
    expect(box).toHaveAccessibleDescription(
      /Nothing leaves this sample studio\. By email, with the subject “A reply from Atelier House”\./,
    )
    await user.type(box, 'Of course, the quiet room is yours.')
    await user.click(screen.getByRole('button', { name: 'Save as draft' }))
    expect(stored().operations.messages.at(-1)).toMatchObject({
      clientId: 'client-1',
      channel: 'email',
      subject: 'A reply from Atelier House',
      body: 'Of course, the quiet room is yours.',
      status: 'draft',
    })
  })

  it('asks to link a message from an unknown number to a client before replying', async () => {
    show()
    await screen.findByRole('list', { name: /Conversation with \+44 7700 900999/ })
    expect(screen.queryByRole('textbox', { name: /^Reply to/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Link to a client')).toHaveValue('')
    expect(screen.queryByLabelText('This is')).not.toBeInTheDocument()
  })
})

describe('saved reply chips', () => {
  it('uses the studio’s own saved replies, or a few ready ones when it has none', () => {
    const saved = seed('UK').savedReplies!
    expect(quickReplies(saved)).toBe(saved)
    expect(quickReplies([]).map((r) => r.name)).toEqual([
      'Thank you, see you soon',
      'Would another time suit you?',
    ])
  })

  it('offers the ready ones on the reply box, and editing only to those who look after them', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => ({ ok: true }))
    const client = seed('UK').clients.find((c) => c.id === 'client-3')!
    render(
      <MemoryRouter>
        <InboxReply
          client={client}
          answering
          lastChannel="sms"
          saved={[]}
          studio="Atelier House"
          allowed
          pending={false}
          sends={false}
          live={false}
          canEditSaved={false}
          onSave={onSave}
        />
      </MemoryRouter>,
    )
    const chips = screen.getByRole('group', { name: 'Saved replies' })
    expect(within(chips).queryByRole('link')).not.toBeInTheDocument()
    await user.click(within(chips).getByRole('button', { name: defaultQuickReplies[1].name }))
    await user.click(within(chips).getByRole('button', { name: defaultQuickReplies[0].name }))
    expect(screen.getByRole('textbox', { name: 'Reply to Ellie' })).toHaveValue(
      `${defaultQuickReplies[1].body}\n\n${defaultQuickReplies[0].body}`,
    )
    await user.click(screen.getByRole('button', { name: 'Save as draft' }))
    expect(onSave).toHaveBeenCalledWith({
      channel: 'sms',
      subject: 'A reply from Atelier House',
      body: `${defaultQuickReplies[1].body}\n\n${defaultQuickReplies[0].body}`,
    })
  })
})
