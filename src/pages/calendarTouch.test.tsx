import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'

async function show() {
  render(
    <MemoryRouter initialEntries={['/calendar']}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
  await waitFor(() =>
    expect(document.querySelector('.route-loading, .candidate-loading')).toBeNull(),
  )
}

const touch = (x: number, y: number) => ({
  pointerType: 'touch',
  pointerId: 7,
  button: 0,
  clientX: x,
  clientY: y,
})
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))

// Stage 6: on a tablet, a finger has to rest on a visit before it moves, so a swipe still scrolls.
describe('moving a visit with a finger', { timeout: 20000 }, () => {
  it('lets a swipe over a visit scroll, and picks the visit up only after a short hold', async () => {
    await show()
    const visit = document.querySelector<HTMLElement>('.calendar-event.event-movable')!
    expect(visit).not.toBeNull()

    // A swipe: the finger moves at once, so nothing is picked up and the page is left to scroll.
    fireEvent.pointerDown(visit, touch(100, 100))
    fireEvent.pointerMove(visit, touch(100, 140))
    await wait(400)
    expect(visit).not.toHaveClass('event-held')
    fireEvent.pointerUp(visit, touch(100, 140))

    // A hold: after a moment the visit lifts, ready to slide.
    fireEvent.pointerDown(visit, touch(100, 100))
    await wait(400)
    expect(visit).toHaveClass('event-held')
    fireEvent.pointerCancel(visit, touch(100, 100))
    await waitFor(() => expect(visit).not.toHaveClass('event-held'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('picks a visit up at once with a mouse, as before', async () => {
    await show()
    const visit = document.querySelector<HTMLElement>('.calendar-event.event-movable')!
    fireEvent.contextMenu(visit)
    fireEvent.pointerDown(visit, {
      pointerType: 'mouse',
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
    })
    // A mouse never waits for a hold, and never shows the held look meant for a finger.
    await wait(400)
    expect(visit).not.toHaveClass('event-held')
    fireEvent.pointerUp(visit, { pointerType: 'mouse', pointerId: 1, button: 0 })
  })
})
