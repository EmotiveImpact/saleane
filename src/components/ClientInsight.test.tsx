import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ClientInsight } from './ClientInsight'
import type { Command, CommandResult } from '../domain/commands'
import { addDays } from '../domain/format'
import type { BusinessState, Client } from '../domain/model'
import type { Role } from '../domain/operations'
import {
  SATURDAY,
  TODAY,
  addClient,
  addMembership,
  addOffer,
  addVisit,
  monthlyRegular,
  studio,
} from '../test/clientInsightStudio'

// "At a glance" on the client page: the facts it shows and the one next step it suggests.
type Shown = {
  state: BusinessState
  today: string
  role: Role
  blocked: boolean
  saving: boolean
  branch: string | null
  commit: (command: Command) => Promise<CommandResult>
}
let store: Shown
vi.mock('../state/context', () => ({ useStore: () => store }))
const commit = vi.fn<(command: Command) => Promise<CommandResult>>()

function show(state: BusinessState, client: Client, patch: Partial<Shown> = {}) {
  store = {
    state,
    today: TODAY,
    role: 'owner',
    blocked: false,
    saving: false,
    branch: null,
    commit,
    ...patch,
  }
  return render(
    <MemoryRouter>
      <ClientInsight client={client} />
      {/* Parts of the client page a step can bring into view. */}
      <section aria-labelledby="client-patch-tests">
        <h2 id="client-patch-tests">Patch tests</h2>
      </section>
      <section aria-labelledby="client-plans-heading">
        <h3 id="client-plans-heading">Packages &amp; memberships</h3>
      </section>
    </MemoryRouter>,
  )
}
const glance = () => screen.getByRole('region', { name: 'At a glance' })
const facts = () =>
  within(glance())
    .queryAllByRole('term')
    .map((term) => term.textContent)
const stepNamed = (name: string) => within(glance()).getByRole('group', { name })

/** A client who came every four weeks until 8 August and has nothing booked. */
function drifter(consent = true) {
  const s = studio()
  const client = addClient(s, 'Charlotte Hayes', { marketingConsent: consent })
  monthlyRegular(s, client.id, addDays(SATURDAY, -56), 6)
  return { s, client }
}

afterEach(() => vi.resetAllMocks())

describe('At a glance', () => {
  it('describes a regular in a sentence and a few facts, with no step when all is in order', () => {
    const s = studio()
    const client = addClient(s, 'Amelia Carter')
    const visits = monthlyRegular(s, client.id, SATURDAY, 13)
    addVisit(s, client.id, addDays(SATURDAY, 28), {
      status: 'confirmed',
      rebookedFromId: visits.at(-1)!.id,
    })
    show(s, client)
    expect(
      within(glance()).getByText('Usually every 4 weeks, on Saturday mornings.'),
    ).toBeInTheDocument()
    expect(facts()).toEqual([
      'Favourite treatment',
      'Last 12 months',
      'Booking ahead',
      'Keeping visits',
    ])
    expect(
      within(glance()).getByText('With Maya, 13 of 13 visits in the last 12 months'),
    ).toBeInTheDocument()
    // Thirteen facials at £95; the £10 tips are left out.
    expect(within(glance()).getByText('£1,235')).toBeInTheDocument()
    expect(within(glance()).getByText('About £95 a visit')).toBeInTheDocument()
    expect(
      within(glance()).getByRole('button', { name: 'How Last 12 months is measured' }),
    ).toBeInTheDocument()
    expect(within(glance()).queryByText('Next step')).not.toBeInTheDocument()
  })

  it('welcomes a new client without inventing anything', () => {
    const s = studio()
    const client = addClient(s, 'Nina Patel')
    addVisit(s, client.id, addDays(TODAY, -10))
    addVisit(s, client.id, addDays(TODAY, 18), { status: 'confirmed' })
    show(s, client)
    expect(within(glance()).getByText('New client. 1 visit so far.')).toBeInTheDocument()
    expect(facts()).toEqual([])
    expect(within(glance()).queryByText('Next step')).not.toBeInTheDocument()
  })

  it('invites a drifting client back with a draft that waits in the Inbox, unsent', async () => {
    const user = userEvent.setup()
    const { s, client } = drifter()
    commit.mockResolvedValue({ ok: true, state: s, recordId: 'message-1' })
    show(s, client)
    const step = stepNamed('Invite them back')
    expect(
      within(step).getByText(
        '8 weeks since their last visit, against their usual 4, and nothing booked.',
      ),
    ).toBeInTheDocument()
    expect(facts()[0]).toBe('Due back')
    expect(within(glance()).getByText(/^Drifting away: 8 weeks/)).toBeInTheDocument()

    await user.click(within(step).getByRole('button', { name: 'Invite them back' }))
    expect(commit).not.toHaveBeenCalled()
    expect(
      within(step).getByText(
        /^Hello Charlotte, it has been a little while since we last saw you. Maya would be glad to see you for your Restorative Facial again./,
      ),
    ).toBeInTheDocument()
    await user.click(within(step).getByRole('button', { name: 'Save as unsent draft' }))
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0][0]).toEqual({
      type: 'message',
      input: {
        clientId: client.id,
        purpose: 'marketing',
        subject: 'We would love to see you, Charlotte',
        body: expect.stringMatching(/^Hello Charlotte/),
      },
    })
    expect(within(step).getByRole('status')).toHaveTextContent(
      'Invitation saved in the Inbox, unsent.',
    )
    expect(within(step).getByRole('link', { name: 'Open the Inbox' })).toHaveAttribute(
      'href',
      '/inbox',
    )
    // The step is done: nothing more to press.
    expect(within(step).queryByRole('button')).not.toBeInTheDocument()
  })

  it('points to the invitation already waiting rather than offering another', () => {
    const { s, client } = drifter()
    s.operations!.messages.push({
      id: 'message-1',
      clientId: client.id,
      purpose: 'marketing',
      subject: 'We would love to see you, Charlotte',
      body: 'Hello Charlotte.',
      status: 'draft',
      createdAt: `${TODAY}T09:00:00.000Z`,
      actor: 'Front desk',
    })
    show(s, client)
    const step = stepNamed('Invite them back')
    expect(within(step).getByRole('status')).toHaveTextContent(
      'An invitation is waiting in the Inbox, unsent.',
    )
    expect(within(step).queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps the draft and says so when the invitation could not be saved', async () => {
    const user = userEvent.setup()
    const { s, client } = drifter()
    commit.mockResolvedValue({ ok: false, error: 'The studio is read only right now.' })
    show(s, client)
    await user.click(screen.getByRole('button', { name: 'Invite them back' }))
    await user.click(screen.getByRole('button', { name: 'Save as unsent draft' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The studio is read only right now.')
    expect(screen.getByRole('button', { name: 'Save as unsent draft' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('books a drifting client who has not agreed to email news, with their usual filled in', async () => {
    const user = userEvent.setup()
    const { s, client } = drifter(false)
    show(s, client)
    const step = stepNamed('Invite them back')
    expect(within(step).getByText(/They have not agreed to email news/)).toBeInTheDocument()
    expect(within(step).queryByRole('button', { name: 'Invite them back' })).toBeNull()
    await user.click(within(step).getByRole('button', { name: 'Book their usual' }))
    const dialog = screen.getByRole('dialog', { name: 'Book a visit' })
    expect(within(dialog).getByLabelText('Treatment')).toHaveValue('facial')
    expect(within(dialog).getByLabelText('Professional')).toHaveValue('maya')
    expect(commit).not.toHaveBeenCalled()
  })

  it('suggests booking their usual when they are due back', async () => {
    const user = userEvent.setup()
    const s = studio()
    const client = addClient(s, 'Ava Williams')
    monthlyRegular(s, client.id, addDays(TODAY, -30), 4, { serviceId: 'massage', staffId: 'theo' })
    show(s, client)
    const step = stepNamed('Book their usual')
    expect(
      within(step).getByText(/^Due back since 7 Oct, with nothing booked\./),
    ).toBeInTheDocument()
    expect(
      within(step).getByText(/Deep Massage with Theo on Wednesday 14 October/),
    ).toBeInTheDocument()
    await user.click(within(step).getByRole('button', { name: 'Book their usual' }))
    const dialog = screen.getByRole('dialog', { name: 'Book a visit' })
    expect(within(dialog).getByLabelText('Treatment')).toHaveValue('massage')
    expect(within(dialog).getByLabelText('Professional')).toHaveValue('theo')
  })

  it('leaves the professional for a general manager to choose when they work elsewhere', async () => {
    const user = userEvent.setup()
    const s = studio()
    const client = addClient(s, 'Ava Williams')
    monthlyRegular(s, client.id, addDays(TODAY, -30), 4, { serviceId: 'massage', staffId: 'theo' })
    show(s, client, { role: 'general', branch: 'another-location' })
    const step = stepNamed('Book their usual')
    expect(within(step).getByText(/filled in with Deep Massage on Wednesday/)).toBeInTheDocument()
    await user.click(within(step).getByRole('button', { name: 'Book their usual' }))
    const dialog = screen.getByRole('dialog', { name: 'Book a visit' })
    expect(within(dialog).getByLabelText('Treatment')).toHaveValue('massage')
    // Maya comes first among those who do it; Theo, who works elsewhere, was not chosen for them.
    expect(within(dialog).getByLabelText('Professional')).toHaveValue('maya')
  })

  it('brings the patch tests into view when one is needed before the next visit', async () => {
    const user = userEvent.setup()
    const s = studio()
    const client = addClient(s, 'Grace Chen')
    addVisit(s, client.id, addDays(TODAY, -60), { serviceId: 'colour' })
    addVisit(s, client.id, addDays(TODAY, -30), { serviceId: 'colour' })
    addVisit(s, client.id, addDays(TODAY, 3), { serviceId: 'colour', status: 'confirmed' })
    show(s, client)
    const step = stepNamed('Patch test before Mon 12 Oct')
    expect(
      within(step).getByText('Needs a patch test at least 48 hours before.'),
    ).toBeInTheDocument()
    await user.click(within(step).getByRole('button', { name: 'Go to patch tests' }))
    expect(screen.getByRole('region', { name: 'Patch tests' })).toHaveFocus()
  })

  it('puts an unpaid membership first and leads to the membership', async () => {
    const user = userEvent.setup()
    const { s, client } = drifter()
    addMembership(s, client.id, '2026-08-01', '2026-09-01')
    show(s, client)
    const step = stepNamed('Glow Membership needs this month’s payment')
    expect(
      within(step).getByText(
        'Unpaid since 1 Sept. Covered visits and the member discount wait until it is paid.',
      ),
    ).toBeInTheDocument()
    await user.click(within(step).getByRole('button', { name: 'Go to memberships' }))
    expect(screen.getByRole('region', { name: 'Packages & memberships' })).toHaveFocus()
  })

  it('suggests mentioning a membership to a monthly client who spends more than it costs', () => {
    const s = studio()
    const client = addClient(s, 'Amelia Carter')
    monthlyRegular(s, client.id, SATURDAY, 6)
    addVisit(s, client.id, addDays(SATURDAY, 28), { status: 'confirmed' })
    addOffer(s, { priceMinor: 7900 })
    show(s, client)
    const step = stepNamed(
      'Comes every month and spends more than the Glow Membership costs: mention it',
    )
    expect(
      within(step).getByText(
        'About £95 a month on treatments it covers, over the last three months. Glow Membership is £79 a month.',
      ),
    ).toBeInTheDocument()
    expect(within(step).getByRole('button', { name: 'Go to memberships' })).toBeInTheDocument()
  })

  it('shows the step without a button to someone who may not act on it, and no spending', () => {
    const { s, client } = drifter()
    // Practitioners have their own day view; the guard holds even if this ever reached them.
    show(s, client, { role: 'practitioner' })
    expect(stepNamed('Invite them back')).toBeInTheDocument()
    expect(within(glance()).queryByRole('button', { name: /Invite|Book/ })).toBeNull()
    expect(facts()).not.toContain('Last 12 months')
  })

  it('offers nothing to press while the studio cannot save', () => {
    const { s, client } = drifter()
    show(s, client, { blocked: true })
    expect(stepNamed('Invite them back')).toBeInTheDocument()
    expect(within(glance()).queryByRole('button', { name: /Invite|Book/ })).toBeNull()
  })
})
