import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'

/** Finds an element by all of its text, including words only a screen reader hears. */
const allText = (wanted: string) => (_: string, element: Element | null) =>
  element?.textContent === wanted

function show() {
  render(
    <MemoryRouter initialEntries={['/today']}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}

// Each test drives the whole app, which can take several seconds on a busy machine.
describe('Today’s side column', { timeout: 20000 }, () => {
  it('starts with what needs someone, as small cards with a count each', async () => {
    const user = userEvent.setup()
    show()
    const needs = screen.getByRole('region', { name: 'Needs you' })
    expect(within(needs).getByText('4 waiting')).toBeInTheDocument()
    const calls = within(needs).getByRole('region', { name: 'Missed calls' })
    expect(within(calls).getByText(allText('2 to call back'))).toBeInTheDocument()
    expect(within(calls).getAllByRole('listitem')).toHaveLength(2)
    const tests = within(needs).getByRole('region', { name: 'Patch tests to sort' })
    expect(within(tests).getByText(allText('2 to sort'))).toBeInTheDocument()

    // A third call: the card keeps its first two and offers the rest.
    await user.click(within(calls).getByRole('button', { name: 'Log a missed call' }))
    await user.type(within(calls).getByLabelText('Log a missed call'), '07700 900789')
    await user.click(within(calls).getByRole('button', { name: 'Add' }))
    expect(within(calls).getByRole('status')).toHaveTextContent('Added to the list to call back.')
    expect(within(calls).getByText(allText('3 to call back'))).toBeInTheDocument()
    expect(within(needs).getByText('5 waiting')).toBeInTheDocument()
    expect(within(calls).getAllByRole('listitem')).toHaveLength(2)
    const seeAll = within(calls).getByRole('button', { name: 'See all 3' })
    expect(seeAll).toHaveAttribute('aria-expanded', 'false')
    await user.click(seeAll)
    expect(within(calls).getAllByRole('listitem')).toHaveLength(3)
    expect(within(calls).getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('keeps the team’s reminders with what needs someone', async () => {
    const user = userEvent.setup()
    show()
    const needs = screen.getByRole('region', { name: 'Needs you' })
    const reminders = within(needs).getByRole('region', { name: 'Reminders' })
    expect(within(reminders).getByText('Nothing left for today.')).toBeInTheDocument()
    await user.click(within(reminders).getByRole('button', { name: 'Add a reminder' }))
    await user.type(within(reminders).getByLabelText('Reminder'), 'Order more towels')
    await user.click(within(reminders).getByRole('button', { name: 'Add' }))
    expect(within(reminders).getByRole('status')).toHaveTextContent('Added to today’s reminders.')
    expect(within(reminders).getByText('Order more towels')).toBeInTheDocument()
    expect(within(needs).getByText('5 waiting')).toBeInTheDocument()

    // One for later in the week is saved for its day, not listed today.
    await user.click(within(reminders).getByRole('button', { name: 'Add a reminder' }))
    await user.type(within(reminders).getByLabelText('Reminder'), 'Call the laundry')
    await user.selectOptions(within(reminders).getByLabelText('Day'), 'Thursday')
    await user.click(within(reminders).getByRole('button', { name: 'Add' }))
    expect(within(reminders).getByRole('status')).toHaveTextContent('Saved for Thursday.')
    expect(within(reminders).queryByText('Call the laundry')).not.toBeInTheDocument()

    await user.click(within(reminders).getByRole('button', { name: 'Done: Order more towels' }))
    expect(within(reminders).getByRole('status')).toHaveTextContent('Done: Order more towels')
    expect(within(reminders).queryByRole('listitem')).not.toBeInTheDocument()
    expect(within(needs).getByText('4 waiting')).toBeInTheDocument()
  })

  it('heads what SALEANE noticed with what the figures say', () => {
    show()
    const noticed = screen.getByRole('region', { name: 'A fuller day than usual.' })
    expect(noticed).toHaveTextContent(
      'Today has 12 visits, about 13 hours of treatment. A usual Tuesday has about an hour and a half.',
    )
    expect(noticed).not.toHaveTextContent(/\d\.5 hours|familiar face/)
    // Clients drifting away: the first two, with the rest a tap away.
    const drifting = within(noticed).getByRole('list', { name: 'Drifting away' })
    expect(within(drifting).getAllByRole('listitem')).toHaveLength(2)
    expect(within(noticed).getByRole('button', { name: /^See all \d+$/ })).toBeInTheDocument()
  })

  it('shows one special, with the rest and the plan flow in a dialog', async () => {
    const user = userEvent.setup()
    show()
    const specials = screen.getByRole('region', { name: 'Specials to consider' })
    expect(within(specials).getAllByRole('button', { name: /Plan this special/ })).toHaveLength(1)
    await user.click(within(specials).getByRole('button', { name: 'See all specials' }))
    const dialog = screen.getByRole('dialog', { name: 'Specials' })
    const plans = within(dialog).getAllByRole('button', { name: /Plan this special/ })
    expect(plans.length).toBeGreaterThan(1)
    const first = within(dialog).getAllByRole('listitem')[0].querySelector('strong')!.textContent!
    await user.click(plans[0])
    const yours = within(dialog).getByRole('heading', { name: 'Your specials' }).parentElement!
    expect(within(yours).getByText(first)).toBeInTheDocument()
    expect(within(yours).getByRole('button', { name: 'Stop this special' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(within(specials).getByText(`One special planned: ${first}.`)).toBeInTheDocument()
  })

  it('shows the team as faces, each with how much of the day is booked', () => {
    show()
    const team = screen.getByRole('region', { name: 'Your team today' })
    const people = within(team).getAllByRole('listitem')
    expect(people.map((person) => person.querySelector('strong')?.textContent)).toEqual([
      'Maya',
      'Sophia',
      'Theo',
    ])
    for (const person of people) expect(person).toHaveTextContent(/\d+% booked\d+ visits?/)
  })
})
