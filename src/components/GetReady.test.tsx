import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { GetReady } from './GetReady'
import { execute } from '../domain/commands'
import type { Command, CommandResult } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import type { Role } from '../domain/operations'
import { seed } from '../domain/seed'
import { createWorkspace } from '../domain/workspace'
import { api } from '../state/api'

// The owner of a new studio sees what is left to set, and each step ticks itself once set.
type Shown = {
  state: BusinessState
  role: Role
  mode: 'demo' | 'server'
  blocked: boolean
  commit: (command: Command) => Promise<CommandResult>
  session?: {
    user: { twoStep?: { since: number; recoveryLeft: number } | null }
    services: { email: boolean; payments: boolean }
  }
  slug?: string
}
let store: Shown
vi.mock('../state/context', () => ({ useStore: () => store }))
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const commit = vi.fn<(command: Command) => Promise<CommandResult>>()
let sequence = 0
function apply(s: BusinessState, ...commands: Command[]) {
  for (const command of commands) {
    const result = execute(s, command, '2026-10-06T08:00:00.000Z', () => `ready-${++sequence}`)
    if (!result.ok) throw new Error(result.error)
    s = result.state
  }
  return s
}
/** A new studio with one facial, Maya who does it, and a treatment room. */
function bookableStudio() {
  const s = apply(createWorkspace({ name: 'Fernleaf Rooms', region: 'UK' }), {
    type: 'service',
    input: {
      name: 'Restorative facial',
      description: 'A fictional treatment',
      category: 'Skin',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceMinor: 9500,
      depositMinor: 0,
      resourceType: 'treatment',
    },
  })
  return apply(
    s,
    {
      type: 'staff',
      input: { name: 'Maya Lind', role: 'Facialist', serviceIds: [s.services[0].id], tone: 'sage' },
    },
    { type: 'resource', input: { name: 'Room One', type: 'treatment' } },
  )
}
/** The same studio with every ready step done. */
function readyStudio() {
  const s = bookableStudio()
  const ready = apply(
    s,
    { type: 'tax', label: 'VAT', rateBps: 2000, inclusive: true },
    { type: 'protection', settings: { saveCard: false, feePercent: 50 } },
    {
      type: 'hours',
      hours: s.operations!.hours.map((day) => ({ ...day, closed: day.day === 1 })),
    },
    {
      type: 'organisation',
      name: s.organisation.name,
      locationName: s.organisation.locationName,
      address: s.organisation.address,
      timeZone: s.organisation.timeZone,
      bookingEnabled: true,
    },
  )
  // A studio record that can hold a phone number and email needs one of them too.
  Object.assign(ready.organisation, { phone: '01225 900456' })
  return ready
}
function show(state: BusinessState, patch: Partial<Shown> = {}) {
  store = { state, role: 'owner', mode: 'server', blocked: false, commit, ...patch }
  return render(
    <MemoryRouter>
      <GetReady />
    </MemoryRouter>,
  )
}
const step = (name: RegExp | string) =>
  screen.getByText(name, { selector: 'strong' }).closest('li') as HTMLElement
const list = () => screen.queryByRole('region', { name: 'Get your studio ready' })

beforeEach(() => {
  localStorage.clear()
  // The owner's team list: just them, until a test says otherwise.
  vi.mocked(api).mockResolvedValue({ members: [{}], invitations: [] } as never)
})
afterEach(() => vi.resetAllMocks())

describe('Get your studio ready', () => {
  it('shows the owner of a new studio each step, with a link to where it is set', () => {
    show(createWorkspace({ name: 'Fernleaf Rooms', region: 'UK' }))
    expect(list()).toBeInTheDocument()
    expect(screen.getByText(/^0 of \d done$/)).toBeInTheDocument()
    const links = {
      'Check your opening hours': ['Review hours', '/settings?section=hours'],
      'Add your treatments': ['Add treatments', '/settings?section=service'],
      'Add your team, and who does what': ['Add your team', '/settings?section=staff'],
      'Add your rooms or chairs': ['Add rooms or chairs', '/settings?section=resource'],
      'Set your VAT': ['Set VAT', '/settings?section=business'],
      'Choose your deposit and cancellation rules': ['Payment rules', '/settings?section=payments'],
    }
    for (const [title, [label, href]] of Object.entries(links))
      expect(within(step(title)).getByRole('link', { name: label })).toHaveAttribute('href', href)
    // Online booking waits for something a guest could book.
    const online = step('Switch on online booking')
    expect(within(online).queryByRole('button')).toBeNull()
    expect(online).toHaveTextContent('First add a treatment, someone who does it')
  })

  it('ticks steps as the studio is set up, and switches on online booking in one step', async () => {
    const s = bookableStudio()
    show(s)
    expect(screen.getByText(/^3 of \d done$/)).toBeInTheDocument()
    for (const title of [
      'Add your treatments',
      'Add your team, and who does what',
      'Add your rooms or chairs',
    ]) {
      expect(step(title)).toHaveTextContent('Done')
      expect(within(step(title)).queryByRole('link')).toBeNull()
    }
    commit.mockResolvedValue({ ok: true, state: s, recordId: s.organisation.id })
    await userEvent.click(screen.getByRole('button', { name: 'Switch on online booking' }))
    // Only the switch changes; the studio's name, address and time zone go back as they are.
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith({
      type: 'organisation',
      name: 'Fernleaf Rooms',
      locationName: 'Fernleaf Rooms',
      address: '',
      timeZone: 'Europe/London',
      bookingEnabled: true,
    })
  })

  it('says why online booking could not be switched on', async () => {
    show(bookableStudio())
    commit.mockResolvedValue({ ok: false, error: 'Reconnect before saving.' })
    await userEvent.click(screen.getByRole('button', { name: 'Switch on online booking' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect before saving.')
  })

  it('tells a manager which steps the owner sets', () => {
    show(bookableStudio(), { role: 'manager' })
    for (const title of ['Set your VAT', 'Switch on online booking'])
      expect(step(title)).toHaveTextContent('The studio owner sets this.')
    expect(screen.queryByRole('button', { name: 'Switch on online booking' })).toBeNull()
    // Hours and payment rules are theirs to set.
    expect(within(step('Check your opening hours')).getByRole('link')).toBeInTheDocument()
    expect(within(step(/deposit and cancellation/)).getByRole('link')).toBeInTheDocument()
  })

  it('lets hours and "no deposit or fee" be confirmed as they are, remembered for the studio', async () => {
    const s = createWorkspace({ name: 'Fernleaf Rooms', region: 'UK' })
    const first = show(s)
    await userEvent.click(screen.getByRole('button', { name: 'These hours are right' }))
    await userEvent.click(screen.getByRole('button', { name: 'No deposit or fee' }))
    expect(step('Check your opening hours')).toHaveTextContent('Done')
    expect(step(/deposit and cancellation/)).toHaveTextContent('Done')
    first.unmount()
    show(s)
    expect(screen.getByText(/^2 of \d done$/)).toBeInTheDocument()
  })

  it('goes once hidden, for this studio only', async () => {
    const s = createWorkspace({ name: 'Fernleaf Rooms', region: 'UK' })
    const first = show(s)
    await userEvent.click(screen.getByRole('button', { name: 'Hide this list' }))
    expect(list()).toBeNull()
    first.unmount()
    const again = show(s)
    expect(list()).toBeNull()
    again.unmount()
    show(createWorkspace({ name: 'Linden Studio', region: 'UK' }))
    expect(list()).toBeInTheDocument()
  })

  it('goes once every step is done', () => {
    show(readyStudio())
    expect(list()).toBeNull()
  })

  it('is not shown to the desk or a practitioner, in the demo or in a sample studio', () => {
    const fresh = createWorkspace({ name: 'Fernleaf Rooms', region: 'UK' })
    for (const role of ['reception', 'practitioner', 'general'] as const) {
      const shown = show(fresh, { role })
      expect(list()).toBeNull()
      shown.unmount()
    }
    const demo = show(fresh, { mode: 'demo' })
    expect(list()).toBeNull()
    demo.unmount()
    show(seed('UK'))
    expect(list()).toBeNull()
  })

  it('still shows when this browser keeps nothing', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked')
    })
    show(createWorkspace({ name: 'Fernleaf Rooms', region: 'UK' }))
    expect(list()).toBeInTheDocument()
    read.mockRestore()
  })

  it('offers the owner the setup screens until they finish them', () => {
    const fresh = createWorkspace({ name: 'Fernleaf Rooms', region: 'UK' })
    const first = show(fresh)
    expect(screen.getByRole('link', { name: 'Set up step by step' })).toHaveAttribute(
      'href',
      '/setup',
    )
    first.unmount()
    const started = { ...fresh, operations: { ...fresh.operations!, setup: { next: 'team' } } }
    const second = show(started as BusinessState)
    expect(screen.getByRole('link', { name: 'Pick up where you left off' })).toHaveAttribute(
      'href',
      '/setup',
    )
    second.unmount()
    // A manager uses Settings; the setup screens are the owner's.
    const manager = show(fresh, { role: 'manager' })
    expect(screen.queryByRole('link', { name: 'Set up step by step' })).toBeNull()
    manager.unmount()
    const done = { ...fresh, operations: { ...fresh.operations!, setup: { next: 'done' } } }
    show(done as BusinessState)
    expect(screen.queryByRole('link', { name: /step by step|left off/ })).toBeNull()
  })
})

describe('Your first weeks', () => {
  const weeks = () => screen.queryByRole('region', { name: 'Your first weeks' })
  const signedIn = {
    session: { user: { twoStep: null }, services: { email: false, payments: false } },
    slug: 'fernleaf-rooms',
  }
  /** Maya and a second person, so there is someone to invite. */
  const withTeam = () =>
    apply(readyStudio(), {
      type: 'staff',
      input: { name: 'Theo Bennett', role: 'Stylist', serviceIds: [], tone: 'sand' },
    })

  it('follows once the studio is ready, with each step and where to do it', () => {
    show(withTeam(), signedIn)
    expect(list()).toBeNull()
    expect(weeks()).toBeInTheDocument()
    expect(screen.getByText('0 of 6 done')).toBeInTheDocument()
    expect(within(step('Share your booking page')).getByRole('button')).toHaveTextContent(
      'Copy the link',
    )
    const links = {
      'Bring your clients across': '/settings?section=switching',
      'Invite your team to sign in': '/settings?section=staff',
      'Check out your first visit': '/calendar',
      'Check your visit reminders': '/settings?section=messages',
      'Turn on two-step sign-in': '/settings?section=staff',
    }
    for (const [title, href] of Object.entries(links))
      expect(within(step(title)).getByRole('link')).toHaveAttribute('href', href)
    // Messages and card payments are never said to go out while they are not connected.
    expect(step('Check your visit reminders')).toHaveTextContent('Nothing goes out until email')
    expect(step('Check out your first visit')).toHaveTextContent('test mode')
  })

  it('gives one main button, on the first step to do, and moves it on once the link is copied', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    show(withTeam(), signedIn)
    const primary = () => weeks()!.querySelectorAll('.button-primary')
    expect(primary()).toHaveLength(1)
    expect(step('Share your booking page')).toHaveClass('is-next')
    expect(within(step('Share your booking page')).getByRole('button')).toHaveClass(
      'button-primary',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Copy the link' }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/book/fernleaf-rooms`)
    expect(screen.getByRole('button', { name: 'Copied' })).toHaveClass('button-secondary')
    expect(primary()).toHaveLength(1)
    expect(step('Bring your clients across')).toHaveClass('is-next')
    expect(within(step('Bring your clients across')).getByRole('link')).toHaveClass(
      'button-primary',
    )
  })

  it('ticks inviting the team when someone else is asked, and takes "I work on my own"', async () => {
    vi.mocked(api).mockResolvedValue({ members: [{}, {}], invitations: [] } as never)
    show(withTeam(), signedIn)
    expect(await screen.findByText('1 of 6 done')).toBeInTheDocument()
    expect(step('Invite your team to sign in')).toHaveTextContent('Done')
    expect(vi.mocked(api)).toHaveBeenCalledWith(expect.stringMatching(/\/team$/))
    await userEvent.click(screen.getByRole('button', { name: 'I am starting fresh' }))
    expect(step('Bring your clients across')).toHaveTextContent('Done')
    expect(screen.getByText('2 of 6 done')).toBeInTheDocument()
  })

  it('leaves inviting to the owner, so a manager sees five steps', () => {
    show(withTeam(), { ...signedIn, role: 'manager' })
    expect(screen.getByText('0 of 5 done')).toBeInTheDocument()
    expect(screen.queryByText('Invite your team to sign in')).toBeNull()
    expect(vi.mocked(api)).not.toHaveBeenCalled()
  })

  it('goes once hidden, and is not shown in a sample studio', async () => {
    show(withTeam(), signedIn)
    await userEvent.click(screen.getByRole('button', { name: 'Hide this list' }))
    expect(weeks()).toBeNull()
    localStorage.clear()
    const sample = withTeam()
    sample.operations = { ...sample.operations!, mode: 'sandbox' }
    show(sample, signedIn)
    expect(weeks()).toBeNull()
  })
})
