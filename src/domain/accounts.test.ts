import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can, permissionFor } from './operations'
import { seed } from './seed'
import {
  accountingPayload,
  dailySummary,
  dayJournal,
  dayTakings,
  monthOf,
  moneyCsv,
  moneyInAndOut,
  salesByReceipt,
  taxSummary,
} from './accounts'
import { serviceRevenue } from './selectors'
import { retailRevenue } from './retail'
import { recordDay } from './tillCount'

// V2: exports for the accountant and a test-mode link to Xero and QuickBooks.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `acc-${++sequence}`)
}
const september = { from: '2026-09-01', to: '2026-09-30' }

describe('accounts', () => {
  it('lists every receipt by the day it was paid, with and without a visit', () => {
    const s = seed('UK')
    const rows = salesByReceipt(s, '2026-09-01', '2026-10-06')
    const sales = s.sales.filter((x) => recordDay(s, x.paidAt) <= '2026-10-06')
    expect(rows.filter((r) => r.receipt.startsWith('SC-'))).toHaveLength(1)
    expect(rows.reduce((t, r) => t + r.servicesMinor, 0)).toBe(
      sales
        .filter((x) => recordDay(s, x.paidAt) >= '2026-09-01')
        .reduce((t, x) => t + serviceRevenue(x), 0),
    )
  })

  it('records money in and out with refunds negative and demo payments marked', () => {
    const s = seed('UK')
    const rows = moneyInAndOut(s, september.from, september.to)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.test || r.kind === 'Chair or room rent')).toBe(true)
    // Stage 3: Theo's rent has a share of his takings, so each week is paid once it has ended.
    expect(rows.filter((r) => r.kind === 'Chair or room rent')).toHaveLength(1)
    expect(
      moneyInAndOut(s, september.from, '2026-10-06').filter((r) => r.kind === 'Chair or room rent'),
    ).toHaveLength(2)
    expect(moneyCsv(rows, 'GBP').split('\n')[0]).toContain('Amount (GBP)')
  })

  it('adds up tax by rate and keeps the day summary consistent with the receipts', () => {
    const s = seed('US')
    const tax = taxSummary(s, september.from, september.to)
    const receipts = salesByReceipt(s, september.from, september.to)
    expect(tax.reduce((t, r) => t + r.taxMinor, 0)).toBe(
      receipts.reduce((t, r) => t + r.taxMinor, 0),
    )
    const days = dailySummary(s, september.from, september.to)
    expect(days.reduce((t, d) => t + d.tipsMinor, 0)).toBe(
      receipts.reduce((t, r) => t + r.tipMinor, 0),
    )
    expect(days.reduce((t, d) => t + d.productsMinor, 0)).toBe(
      receipts.reduce((t, r) => t + r.productsMinor, 0),
    )
  })

  it('turns each day into a balanced journal against the takings clearing account', () => {
    const s = seed('UK')
    const codes = s.operations!.accounting!.codes
    for (const day of dailySummary(s, september.from, '2026-10-06')) {
      const lines = dayJournal(day, codes)
      const debit = lines.reduce((t, l) => t + l.debitMinor, 0)
      const credit = lines.reduce((t, l) => t + l.creditMinor, 0)
      expect(debit).toBe(credit)
      const clearing = lines.find((l) => l.account === 'Takings clearing')
      expect((clearing?.debitMinor ?? 0) - (clearing?.creditMinor ?? 0)).toBe(dayTakings(day))
    }
    const refundDay = { ...dailySummary(s, september.from, september.to)[0], refundsMinor: 1e7 }
    const lines = dayJournal(refundDay, codes)
    expect(lines[0]).toMatchObject({ account: 'Takings clearing', debitMinor: 0 })
  })

  it('prepares Xero and QuickBooks batches in their own shapes', () => {
    const s = seed('UK')
    const codes = s.operations!.accounting!.codes
    const all = dailySummary(s, september.from, september.to)
    const empty = all.filter((day) => !dayJournal(day, codes).length)
    expect(empty.length).toBeGreaterThan(0)
    const days = [empty[0], ...all.filter((day) => dayJournal(day, codes).length).slice(0, 2)]
    const xero = accountingPayload('xero', days, codes, 'GBP', 'Atelier House') as {
      ManualJournals: { JournalLines: { LineAmount: number }[] }[]
    }
    expect(xero.ManualJournals).toHaveLength(2)
    for (const journal of xero.ManualJournals)
      expect(journal.JournalLines.reduce((t, l) => t + Math.round(l.LineAmount * 100), 0)).toBe(0)
    const qb = accountingPayload('quickbooks', days, codes, 'GBP', 'Atelier House') as {
      JournalEntries: { Line: { JournalEntryLineDetail: { PostingType: string } }[] }[]
    }
    expect(qb.JournalEntries[0].Line[0].JournalEntryLineDetail.PostingType).toBe('Debit')
  })

  it('logs a prepared batch as test mode, and only with the codes filled in', () => {
    const s = seed('UK')
    const command = {
      type: 'accounting-export',
      provider: 'xero',
      ...september,
    } as Command
    const result = dispatch(s, command, 'Ava · owner', now)
    if (!result.ok) throw new Error(result.error)
    const batch = result.state.operations!.accountingExports!.at(-1)!
    expect(batch).toMatchObject({ mode: 'test', provider: 'xero', actor: 'Ava · owner' })
    expect(batch.takingsMinor).toBe(
      dailySummary(s, september.from, september.to).reduce((t, d) => t + dayTakings(d), 0),
    )
    expect(run(s, { ...command, provider: 'quickbooks' } as Command).ok).toBe(false)
    const blank = structuredClone(s)
    blank.operations!.accounting!.codes.clearing = ''
    expect(run(blank, command).ok).toBe(false)
  })

  it('lets only the owner change the software, and owners and managers prepare batches', () => {
    expect(can('owner', permissionFor({ type: 'accounting-settings' }))).toBe(true)
    expect(can('manager', permissionFor({ type: 'accounting-settings' }))).toBe(false)
    expect(can('manager', permissionFor({ type: 'accounting-export' }))).toBe(true)
    expect(can('reception', permissionFor({ type: 'accounting-export' }))).toBe(false)
  })

  it('finds this month and last month', () => {
    expect(monthOf('2026-10-06')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(monthOf('2026-03-31', 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthOf('2026-01-15', 1)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('counts products before tax the same way as Business', () => {
    const s = seed('UK')
    const rows = salesByReceipt(s, '2026-01-01', '2026-12-31')
    const expected =
      s.sales.reduce((t, x) => t + retailRevenue(x), 0) +
      (s.counterSales ?? []).reduce((t, x) => t + retailRevenue(x), 0)
    expect(rows.reduce((t, r) => t + r.productsMinor, 0)).toBe(expected)
  })
})
