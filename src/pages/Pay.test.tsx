import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Pay } from './Pay'
import { seed } from '../domain/seed'
import { money } from '../domain/format'
import { operations } from '../domain/operations'
import { rentStatement } from '../domain/rent'

// The sample studio as the demo shows it. Theo rents his chair from 21 September, so his visits
// since then are his own takings and earn no commission.
const state = seed('UK', { regulars: true })
vi.mock('../state/context', () => ({
  useStore: () => ({ state, role: 'owner', mode: 'demo', blocked: false, commit: vi.fn() }),
}))

const completed = (staffId: string, from: string, to: string) =>
  state.appointments.filter(
    (a) => a.staffId === staffId && a.status === 'completed' && a.date >= from && a.date <= to,
  ).length
const summary = (name: string) =>
  within(screen.getByRole('region', { name: 'Each person' }))
    .getByText(name, { selector: 'strong' })
    .parentElement!.querySelector('small')!

describe('Pay', () => {
  it('counts the visits of someone renting a chair, though they earn no commission', async () => {
    render(
      <MemoryRouter>
        <Pay />
      </MemoryRouter>,
    )
    const october = completed('staff-theo', '2026-10-01', '2026-10-06')
    expect(october).toBeGreaterThan(0)
    expect(summary('Theo Bennett')).toHaveTextContent(
      `${october} visits while renting · Rents a chair or room, keeps own takings`,
    )
    expect(summary('Maya Lewis')).toHaveTextContent(
      new RegExp(`^${completed('staff-maya', '2026-10-01', '2026-10-06')} visits · `),
    )
    // September: on commission until he started renting on the 21st.
    await userEvent.click(screen.getByRole('radio', { name: 'Last month' }))
    const before = completed('staff-theo', '2026-09-01', '2026-09-20')
    const after = completed('staff-theo', '2026-09-21', '2026-09-30')
    expect(before * after).toBeGreaterThan(0)
    expect(summary('Theo Bennett')).toHaveTextContent(
      `${before} visits on commission, ${after} while renting`,
    )
  })

  it('shows the fixed rent owed and the share still running for the week', () => {
    render(
      <MemoryRouter>
        <Pay />
      </MemoryRouter>,
    )
    const rental = operations(state).rentals!.find((r) => r.staffId === 'staff-theo')!
    const week = rentStatement(state, rental).at(-1)!
    // The sample's rent is a fixed amount a week plus a share of treatments, with this week running.
    expect(week.open && week.owedMinor > 0 && week.runningMinor > 0).toBe(true)
    const panel = within(screen.getByRole('region', { name: 'Chair and room rent' }))
    const owed = panel.getByText(`${money(week.owedMinor, state.organisation, true)} owed`, {
      exact: false,
    })
    expect(owed).toHaveTextContent(
      `${money(week.runningMinor, state.organisation, true)} more so far this week`,
    )
  })
})
