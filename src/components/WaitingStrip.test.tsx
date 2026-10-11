import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'

// Today's phone strip: what waits on the desk, named near the top, each a jump to its card.
describe('the waiting strip on Today', { timeout: 20000 }, () => {
  it('names what is waiting and links each to its card further down', async () => {
    render(
      <MemoryRouter initialEntries={['/today']}>
        <StoreProvider>
          <App />
        </StoreProvider>
      </MemoryRouter>,
    )
    const strip = await screen.findByRole(
      'navigation',
      { name: 'Waiting on you' },
      { timeout: 8000 },
    )
    const links = within(strip).getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      const target = document.getElementById(link.getAttribute('href')!.slice(1))
      expect(target).not.toBeNull()
    }
    // It comes before the day's visits, so a phone meets it first.
    const day = screen.getByRole('heading', { name: 'The day ahead' })
    expect(strip.compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
