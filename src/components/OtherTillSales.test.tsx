import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { OtherTillDialog, OtherTillRefunds, OtherTillRow } from './OtherTillSales'
import { dispatch } from '../domain/commands'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import { parseState } from '../domain/model'
import { operations } from '../domain/operations'
import { seed } from '../domain/seed'
import { otherTillSales } from '../domain/otherTill'

// Stage 5: a sale from another till says which till took the money and that SALEANE took none.
const now = '2026-10-06T12:00:00.000Z'
function studio() {
  const s = structuredClone(seed('UK'))
  s.operations = { ...s.operations!, mode: 'local' }
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object')
      for (const [key, item] of Object.entries(value)) {
        if (key === 'method' && typeof item === 'string' && item.startsWith('demo_'))
          (value as Record<string, unknown>)[key] = 'cash'
        else walk(item)
      }
  }
  walk(s)
  let next: BusinessState = parseState(s, s.organisation.region)
  const send = (command: Command) => {
    const result = dispatch(next, command, 'Shop till (access key)', now, {
      software: { keyId: 'key-1', name: 'Shop till' },
    })
    if (!result.ok) throw new Error(result.error)
    next = result.state
  }
  const serum = operations(next).products.find((p) => p.id === 'product-enzyme-peel')!
  const base = {
    locationId: next.organisation.locationId,
    occurredAt: '2026-10-06T10:30:00Z',
    staffId: next.staff[0].id,
  }
  send({
    type: 'other-till-sale',
    sale: {
      ...base,
      receipt: 'T-1',
      lines: [
        {
          kind: 'product',
          productId: serum.id,
          quantity: 3,
          totalMinor: 3600,
          taxMinor: 600,
          taxRateBps: 2000,
        },
        {
          kind: 'product',
          name: 'Gift bag',
          quantity: 1,
          totalMinor: 120,
          taxMinor: 20,
          taxRateBps: 2000,
        },
      ],
      payments: [{ method: 'card', amountMinor: 3720 }],
    },
  })
  send({
    type: 'other-till-refund',
    refund: {
      ...base,
      receipt: 'R-1',
      refundOf: 'T-1',
      reason: 'Bag was torn',
      lines: [
        {
          kind: 'product',
          name: 'Gift bag',
          quantity: 1,
          totalMinor: 120,
          taxMinor: 20,
          taxRateBps: 2000,
        },
      ],
      payments: [{ method: 'cash', amountMinor: 120 }],
    },
  })
  return next
}
const state = studio()
vi.mock('../state/context', () => ({ useStore: () => ({ state }) }))

test('a sale from another till names its till and never claims SALEANE took the money', async () => {
  const user = userEvent.setup()
  const [sale, refund] = otherTillSales(state)
  const open = vi.fn()
  render(<OtherTillRow sale={sale} onOpen={open} />)
  const row = screen.getByRole('button', { name: /Sold on Shop till/ })
  expect(row).toHaveTextContent('Card on another till · T-1')
  expect(row).toHaveTextContent('£1.20 given back')
  await user.click(row)
  expect(open).toHaveBeenCalled()
  render(<OtherTillDialog saleId={sale.id} onClose={() => {}} />)
  expect(screen.getByRole('dialog', { name: 'Sale from another till' })).toBeVisible()
  expect(
    screen.getByText(/SALEANE recorded it when that till sent it in and took no payment/),
  ).toBeVisible()
  expect(screen.getByText('Gift bag (not on your menu)')).toBeVisible()
  // The shelf held fewer than were sold, so the team is asked to count it.
  expect(screen.getByText(/not on SALEANE’s count\. Count the shelf when you can\./)).toBeVisible()
  expect(screen.queryByText(/Card through SALEANE|payment provider confirmed/)).toBeNull()
  render(<OtherTillRefunds onOpen={open} />)
  expect(
    screen.getByRole('button', { name: /Given back on Shop till · Bag was torn/ }),
  ).toHaveTextContent(`Receipt ${refund.receipt}`)
})
