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
  it('lets each person choose the voice they hear, or keep the studio’s', async () => {
    const user = userEvent.setup()
    render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    const voice = await within(panel).findByRole('combobox', { name: 'Voice' })
    expect(voice).toHaveTextContent('The studio’s (Vesper)')
    await user.selectOptions(voice, 'quartz')
    expect(commit).toHaveBeenCalledWith({ type: 'own-voice', voice: 'quartz' })
    expect(await within(panel).findByText('Saved. Your next talk uses it.')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Talk' }))
    // While talking, the voice stays as it started.
    expect(await within(panel).findByRole('timer')).toBeInTheDocument()
    expect(within(panel).queryByRole('combobox', { name: 'Voice' })).toBeNull()
  })

  it('talks, shows what was heard and answered, and stops', async () => {
    const user = userEvent.setup()
    render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    expect(
      await within(panel).findByText(
        /When you talk, your voice goes to OpenAI, which listens and speaks/,
      ),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText('3 of 300 questions used this month. 2 of 30 talking minutes used.'),
    ).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Talk' }))
    expect(mocked).toHaveBeenCalledWith(`${base}/talk`, {
      method: 'POST',
      // What is said joins the panel's conversation, so a typed follow-up knows what was asked.
      body: { sdp: 'v=0 offer', conversation: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      timeoutMs: 30_000,
    })
    expect(await within(panel).findByRole('timer')).toBeInTheDocument()
    expect(within(panel).getByRole('timer').parentElement).toHaveTextContent('Talking · 10:00 left')
    expect(within(panel).getByRole('status')).toHaveTextContent(
      'Talking. Ask whenever you are ready.',
    )
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

  it('sends only the conversation’s id, the same one for typed and spoken questions', async () => {
    const user = userEvent.setup()
    const reading = mocked.getMockImplementation()!
    mocked.mockImplementation(async (path: string, options?: { method?: string }) =>
      path === base && options?.method === 'POST'
        ? { status: 'answered', text: '14:00: Amelia.', proposals: [], usage: usage(0) }
        : reading(path, options),
    )
    render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    await user.type(within(panel).getByLabelText('Your question'), 'Who is my 2pm?')
    await user.click(within(panel).getByRole('button', { name: 'Ask' }))
    await within(panel).findByText('14:00: Amelia.')
    const asked = mocked.mock.calls.find(([path, o]) => path === base && o)![1] as {
      body: { conversation: string }
    }
    await user.click(within(panel).getByRole('button', { name: 'Talk' }))
    expect(mocked).toHaveBeenCalledWith(`${base}/talk`, {
      method: 'POST',
      body: { sdp: 'v=0 offer', conversation: asked.body.conversation },
      timeoutMs: 30_000,
    })
  })

  it('lets an approved change that did not save be approved again, and shows a saved one as done', async () => {
    const user = userEvent.setup()
    const reading = mocked.getMockImplementation()!
    mocked.mockImplementation(async (path: string, options?: { method?: string }) =>
      path === base && options?.method === 'POST'
        ? {
            status: 'answered',
            text: 'Here are both, ready for you to approve.',
            proposals: [
              { id: 'p1', summary: 'Remind the team on Wednesday 7 October: Call Amelia' },
              { id: 'p2', summary: 'Remind the team on Thursday 8 October: Order wax' },
            ],
            usage: usage(0),
          }
        : path === `${base}/proposals/p2`
          ? { outcome: 'applied' }
          : reading(path, options),
    )
    commit.mockResolvedValueOnce({ ok: false, error: 'Someone else saved a change. Try again.' })
    render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    await user.type(within(panel).getByLabelText('Your question'), 'Remind us about both')
    await user.click(within(panel).getByRole('button', { name: 'Ask' }))
    await within(panel).findByText('Here are both, ready for you to approve.')
    const [first] = within(panel).getAllByRole('button', { name: 'Approve' })
    await user.click(first)
    expect(await within(panel).findByText('Someone else saved a change. Try again.')).toBeVisible()
    // Still approved on the server, so Approve tries the same change again.
    expect(within(panel).getAllByRole('button', { name: 'Approve' })).toHaveLength(2)
    await user.click(within(panel).getAllByRole('button', { name: 'Approve' })[0])
    expect(commit).toHaveBeenCalledTimes(2)
    // Saved already, from another tab: shown as done, and not saved again.
    await user.click(within(panel).getByRole('button', { name: 'Approve' }))
    expect(await within(panel).findAllByText(/Done\. Saved to your records\./)).toHaveLength(2)
    expect(commit).toHaveBeenCalledTimes(2)
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
    expect(within(panel).queryByRole('timer')).not.toBeInTheDocument()
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
    await within(panel).findByRole('timer')
    unmount()
    expect(stop).toHaveBeenCalled()
    expect(mocked).toHaveBeenCalledWith(`${base}/talk/talk-1/end`, { method: 'POST', body: {} })
  })

  it('calls off a talk still starting when the panel closes, and ends it if it had begun', async () => {
    // As the real line does: once called off it lets go and starts nothing more.
    connect.mockImplementation(async (start, _ended, signal) => {
      const answer = await start('v=0 offer')
      if (!answer) return null
      if (signal?.aborted) {
        stop()
        return null
      }
      return { stop }
    })
    let answer!: (value: unknown) => void
    const talkPosts = () => mocked.mock.calls.filter(([path]) => path === `${base}/talk`)
    const user = userEvent.setup()
    const { unmount } = render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    const general = mocked.getMockImplementation()!
    mocked.mockImplementation(async (path, options) =>
      path === `${base}/talk` ? new Promise((done) => (answer = done)) : general(path, options),
    )
    await user.click(await within(panel).findByRole('button', { name: 'Talk' }))
    await vi.waitFor(() => expect(talkPosts()).toHaveLength(1))
    // The panel closes before SALEANE answers; then the talk it asked for starts.
    unmount()
    expect(mocked).not.toHaveBeenCalledWith(`${base}/talk/talk-1/end`, expect.anything())
    answer(started)
    await vi.waitFor(() =>
      expect(mocked).toHaveBeenCalledWith(`${base}/talk/talk-1/end`, { method: 'POST', body: {} }),
    )
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('tells SALEANE at once when the line fails, so nothing more is held', async () => {
    let lineEnded!: () => void
    connect.mockImplementation(async (start, onEnded) => {
      lineEnded = onEnded
      return (await start('v=0 offer')) ? { stop } : null
    })
    const user = userEvent.setup()
    render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    await user.click(await within(panel).findByRole('button', { name: 'Talk' }))
    await within(panel).findByRole('timer')
    lineEnded()
    expect(await within(panel).findByText('The talk has ended.')).toBeInTheDocument()
    expect(mocked).toHaveBeenCalledWith(`${base}/talk/talk-1/end`, { method: 'POST', body: {} })
    expect(within(panel).getByRole('button', { name: 'Talk' })).toBeInTheDocument()
  })

  it('never lets a late reading of an earlier talk end the one now running', async () => {
    let lateReading!: (view: unknown) => void
    const general = mocked.getMockImplementation()!
    mocked.mockImplementation(async (path, options) => {
      // The first talk's reading is slow to come back.
      if (path === `${base}/talk/talk-1` && !options)
        return new Promise((done) => (lateReading = done))
      if (path === `${base}/talk/talk-2` && !options)
        return { id: 'talk-2', status: 'talking', secondsLeft: 590, turns: [], usage: usage(600) }
      return general(path, options)
    })
    const user = userEvent.setup()
    render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    await user.click(await within(panel).findByRole('button', { name: 'Talk' }))
    await within(panel).findByRole('timer')
    await vi.waitFor(() => expect(lateReading).toBeTypeOf('function'), { timeout: 3000 })
    await user.click(within(panel).getByRole('button', { name: 'Stop' }))
    await within(panel).findByText('The talk has ended.')
    // The second talk is running when the first one's reading finally arrives, saying it ended.
    started = { ...started, id: 'talk-2' }
    await user.click(within(panel).getByRole('button', { name: 'Talk' }))
    await within(panel).findByRole('timer')
    lateReading({ id: 'talk-1', status: 'ended', secondsLeft: 0, turns: [], usage: usage(215) })
    await new Promise((done) => setTimeout(done, 50))
    expect(within(panel).getByRole('timer')).toBeInTheDocument()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('shows a later talk’s questions even when OpenAI reuses an earlier one’s id', async () => {
    const general = mocked.getMockImplementation()!
    mocked.mockImplementation(async (path, options) => {
      if (path === `${base}/talk/talk-2` && !options)
        return {
          id: 'talk-2',
          status: 'talking',
          secondsLeft: 590,
          turns: [{ id: 'item_1', heard: 'And tomorrow?', answer: 'Two visits.', proposals: [] }],
          usage: usage(600),
        }
      return general(path, options)
    })
    const user = userEvent.setup()
    render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    await user.click(await within(panel).findByRole('button', { name: 'Talk' }))
    await within(panel).findByText('Remind me to call Amelia tomorrow.', {}, { timeout: 3000 })
    await user.click(within(panel).getByRole('button', { name: 'Stop' }))
    await within(panel).findByText('The talk has ended.')
    started = { ...started, id: 'talk-2' }
    await user.click(within(panel).getByRole('button', { name: 'Talk' }))
    expect(
      await within(panel).findByText('And tomorrow?', {}, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(within(panel).getByText('Two visits.')).toBeInTheDocument()
  })
})
