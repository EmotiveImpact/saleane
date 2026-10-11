import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { Rota } from '../pages/Rota'
import { Manage } from '../pages/Manage'
import { seed } from '../domain/seed'
import { dispatch } from '../domain/commands'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import { operations } from '../domain/operations'
import { staffLocationOn } from '../domain/locations'

// Stage 4: moving someone to another location, from the rota and from Settings.
const now = '2026-10-06T09:45:00.000Z'
const store = vi.hoisted(() => ({
  state: null as unknown as BusinessState,
  role: 'owner' as string,
  listeners: new Set<() => void>(),
  commands: [] as Command[],
}))
function setStudio(next: BusinessState) {
  store.state = next
  store.listeners.forEach((listener) => listener())
}
async function commit(command: Command) {
  store.commands.push(command)
  const result = dispatch(store.state, command, 'Ava Owner', now)
  if (result.ok) setStudio(result.state)
  return result
}
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
      today: '2026-10-06',
      mode: 'demo',
      branch: null,
    }
  },
}))

function apply(s: BusinessState, command: Command) {
  const result = dispatch(s, command, 'Ava Owner', now)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
/** The sample studio with Shoreditch open and a room there. */
function twoSites() {
  let s = apply(seed('UK'), {
    type: 'location',
    input: { name: 'Shoreditch', address: '1 Curtain Road' },
  } as Command)
  const shoreditch = operations(s).locations![0].id
  s = apply(s, {
    type: 'resource',
    input: { name: 'Shoreditch room', type: 'treatment', locationId: shoreditch },
  } as Command)
  return { s, shoreditch }
}
const mayaVisit = (date: string): Command =>
  ({
    type: 'book',
    input: {
      serviceId: 'service-facial',
      staffId: 'staff-maya',
      date,
      startMinutes: 600,
      clientId: 'client-1',
      source: 'desk',
    },
  }) as Command

beforeEach(() => {
  store.state = twoSites().s
  store.role = 'owner'
  store.commands = []
})
const show = (page = <Rota />) => render(<MemoryRouter>{page}</MemoryRouter>)
const panel = () => screen.getByRole('region', { name: 'Moving between locations' })

describe('moving someone from the rota', () => {
  it('checks the move first, asks about booked visits, and saves it from a date', async () => {
    const user = userEvent.setup()
    store.state = apply(store.state, mayaVisit('2026-10-13'))
    show()
    expect(panel()).toHaveTextContent('Nobody is moving.')
    await user.click(within(panel()).getByRole('button', { name: 'Move someone' }))
    const dialog = screen.getByRole('dialog', { name: 'Move someone to another location' })
    expect(within(dialog).getByLabelText('Who is moving')).toHaveValue('staff-maya')
    expect(within(dialog).getByLabelText('Moving to')).toHaveTextContent('Shoreditch')
    // Her week from the Monday after this one, at Shoreditch, before anything is saved.
    expect(dialog).toHaveTextContent("Maya's week from Monday 12 October")
    expect(dialog).toHaveTextContent('Monday09:00 to 18:00 at Shoreditch')
    expect(dialog).toHaveTextContent('SaturdayNot working')
    // The visit she has booked after the move would be left at Marylebone.
    const keep = within(dialog).getByRole('group', {
      name: 'A booked visit would be left at Marylebone, London',
    })
    expect(keep).toHaveTextContent('Tue 13 Oct 10:00 Amelia, Skin Renewal Facial with Maya Lewis')
    const save = within(dialog).getByRole('button', { name: 'Move Maya' })
    expect(save).toBeDisabled()
    await user.click(within(keep).getByRole('radio', { name: /Move it first/ }))
    expect(within(dialog).getByRole('link', { name: 'Open the calendar' })).toHaveAttribute(
      'href',
      '/calendar?date=2026-10-13',
    )
    await user.click(within(keep).getByRole('radio', { name: /Keep it booked as it is/ }))
    await user.type(
      within(dialog).getByLabelText('Note for the team (optional)'),
      'Leading Shoreditch',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Move Maya' }))
    expect(store.commands.at(-1)).toEqual({
      type: 'staff-move',
      input: {
        staffId: 'staff-maya',
        date: '2026-10-12',
        to: operations(store.state).locations![0].id,
        note: 'Leading Shoreditch',
      },
      keepBooked: true,
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Maya Lewis moves to Shoreditch on Monday 12 October. Their usual days and hours stay the same, and days before it stay where they were. 1 booked visit stays at Marylebone, London, marked on the rota.',
    )
    expect(staffLocationOn(store.state, 'staff-maya', '2026-10-09')).toBe(
      store.state.organisation.locationId,
    )
    expect(panel()).toHaveTextContent(
      'Maya Lewis · Moves from Marylebone, London to Shoreditch on Monday 12 October',
    )
    expect(panel()).toHaveTextContent(
      'Monday to Friday · Leading Shoreditch · by Ava Owner · 1 booked visit kept at Marylebone, London',
    )
    // The rota says where the kept visit is, not that it is outside her hours.
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    const tuesday = screen.getByRole('button', {
      name: "Change Maya Lewis's day, Tuesday 13 October. 09:00 to 18:00. 1 booked visit still at Marylebone, London.",
    })
    expect(within(tuesday).getByText('1 booked visit still at Marylebone, London')).toBeVisible()
    // It is counted there, not as a visit at Shoreditch too.
    expect(within(tuesday).queryByText('1 visit')).toBeNull()
  })

  it('marks the first day at the new location on the rota, and cancels a move still to come', async () => {
    const user = userEvent.setup()
    const shoreditch = operations(store.state).locations![0].id
    store.state = apply(store.state, {
      type: 'staff-move',
      input: { staffId: 'staff-maya', date: '2026-10-12', to: shoreditch },
    } as Command)
    show()
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    const monday = screen.getByRole('button', {
      name: "Change Maya Lewis's day, Monday 12 October. 09:00 to 18:00. First day at a new location.",
    })
    expect(within(monday).getByText('Moved here')).toBeInTheDocument()
    expect(within(monday).getByText('Shoreditch')).toBeInTheDocument()
    await user.click(
      within(panel()).getByRole('button', { name: "Cancel Maya Lewis's move to Shoreditch" }),
    )
    const dialog = screen.getByRole('dialog', { name: "Cancel Maya's move?" })
    expect(dialog).toHaveTextContent(
      'Moves from Marylebone, London to Shoreditch on Monday 12 October. Cancelling keeps their days at Marylebone, London.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel the move' }))
    expect(store.commands.at(-1)).toMatchObject({ type: 'staff-move-cancel' })
    expect(screen.getByRole('status')).toHaveTextContent(
      "Maya Lewis's move to Shoreditch is cancelled. Their days stay at Marylebone, London.",
    )
    expect(panel()).toHaveTextContent('cancelled by Ava Owner')
    expect(within(panel()).getByText('Cancelled')).toBeInTheDocument()
    expect(staffLocationOn(store.state, 'staff-maya', '2026-10-13')).toBe(
      store.state.organisation.locationId,
    )
  })

  it('names treatments the new location does not offer, and says why a move cannot be saved', async () => {
    const user = userEvent.setup()
    const { s, shoreditch } = twoSites()
    // Shoreditch offers no Deep Restore Massage, and nothing Theo does.
    store.state = structuredClone(s)
    for (const service of store.state.services)
      if (
        ['service-restore', 'service-cut', 'service-gloss', 'service-patch-test'].includes(
          service.id,
        )
      )
        service.notOfferedAt = [shoreditch]
    show()
    await user.click(within(panel()).getByRole('button', { name: 'Move someone' }))
    const dialog = screen.getByRole('dialog', { name: 'Move someone to another location' })
    expect(dialog).toHaveTextContent(
      'Shoreditch does not offer Deep Restore Massage, so Maya cannot be booked for it there.',
    )
    await user.selectOptions(within(dialog).getByLabelText('Who is moving'), 'staff-theo')
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      "Shoreditch does not offer any of Theo's treatments. Choose another location.",
    )
    expect(within(dialog).getByRole('button', { name: 'Move Theo' })).toBeDisabled()
    expect(store.commands).toEqual([])
  })

  it('shows the moves to everyone who sees the rota, and the way to move to owners and managers only', () => {
    store.role = 'reception'
    show()
    expect(panel()).toHaveTextContent('An owner or manager can move someone from a date.')
    expect(within(panel()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('leaves the panel out for a studio with one location', () => {
    store.state = seed('UK')
    show()
    expect(screen.queryByRole('region', { name: 'Moving between locations' })).toBeNull()
  })
})

describe('moving someone from Settings', () => {
  it('shows where each person works, and moves them from their details', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/settings?section=staff')
    render(
      <MemoryRouter initialEntries={['/settings?section=staff']}>
        <Manage />
      </MemoryRouter>,
    )
    expect(screen.getAllByText('Works at Marylebone, London').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Edit Maya Lewis' }))
    const editor = screen.getByRole('dialog', { name: 'Edit professional' })
    await user.click(within(editor).getByRole('button', { name: 'Move to another location' }))
    const dialog = screen.getByRole('dialog', { name: 'Move Maya Lewis' })
    expect(within(dialog).queryByLabelText('Who is moving')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Move Maya' }))
    expect(screen.getByText(/^Maya Lewis moves to Shoreditch on Monday 12 October\./)).toBeVisible()
    expect(
      screen.getByText('Works at Marylebone, London · moves to Shoreditch on Monday 12 October'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Maya Lewis' }))
    expect(screen.getByRole('dialog', { name: 'Edit professional' })).toHaveTextContent(
      'Moves from Marylebone, London to Shoreditch on Monday 12 October. The locations above are from that day on; days before it stay where they were.',
    )
  })
})
