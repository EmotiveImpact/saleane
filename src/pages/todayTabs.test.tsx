import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'

function show() {
  render(
    <MemoryRouter initialEntries={['/today']}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}

/** A screen 650px wide or narrower: only the phone query matches, so nothing else changes. */
function onAPhone() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 650px)',
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

const toCome = (text: string | null) => Number(/(\d+) to come/.exec(text ?? '')?.[1])

// Each test drives the whole app, which can take several seconds on a busy machine.
describe('Today on a phone', { timeout: 20000 }, () => {
  beforeEach(onAPhone)
  afterEach(() => vi.unstubAllGlobals())

  it('sorts the day, what needs you and the team into three tabs, each with its count', async () => {
    const user = userEvent.setup()
    show()
    const tablist = await screen.findByRole('tablist', { name: 'Today' }, { timeout: 8000 })
    const [day, needs, team] = within(tablist).getAllByRole('tab')
    expect(day).toHaveAccessibleName(/^The day \d+ to come$/)
    expect(needs).toHaveAccessibleName('Needs you 5 waiting')
    expect(team).toHaveAccessibleName('Team 3 professionals')
    // Only Needs you turns rose, and only because something waits.
    expect(needs.querySelector('.count')).toHaveAttribute('data-attention')
    expect(day.querySelector('.count')).not.toHaveAttribute('data-attention')
    expect(team.querySelector('.count')).not.toHaveAttribute('data-attention')

    // It opens on the day, whose heading carries the same count as its tab.
    expect(day).toHaveAttribute('aria-selected', 'true')
    const schedule = screen.getByRole('region', { name: 'The day ahead' })
    expect(toCome(schedule.querySelector('.count')!.textContent)).toBe(toCome(day.textContent))
    expect(screen.queryByRole('region', { name: 'Needs you' })).not.toBeInTheDocument()
    // The tabs take the place of the strip that used to name what was waiting.
    expect(screen.queryByRole('navigation', { name: 'Waiting on you' })).not.toBeInTheDocument()

    await user.click(needs)
    const waiting = screen.getByRole('region', { name: 'Needs you' })
    expect(within(waiting).getByText('5 waiting')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'The day ahead' })).not.toBeInTheDocument()

    // A call logged from the tab counts at once, in the tab and in its heading.
    const calls = within(waiting).getByRole('region', { name: 'Missed calls' })
    await user.click(within(calls).getByRole('button', { name: 'Log a missed call' }))
    await user.type(within(calls).getByLabelText('Log a missed call'), '07700 900789')
    await user.click(within(calls).getByRole('button', { name: 'Add' }))
    expect(within(waiting).getByText('6 waiting')).toBeInTheDocument()
    expect(needs).toHaveAccessibleName('Needs you 6 waiting')

    // The arrow keys move between tabs, as they do on every tab row.
    await user.click(needs)
    await user.keyboard('{ArrowRight}')
    expect(team).toHaveAttribute('aria-selected', 'true')
    const people = screen.getByRole('region', { name: 'Your team today' })
    expect(within(people).getByText('3 professionals')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Your booking experience/ })).toBeInTheDocument()
  })
})

describe('Today on a computer', { timeout: 20000 }, () => {
  it('keeps the columns side by side, each heading with the same count a phone shows', async () => {
    show()
    const schedule = await screen.findByRole('region', { name: 'The day ahead' }, { timeout: 8000 })
    expect(screen.queryByRole('tablist', { name: 'Today' })).not.toBeInTheDocument()
    expect(schedule.querySelector('.count')).toHaveTextContent(/^\d+ to come$/)
    const needs = screen.getByRole('region', { name: 'Needs you' })
    expect(within(needs).getByText('5 waiting')).toHaveAttribute('data-attention')
    const team = screen.getByRole('region', { name: 'Your team today' })
    expect(within(team).getByText('3 professionals')).not.toHaveAttribute('data-attention')
  })
})
