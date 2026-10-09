import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { seed } from '../domain/seed'
import { dateLabel } from '../domain/format'
import { storageKey } from '../state/storage'

describe('Money receipts', { timeout: 20000 }, () => {
  it('files a receipt under the studio’s own day, the day its receipt gives it', async () => {
    // Paid at half past midnight in London on Tuesday, which is still Monday in UTC.
    const s = seed('UK')
    const latest = [...s.sales].sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0]
    latest.paidAt = '2026-10-05T23:30:00.000Z'
    localStorage.setItem(storageKey('UK'), JSON.stringify(s))
    render(
      <MemoryRouter initialEntries={['/business/money']}>
        <StoreProvider>
          <App />
        </StoreProvider>
      </MemoryRouter>,
    )
    const tuesday = await screen.findByRole(
      'region',
      { name: dateLabel('2026-10-06') },
      { timeout: 10000 },
    )
    expect(within(tuesday).getByText(new RegExp(`${latest.receiptNumber}\\b`))).toBeInTheDocument()
    const monday = screen.queryByRole('region', { name: dateLabel('2026-10-05') })
    if (monday)
      expect(within(monday).queryByText(new RegExp(`${latest.receiptNumber}\\b`))).toBeNull()
  })
})
