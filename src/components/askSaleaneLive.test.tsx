import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AskSaleane } from './AskSaleane'
import { ReceptionistSettings } from './ReceptionistSettings'
import { api } from '../state/api'
import { seed } from '../domain/seed'

// NEXT-12: signed in, the panel and the receptionist's settings say when Claude answers.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const sample = seed('UK')
const state = { ...sample, operations: { ...sample.operations!, mode: 'local' as const } }
vi.mock('../state/context', () => ({
  useStore: () => ({
    state,
    mode: 'server',
    slug: 'linden',
    session: { workspaces: [{ slug: 'linden', id: 'org-1' }] },
    role: 'owner',
    today: '2026-10-06',
    blocked: false,
    commit: vi.fn(),
  }),
}))
const usage = { used: { typed: 3 }, allowance: { typed: 300 } }
const mocked = vi.mocked(api)
let mode: 'live' | 'test'

beforeEach(() => {
  mocked.mockReset()
  mode = 'live'
  mocked.mockImplementation(async (_path: string, options?: { method?: string }) =>
    options?.method === 'POST'
      ? {
          status: 'unavailable',
          text: 'Sorry, I could not answer just now. Nothing was changed. Please try again shortly.',
          proposals: [],
          usage,
        }
      : { mode, usage },
  )
})

describe('Ask SALEANE with a real AI', () => {
  it('says Claude answers, waits long enough, and shows a failed answer plainly', async () => {
    const user = userEvent.setup()
    render(<AskSaleane onClose={() => {}} />)
    const panel = await screen.findByRole('dialog', { name: 'Ask SALEANE' })
    expect(
      await within(panel).findByText(
        'Answers come from your studio records, read by Claude, an AI from Anthropic. Changes wait for your approval, and nothing is sent.',
      ),
    ).toBeInTheDocument()
    expect(within(panel).getByText('3 of 300 questions used this month.')).toBeInTheDocument()
    await user.type(within(panel).getByLabelText('Your question'), 'Who is in at 2?')
    await user.click(within(panel).getByRole('button', { name: 'Ask' }))
    expect(
      await within(panel).findByText(
        'Sorry, I could not answer just now. Nothing was changed. Please try again shortly.',
      ),
    ).toBeInTheDocument()
    expect(mocked).toHaveBeenLastCalledWith('/api/workspaces/org-1/assistant', {
      method: 'POST',
      body: { text: 'Who is in at 2?', history: [] },
      timeoutMs: 80_000,
    })
  })

  it('stays described as test mode until the server says otherwise', async () => {
    mode = 'test'
    render(<AskSaleane onClose={() => {}} />)
    expect(
      await screen.findByText(
        'Test mode: answers come from your studio records. No AI service is connected, and nothing is sent.',
      ),
    ).toBeInTheDocument()
  })
})

describe('the receptionist settings with a real AI', () => {
  it('tells the owner that guests’ words go to Anthropic to be answered', async () => {
    render(
      <MemoryRouter>
        <ReceptionistSettings />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText(
        /It uses Claude, an AI from Anthropic: what guests write is sent there/,
      ),
    ).toBeInTheDocument()
  })
})
