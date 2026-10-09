import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AreaHome } from './AreaHome'
import { api } from '../state/api'
import { seed } from '../domain/seed'
import { DEMO_DATE } from '../domain/model'
import { execute } from '../domain/commands'
import { operations } from '../domain/operations'
import { areaView } from '../domain/area'

vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const session = {
  user: { id: 'account-priya', name: 'Priya Shah', email: 'priya@example.invalid' },
}
vi.mock('../state/context', () => ({
  useStore: () => ({
    session,
    refreshSession: async () => session,
    openWorkspace: vi.fn(),
    connection: 'online',
  }),
}))

/** The sample studio with its one location in a region called Somerset. */
function areaRecord() {
  const studio = seed('UK')
  const grouped = execute(studio, {
    type: 'region',
    input: { name: 'Somerset', locationIds: [studio.organisation.locationId] },
  })
  if (!grouped.ok) throw new Error(grouped.error)
  const regionId = operations(grouped.state).regions![0].id
  return {
    id: studio.organisation.id,
    role: 'regional',
    view: 'area',
    area: areaView(grouped.state, regionId, DEMO_DATE),
  }
}
function view(orgId: string) {
  return render(
    <MemoryRouter initialEntries={[`/area/${orgId}`]}>
      <Routes>
        <Route path="/area/:orgId" element={<AreaHome />} />
      </Routes>
    </MemoryRouter>,
  )
}
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

test('greets the regional manager by their own first name, not the region', async () => {
  // 09:30 in London.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T08:30:00Z'))
  const record = areaRecord()
  vi.mocked(api).mockResolvedValue(record as never)
  view(record.id)
  expect(await screen.findByRole('heading', { level: 1, name: /^Good morning/ })).toHaveTextContent(
    'Good morning, Priya.',
  )
  expect(screen.queryByText(/Good morning, Somerset/)).not.toBeInTheDocument()
  // The region is still named beside the studio.
  expect(screen.getByText('Regional manager · Somerset')).toBeInTheDocument()
})
