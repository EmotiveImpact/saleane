import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { MoveDayStrip } from './MoveDayStrip'

const days = [
  { date: '2026-10-07', open: true },
  { date: '2026-10-08', open: true },
  { date: '2026-10-11', open: false },
]

test('names each day by weekday and date in the studio’s language, and closed days in words', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <MoveDayStrip
      days={days}
      value="2026-10-07"
      current="2026-10-07"
      locale="en-GB"
      label="Choose a day"
      onChange={onChange}
    />,
  )
  expect(screen.getByRole('group', { name: 'Choose a day' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Wed 7 Oct Your visit' })).toBeChecked()
  const closed = screen.getByRole('radio', { name: 'Sun 11 Oct Closed' })
  expect(closed).toBeDisabled()
  await user.click(closed)
  expect(onChange).not.toHaveBeenCalled()
  await user.click(screen.getByRole('radio', { name: /Thu 8 Oct/ }))
  expect(onChange).toHaveBeenCalledWith('2026-10-08')
  expect(screen.getByRole('button', { name: 'Earlier days' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Later days' })).toBeInTheDocument()
})

test('reads month before day for a studio in the United States', () => {
  render(
    <MoveDayStrip
      days={days}
      value="2026-10-08"
      locale="en-US"
      label="Choose a day"
      onChange={() => undefined}
    />,
  )
  expect(screen.getByRole('radio', { name: /^Thu Oct 8/ })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Sun Oct 11 Closed' })).toBeDisabled()
})
