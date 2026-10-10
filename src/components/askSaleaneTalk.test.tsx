import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AskSaleane } from './AskSaleane'
import { api } from '../state/api'
import { MicrophoneError, connectTalk } from '../assistant/talkLine'
import { seed } from '../domain/seed'

// NEXT-12 part 2: talking to Ask SALEANE. The browser's connection to OpenAI is pretended here;
// server/talk.test.ts covers the talk itself.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
vi.mock('../assistant/talkLine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../assistant/talkLine')>()),
  connectTalk: vi.fn(),
}))
const sample = seed('UK')
const state = { ...sample, operations: { ...sample.operations!, mode: 'local' as const } }
const commit = vi.fn(async () => ({ ok: true }))
vi.mock('../state/context', () => ({
  useStore: () => ({
    state,
    mode: 'server',
    slug: 'linden',
    session: { workspaces: [{ slug: 'linden', id: 'org-1' }] },
    role: 'owner',
    today: '2026-10-06',
    blocked: false,
    commit,
  }),
}))
const base = '/api/workspaces/org-1/assistant'
const usage = (talkSeconds: number) => ({
  used: { typed: 3, talkSeconds },
  allowance: { typed: 300, talkSeconds: 1800 },
})
const mocked = vi.mocked(api)
const connect = vi.mocked(connectTalk)
const stop = vi.fn()
let talk: boolean
let started: Record<string, unknown>
let ended: boolean
const turns = [
  {
    id: 'item_1',
    heard: 'Remind me to call Amelia tomorrow.',
    answer: 'I have prepared a reminder for tomorrow. It is waiting on your screen to approve.',
    proposals: [{ id: 'p1', summary: 'Remind the team on Wednesday 7 October: Call Amelia' }],
  },
]

beforeEach(() => {
  mocked.mockReset()
  connect.mockReset()
  stop.mockReset()
  talk = true
  ended = false
  started = { status: 'talking', id: 'talk-1', sdp: 'v=0 answer', seconds: 600, usage: usage(600) }
  connect.mockImplementation(async (start) => ((await start('v=0 offer')) ? { stop } : null))
  mocked.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path === base && !options) return { mode: 'live', talk, usage: usage(120) }
    if (path === `${base}/talk`) return started
    if (path === `${base}/talk/talk-1/end`) ended = true
    if (path === `${base}/proposals/p1`)
      return { outcome: 'approved', command: { type: 'task-add', input: {} } }
    if (path.startsWith(`${base}/talk/talk-1`))
      return {
        id: 'talk-1',
        status: ended ? 'ended' : 'talking',
        secondsLeft: ended ? 0 : 245,
        turns,
        usage: usage(ended ? 215 : 600),
      }
    throw new Error(`Unexpected ${path}`)
  })
})

describe('talking to Ask SALEANE', () => {
  it('talks, shows what was heard and answered, and stops', async () => {
    const user = userEvent.setup()
    render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    expect(
      await within(panel).findByText(/When you talk, OpenAI's voice listens and speaks/),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText('3 of 300 questions used this month. 2 of 30 talking minutes used.'),
    ).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Talk' }))
    expect(mocked).toHaveBeenCalledWith(`${base}/talk`, {
      method: 'POST',
      body: { sdp: 'v=0 offer' },
    })
    expect(await within(panel).findByText('Talking with Ask SALEANE')).toBeInTheDocument()
    expect(within(panel).getByRole('timer')).toHaveTextContent('10:00 left')
    expect(within(panel).queryByRole('button', { name: 'Talk' })).not.toBeInTheDocument()

    // Each second the panel reads the talk: the time left, what was heard and the answer.
    expect(
      await within(panel).findByText('Remind me to call Amelia tomorrow.', {}, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(within(panel).getByText('You said:')).toBeInTheDocument()
    expect(within(panel).getByRole('timer')).toHaveTextContent('4:05 left')
    expect(
      within(panel).getByText(
        'I have prepared a reminder for tomorrow. It is waiting on your screen to approve.',
      ),
    ).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Approve' }))
    expect(await within(panel).findByText(/Done\. Saved to your records\./)).toBeInTheDocument()
    expect(commit).toHaveBeenCalledWith({ type: 'task-add', input: {} })

    await user.click(within(panel).getByRole('button', { name: 'Stop' }))
    expect(stop).toHaveBeenCalled()
    expect(mocked).toHaveBeenCalledWith(`${base}/talk/talk-1/end`, { method: 'POST', body: {} })
    expect(await within(panel).findByText('The talk has ended.')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Talk' })).toBeInTheDocument()
    expect(
      within(panel).getByText('3 of 300 questions used this month. 4 of 30 talking minutes used.'),
    ).toBeInTheDocument()
    // The question heard is shown once, however many times the talk was read.
    expect(within(panel).getAllByText('Remind me to call Amelia tomorrow.')).toHaveLength(1)
  })

  it('says plainly when the microphone is refused or the month’s talking time is used up', async () => {
    const user = userEvent.setup()
    connect.mockRejectedValueOnce(new MicrophoneError())
    render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    await user.click(await within(panel).findByRole('button', { name: 'Talk' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'SALEANE needs your microphone to talk. Allow it in your browser, or type instead.',
    )
    started = {
      status: 'refused',
      text: "This month's talking time is used up. It resets on the 1st, or the owner can add Plus. You can still type.",
      usage: usage(1800),
    }
    await user.click(within(panel).getByRole('button', { name: 'Talk' }))
    expect(
      await within(panel).findByText(/This month's talking time is used up\./),
    ).toBeInTheDocument()
    expect(within(panel).queryByText('Talking with Ask SALEANE')).not.toBeInTheDocument()
    expect(stop).not.toHaveBeenCalled()
  })

  it('offers no Talk button until SALEANE’s voice is switched on', async () => {
    talk = false
    render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    expect(
      await within(panel).findByText('3 of 300 questions used this month.'),
    ).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Talk' })).not.toBeInTheDocument()
  })

  it('hangs up when the panel closes mid-talk', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    await user.click(await within(panel).findByRole('button', { name: 'Talk' }))
    await within(panel).findByText('Talking with Ask SALEANE')
    unmount()
    expect(stop).toHaveBeenCalled()
    expect(mocked).toHaveBeenCalledWith(`${base}/talk/talk-1/end`, { method: 'POST', body: {} })
  })
})
