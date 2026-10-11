import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { News } from './News'
import { api } from '../state/api'
import { seed } from '../domain/seed'
import { createWorkspace } from '../domain/workspace'
import { newsAudience, newsSummary } from '../domain/news'
import { dispatch } from '../domain/commands'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'

// Stage 4: one message to many clients, drafted by leads and approved by the owner.
const store = vi.hoisted(() => ({
  state: null as unknown as BusinessState,
  role: 'owner' as string,
  mode: 'demo' as 'demo' | 'server',
  branch: undefined as string | undefined,
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
      branch: store.branch,
      blocked: false,
      commit,
      mode: store.mode,
      slug: 'atelier-house',
      today: '2026-10-06',
    }
  },
}))

const SUBJECT = 'Thursday evenings at Atelier House'
beforeEach(() => {
  store.state = seed('UK')
  store.role = 'owner'
  store.mode = 'demo'
  store.branch = undefined
  store.commands = []
})
const show = () =>
  render(
    <MemoryRouter>
      <News />
    </MemoryRouter>,
  )
/** A second location, so the studio has clients of more than one place. */
function withNorth() {
  store.state.operations!.locations = [
    { id: 'loc-north', name: 'Islington', address: '1 Upper Street' },
  ]
}

describe('messages to clients', () => {
  it('shows the sample draft with its numbers, who is left out and both previews', async () => {
    const user = userEvent.setup()
    show()
    expect(screen.getByRole('heading', { name: 'Campaigns' })).toBeInTheDocument()
    expect(screen.getByText(/This is a sample studio\. Approving a message shows how it works/))
    const row = screen.getByRole('button', { name: new RegExp(SUBJECT) })
    expect(row).toHaveTextContent('Every client of the studio')
    expect(row).toHaveTextContent('Draft')
    await user.click(row)
    const panel = screen.getByRole('dialog', { name: SUBJECT })
    expect(panel).toHaveTextContent('Would go to 12 clients: 12 by email, 0 by text.')
    const left = within(panel).getByRole('list', { name: 'Left out' })
    expect(left).toHaveTextContent('Have not agreed to news and offers')
    expect(left).toHaveTextContent('3 clients left out')
    expect(panel).toHaveTextContent('Every client who agreed to news and offers.')
    expect(panel).toHaveTextContent(
      'Texts go only to clients whose agreement named texts, so 12 clients get an email instead.',
    )
    // Only numbers: no client's name or address is listed anywhere in the panel.
    for (const client of store.state.clients) {
      expect(panel).not.toHaveTextContent(client.email)
      expect(panel).not.toHaveTextContent(client.name)
    }
    const email = within(panel).getByLabelText('As an email')
    expect(email).toHaveTextContent('From Atelier House')
    expect(email).toHaveTextContent('Hello [first name],')
    expect(email).toHaveTextContent('To stop them, use this link: [a private link to stop news]')
    expect(email).not.toHaveTextContent('{{')
    await user.click(within(panel).getByRole('radio', { name: 'As a text' }))
    const text = within(panel).getByLabelText('As a text')
    expect(text).toHaveTextContent('Atelier House: From November we stay open')
    expect(text).toHaveTextContent('Reply STOP to stop texts.')
    expect(text).toHaveTextContent(/\d+ characters, sent as 2 parts\./)
    expect(panel).toHaveTextContent('Written by Sophia Reed')
  })

  it('lets the owner approve after a final check, with sample wording that claims nothing', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: new RegExp(SUBJECT) }))
    const panel = screen.getByRole('dialog', { name: SUBJECT })
    await user.click(within(panel).getByRole('button', { name: 'Check and approve' }))
    expect(
      within(panel).getByRole('heading', { name: 'Send to 12 clients: 12 by email, 0 by text?' }),
    ).toBeInTheDocument()
    expect(panel).toHaveTextContent('This is a sample studio, so nothing is queued or sent.')
    expect(panel).not.toHaveTextContent(/\bwas sent\b|\bhas been sent\b/)
    await user.click(within(panel).getByRole('button', { name: 'Approve and send to 12 clients' }))
    expect(store.commands).toEqual([
      {
        type: 'news-approve',
        messageId: 'news-thursday-evenings',
        expect: { email: 12, text: 0 },
      },
    ])
    expect(screen.getByRole('status')).toHaveTextContent(
      'Approved. A sample studio, so nothing was queued or sent.',
    )
    const row = screen.getByRole('button', { name: new RegExp(SUBJECT) })
    expect(row).toHaveTextContent('Sample, nothing sent')
    expect(row).toHaveTextContent('Approved 6 October 2026 at 10:45 for 12 clients')
    // Once approved, the words are fixed and a sample has nothing waiting to stop.
    await user.click(row)
    const approved = screen.getByRole('dialog', { name: SUBJECT })
    expect(approved).toHaveTextContent('Approved for 12 clients: 12 by email, 0 by text.')
    expect(approved).toHaveTextContent('Approved by Ava Owner')
    for (const name of ['Change it', 'Check and approve', 'Stop the rest'])
      expect(within(approved).queryByRole('button', { name })).not.toBeInTheDocument()
  })

  it('lets a manager change the draft but leaves approval to the owner', async () => {
    const user = userEvent.setup()
    store.role = 'manager'
    show()
    await user.click(screen.getByRole('button', { name: new RegExp(SUBJECT) }))
    const panel = screen.getByRole('dialog', { name: SUBJECT })
    expect(within(panel).queryByRole('button', { name: 'Check and approve' })).toBeNull()
    expect(panel).toHaveTextContent('The owner checks the numbers and approves it.')
    await user.click(within(panel).getByRole('button', { name: 'Change it' }))
    const editor = screen.getByRole('dialog', { name: 'Change the draft' })
    const subject = within(editor).getByRole('textbox', { name: 'Subject' })
    await user.clear(subject)
    await user.type(subject, 'Late Thursdays')
    await user.click(within(editor).getByRole('button', { name: 'Save draft' }))
    expect(store.commands).toEqual([
      expect.objectContaining({
        type: 'news-save',
        id: 'news-thursday-evenings',
        input: expect.objectContaining({ subject: 'Late Thursdays', by: 'either', bookLink: true }),
      }),
    ])
    // The saved draft opens at once; the page behind says it was saved.
    expect(screen.getByRole('dialog', { name: 'Late Thursdays' })).toBeInTheDocument()
    expect(screen.getByText('Draft saved.')).toHaveAttribute('role', 'status')
  })

  it('keeps a general manager to the clients of their own location', async () => {
    const user = userEvent.setup()
    withNorth()
    store.role = 'general'
    store.branch = 'loc-north'
    show()
    // The sample draft is for the whole studio, so they can read it but not change or approve it.
    await user.click(screen.getByRole('button', { name: new RegExp(SUBJECT) }))
    const panel = screen.getByRole('dialog', { name: SUBJECT })
    for (const name of ['Change it', 'Check and approve', 'Stop the rest'])
      expect(within(panel).queryByRole('button', { name })).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Close dialog' }))
    await user.click(screen.getByRole('button', { name: 'Write a message' }))
    const editor = screen.getByRole('dialog', { name: 'Write a message' })
    expect(editor).toHaveTextContent('For the clients of Islington.')
    expect(within(editor).queryByRole('radio', { name: 'Every client of the studio' })).toBeNull()
    await user.type(within(editor).getByRole('textbox', { name: 'Subject' }), 'Islington evenings')
    await user.type(
      within(editor).getByRole('textbox', { name: 'Your message' }),
      'We are open late on Thursdays from November.',
    )
    await user.click(within(editor).getByRole('button', { name: 'Save draft' }))
    expect(store.commands).toEqual([
      {
        type: 'news-save',
        input: {
          subject: 'Islington evenings',
          body: 'We are open late on Thursdays from November.',
          by: 'email',
          locationIds: ['loc-north'],
          bookLink: true,
        },
      },
    ])
    const saved = screen.getByRole('dialog', { name: 'Islington evenings' })
    expect(saved).toHaveTextContent('Nobody would receive this yet.')
    expect(saved).toHaveTextContent(
      'A client of a location had a visit there in the last 12 months, or has one booked there.',
    )
  })

  it('lets the owner choose locations and shows the numbers by location', async () => {
    const user = userEvent.setup()
    withNorth()
    show()
    await user.click(screen.getByRole('button', { name: 'Write a message' }))
    const editor = screen.getByRole('dialog', { name: 'Write a message' })
    await user.click(within(editor).getByRole('radio', { name: 'The clients of chosen locations' }))
    expect(editor).toHaveTextContent('Choose at least one location.')
    await user.click(within(editor).getByRole('checkbox', { name: 'Marylebone, London' }))
    expect(editor).toHaveTextContent('Would go to 12 clients: 12 by email, 0 by text.')
    await user.type(within(editor).getByRole('textbox', { name: 'Subject' }), 'Marylebone news')
    await user.type(
      within(editor).getByRole('textbox', { name: 'Your message' }),
      'A new facial arrives next week.',
    )
    await user.click(within(editor).getByRole('button', { name: 'Save draft' }))
    const panel = screen.getByRole('dialog', { name: 'Marylebone news' })
    expect(within(panel).getByRole('list', { name: 'By location' })).toHaveTextContent(
      'Marylebone, London12 by email, 0 by text',
    )
  })

  it('welcomes a studio with no message yet', async () => {
    const user = userEvent.setup()
    store.state.operations!.news = []
    show()
    expect(
      screen.getByRole('heading', { name: 'One message for all your clients.' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Campaigns' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Write a message' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Write a message' }))
    expect(screen.getByRole('dialog', { name: 'Write a message' })).toBeInTheDocument()
  })

  it('tucks drafts put aside away', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: new RegExp(SUBJECT) }))
    const panel = screen.getByRole('dialog', { name: SUBJECT })
    await user.click(within(panel).getByText('More'))
    await user.click(within(panel).getByRole('button', { name: 'Put this draft aside' }))
    expect(screen.getByRole('status')).toHaveTextContent('Draft put aside. It stays in the record.')
    expect(screen.getByRole('heading', { name: 'One message for all your clients.' }))
    expect(screen.getByText('Drafts put aside (1)')).toBeInTheDocument()
  })

  it('waits to know whether providers are live, then words approval for test mode or live', async () => {
    const user = userEvent.setup()
    store.mode = 'server'
    // A real studio of its own, with three clients who agreed and one who did not.
    const real = createWorkspace({ name: 'Linden Rooms', region: 'UK' })
    real.clients = [1, 2, 3, 4].map((n) => ({
      id: `c${n}`,
      organisationId: real.organisation.id,
      name: `Client ${n} Example`,
      email: `client${n}@example.com`,
      phone: '',
      preferences: '',
      marketingConsent: n !== 4,
      createdAt: '2026-01-01T09:00:00.000Z',
    }))
    const saved = dispatch(
      real,
      {
        type: 'news-save',
        input: { subject: 'Late Thursdays', body: 'Open until eight from November.', by: 'email' },
      },
      'Ava Owner',
      '2026-10-06T09:00:00.000Z',
    )
    if (!saved.ok) throw new Error(saved.error)
    store.state = saved.state
    let live: boolean | null = null
    let answer: (follow: unknown) => void = () => {}
    const follow = (on: boolean) => ({
      mode: 'local',
      providers: { email: { live: on }, sms: { live: false } },
      messages: [],
    })
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.includes('/news/audience'))
        return newsSummary(
          newsAudience(store.state, { by: 'email' }, { now: '2026-10-06T09:45:00.000Z' }),
        ) as never
      // NEXT-14: what each campaign did, from Marketing's results; nothing has gone yet.
      if (path.endsWith('/marketing'))
        return { ...follow(live ?? false), campaigns: [], automatic: [], months: [] } as never
      if (live === null) return new Promise((resolve) => (answer = resolve)) as never
      return follow(live) as never
    })
    const { unmount } = show()
    await user.click(screen.getByRole('button', { name: /Late Thursdays/ }))
    let panel = screen.getByRole('dialog', { name: 'Late Thursdays' })
    expect(
      await within(panel).findByText('Would go to 3 clients: 3 by email, 0 by text.'),
    ).toBeInTheDocument()
    // Until the server says how messages go, approval waits and no mode is claimed.
    expect(within(panel).getByRole('button', { name: 'Check and approve' })).toBeDisabled()
    expect(screen.queryByText(/Test mode: approved messages/)).toBeNull()
    answer(follow(false))
    await user.click(await within(panel).findByRole('button', { name: 'Check and approve' }))
    expect(panel).toHaveTextContent('Test mode: they will be queued in test mode, not sent.')
    await user.click(within(panel).getByRole('button', { name: 'Not yet' }))
    unmount()

    live = true
    show()
    await user.click(screen.getByRole('button', { name: /Late Thursdays/ }))
    panel = screen.getByRole('dialog', { name: 'Late Thursdays' })
    await within(panel).findByText('Would go to 3 clients: 3 by email, 0 by text.')
    expect(
      screen.getByText(/Approved messages go through your email and text providers/),
    ).toBeInTheDocument()
    await user.click(await within(panel).findByRole('button', { name: 'Check and approve' }))
    expect(panel).toHaveTextContent('They go out between 09:00 and 19:00 on the studio’s clock.')
    await user.click(within(panel).getByRole('button', { name: 'Approve and send to 3 clients' }))
    expect(screen.getByRole('status')).toHaveTextContent(
      'Approved. Queued to go out between 09:00 and 19:00. A message is called delivered only when the provider confirms it.',
    )
  })
})
