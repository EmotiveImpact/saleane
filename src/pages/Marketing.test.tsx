import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { MarketingAudience, MarketingAutomatic, MarketingResults } from './Marketing'
import { api } from '../state/api'
import { seed } from '../domain/seed'
import { dispatch } from '../domain/commands'
import { reminderSettings } from '../domain/reminders'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import type { Results } from './marketingResults'

// NEXT-14: Marketing, its own section: the automatic emails, who may hear from the studio, and
// what each message did, with the month's marketing emails.
const store = vi.hoisted(() => ({
  state: null as unknown as BusinessState,
  role: 'owner' as string,
  mode: 'demo' as 'demo' | 'server',
  listeners: new Set<() => void>(),
  commands: [] as unknown[],
}))
function setStudio(next: BusinessState) {
  store.state = next
  store.listeners.forEach((listener) => listener())
}
async function commit(command: Command) {
  store.commands.push(command)
  const result = dispatch(store.state, command, 'Ava Owner', '2026-10-06T09:45:00.000Z')
  if (result.ok) setStudio(result.state)
  return result
}
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
vi.mock('../state/context', () => ({
  useStore: () => {
    const state = useSyncExternalStore(
      (listener) => {
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
      },
      () => store.state,
    )
    return {
      state,
      role: store.role,
      blocked: false,
      commit,
      mode: store.mode,
      slug: 'atelier-house',
      today: '2026-10-06',
    }
  },
}))

beforeEach(() => {
  store.state = seed('UK')
  store.role = 'owner'
  store.mode = 'demo'
  store.commands = []
  vi.mocked(api).mockReset()
})
const show = (page: React.ReactNode) => render(<MemoryRouter>{page}</MemoryRouter>)

describe('automatic messages', () => {
  it('switches each automatic email on or off, and changes nothing about visit messages', async () => {
    const user = userEvent.setup()
    store.state.operations = {
      ...store.state.operations!,
      reminders: { ...reminderSettings(store.state), confirmations: false },
    }
    show(<MarketingAutomatic />)
    expect(screen.getByRole('heading', { level: 1, name: 'Automatic messages' })).toBeVisible()
    const switches = screen.getAllByRole('switch')
    expect(switches.map((s) => s.closest('section')!.querySelector('h2')!.textContent)).toEqual([
      'Aftercare',
      'Due back',
      'Birthday',
      'We miss you',
    ])
    expect(screen.getAllByText('A sample studio sends none.')).toHaveLength(4)
    const save = screen.getByRole('button', { name: 'Save automatic messages' })
    expect(save).toBeDisabled()
    // Turning "we miss you" off greys its gap; the birthday stays on.
    await user.click(screen.getByRole('switch', { name: /We miss you email/ }))
    expect(screen.getByRole('combobox', { name: /A long gap is/ })).toBeDisabled()
    await user.click(save)
    expect(store.commands).toHaveLength(1)
    const sent = store.commands[0] as Extract<Command, { type: 'reminders' }>
    expect(sent.type).toBe('reminders')
    expect(sent.settings).toMatchObject({
      missYou: false,
      birthday: true,
      aftercare: true,
      dueBack: true,
      // The booking messages keep their own settings.
      confirmations: false,
    })
    expect(
      screen.getByText('Saved. The next message due follows the new choices.'),
    ).toBeInTheDocument()
  })

  it('shows the choices to a general manager without letting them change them', () => {
    store.role = 'general'
    show(<MarketingAutomatic />)
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save automatic messages' })).toBeNull()
  })
})

describe('the audience', () => {
  it('counts who may hear from the studio and how people stopped, never who', () => {
    show(<MarketingAudience />)
    expect(screen.getByRole('heading', { level: 1, name: 'Audience' })).toBeVisible()
    for (const label of ['Can hear from you', 'By text too', 'Have not agreed', 'Stopped'])
      expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How people stopped' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Month by month' })).toBeVisible()
    const names = store.state.clients.map((c) => c.name)
    const page = document.body.textContent ?? ''
    for (const name of names.slice(0, 5)) expect(page).not.toContain(name)
  })
})

describe('results', () => {
  const results: Results = {
    mode: 'local',
    providers: { email: { live: true }, sms: { live: false } },
    emails: { used: 1640, limit: 2000 },
    campaigns: [{ id: 'news-1', sent: 40, test: 0, notSent: 2, waiting: 0, stopped: 1, booked: 3 }],
    automatic: [],
    months: [
      {
        month: '2026-10',
        campaigns: [
          { id: 'news-1', sent: 40, test: 0, notSent: 2, waiting: 0, stopped: 1, booked: 3 },
        ],
        automatic: [
          { kind: 'birthday', sent: 6, test: 0, notSent: 0, waiting: 0, stopped: 0, booked: 1 },
        ],
        stoppedAll: 2,
      },
    ],
  }

  it('shows the month’s marketing emails and what each message did', async () => {
    store.mode = 'server'
    store.state.operations = {
      ...store.state.operations!,
      news: [
        {
          id: 'news-1',
          subject: 'Thursday evenings',
          body: 'We are open until eight on Thursdays from November.',
          by: 'email',
          status: 'approved',
          createdAt: '2026-10-01T09:00:00.000Z',
          actor: 'Ava Owner',
          approvedAt: '2026-10-01T09:30:00.000Z',
          approvedBy: 'Ava Owner',
          toEmail: 42,
          toText: 0,
        },
      ],
    }
    vi.mocked(api).mockResolvedValue(results as never)
    show(<MarketingResults />)
    expect(await screen.findByText('1,640 of 2,000')).toBeInTheDocument()
    expect(screen.getByText('360 of 2,000 marketing emails left this month.')).toBeInTheDocument()
    const october = screen.getByRole('region', { name: 'October 2026' })
    expect(within(october).getByText('Thursday evenings')).toBeInTheDocument()
    expect(
      within(october).getByText(
        '40 sent · 2 not sent · 1 stopped hearing from you · 3 booked within two weeks',
      ),
    ).toBeInTheDocument()
    expect(within(october).getByText('Birthday')).toBeInTheDocument()
    expect(within(october).getByText(/2 clients asked to stop hearing from you/)).toBeVisible()
  })

  it('says when the month’s marketing emails are all used', async () => {
    store.mode = 'server'
    vi.mocked(api).mockResolvedValue({ ...results, emails: { used: 2000, limit: 2000 } } as never)
    show(<MarketingResults />)
    expect(
      await screen.findByText('All 2,000 marketing emails for this month are used.'),
    ).toBeInTheDocument()
  })

  it('says a sample studio sends nothing, so has nothing to count', () => {
    show(<MarketingResults />)
    expect(
      screen.getByText(
        'This is a sample studio: nothing is sent, so there are no results to count.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/marketing emails left/)).toBeNull()
  })
})
