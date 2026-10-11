import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { StudioSetup } from './StudioSetup'
import { execute } from '../domain/commands'
import type { Command, CommandResult } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import type { Role } from '../domain/operations'
import { operations } from '../domain/operations'
import { createWorkspace } from '../domain/workspace'

// "Set up your studio": one job per screen, saved on Continue, picked up where it was left.
type Shown = {
  state: BusinessState
  role: Role
  mode: 'demo' | 'server'
  blocked: boolean
  slug: string
  session: { user: { name: string } }
  commit: (command: Command) => Promise<CommandResult>
}
let store: Shown
vi.mock('../state/context', () => ({ useStore: () => store }))
const commit = vi.fn(async (command: Command): Promise<CommandResult> => {
  const result = execute(store.state, command, '2026-10-06T08:00:00.000Z', () =>
    crypto.randomUUID(),
  )
  if (result.ok) store.state = result.state
  return result
})
function show(state: BusinessState, role: Role = 'owner') {
  store = {
    state,
    role,
    mode: 'server',
    blocked: false,
    slug: 'linden-studio',
    session: { user: { name: 'Amara Okafor' } },
    commit,
  }
  return render(
    <MemoryRouter initialEntries={['/setup']}>
      <Routes>
        <Route path="/setup" element={<StudioSetup />} />
        <Route path="/today" element={<p>Today</p>} />
      </Routes>
    </MemoryRouter>,
  )
}
const fresh = () => createWorkspace({ name: 'Linden Studio', region: 'UK', locationName: 'Bath' })
const heading = () => screen.getByRole('heading', { level: 1 })
const next = () => screen.getByRole('button', { name: 'Continue' })

afterEach(() => vi.clearAllMocks())

describe('Set up your studio', () => {
  it('saves each screen on Continue and moves on', async () => {
    show(fresh())
    expect(heading()).toHaveTextContent('Where guests find you')
    expect(screen.getByText('Step 1 of 8')).toBeInTheDocument()
    // Continue waits for the address and says why.
    expect(next()).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Add your address so guests can find you.')
    await userEvent.type(screen.getByLabelText('Address'), '12 Milsom Street, Bath')
    await userEvent.click(next())
    expect(commit).toHaveBeenCalledWith({
      type: 'setup-step',
      next: 'hours',
      changes: [
        expect.objectContaining({ type: 'organisation', address: '12 Milsom Street, Bath' }),
      ],
    })
    expect(heading()).toHaveTextContent('When you are open')
    expect(heading()).toHaveFocus()
    expect(operations(store.state).setup).toEqual({ next: 'hours' })
  })

  it('adds a common treatment with its length, leaving the price to the owner', async () => {
    const s = fresh()
    show({ ...s, operations: { ...s.operations!, setup: { next: 'treatments' } } })
    expect(heading()).toHaveTextContent('What you offer')
    await userEvent.click(screen.getByRole('radio', { name: 'Skin' }))
    await userEvent.click(screen.getByRole('button', { name: /Signature facial/ }))
    const row = screen.getByRole('list', { name: 'Your treatments' })
    expect(within(row).getByLabelText('Treatment')).toHaveValue('Signature facial')
    expect(within(row).getByLabelText('Price (GBP)')).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('Add a price for Signature facial.')
    await userEvent.type(within(row).getByLabelText('Price (GBP)'), '85')
    await userEvent.click(next())
    expect(store.state.services).toMatchObject([
      {
        name: 'Signature facial',
        priceMinor: 8500,
        durationMinutes: 60,
        resourceType: 'treatment',
      },
    ])
    expect(heading()).toHaveTextContent('Who does what')
  })

  it('picks up where the owner left off, and Back never loses a saved screen', async () => {
    const s = fresh()
    show({ ...s, operations: { ...s.operations!, setup: { next: 'look' } } })
    expect(heading()).toHaveTextContent('How your booking page looks')
    expect(screen.getByText('Step 6 of 8')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(heading()).toHaveTextContent('Where treatments happen')
    expect(operations(store.state).setup).toEqual({ next: 'look' })
  })

  it('asks before leaving an unfinished screen, and keeps the finished ones', async () => {
    show(fresh())
    await userEvent.type(screen.getByLabelText('Phone for guests (optional)'), '01632 960 120')
    await userEvent.click(screen.getByRole('button', { name: 'Finish later' }))
    expect(commit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('This screen is not finished')
    await userEvent.click(screen.getByRole('button', { name: 'Leave without saving this screen' }))
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('is only for the owner', () => {
    show(fresh(), 'manager')
    expect(screen.getByText('Today')).toBeInTheDocument()
  })
})
