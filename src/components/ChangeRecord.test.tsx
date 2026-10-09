import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ChangeRecord } from './ChangeRecord'
import { api } from '../state/api'
import { seed } from '../domain/seed'
import type { ChangeEntry } from '../domain/changeRecord'

// NEXT-05: who changed what, for the owner.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const state = seed('UK')
let mode = 'server'
vi.mock('../state/context', () => ({
  useStore: () => ({ mode, state, role: 'owner', today: '2026-10-06', blocked: false }),
}))
const base = `/api/workspaces/${state.organisation.id}/changes`
const change = (id: string, at: string, extra: Partial<ChangeEntry> = {}): ChangeEntry => ({
  id,
  at: Date.parse(at),
  who: 'Ada Owner',
  person: true,
  group: 'settings',
  what: 'Changed a treatment',
  about: 'Skin Renewal Facial',
  lines: [{ what: 'price', from: '£95.00', to: '£105.00' }],
  others: [],
  ...extra,
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'))
})
afterEach(() => {
  vi.useRealTimers()
  mode = 'server'
  vi.resetAllMocks()
})

test('lists changes under the studio’s days, filters by person, and pages back', async () => {
  const user = userEvent.setup()
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === `${base}?`)
      return {
        entries: [
          change('a', '2026-10-06T08:05:00.000Z'),
          change('b', '2026-10-05T22:30:00.000Z', {
            who: 'A guest booking online',
            person: false,
            group: 'visits',
            what: 'Booked online',
            about: 'Amelia Carter, Skin Renewal Facial, Thu 8 Oct at 10:00',
            lines: [],
          }),
        ],
        next: '1.2',
        people: [{ id: 'account-max', name: 'Max Manager' }],
      } as never
    if (path === `${base}?before=1.2`)
      return {
        entries: [
          change('c', '2026-10-04T10:00:00.000Z', {
            what: 'Changed a client’s details',
            about: 'Amelia Carter',
            lines: [],
            others: ['email', 'phone'],
          }),
        ],
        next: null,
      } as never
    if (path === `${base}?who=account-max`) return { entries: [], next: null, people: [] } as never
    throw new Error(`Unexpected route ${path}`)
  })
  render(<ChangeRecord />)
  const today = (await screen.findByRole('heading', { name: 'Today' })).parentElement!
  expect(within(today).getByText('Changed a treatment')).toBeInTheDocument()
  expect(within(today).getByText('09:05')).toBeInTheDocument()
  expect(within(today).getByText('By Ada Owner')).toBeInTheDocument()
  expect(within(today).getByText('£105.00').closest('li')).toHaveTextContent(
    'Price £95.00 became £105.00',
  )
  // 22:30 in London on 5 October, not the next day as it would be by the clock in UTC.
  const fifth = screen.getByRole('heading', { name: '5 October 2026' }).parentElement!
  expect(within(fifth).getByText('A guest booking online')).toBeInTheDocument()
  expect(within(fifth).getByText('23:30')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Show older changes' }))
  expect(await screen.findByText('Changed email and phone')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Show older changes' })).toBeNull()

  await user.selectOptions(screen.getByLabelText('Who'), 'Max Manager')
  expect(
    await screen.findByText('No changes match. Try everyone, everything or a later day.'),
  ).toBeInTheDocument()
})

test('says the browser demo keeps no change record', () => {
  mode = 'demo'
  render(<ChangeRecord />)
  expect(screen.getByText(/browser demo keeps no change record/)).toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
})
