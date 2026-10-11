import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { GiftCards } from './GiftCards'
import { seed } from '../domain/seed'
import { dispatch } from '../domain/commands'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import { operations } from '../domain/operations'

// Stage 4: moving a gift card to another location from its page.
const now = '2026-10-06T09:45:00.000Z'
const store = vi.hoisted(() => ({
  state: null as unknown as BusinessState,
  role: 'owner' as string,
  branch: null as string | null,
  listeners: new Set<() => void>(),
  commands: [] as Command[],
}))
async function commit(command: Command) {
  store.commands.push(command)
  const result = dispatch(store.state, command, 'Ava Owner', now)
  if (result.ok) {
    store.state = result.state
    store.listeners.forEach((listener) => listener())
  }
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
      branch: store.branch,
      blocked: false,
      commit,
      today: '2026-10-06',
      mode: 'demo',
    }
  },
}))

function apply(s: BusinessState, command: Command) {
  const result = dispatch(s, command, 'Ava Owner', now)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
function twoSites() {
  return apply(seed('UK'), {
    type: 'location',
    input: { name: 'Shoreditch', address: '1 Curtain Road' },
  } as Command)
}
const shoreditch = () => operations(store.state).locations![0].id

beforeEach(() => {
  store.state = twoSites()
  store.role = 'owner'
  store.branch = null
  store.commands = []
})
const show = () =>
  render(
    <MemoryRouter>
      <GiftCards />
    </MemoryRouter>,
  )
const openCard = async (code: string) => {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(code) }))
  return screen.getByRole('dialog')
}

describe('moving a gift card to another location', () => {
  it('moves a card with a reason, keeps everything else, and shows it in its history', async () => {
    const user = userEvent.setup()
    show()
    expect(
      screen.getByText('Waiting to be spent, by where each card belongs: Marylebone, London £170.'),
    ).toBeInTheDocument()
    let card = await openCard('LAKE-7K4M-2QHN')
    expect(card).toHaveTextContent(
      'Sold at Marylebone, London, and belongs there. It can be spent at any location.',
    )
    await user.click(within(card).getByRole('button', { name: 'Move to another location' }))
    const dialog = screen.getByRole('dialog', { name: 'Move LAKE-7K4M-2QHN' })
    expect(dialog).toHaveTextContent(
      'It belongs to Marylebone, London now. Its code, balance, last day and history stay as they are.',
    )
    expect(within(dialog).getByLabelText('Move to')).toHaveDisplayValue('Shoreditch')
    expect(dialog).toHaveTextContent(
      'Money already taken for it and spent with it stays where it happened. What is left on it, £75.00, counts at Shoreditch from now on. It can still be spent at any location.',
    )
    // A reason is needed before it can be saved.
    await user.click(within(dialog).getByRole('button', { name: 'Move card' }))
    expect(store.commands).toEqual([])
    await user.type(within(dialog).getByLabelText(/Why it is moving/), 'Hannah lives nearer')
    await user.click(within(dialog).getByRole('button', { name: 'Move card' }))
    expect(store.commands).toEqual([
      {
        type: 'gift-card-move',
        giftCardId: 'gift-1',
        locationId: shoreditch(),
        reason: 'Hannah lives nearer',
      },
    ])
    card = screen.getByRole('dialog', { name: 'Gift card' })
    expect(card).toHaveTextContent(
      'Belongs to Shoreditch. Sold at Marylebone, London. It can be spent at any location.',
    )
    const history = within(card).getByRole('region', { name: 'History' })
    expect(history).toHaveTextContent('Sold for £75.00 at Marylebone, London by Front desk')
    expect(history).toHaveTextContent(
      '6 October 2026Moved from Marylebone, London to Shoreditch by Ava Owner: Hannah lives nearer',
    )
    expect(
      screen.getByText(
        'Waiting to be spent, by where each card belongs: Marylebone, London £95, Shoreditch £75.',
      ),
    ).toBeInTheDocument()
  })

  it('lets a general manager move only a card that belongs to their location', async () => {
    store.role = 'general'
    store.branch = store.state.organisation.locationId
    store.state = apply(store.state, {
      type: 'gift-card-move',
      giftCardId: 'gift-1',
      locationId: shoreditch(),
      reason: 'Hannah lives nearer',
    } as Command)
    show()
    let card = await openCard('LAKE-7K4M-2QHN')
    expect(card).toHaveTextContent('Belongs to Shoreditch.')
    expect(within(card).queryByRole('button', { name: 'Move to another location' })).toBeNull()
    await userEvent.click(within(card).getByRole('button', { name: 'Close dialog' }))
    card = await openCard('SAGE-9P3T-XW5C')
    expect(within(card).getByRole('button', { name: 'Move to another location' })).toBeVisible()
  })

  it('is not offered to the desk, or with one location', async () => {
    store.role = 'reception'
    const { unmount } = show()
    let card = await openCard('LAKE-7K4M-2QHN')
    expect(within(card).queryByRole('button', { name: 'Move to another location' })).toBeNull()
    unmount()
    store.role = 'owner'
    store.state = seed('UK')
    show()
    card = await openCard('LAKE-7K4M-2QHN')
    expect(within(card).queryByRole('button', { name: 'Move to another location' })).toBeNull()
    expect(card).not.toHaveTextContent('Sold at')
    expect(screen.queryByText(/by where each card belongs/)).toBeNull()
  })

  it('is not offered for a card that has run out of time', async () => {
    store.state = structuredClone(store.state)
    store.state.giftCards![0].expiresOn = '2026-10-05'
    show()
    const card = await openCard('LAKE-7K4M-2QHN')
    expect(within(card).getByRole('button', { name: 'Give more time' })).toBeVisible()
    expect(within(card).queryByRole('button', { name: 'Move to another location' })).toBeNull()
  })
})
