import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { BusinessState } from '../domain/model'
import { DEMO_DATE } from '../domain/model'
import { seed, FULL_DAY } from '../domain/seed'
import { operations } from '../domain/operations'
import type { Role } from '../domain/operations'
import { NeedsYou } from './NeedsYou'
import { Calendar } from '../pages/Calendar'
import { Business } from '../pages/Business'

// Stage 6: the small moments, on the screens where they appear, from a studio record alone.
let store: {
  state: BusinessState
  today: string
  role: Role
  branch: string | null
  blocked: boolean
  saving: boolean
  mode: 'demo' | 'server'
  connection: 'online'
  reload: () => Promise<void>
  commit: () => Promise<never>
}
vi.mock('../state/context', () => ({ useStore: () => store }))

function use(state: BusinessState, role: Role = 'owner') {
  store = {
    state,
    today: DEMO_DATE,
    role,
    branch: null,
    blocked: false,
    saving: false,
    mode: 'demo',
    connection: 'online',
    reload: async () => {},
    commit: async () => {
      throw new Error('Nothing is saved in these tests.')
    },
  }
}
const at = (route: string, page: ReactNode) =>
  render(<MemoryRouter initialEntries={[route]}>{page}</MemoryRouter>)

/**
 * The sample day at 10:45 with its calls returned or followed up, its colour visits moved away and Noor, who
 * tapped "I've arrived", not here yet.
 */
function quietSample() {
  const s = seed('UK')
  s.operations = {
    ...operations(s),
    missedCalls: (operations(s).missedCalls ?? []).map((call) => ({
      ...call,
      calledBackAt: '2026-10-06T09:00:00.000Z',
    })),
    answeredCalls: (operations(s).answeredCalls ?? []).map((call) => ({
      ...call,
      doneAt: '2026-10-06T09:45:00.000Z',
    })),
  }
  for (const a of s.appointments) if (a.serviceId === 'service-gloss') a.status = 'cancelled'
  delete s.appointments.find((a) => a.id === 'visit-noor')!.guestHereAt
  return s
}

describe('All in hand', () => {
  beforeEach(() => use(quietSample()))
  it('gives way to a still room once nothing waits and everyone due has been welcomed', async () => {
    const user = userEvent.setup()
    at('/today', <NeedsYou />)
    const calm = screen.getByRole('region', { name: 'All in hand' })
    expect(
      within(calm).getByText('Everyone due so far has been welcomed, and nothing is waiting.'),
    ).toBeInTheDocument()
    // Logging a call or adding a reminder stays one tap away.
    await user.click(
      within(calm).getByRole('button', { name: 'Add a reminder or log a missed call' }),
    )
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Reminders' })).toBeInTheDocument()
  })
  it('never shows while a call waits', () => {
    const s = seed('UK')
    for (const a of s.appointments) if (a.serviceId === 'service-gloss') a.status = 'cancelled'
    use(s)
    at('/today', <NeedsYou />)
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'All in hand' })).not.toBeInTheDocument()
  })
  it('never shows while a guest is late, or waiting at the desk to be welcomed', () => {
    const late = quietSample()
    late.appointments.find((a) => a.id === 'visit-noor')!.startMinutes = 630
    use(late)
    const { unmount } = at('/today', <NeedsYou />)
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeInTheDocument()
    unmount()
    const waiting = quietSample()
    waiting.appointments.find((a) => a.id === 'visit-noor')!.guestHereAt =
      '2026-10-06T09:40:00.000Z'
    use(waiting)
    at('/today', <NeedsYou />)
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeInTheDocument()
  })
})

describe('Fully booked, and a pause', { timeout: 20000 }, () => {
  it('says the day is fully booked once, and lets the empty-time guides go', () => {
    use(seed('UK', { regulars: true }))
    const { container } = at(`/calendar?date=${FULL_DAY}`, <Calendar />)
    expect(screen.getByRole('status')).toHaveTextContent('Fully booked. Beautifully done.')
    expect(container.querySelector('.calendar-grid')).toHaveClass('is-full')
    // A pause between two of Maya's visits is drawn, and its time still books exactly as before.
    expect(container.querySelectorAll('.calendar-pause').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Book with Maya Lewis from 11:45' })).toBeVisible()
  })
  it('stays quiet on a day with time left', () => {
    use(seed('UK', { regulars: true }))
    const { container } = at(`/calendar?date=${DEMO_DATE}`, <Calendar />)
    expect(screen.queryByText('Fully booked. Beautifully done.')).not.toBeInTheDocument()
    expect(container.querySelector('.calendar-grid')).not.toHaveClass('is-full')
    // Maya has a quarter of an hour between two visits this morning.
    expect(
      [...container.querySelectorAll('.calendar-pause')].map((pause) => pause.textContent),
    ).toContain('A pause')
  })
  it('never says it about a day that has passed', () => {
    const s = seed('UK', { regulars: true })
    use(s)
    store.today = '2026-10-13'
    at(`/calendar?date=${FULL_DAY}`, <Calendar />)
    expect(screen.queryByText('Fully booked. Beautifully done.')).not.toBeInTheDocument()
  })
})

describe('The closing ledger', { timeout: 20000 }, () => {
  /** Every visit today checked out by cash, as the desk would. */
  function settled() {
    const s = seed('UK')
    const model = s.sales[0]
    for (const a of s.appointments.filter((x) => x.date === DEMO_DATE)) {
      if (a.status === 'completed' || a.status === 'cancelled' || a.status === 'no_show') continue
      a.status = 'completed'
      s.sales.push({
        ...model,
        id: `sale-close-${a.id}`,
        appointmentId: a.id,
        serviceMinor: a.bookedPriceMinor,
        tipMinor: 0,
        totalMinor: a.bookedPriceMinor,
        balanceMinor: a.bookedPriceMinor - a.bookedDepositMinor,
        depositAppliedMinor: a.bookedDepositMinor,
        method: 'cash',
      })
    }
    return s
  }
  it('keeps "Before you close." while visits are open', () => {
    use(seed('UK'))
    at('/business', <Business />)
    expect(screen.getByRole('heading', { name: 'Before you close.' })).toBeInTheDocument()
    expect(screen.getByText(/10 of today’s 12 visits still to check out\./)).toBeInTheDocument()
    expect(screen.queryByText('Studio closed. See you tomorrow.')).not.toBeInTheDocument()
  })
  it('reads like a printed ledger once the day is settled', () => {
    use(settled())
    at('/business', <Business />)
    expect(screen.getByRole('heading', { name: 'The day is settled.' })).toBeInTheDocument()
    const ledger = screen.getByText('Guests seen').closest('dl')!
    expect([...ledger.querySelectorAll('dt')].map((term) => term.textContent)).toEqual([
      'Guests seen',
      'First-time guests',
      'Rebooked before leaving',
      'Treatment takings recorded',
      'Products sold, before tax',
      'Tips recorded',
    ])
    expect(within(ledger).getByText('12')).toBeInTheDocument()
    // Theo rents his chair, so his own takings are named as left out.
    expect(screen.getByText(/Renters’ own takings, £[\d,.]+, are left out\./)).toBeInTheDocument()
    expect(screen.getByText('Nothing is booked for tomorrow yet.')).toBeInTheDocument()
    expect(screen.getByText('Studio closed. See you tomorrow.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/charged|processed/i)
  })
})
