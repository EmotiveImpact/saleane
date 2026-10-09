import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { DayStrip } from './DayStrip'
import type { DayStripDay } from './DayStrip'

const days: DayStripDay[] = [
  { date: '2026-11-01', closed: true },
  { date: '2026-11-02', free: 4 },
  { date: '2026-11-03', free: 0 },
  { date: '2026-11-04', closed: true },
  { date: '2026-11-05', free: 1 },
  { date: '2026-11-06' },
]

function Strip({
  locale = 'en-GB',
  onMore,
  onPick = () => {},
}: {
  locale?: string
  onMore?: () => void
  onPick?: (date: string) => void
}) {
  const [value, setValue] = useState('2026-11-02')
  return (
    <DayStrip
      days={days}
      value={value}
      onChange={(date) => {
        setValue(date)
        onPick(date)
      }}
      locale={locale}
      label="Choose a day"
      today="2026-11-02"
      action={<button type="button">First available</button>}
      onMore={onMore}
    />
  )
}

test('each day says in words whether it is closed, full or how many times it has', () => {
  render(<Strip />)
  const group = screen.getByRole('radiogroup', { name: 'Choose a day' })
  expect(group).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Sunday 1 November, closed' })).toBeDisabled()
  expect(
    screen.getByRole('radio', { name: 'Today, Monday 2 November, 4 times free' }),
  ).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Tuesday 3 November, full' })).toBeEnabled()
  expect(screen.getByRole('radio', { name: 'Thursday 5 November, 1 time free' })).toBeEnabled()
  // A day whose count isn't known yet still reads as a day.
  expect(screen.getByRole('radio', { name: 'Friday 6 November' })).toBeEnabled()
  expect(screen.getByText('Today')).toBeInTheDocument()
  expect(screen.getAllByText('Closed')).toHaveLength(2)
  expect(screen.getByText('Full')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'First available' })).toBeInTheDocument()
})

test('the arrow keys move between days and pass over closed ones', async () => {
  const user = userEvent.setup()
  const onPick = vi.fn()
  render(<Strip onPick={onPick} />)
  await user.click(screen.getByRole('radio', { name: /Monday 2 November/ }))
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('radio', { name: 'Tuesday 3 November, full' })).toBeChecked()
  await user.keyboard('{ArrowRight}')
  // Wednesday is closed, so Thursday is next.
  expect(screen.getByRole('radio', { name: 'Thursday 5 November, 1 time free' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Thursday 5 November, 1 time free' })).toHaveFocus()
  expect(onPick).toHaveBeenLastCalledWith('2026-11-05')
  expect(onPick).not.toHaveBeenCalledWith('2026-11-04')
})

test('days are written in the studio’s locale, and more can be asked for', async () => {
  const user = userEvent.setup()
  const onMore = vi.fn()
  render(<Strip locale="en-US" onMore={onMore} />)
  expect(screen.getByRole('radio', { name: 'Tuesday, November 3, full' })).toBeInTheDocument()
  expect(screen.getByText('Nov 3')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'More dates' }))
  expect(onMore).toHaveBeenCalledOnce()
})
