import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { Rota } from './Rota'
import { TeamToday } from '../components/TeamToday'
import { seed } from '../domain/seed'
import { dispatch } from '../domain/commands'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import { operations } from '../domain/operations'

// Stage 3: the rota week, where owners and managers change one day or a whole week.
const store = vi.hoisted(() => ({
  state: null as unknown as BusinessState,
  role: 'owner' as string,
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
vi.mock('../state/context', () => ({
  useStore: () => {
    const state = useSyncExternalStore(
      (listener) => {
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
      },
      () => store.state,
    )
    return { state, role: store.role, blocked: false, commit, today: '2026-10-06' }
  },
}))

beforeEach(() => {
  store.state = seed('UK')
  store.role = 'owner'
  store.commands = []
})
const show = (page = <Rota />) => render(<MemoryRouter>{page}</MemoryRouter>)
const rotaTable = () => screen.getByRole('region', { name: 'Rota for the week' })

describe('changed days on the rota', () => {
  it('marks the sample week’s changed shift and extra day, and opens a day to change', async () => {
    show()
    const friday = screen.getByRole('button', {
      name: "Change Maya Lewis's day, Friday 9 October. 09:00 to 15:00. Changed.",
    })
    expect(within(friday).getByText('Changed')).toBeInTheDocument()
    expect(friday.closest('td')).toHaveClass('rota-changed')
    const saturday = screen.getByRole('button', {
      name: "Change Maya Lewis's day, Saturday 10 October. 10:00 to 16:00. Extra day.",
    })
    expect(within(saturday).getByText('Extra day')).toBeInTheDocument()
    // Days that have passed and days the studio is closed are not offered for changing.
    expect(
      screen.queryByRole('button', { name: /Change Maya Lewis's day, Monday 5 October/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Change Maya Lewis's day, Sunday 11 October/ }),
    ).not.toBeInTheDocument()
    await userEvent.click(friday)
    const dialog = screen.getByRole('dialog', { name: 'Maya Lewis, Friday 9 October' })
    expect(dialog).toHaveTextContent('Usually 09:00 to 18:00. A change here is for this day only.')
    expect(dialog).toHaveTextContent('Changed for this day by Owner. Training from three')
    expect(within(dialog).getByRole('button', { name: 'Save this day' })).toBeDisabled()
  })

  it('puts a changed day back to usual hours', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /Maya Lewis's day, Friday 9 October/ }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'As usual' }))
    await user.click(within(dialog).getByRole('button', { name: 'Put back to usual' }))
    expect(store.commands).toEqual([
      { type: 'rota-day-usual', staffId: 'staff-maya', date: '2026-10-09' },
    ])
    expect(screen.getByRole('status')).toHaveTextContent(
      'Maya Lewis is back to their usual hours on Friday 9 October.',
    )
    expect(
      screen.getByRole('button', {
        name: "Change Maya Lewis's day, Friday 9 October. 09:00 to 18:00.",
      }),
    ).toBeInTheDocument()
  })

  it('adds an extra day for someone who does not usually work it', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /Maya Lewis's day, Saturday 10 October/ }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await user.click(
      screen.getByRole('button', {
        name: "Change Maya Lewis's day, Saturday 17 October. Not working.",
      }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Maya Lewis, Saturday 17 October' })
    expect(dialog).toHaveTextContent('Does not usually work on Saturdays.')
    // No day off to take from a day they do not work.
    expect(within(dialog).queryByRole('radio', { name: 'Not working' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'Extra day' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.type(within(dialog).getByLabelText('Note for the team (optional)'), 'Covering')
    await user.click(within(dialog).getByRole('button', { name: 'Save this day' }))
    expect(store.commands).toEqual([
      {
        type: 'rota-day',
        input: {
          staffId: 'staff-maya',
          date: '2026-10-17',
          working: true,
          open: 540,
          close: 1080,
          note: 'Covering',
        },
      },
    ])
    expect(screen.getByRole('status')).toHaveTextContent(
      'Maya Lewis works 09:00 to 18:00 on Saturday 17 October. Their usual hours stay as they are.',
    )
    expect(within(rotaTable()).getAllByText('Extra day')).toHaveLength(1)
  })

  it('names booked visits outside the new hours and waits for a choice', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: /Maya Lewis's day, Tuesday 6 October/ }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Not working' }))
    const keep = within(dialog).getByRole('group', {
      name: /booked visits? would be outside the new hours/,
    })
    expect(keep).toHaveTextContent(/Amelia, Skin Renewal Facial/)
    const save = within(dialog).getByRole('button', { name: 'Save this day' })
    expect(save).toBeDisabled()
    await user.click(within(keep).getByRole('radio', { name: /^Move (it|them) first/ }))
    expect(within(dialog).getByRole('link', { name: 'Open the calendar' })).toHaveAttribute(
      'href',
      '/calendar?date=2026-10-06',
    )
    expect(store.commands).toEqual([])
    await user.click(within(keep).getByRole('radio', { name: /^Keep (it|them) booked/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save this day' }))
    expect(store.commands).toEqual([
      {
        type: 'rota-day',
        input: { staffId: 'staff-maya', date: '2026-10-06', working: false },
        keepBooked: true,
      },
    ])
    // The visits are exactly as they were, and the warning stays on the rota.
    expect(store.state.appointments).toEqual(seed('UK').appointments)
    expect(operations(store.state).messages).toEqual(operations(seed('UK')).messages)
    expect(screen.getByRole('status')).toHaveTextContent(/outside the hours, marked on the rota\./)
    const cell = screen.getByRole('button', { name: /Maya Lewis's day, Tuesday 6 October/ })
    expect(cell).toHaveTextContent(/Not working/)
    expect(cell).toHaveTextContent(/booked visits? outside their hours/)
  })

  it('copies and clears a whole week from one tucked-away place', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByText('Change the whole week'))
    await user.click(screen.getByRole('button', { name: "Clear this week's changes" }))
    const dialog = screen.getByRole('dialog', { name: "Clear this week's changes" })
    expect(within(dialog).getByRole('list', { name: 'Days to clear' }).children).toHaveLength(2)
    await user.click(within(dialog).getByRole('button', { name: 'Put 2 days back to usual' }))
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 days are back to usual hours this week.',
    )
    expect(within(rotaTable()).queryByText('Extra day')).not.toBeInTheDocument()
    // The cleared changes stay on record, so a later week can still be planned from scratch.
    expect(operations(store.state).rotaChanges!.every((c) => c.ended?.how === 'cleared')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.queryByText('Change the whole week')).not.toBeInTheDocument()
  })

  it('copies last week’s changes onto the next week', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await user.click(screen.getByText('Change the whole week'))
    expect(screen.getByRole('button', { name: "Clear this week's changes" })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: "Copy last week's changes" }))
    const dialog = screen.getByRole('dialog', { name: "Copy last week's changes" })
    const list = within(dialog).getByRole('list', { name: 'Days to copy' })
    expect(list).toHaveTextContent('Fri 16 Oct: 09:00 to 15:00')
    expect(list).toHaveTextContent('Sat 17 Oct: 10:00 to 16:00')
    await user.click(within(dialog).getByRole('button', { name: 'Copy 2 days' }))
    expect(store.commands).toEqual([{ type: 'rota-week-copy', monday: '2026-10-12' }])
    expect(within(rotaTable()).getByText('Extra day')).toBeInTheDocument()
    expect(within(rotaTable()).getByText('Changed')).toBeInTheDocument()
  })

  it('shows the desk the changed days without a way to change them', () => {
    store.role = 'reception'
    show()
    expect(within(rotaTable()).getByText('Extra day')).toBeInTheDocument()
    expect(within(rotaTable()).queryAllByRole('button')).toEqual([])
    expect(screen.queryByText('Change the whole week')).not.toBeInTheDocument()
    expect(screen.getByText(/Changed days are marked\./)).toBeInTheDocument()
  })
})

describe("Today's team", () => {
  it('says when someone’s hours are changed for today', () => {
    const changed = dispatch(
      seed('UK'),
      {
        type: 'rota-day',
        input: { staffId: 'staff-theo', date: '2026-10-06', working: true, open: 600, close: 1080 },
        keepBooked: true,
      },
      'Ava Owner',
      '2026-10-06T09:45:00.000Z',
    )
    if (!changed.ok) throw new Error(changed.error)
    store.state = changed.state
    show(<TeamToday />)
    expect(screen.getByText('Hours changed')).toBeInTheDocument()
  })
})
