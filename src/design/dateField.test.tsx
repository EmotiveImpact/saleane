import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateField, TimeField, writtenDate } from '.'

function Controlled({
  start = '2026-11-03',
  locale = 'en-GB',
  onPick = () => {},
  min,
  max,
}: {
  start?: string
  locale?: string
  onPick?: (date: string) => void
  min?: string
  max?: string
}) {
  const [date, setDate] = useState(start)
  return (
    <label>
      Date
      <DateField
        value={date}
        locale={locale}
        today="2026-10-06"
        min={min}
        max={max}
        onChange={(next) => {
          setDate(next)
          onPick(next)
        }}
      />
    </label>
  )
}

describe('DateField', () => {
  it('writes the date out the studio’s way, whatever the browser’s language', () => {
    render(<Controlled />)
    expect(screen.getByLabelText('Date')).toHaveTextContent('Tue 3 Nov 2026')
    expect(screen.queryByText('11/03/2026')).not.toBeInTheDocument()
    expect(writtenDate('2026-11-03', 'en-US')).toBe('Tue, Nov 3, 2026')
    expect(writtenDate('2026-11-03', 'en-GB', 'long')).toBe('Tuesday 3 November 2026')
  })

  it('opens on the chosen day and is chosen from with the keyboard', async () => {
    const user = userEvent.setup()
    const picked = vi.fn()
    render(<Controlled onPick={picked} />)
    const trigger = screen.getByLabelText('Date')
    await user.click(trigger)
    const calendar = screen.getByRole('dialog', { name: 'Choose a date' })
    expect(within(calendar).getByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    expect(within(calendar).getByRole('button', { name: 'Tuesday 3 November 2026' })).toHaveFocus()
    // A day on, a week on, back to the start of the week (a Monday in the UK), then a month on.
    await user.keyboard('{ArrowRight}{ArrowDown}{Home}')
    expect(within(calendar).getByRole('button', { name: 'Monday 9 November 2026' })).toHaveFocus()
    await user.keyboard('{PageDown}')
    expect(within(calendar).getByRole('heading', { name: 'December 2026' })).toBeInTheDocument()
    expect(
      within(calendar).getByRole('button', { name: 'Wednesday 9 December 2026' }),
    ).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(picked).toHaveBeenCalledWith('2026-12-09')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveTextContent('Wed 9 Dec 2026')
    expect(trigger).toHaveFocus()
  })

  it('marks today, offers it in one tap and starts the week as the locale does', async () => {
    const user = userEvent.setup()
    const picked = vi.fn()
    render(<Controlled locale="en-US" onPick={picked} start="2026-10-20" />)
    await user.click(screen.getByLabelText('Date'))
    const calendar = screen.getByRole('dialog', { name: 'Choose a date' })
    expect(within(calendar).getAllByRole('columnheader')[0]).toHaveAttribute('abbr', 'Sunday')
    expect(
      within(calendar).getByRole('button', { name: 'Tuesday, October 6, 2026' }),
    ).toHaveAttribute('aria-current', 'date')
    expect(
      within(calendar).getByRole('button', { name: 'Tuesday, October 20, 2026' }).closest('td'),
    ).toHaveAttribute('aria-selected', 'true')
    await user.click(within(calendar).getByRole('button', { name: /^Today/ }))
    expect(picked).toHaveBeenCalledWith('2026-10-06')
  })

  it('keeps to the earliest and latest dates allowed', async () => {
    const user = userEvent.setup()
    render(<Controlled start="2026-10-07" min="2026-10-06" max="2026-11-05" />)
    await user.click(screen.getByLabelText('Date'))
    const calendar = screen.getByRole('dialog', { name: 'Choose a date' })
    expect(within(calendar).getByRole('button', { name: 'Previous month' })).toBeDisabled()
    expect(within(calendar).getByRole('button', { name: 'Monday 5 October 2026' })).toBeDisabled()
    await user.keyboard('{ArrowUp}')
    expect(within(calendar).getByRole('button', { name: 'Tuesday 6 October 2026' })).toHaveFocus()
    await user.keyboard('{PageDown}{PageDown}')
    expect(within(calendar).getByRole('button', { name: 'Thursday 5 November 2026' })).toHaveFocus()
    expect(within(calendar).getByRole('button', { name: 'Next month' })).toBeDisabled()
  })

  it('submits an ISO date in a form and tells the form when it changes', async () => {
    const user = userEvent.setup()
    const changes: string[] = []
    const submitted: string[] = []
    render(
      <form
        onChange={(event) =>
          changes.push(String(new FormData(event.currentTarget).get('date') ?? ''))
        }
        onSubmit={(event) => {
          event.preventDefault()
          submitted.push(String(new FormData(event.currentTarget).get('date')))
        }}
      >
        <label>
          Day off
          <DateField name="date" required locale="en-GB" today="2026-10-06" />
        </label>
        <button type="submit">Save</button>
      </form>,
    )
    expect(screen.getByLabelText('Day off')).toHaveTextContent('Choose a date')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(submitted).toEqual([])
    expect(screen.getByLabelText('Day off')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Day off')).toHaveFocus()
    await user.click(screen.getByLabelText('Day off'))
    await user.click(screen.getByRole('button', { name: 'Wednesday 7 October 2026' }))
    expect(changes).toEqual(['2026-10-07'])
    expect(screen.getByLabelText('Day off')).not.toHaveAttribute('aria-invalid')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(submitted).toEqual(['2026-10-07'])
  })
})

describe('TimeField', () => {
  it('lists times at a step, 24-hour in the UK and 12-hour in the US', async () => {
    const user = userEvent.setup()
    const picked = vi.fn()
    const { rerender } = render(
      <TimeField aria-label="Closes" locale="en-GB" value="18:00" onChange={picked} />,
    )
    const field = screen.getByRole('combobox', { name: 'Closes' })
    expect(within(field).getByRole('option', { name: '18:00' })).toHaveProperty('selected', true)
    expect(within(field).getAllByRole('option')).toHaveLength(96)
    await user.selectOptions(field, '17:30')
    expect(picked).toHaveBeenCalledWith('17:30')
    rerender(<TimeField aria-label="Closes" locale="en-US" value="18:00" onChange={picked} />)
    expect(within(field).getByRole('option', { name: '06:00 PM' })).toHaveProperty('selected', true)
  })

  it('keeps a saved time that sits off the step, and submits HH:MM in a form', () => {
    let data: FormData | undefined
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault()
          data = new FormData(event.currentTarget)
        }}
      >
        <TimeField aria-label="Starts" name="start" locale="en-GB" defaultValue="09:10" step={30} />
        <button type="submit">Save</button>
      </form>,
    )
    const field = screen.getByRole('combobox', { name: 'Starts' })
    expect(within(field).getByRole('option', { name: '09:10' })).toHaveProperty('selected', true)
    expect(within(field).getByRole('option', { name: '09:30' })).toBeInTheDocument()
    screen.getByRole('button', { name: 'Save' }).click()
    expect(data?.get('start')).toBe('09:10')
  })
})
