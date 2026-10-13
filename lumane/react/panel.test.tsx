import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { ApprovalCard, AskPanel, Composer, Conversation, Message, UsageLine } from '.'
import type { AskTransport, Decided } from '.'

// Two pretend apps with no SALEANE inside them. Tally takes LUMANE's whole panel in the default
// look; Caleane builds its own panel from the parts, in its own design. If the parts needed
// anything from SALEANE, this file could not be written.

const invoices: AskTransport = {
  ask: async (question) =>
    /chase/i.test(question)
      ? {
          text: 'Three invoices are more than 30 days late, £4,860 in all. Here are three polite reminders, ready for you.',
          proposals: [
            {
              id: 'chase-1',
              summary: 'Email a reminder to Hartley & Rowe, Northgate Studio and Fenwick Joinery.',
              details: [{ label: 'Invoices', value: '3, £4,860 in all' }],
            },
          ],
          usage: [{ used: 42, allowance: 300, unit: 'uses', noun: 'questions' }],
        }
      : { text: 'Hartley & Rowe owe the most: £2,400.', proposals: [] },
  decide: async (_id, approve) => (approve ? 'done' : 'declined'),
}

describe('Ask in the default look (a pretend invoicing app)', () => {
  it('asks, prepares a change, waits for approval and shows the new usage', async () => {
    const user = userEvent.setup()
    const decide = vi.spyOn(invoices, 'decide')
    render(
      <AskPanel
        name="Ask Tally"
        about="AI assistant for your invoices"
        starters={['Chase the invoices more than 30 days late', 'Who owes the most?']}
        usage={[{ used: 41, allowance: 300, unit: 'uses', noun: 'questions' }]}
        transport={invoices}
        look={{ colour: '#2F6F62', corners: 'soft', scheme: 'light' }}
      />,
    )
    const panel = screen.getByRole('region', { name: 'Ask Tally' })
    expect(panel).toHaveAttribute('data-lumane-look', 'light')
    expect(panel.style.getPropertyValue('--lumane-accent')).toBe('#2F6F62')
    expect(within(panel).getByText('41 of 300 questions used this month.')).toBeInTheDocument()
    await user.click(
      within(panel).getByRole('button', { name: 'Chase the invoices more than 30 days late' }),
    )
    expect(
      await within(panel).findByText(/Three invoices are more than 30 days late/),
    ).toBeVisible()
    expect(within(panel).getByText('Waiting for your approval')).toBeInTheDocument()
    expect(within(panel).getByText('3, £4,860 in all')).toBeInTheDocument()
    expect(within(panel).getByText('42 of 300 questions used this month.')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Approve' }))
    expect(await within(panel).findByText('Done. Saved.')).toBeInTheDocument()
    expect(decide).toHaveBeenCalledWith('chase-1', true)
  })

  it('says what went wrong when an answer cannot come, and lets the person ask again', async () => {
    const user = userEvent.setup()
    const failing: AskTransport = {
      ...invoices,
      ask: vi
        .fn<AskTransport['ask']>()
        .mockRejectedValueOnce(new Error('Ask Tally could not answer. Try again.'))
        .mockResolvedValueOnce({ text: 'Hartley & Rowe owe the most.', proposals: [] }),
    }
    render(<AskPanel name="Ask Tally" transport={failing} />)
    await user.type(screen.getByLabelText('Your question'), 'Who owes the most?{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask Tally could not answer.')
    await user.type(screen.getByLabelText('Your question'), 'Who owes the most?{Enter}')
    expect(await screen.findByText('Hartley & Rowe owe the most.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('talks, counting down, and hangs up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const stop = vi.fn(async () => {})
    render(
      <AskPanel
        name="Ask Tally"
        transport={{ ...invoices, talk: { start: async () => ({ seconds: 300 }), stop } }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Talk' }))
    expect(await screen.findByRole('timer')).toHaveTextContent('5:00 left')
    await act(async () => vi.advanceTimersByTime(3000))
    expect(screen.getByRole('timer')).toHaveTextContent('4:57 left')
    expect(screen.queryByRole('button', { name: 'Talk' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Talk' })).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('wears no look at all when the app asks for plain parts', () => {
    render(<AskPanel name="Ask Tally" transport={invoices} look="plain" />)
    const panel = screen.getByRole('region', { name: 'Ask Tally' })
    expect(panel).not.toHaveAttribute('data-lumane-look')
    expect(panel.getAttribute('style')).toBeNull()
  })
})

/** Caleane's own button and panel, as a calendar app with its own design system has them. */
function CaleaneButton({
  tone = 'solid',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'solid' | 'outline' }) {
  return <button {...props} className={`cal-btn cal-btn-${tone} ${props.className ?? ''}`} />
}

function AskCaleane({ decide }: { decide: (approve: boolean) => Promise<Decided> }) {
  const [lines, setLines] = useState<string[]>([])
  return (
    <aside className="cal-drawer" aria-label="Ask Caleane">
      <Conversation className="cal-thread" follow={lines}>
        {lines.map((line) => (
          <Message key={line} from="person" className="cal-you">
            {line}
          </Message>
        ))}
        {lines.length > 0 && (
          <Message from="assistant" className="cal-reply">
            <p>Friday at 14:00 suits all five people invited. Here is the change, ready for you.</p>
            <ApprovalCard.Root className="cal-card" onDecide={decide}>
              <ApprovalCard.Label className="cal-eyebrow">Needs your approval</ApprovalCard.Label>
              <ApprovalCard.Summary>
                Move the design review to Fri 9 Oct, 14:00
              </ApprovalCard.Summary>
              <ApprovalCard.Actions className="cal-row">
                <ApprovalCard.Approve asChild>
                  <CaleaneButton>Approve</CaleaneButton>
                </ApprovalCard.Approve>
                <ApprovalCard.Decline asChild>
                  <CaleaneButton tone="outline">Not now</CaleaneButton>
                </ApprovalCard.Decline>
              </ApprovalCard.Actions>
              <ApprovalCard.Outcome done="Moved. Everyone invited will hear by email." />
            </ApprovalCard.Root>
          </Message>
        )}
      </Conversation>
      <Composer.Root className="cal-ask" onAsk={(q) => setLines((all) => [...all, q])}>
        <Composer.Label />
        <Composer.Input className="cal-input" placeholder="Ask anything about your calendar" />
        <Composer.Send asChild>
          <CaleaneButton>Ask</CaleaneButton>
        </Composer.Send>
      </Composer.Root>
      <UsageLine
        className="cal-meter"
        items={[{ used: 3, allowance: 50, unit: 'uses', noun: 'questions' }]}
      />
    </aside>
  )
}

describe("Ask in an app's own design (a pretend calendar app)", () => {
  it("works the same, dressed entirely in the app's components and class names", async () => {
    const user = userEvent.setup()
    const decide = vi.fn(async (approve: boolean): Promise<Decided> =>
      approve ? 'done' : 'declined',
    )
    render(<AskCaleane decide={decide} />)
    await user.type(
      screen.getByPlaceholderText('Ask anything about your calendar'),
      'Move the design review to Friday at 2pm{Enter}',
    )
    const card = screen.getByText('Needs your approval').closest('.cal-card')!
    expect(card).toHaveAttribute('data-state', 'waiting')
    const approve = within(card as HTMLElement).getByRole('button', { name: 'Approve' })
    expect(approve).toHaveClass('cal-btn', 'cal-btn-solid')
    expect(within(card as HTMLElement).getByRole('button', { name: 'Not now' })).toHaveClass(
      'cal-btn-outline',
    )
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveAttribute('type', 'submit')
    await user.click(approve)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Moved. Everyone invited will hear by email.',
    )
    expect(decide).toHaveBeenCalledWith(true)
    expect(screen.getByText('3 of 50 questions used this month.')).toHaveClass('cal-meter')
    // No default look is applied: Caleane's own stylesheet is all that dresses it.
    expect(document.querySelector('[data-lumane-look]')).toBeNull()
  })
})
