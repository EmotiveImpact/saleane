import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMemo, useSyncExternalStore } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { Rota } from './Rota'
import { Manage } from './Manage'
import { TeamToday } from '../components/TeamToday'
import { seed } from '../domain/seed'
import { dispatch } from '../domain/commands'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import { operations } from '../domain/operations'
import { branchChangeRefusal, branchRefusal, branchView } from '../domain/branch'

// Stage 4: a general manager's Rota and rooms. Their screens read the branch view, and every
// change goes through the same checks the server makes.
const store = vi.hoisted(() => ({
  full: null as unknown as BusinessState,
  branch: '',
  listeners: new Set<() => void>(),
  commands: [] as unknown[],
}))
function setStudio(next: BusinessState) {
  store.full = next
  store.listeners.forEach((listener) => listener())
}
async function commit(command: Command) {
  store.commands.push(command)
  const refusal = branchRefusal(store.full, store.branch, command)
  if (refusal) return { ok: false as const, error: refusal }
  const result = dispatch(store.full, command, 'Gia General', '2026-10-06T09:45:00.000Z')
  if (!result.ok) return result
  const after = branchChangeRefusal(store.full, result.state, store.branch)
  if (after) return { ok: false as const, error: after }
  setStudio(result.state)
  return result
}
vi.mock('../state/context', () => ({
  useStore: () => {
    const full = useSyncExternalStore(
      (listener) => {
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
      },
      () => store.full,
    )
    const state = useMemo(() => branchView(full, store.branch, '2026-10-06'), [full])
    return {
      state,
      role: 'general',
      branch: store.branch,
      blocked: false,
      commit,
      today: '2026-10-06',
      mode: 'sandbox',
    }
  },
}))

/** The sample with Islington open: a room there, and Nia at Islington Monday to Wednesday. */
function twoSites() {
  const apply = (s: BusinessState, command: Command) => {
    const result = dispatch(s, command, 'Ava Owner', '2026-10-06T08:00:00.000Z')
    if (!result.ok) throw new Error(result.error)
    return result.state
  }
  let s = apply(seed('UK'), {
    type: 'location',
    input: { name: 'Islington', address: '1 Upper Street' },
  })
  const islington = s.operations!.locations![0].id
  s = apply(s, {
    type: 'resource',
    input: { name: 'Islington room', type: 'treatment', locationId: islington },
  } as Command)
  s = apply(s, {
    type: 'staff',
    input: {
      name: 'Nia Fictional',
      role: 'Facialist',
      serviceIds: ['service-facial'],
      tone: 'sage',
      hours: operations(s).hours.map((h) =>
        h.day >= 1 && h.day <= 3 ? { ...h, locationId: islington } : { ...h },
      ),
    },
  } as Command)
  s = apply(s, {
    type: 'time-off',
    input: {
      staffId: s.staff.find((p) => p.name === 'Nia Fictional')!.id,
      from: '2026-10-12',
      to: '2026-10-13',
      kind: 'holiday',
    },
  } as Command)
  return { s, islington, nia: s.staff.find((p) => p.name === 'Nia Fictional')!.id }
}

let nia = ''
let islington = ''
beforeEach(() => {
  const sites = twoSites()
  store.full = sites.s
  store.branch = sites.islington
  store.commands = []
  nia = sites.nia
  islington = sites.islington
})
const show = (page = <Rota />, path = '/business/rota') =>
  render(<MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>)
const rotaTable = () => screen.getByRole('region', { name: 'Rota for the week' })

describe('the rota for a general manager', () => {
  it('shows their own team, with days at another location as where only', () => {
    show()
    const table = rotaTable()
    expect(within(table).getByText('Nia Fictional')).toBeInTheDocument()
    for (const name of ['Maya Lewis', 'Sophia Reed', 'Theo Bennett'])
      expect(within(table).queryByText(name)).not.toBeInTheDocument()
    // Wednesday is an Islington day; Thursday is the main location's, shown without times.
    expect(
      screen.getByRole('button', { name: /^Change Nia Fictional's day, Wednesday 7 October/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Nia Fictional's day, Thursday 8 October/ }),
    ).not.toBeInTheDocument()
    const thursday = within(table).getAllByText('Planned there')[0].closest('td')!
    expect(thursday).toHaveTextContent('Marylebone, London')
    expect(thursday).not.toHaveTextContent(/\d\d:\d\d/)
    expect(screen.getByText(/Your team at Islington\./)).toBeInTheDocument()
    // Holiday figures for their team only, and no allowance button.
    const holiday = screen.getByRole('region', { name: /Holiday in 2026/ })
    expect(within(holiday).getByText('Nia Fictional')).toBeInTheDocument()
    expect(within(holiday).queryByText('Maya Lewis')).not.toBeInTheDocument()
    expect(within(holiday).queryByRole('button', { name: /Allowance/ })).not.toBeInTheDocument()
  })

  it('changes one of their days at their own location, naming no other', async () => {
    const user = userEvent.setup()
    show()
    await user.click(
      screen.getByRole('button', { name: /^Change Nia Fictional's day, Wednesday 7 October/ }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Nia Fictional, Wednesday 7 October' })
    expect(dialog).toHaveTextContent('At Islington.')
    expect(within(dialog).queryByRole('combobox', { name: 'At' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'Not working' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save this day' }))
    expect(store.commands).toEqual([
      { type: 'rota-day', input: { staffId: nia, date: '2026-10-07', working: false } },
    ])
    expect(screen.getByRole('status')).toHaveTextContent(
      'Nia Fictional is not working on Wednesday 7 October.',
    )
    expect(operations(store.full).rotaChanges!.at(-1)!.actor).toBe('Gia General')
  })

  it('asks for a sign-off instead of saving when the owner wants one', async () => {
    const user = userEvent.setup()
    const o = operations(store.full)
    store.full = {
      ...store.full,
      operations: {
        ...o,
        approvals: { regionalLimitMinor: 500_00, ...o.approvals, rotaSignOff: 'all' },
      },
    }
    show()
    await user.click(
      screen.getByRole('button', { name: /^Change Nia Fictional's day, Wednesday 7 October/ }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Nia Fictional, Wednesday 7 October' })
    await user.click(within(dialog).getByRole('radio', { name: 'Not working' }))
    expect(dialog).toHaveTextContent('Changes to the rota need a sign-off first.')
    expect(within(dialog).queryByRole('button', { name: 'Save this day' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Ask for a sign-off' }))
    expect(store.commands).toEqual([
      {
        type: 'request-raise',
        input: {
          locationId: islington,
          kind: 'rota',
          rota: { type: 'rota-day', input: { staffId: nia, date: '2026-10-07', working: false } },
        },
      },
    ])
    // Nothing on the rota changes until it is approved; the request waits at Islington.
    expect(operations(store.full).rotaChanges ?? []).toHaveLength((o.rotaChanges ?? []).length)
    expect(operations(store.full).requests!.at(-1)).toMatchObject({
      kind: 'rota',
      locationId: islington,
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Asked for a sign-off for Nia Fictional on Wednesday 7 October.',
    )
  })

  it('copies a week for their own location only', async () => {
    const user = userEvent.setup()
    const made = dispatch(
      store.full,
      {
        type: 'rota-day',
        input: {
          staffId: nia,
          date: '2026-10-07',
          working: true,
          open: 600,
          close: 900,
          locationId: islington,
        },
      },
      'Gia General',
      '2026-10-06T08:00:00.000Z',
    )
    if (!made.ok) throw new Error(made.error)
    store.full = made.state
    show()
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await user.click(screen.getByText('Change the whole week'))
    await user.click(screen.getByRole('button', { name: "Copy last week's changes" }))
    const dialog = screen.getByRole('dialog', { name: "Copy last week's changes" })
    // Maya's changed Friday and Saturday at the main location are not theirs to copy.
    expect(within(dialog).getByRole('list', { name: 'Days to copy' })).toHaveTextContent(
      'Nia Fictional',
    )
    expect(dialog).not.toHaveTextContent('Maya')
    await user.click(within(dialog).getByRole('button', { name: 'Copy 1 day' }))
    expect(store.commands).toEqual([
      { type: 'rota-week-copy', monday: '2026-10-12', locationId: islington },
    ])
  })

  it('adds and changes time off for their team, and says why a day elsewhere cannot be', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'Add time off' }))
    let dialog = screen.getByRole('dialog', { name: 'Add time off' })
    const who = within(dialog).getByRole('combobox', { name: 'Who' })
    expect(
      within(who)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Nia Fictional'])
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    // Nia's holiday on Monday 12 and Tuesday 13 October is theirs to change.
    await user.click(
      screen.getByRole('button', { name: "Change Nia Fictional's holiday from Monday 12 October" }),
    )
    dialog = screen.getByRole('dialog', { name: "Change Nia Fictional's time off" })
    const save = within(dialog).getByRole('button', { name: 'Save the change' })
    expect(save).toBeDisabled()
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Kind' }), 'sick')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(store.commands).toEqual([
      {
        type: 'time-off-change',
        timeOffId: expect.any(String),
        input: { from: '2026-10-12', to: '2026-10-13', kind: 'sick' },
      },
    ])
    expect(screen.getByRole('status')).toHaveTextContent(
      "Nia Fictional's time off is changed. They are away from Monday 12 October to Tuesday 13 October, and the earlier days are kept on record.",
    )
    const record = screen.getByText(/changed by Gia General/)
    expect(record).toHaveTextContent('(was Mon 12 Oct to Tue 13 Oct)')
  })
})

describe('rooms for a general manager', () => {
  it('lists and adds rooms at their own location only', async () => {
    const user = userEvent.setup()
    show(<Manage />, '/settings?section=resource')
    expect(screen.getByRole('button', { name: 'Edit Islington room' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Edit Treatment room 1' })).not.toBeInTheDocument()
    expect(screen.getByText(/The rooms and chairs at Islington\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Add resource/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('At Islington.')
    expect(within(dialog).queryByRole('combobox', { name: 'Location' })).not.toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: /Name/ }), 'Islington chair')
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Resource type' }),
      'chair',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(store.commands).toEqual([
      {
        type: 'resource',
        input: { name: 'Islington chair', type: 'chair', archived: false, locationId: islington },
      },
    ])
    expect(store.full.resources.find((r) => r.name === 'Islington chair')!.locationId).toBe(
      islington,
    )
  })
})

describe('team today for a general manager', () => {
  it('shows the people whose day today is at their location', () => {
    render(
      <MemoryRouter>
        <TeamToday />
      </MemoryRouter>,
    )
    // Tuesday is an Islington day for Nia; the main location's team is not shown.
    expect(screen.getByText('Nia')).toBeInTheDocument()
    expect(screen.queryByText('Maya')).not.toBeInTheDocument()
  })
})
