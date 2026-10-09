import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LocationsSettings } from './LocationsSettings'
import { execute } from '../domain/commands'
import type { Command, CommandResult } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import type { Role } from '../domain/operations'
import { places, staffLocationOn } from '../domain/locations'
import { createWorkspace } from '../domain/workspace'
import { seed } from '../domain/seed'

// "Add a location": six screens, nothing saved until the last one.
type Shown = {
  state: BusinessState
  role: Role
  mode: 'demo' | 'server'
  blocked: boolean
  commit: (command: Command) => Promise<CommandResult>
}
let store: Shown
vi.mock('../state/context', () => ({ useStore: () => store }))
const commit = vi.fn(async (command: Command): Promise<CommandResult> => {
  const result = execute(store.state, command, '2026-10-06T08:00:00.000Z', () =>
    crypto.randomUUID(),
  )
  if (result.ok) store.state = result.state
  return result
})
/** A local studio with the sample menu, team and rooms, and no visits. */
function studio(): BusinessState {
  const s = createWorkspace({ name: 'Linden Studio', region: 'UK', locationName: 'Marylebone' })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  return s
}
function show(role: Role = 'owner') {
  store = { state: studio(), role, mode: 'server', blocked: false, commit }
  return render(
    <MemoryRouter>
      <LocationsSettings />
    </MemoryRouter>,
  )
}
const dialog = () => screen.getByRole('dialog')
const next = () => within(dialog()).getByRole('button', { name: /^Continue/ })

afterEach(() => vi.clearAllMocks())

describe('Add a location', () => {
  it('walks the owner through each screen and saves it all at the end', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Add location' }))
    const steps = within(dialog()).getByRole('list', { name: 'Adding a location' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(6)
    expect(next()).toBeDisabled()
    await userEvent.type(within(dialog()).getByLabelText('Name'), 'Islington')
    await userEvent.type(within(dialog()).getByLabelText('Address'), '1 Upper Street, London')
    await userEvent.click(next())

    // Hours: the same as the main location unless the owner says otherwise.
    expect(
      within(dialog()).getByRole('button', { name: 'The same as Marylebone' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(next())

    // Treatments: leave one off and price another differently.
    const menu = within(dialog()).getByRole('list', { name: 'Treatments here' })
    await userEvent.click(within(menu).getByRole('checkbox', { name: /Lymphatic Massage/ }))
    const facial = within(menu).getByLabelText('Price of Skin Renewal Facial here')
    await userEvent.clear(facial)
    await userEvent.type(facial, '105')
    await userEvent.click(next())

    // Rooms: one of each kind its menu needs, named after it.
    const rooms = within(dialog()).getByRole('list', { name: 'Rooms and chairs' })
    expect(
      within(rooms)
        .getAllByLabelText('Name')
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['Islington room 1', 'Islington chair 1'])
    await userEvent.click(next())

    // Team: Maya works Thursdays here.
    expect(within(dialog()).getByRole('status')).toHaveTextContent(
      'Choose who works here, and on which days.',
    )
    const maya = within(dialog()).getByText('Maya Lewis').closest('li') as HTMLElement
    await userEvent.click(within(maya).getByRole('checkbox', { name: 'Thursday' }))
    expect(within(maya).getByRole('checkbox', { name: 'Sunday, closed' })).toBeDisabled()
    await userEvent.click(next())

    // Check: nothing has been saved until now.
    expect(commit).not.toHaveBeenCalled()
    expect(within(dialog()).getByText('Maya Lewis (Thu)')).toBeInTheDocument()
    expect(
      within(dialog()).getByText('Each location is £49 a month, plus VAT.'),
    ).toBeInTheDocument()
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Add Islington' }))
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0][0]).toMatchObject({
      type: 'location-open',
      location: { name: 'Islington', address: '1 Upper Street, London' },
      rooms: [
        { name: 'Islington room 1', type: 'treatment' },
        { name: 'Islington chair 1', type: 'chair' },
      ],
      team: [{ staffId: 'staff-maya', days: [4] }],
      notOffered: ['service-lymphatic'],
      prices: [{ serviceId: 'service-facial', priceMinor: 10500 }],
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Islington is added, with its rooms, team and menu.',
    )
    const islington = places(store.state).find((p) => p.name === 'Islington')!
    expect(staffLocationOn(store.state, 'staff-maya', '2026-10-08')).toBe(islington.id)
  })

  it('is for the owner', () => {
    show('manager')
    expect(screen.queryByRole('button', { name: 'Add location' })).toBeNull()
  })
})
