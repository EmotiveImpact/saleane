import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Button, Empty, LoadingShapes, MoreOptions, photos } from '.'
import { Clients } from '../pages/Clients'
import { Waitlist } from '../pages/Waitlist'
import type { BusinessState } from '../domain/model'
import type { Role } from '../domain/operations'
import { createWorkspace } from '../domain/workspace'

// The quality bar (docs/DESIGN_LANGUAGE.md): lovely empty pages, calm loading and options
// tucked away until asked for, and a new studio never meeting a table or figures at zero.
let store: {
  state: BusinessState
  role: Role
  blocked: boolean
  saving: boolean
  commit: () => Promise<never>
}
vi.mock('../state/context', () => ({ useStore: () => store }))

function newStudio(patch: Partial<typeof store> = {}) {
  store = {
    state: createWorkspace({ name: 'Fernleaf Rooms', region: 'UK' }),
    role: 'owner',
    blocked: false,
    saving: false,
    commit: vi.fn(),
    ...patch,
  }
}

describe('the shared pieces', () => {
  it('gives a page with nothing in it a photograph, one line and one next step', () => {
    render(
      <Empty
        photo={photos.tea}
        eyebrow="Waitlist"
        level={1}
        title="Nobody is waiting yet."
        action={<Button>Add</Button>}
      >
        One line.
      </Empty>,
    )
    // The welcome stands in for the page header, so it carries the page's name and its heading.
    const heading = screen.getByRole('heading', { level: 1, name: 'Nobody is waiting yet.' })
    expect(heading.previousElementSibling).toHaveTextContent('Waitlist')
    // The words come first for screen readers; the photograph is decoration and is passed over.
    const picture = document.querySelector('.empty-picture img')
    expect(picture).toHaveAttribute('src', photos.tea)
    expect(picture).toHaveAttribute('alt', '')
    expect(document.querySelector('.empty-photo')?.firstElementChild).toHaveClass('empty-words')
    expect(screen.getByRole('button', { name: 'Add' })).toBeVisible()
  })
  it('keeps a small gap in a list to its words', () => {
    render(<Empty title="No clients match">Try another name.</Empty>)
    expect(document.querySelector('.empty-picture')).toBeNull()
    expect(document.querySelector('.empty-action')).toBeNull()
    expect(screen.getByRole('heading', { level: 3, name: 'No clients match' })).toBeVisible()
  })
  it('announces loading once and hides the shapes from screen readers', () => {
    render(<LoadingShapes kind="page" rows={3} label="Reading the change record…" />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Reading the change record…')
    expect(status.querySelectorAll('.loading-row')).toHaveLength(3)
    expect(status.querySelectorAll('.shape-tile')).toHaveLength(4)
    for (const shapes of status.querySelectorAll(':scope > div'))
      expect(shapes).toHaveAttribute('aria-hidden', 'true')
  })
  it('keeps rare options closed until asked for', async () => {
    const user = userEvent.setup()
    render(
      <MoreOptions label="More booking settings">
        <label>
          <input type="checkbox" /> A rare setting
        </label>
      </MoreOptions>,
    )
    const more = screen.getByText('More booking settings').closest('details')!
    expect(more.open).toBe(false)
    await user.click(screen.getByText('More booking settings'))
    expect(more.open).toBe(true)
  })
})

describe('a new studio', () => {
  it('meets one welcoming Clients page instead of an empty table', async () => {
    newStudio()
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Clients />
      </MemoryRouter>,
    )
    // The welcome takes the place of the page header: one heading, not two stacked titles.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Your clients will gather here.' }),
    ).toBeVisible()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Client segments' })).toBeNull()
    // One way to add a client, not a second copy in the header.
    expect(screen.queryByRole('button', { name: 'Add client' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Import clients' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Add your first client' }))
    expect(await screen.findByRole('dialog')).toBeVisible()
  })
  it('meets a welcoming waitlist instead of three figures at zero', () => {
    newStudio()
    render(
      <MemoryRouter>
        <Waitlist />
      </MemoryRouter>,
    )
    const page = document.querySelector('.waitlist-page') as HTMLElement
    expect(within(page).getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      within(page).getByRole('heading', { level: 1, name: 'Nobody is waiting yet.' }),
    ).toBeVisible()
    expect(screen.queryByText('Waiting now')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Add to the waitlist' })).toHaveLength(1)
  })
  it('offers no button while the studio is read only', () => {
    newStudio({ blocked: true })
    render(
      <MemoryRouter>
        <Waitlist />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'Add to the waitlist' })).toBeNull()
  })
})
