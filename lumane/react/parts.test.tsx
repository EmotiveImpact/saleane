import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import {
  ApprovalCard,
  AskWords,
  Composer,
  Conversation,
  Message,
  TalkBar,
  TalkButton,
  UsageLine,
  clock,
  contrast,
  lookProblems,
  lookStyle,
  usageLine,
  usageState,
} from '.'
import type { Decided } from '.'

/** A promise the test settles when it chooses, like a save that takes its time. */
function later<T>() {
  let settle!: (value: T) => void
  let fail!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    settle = yes
    fail = no
  })
  return { promise, settle, fail }
}

function Card({ onDecide }: { onDecide: (approve: boolean) => Promise<Decided> | Decided }) {
  return (
    <ApprovalCard.Root onDecide={onDecide}>
      <ApprovalCard.Label />
      <ApprovalCard.Summary>Move the design review to Friday at 2pm</ApprovalCard.Summary>
      <ApprovalCard.Actions>
        <ApprovalCard.Approve />
        <ApprovalCard.Decline />
      </ApprovalCard.Actions>
      <ApprovalCard.Outcome />
    </ApprovalCard.Root>
  )
}

describe('the approval card', () => {
  it('shows done only once the app has saved the change', async () => {
    const user = userEvent.setup()
    const save = later<Decided>()
    render(<Card onDecide={() => save.promise} />)
    expect(screen.getByText('Waiting for your approval')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    // Saving: both answers wait, and nothing says done yet.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled()
    expect(screen.queryByText('Done. Saved.')).toBeNull()
    await act(async () => save.settle('done'))
    expect(screen.getByRole('status')).toHaveTextContent('Done. Saved.')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('Waiting for your approval')).toBeNull()
  })

  it('answers once, however fast the taps', async () => {
    const user = userEvent.setup()
    const save = later<Decided>()
    const onDecide = vi.fn(() => save.promise)
    render(<Card onDecide={onDecide} />)
    const approve = screen.getByRole('button', { name: 'Approve' })
    await user.dblClick(approve)
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onDecide).toHaveBeenCalledTimes(1)
    expect(onDecide).toHaveBeenCalledWith(true)
    await act(async () => save.settle('done'))
  })

  it('goes back to waiting when saving fails, so the person can try again', async () => {
    const user = userEvent.setup()
    const onDecide = vi
      .fn<(approve: boolean) => Promise<Decided>>()
      .mockRejectedValueOnce(new Error('The connection dropped.'))
      .mockResolvedValueOnce('done')
    render(<Card onDecide={onDecide} />)
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.queryByRole('status')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Done. Saved.')
    expect(onDecide).toHaveBeenCalledTimes(2)
  })

  it('never shows a "not now" as done', async () => {
    const user = userEvent.setup()
    render(<Card onDecide={() => 'done'} />)
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Left as it was.')
  })

  it("puts its behaviour on the app's own button, keeping the app's look and click", async () => {
    const user = userEvent.setup()
    const save = later<Decided>()
    const tapped = vi.fn()
    function AppButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
      return <button {...props} className={`app-button ${props.className ?? ''}`} />
    }
    render(
      <ApprovalCard.Root onDecide={() => save.promise}>
        <ApprovalCard.Actions className="app-actions">
          <ApprovalCard.Approve asChild>
            <AppButton onClick={tapped}>Yes, move it</AppButton>
          </ApprovalCard.Approve>
        </ApprovalCard.Actions>
        <ApprovalCard.Outcome done="Moved." className="app-outcome" />
      </ApprovalCard.Root>,
    )
    const button = screen.getByRole('button', { name: 'Yes, move it' })
    expect(button).toHaveClass('app-button')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('data-lumane', 'approve')
    await user.click(button)
    expect(tapped).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    await act(async () => save.settle('done'))
    expect(screen.getByRole('status')).toHaveTextContent('Moved.')
    expect(screen.getByRole('status')).toHaveClass('app-outcome')
  })

  it('takes the app’s own words', () => {
    render(
      <AskWords words={{ approve: 'Approuver', decline: 'Pas maintenant' }}>
        <Card onDecide={() => 'done'} />
      </AskWords>,
    )
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pas maintenant' })).toBeInTheDocument()
  })
})

describe('the question box', () => {
  it('asks the trimmed question and empties, and never asks an empty one', async () => {
    const user = userEvent.setup()
    const onAsk = vi.fn()
    render(
      <Composer.Root onAsk={onAsk}>
        <Composer.Label />
        <Composer.Input />
        <Composer.Send />
      </Composer.Root>,
    )
    const box = screen.getByLabelText('Your question')
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    await user.type(box, '   {Enter}')
    expect(onAsk).not.toHaveBeenCalled()
    await user.type(box, "  What's on tomorrow?  {Enter}")
    expect(onAsk).toHaveBeenCalledWith("What's on tomorrow?")
    expect(box).toHaveValue('')
    expect(box).toHaveAttribute('maxLength', '500')
  })

  it('asks nothing while an answer is on its way', async () => {
    const user = userEvent.setup()
    const onAsk = vi.fn()
    render(
      <Composer.Root onAsk={onAsk} busy>
        <Composer.Input />
        <Composer.Send />
      </Composer.Root>,
    )
    await user.type(screen.getByRole('textbox'), 'Who is next?{Enter}')
    expect(onAsk).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    expect(screen.getByRole('textbox')).toHaveValue('Who is next?')
  })

  it('lets the app hold the text itself', async () => {
    const user = userEvent.setup()
    const asked: string[] = []
    function Held() {
      const [text, setText] = useState('Find a free hour')
      return (
        <Composer.Root onAsk={(q) => asked.push(q)} value={text} onValueChange={setText}>
          <Composer.Input />
          <Composer.Send />
        </Composer.Root>
      )
    }
    render(<Held />)
    await user.type(screen.getByRole('textbox'), ' with Sam{Enter}')
    expect(asked).toEqual(['Find a free hour with Sam'])
    expect(screen.getByRole('textbox')).toHaveValue('')
  })
})

describe('the conversation', () => {
  it('says who spoke, and keeps the newest line in view without moving on open', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const { rerender } = render(
      <Conversation follow={0}>
        <Message from="person">Who is my 2pm?</Message>
      </Conversation>,
    )
    expect(scroll).not.toHaveBeenCalled()
    rerender(
      <Conversation follow={1}>
        <Message from="person">Who is my 2pm?</Message>
        <Message from="person" spoken>
          And after her?
        </Message>
      </Conversation>,
    )
    expect(scroll).toHaveBeenCalledTimes(1)
    const lines = screen.getAllByText(/\?$/)
    expect(lines[0]).toHaveTextContent('You asked: Who is my 2pm?')
    expect(lines[1]).toHaveTextContent('You said: And after her?')
    expect(lines[0].closest('[data-lumane="conversation"]')).toHaveAttribute('aria-live', 'polite')
  })

  it('keeps the newest line in view when a card inside it changes', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const user = userEvent.setup()
    render(
      <Conversation follow={1}>
        <Message from="assistant">
          <Card onDecide={() => 'done'} />
        </Message>
      </Conversation>,
    )
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await screen.findByRole('status')
    expect(scroll).toHaveBeenCalled()
  })
})

describe('talking', () => {
  it('counts down without interrupting, and cannot be stopped twice', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    const { rerender } = render(
      <TalkBar.Root>
        <TalkBar.Dot />
        <TalkBar.Status>
          <TalkBar.Countdown seconds={245} />
        </TalkBar.Status>
        <TalkBar.Stop onStop={onStop} />
      </TalkBar.Root>,
    )
    expect(screen.getByText(/^Talking/)).toHaveTextContent('Talking · 4:05 left')
    expect(screen.getByRole('timer')).toHaveAttribute('aria-live', 'off')
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalledTimes(1)
    rerender(
      <TalkBar.Root ending>
        <TalkBar.Status>
          <TalkBar.Countdown seconds={240} />
        </TalkBar.Status>
        <TalkBar.Stop onStop={onStop} />
      </TalkBar.Root>,
    )
    expect(screen.getByText('Ending the talk…')).toBeInTheDocument()
    expect(screen.queryByRole('timer')).toBeNull()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
  })

  it('cannot start a second talk while one is starting', () => {
    const onStart = vi.fn()
    render(<TalkButton onStart={onStart} starting />)
    const button = screen.getByRole('button', { name: 'Starting…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('shows minutes and seconds', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(59.6)).toBe('1:00')
    expect(clock(600)).toBe('10:00')
    expect(clock(-3)).toBe('0:00')
  })
})

describe('the usage line', () => {
  const items = [
    { used: 3, allowance: 300, unit: 'uses' as const, noun: 'questions' },
    { used: 241, allowance: 1800, unit: 'seconds' as const, noun: 'talking minutes' },
  ]

  it('says what is used, with talking time in whole minutes', () => {
    expect(usageLine(items, { period: 'this month' })).toBe(
      '3 of 300 questions used this month. 5 of 30 talking minutes used.',
    )
    expect(usageLine([{ used: 1200, allowance: 1000, unit: 'uses', noun: 'questions' }])).toBe(
      '1,200 of 1,000 questions used.',
    )
  })

  it('says when an allowance is running out', () => {
    expect(usageState(items)).toBe('fine')
    expect(usageState([{ ...items[0], used: 240 }])).toBe('near')
    expect(usageState([{ ...items[0], used: 300 }])).toBe('reached')
    render(<UsageLine items={[{ ...items[0], used: 250 }]} />)
    const line = screen.getByText('250 of 300 questions used this month.')
    expect(line).toHaveAttribute('data-state', 'near')
  })
})

describe('the default look', () => {
  it('is set by four choices, with colours worked out to read clearly', () => {
    const style = lookStyle({ colour: '#3949AB', corners: 'round', scheme: 'dark' }) as Record<
      string,
      string
    >
    expect(style['--lumane-accent']).toBe('#3949AB')
    expect(style['--lumane-on-accent']).toBe('#ffffff')
    expect(style['--lumane-radius']).toBe('24px')
    expect(style['--lumane-radius-control']).toBe('999px')
    expect(style['--lumane-bg']).toBe('#1c1d1f')
    // On a dark page the indigo is lifted until it reads as writing.
    expect(contrast(style['--lumane-accent-ink'], style['--lumane-bg'])).toBeGreaterThanOrEqual(4.5)
    // And on the tint behind a change waiting for approval.
    expect(contrast(style['--lumane-accent-ink'], style['--lumane-soft'])).toBeGreaterThanOrEqual(
      4.5,
    )
    const pale = lookStyle({ colour: '#F4D35E' }) as Record<string, string>
    expect(pale['--lumane-on-accent']).toBe('#111111')
    expect(contrast(pale['--lumane-accent-ink'], '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('says plainly when a choice would be hard to read', () => {
    expect(lookProblems({ colour: '#2F6F62' })).toEqual([])
    expect(lookProblems({ colour: 'green' })).toEqual([
      'The colour needs to be a hex code, such as #2F6F62.',
    ])
    expect(lookProblems({ colour: '#777777' })).toEqual([
      'Writing on this colour would be hard to read. Choose a deeper or a paler one.',
    ])
  })

  it('leaves a panel alone that asks for no look', () => {
    render(
      <div>
        <Composer.Root onAsk={() => {}}>
          <Composer.Input />
        </Composer.Root>
      </div>,
    )
    expect(within(document.body).getByRole('textbox').closest('[data-lumane-look]')).toBeNull()
  })
})
