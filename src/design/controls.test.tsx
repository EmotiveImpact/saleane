import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  Button,
  Checkbox,
  Menu,
  MenuItem,
  Modal,
  MovingList,
  MovingRow,
  Notices,
  Select,
  Switch,
  Tip,
  notify,
} from '.'

afterEach(cleanup)

describe('Select', () => {
  it('opens its own list with the current choice ticked, and hands back the value chosen', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    render(
      <Select aria-label="Room" defaultValue="two" onChange={changed}>
        <option value="one">Treatment room 1</option>
        <option value="two">Treatment room 2</option>
        <optgroup label="Elsewhere">
          <option value="bar">The nail bar</option>
        </optgroup>
      </Select>,
    )
    const field = screen.getByRole('combobox', { name: 'Room' })
    expect(field).toHaveTextContent('Treatment room 2')
    await user.click(field)
    const list = await screen.findByRole('listbox')
    expect(screen.getByRole('option', { name: 'Treatment room 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('group', { name: 'Elsewhere' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'The nail bar' }))
    expect(list).not.toBeInTheDocument()
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ target: { value: 'bar' } }))
    expect(field).toHaveTextContent('The nail bar')
    expect(field).toHaveFocus()
  })

  it('gives a form the plain value, an empty choice included', async () => {
    const user = userEvent.setup()
    let form: HTMLFormElement | null = null
    render(
      <form ref={(node) => void (form = node)}>
        <Select aria-label="Who" name="who" defaultValue="maya">
          <option value="">Anyone</option>
          <option value="maya">Maya</option>
        </Select>
      </form>,
    )
    expect(new FormData(form!).get('who')).toBe('maya')
    await user.click(screen.getByRole('combobox', { name: 'Who' }))
    await user.click(await screen.findByRole('option', { name: 'Anyone' }))
    expect(new FormData(form!).get('who')).toBe('')
  })
})

describe('ticks and switches', () => {
  it('a tick is a checkbox a form reads, and a switch is heard as a switch', async () => {
    const user = userEvent.setup()
    const ticked = vi.fn()
    let form: HTMLFormElement | null = null
    render(
      <form ref={(node) => void (form = node)}>
        <label>
          <Checkbox name="hide" onChange={(event) => ticked(event.target.checked)} />
          Hide finished visits
        </label>
        <label>
          <Switch name="reminders" defaultChecked />
          Send reminders
        </label>
      </form>,
    )
    const tick = screen.getByRole('checkbox', { name: 'Hide finished visits' })
    const toggle = screen.getByRole('switch', { name: 'Send reminders' })
    expect(tick).not.toBeChecked()
    expect(toggle).toBeChecked()
    await user.click(screen.getByText('Hide finished visits'))
    expect(tick).toBeChecked()
    expect(ticked).toHaveBeenLastCalledWith(true)
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    const read = new FormData(form!)
    expect(read.get('hide')).toBe('on')
    expect(read.get('reminders')).toBeNull()
  })
})

function Shelf() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Menu
        label="More for the balm"
        trigger={<Button aria-label="More for the balm">More</Button>}
      >
        <MenuItem onSelect={() => setOpen(true)}>Correct the count</MenuItem>
        <MenuItem onSelect={() => {}}>Edit details</MenuItem>
      </Menu>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Correct the count"
        description="How many are on the shelf."
      >
        <input aria-label="Count" autoFocus />
      </Modal>
    </>
  )
}

describe('Menu', () => {
  it('opens by keyboard, moves with the arrows and gives focus back to its button', async () => {
    const user = userEvent.setup()
    render(<Shelf />)
    const button = screen.getByRole('button', { name: 'More for the balm' })
    button.focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: 'More for the balm' })
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Correct the count',
      'Edit details',
    ])
    await user.keyboard('{Escape}')
    expect(menu).not.toBeInTheDocument()
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('a pop-up opened from an item returns focus to the menu’s button when it closes', async () => {
    const user = userEvent.setup()
    render(<Shelf />)
    const button = screen.getByRole('button', { name: 'More for the balm' })
    await user.click(button)
    await user.click(await screen.findByRole('menuitem', { name: 'Correct the count' }))
    expect(await screen.findByRole('textbox', { name: 'Count' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(button).toHaveFocus())
  })
})

describe('Tip', () => {
  it('names an icon button on keyboard focus without replacing its own label', async () => {
    const user = userEvent.setup()
    render(
      <Tip label="Next week">
        <button aria-label="Next week">›</button>
      </Tip>,
    )
    await user.tab()
    const button = screen.getByRole('button', { name: 'Next week' })
    expect(button).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Next week')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
    expect(button).toHaveAccessibleName('Next week')
  })

  it('shows nothing extra when switched off', () => {
    render(
      <Tip label="Next week" disabled>
        <button>Next week</button>
      </Tip>,
    )
    expect(screen.getByRole('button', { name: 'Next week' })).not.toHaveAttribute('data-state')
  })
})

describe('notices', () => {
  it('say what happened in the corner, where screen readers hear it too', async () => {
    render(<Notices />)
    notify('Delivery of 6 recorded for Calming Cleansing Balm. 12 in stock.')
    const region = screen.getByRole('region', { name: 'Notices (F8)' })
    expect(region).toBeInTheDocument()
    expect(
      await screen.findAllByText('Delivery of 6 recorded for Calming Cleansing Balm. 12 in stock.'),
    ).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })
})

describe('MovingList', () => {
  it('without motion (reduced motion and tests) its rows are plain elements, shown at once', () => {
    render(
      <ul aria-label="Arrivals">
        <MovingList>
          <MovingRow as="li" key="a">
            Amelia Carter, 10:00
          </MovingRow>
          <MovingRow as="li" key="b">
            Theo Bennett, 11:30
          </MovingRow>
        </MovingList>
      </ul>,
    )
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      'Amelia Carter, 10:00',
      'Theo Bennett, 11:30',
    ])
    expect(rows[0]).not.toHaveAttribute('style')
  })
})
