import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReceiptSlip } from './ReceiptSlip'
import { printReceipt } from './printReceipt'
import { PaperPreview, ReceiptActions } from './ReceiptActions'
import { api } from '../state/api'
import { execute } from '../domain/commands'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import type { Receipt } from '../domain/receipt'
import { createWorkspace } from '../domain/workspace'
import { seed } from '../domain/seed'

// Stage 2: the receipt as a till roll, printed on its own, and its buttons.
vi.mock('../state/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/api')>()),
  api: vi.fn(),
}))
const store = { current: {} as Record<string, unknown> }
vi.mock('../state/context', () => ({ useStore: () => store.current }))
afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

const receipt: Receipt = {
  ref: { kind: 'walk-in', id: 'c-1' },
  key: 'walk-in:c-1',
  kind: 'walk-in',
  title: 'Receipt',
  number: 'SC-7',
  locationId: 'loc-1',
  studio: {
    name: 'Lumen Studio',
    address: '12 Upper Street, London N1',
    taxNumber: { label: 'VAT number', value: 'GB 123 4567 89' },
  },
  issuedAt: '2026-10-06T13:05:00.000Z',
  date: 'Tuesday 6 October 2026',
  time: '14:05',
  servedBy: 'Maya',
  lines: [
    { label: 'Cleansing Balm', detail: '2 × £16.00', amountMinor: 3200 },
    { label: 'Member discount (10%)', amountMinor: 320, minus: true },
  ],
  totalMinor: 2880,
  included: [{ label: 'Includes VAT 20%', amountMinor: 480 }],
  settled: [],
  paid: { label: 'Cash', amountMinor: 2880 },
  refunds: [],
  notes: [],
  thanks: 'Thank you for coming in.',
  sample: false,
  money: { locale: 'en-GB', currency: 'GBP' },
}

describe('the receipt slip', () => {
  it('reads top to bottom like the paper, at the chosen width', () => {
    render(<ReceiptSlip receipt={receipt} paper="58" />)
    const slip = screen.getByRole('article', { name: 'Receipt SC-7' })
    expect(slip).toHaveClass('receipt-slip', 'receipt-slip-58')
    expect(slip.textContent).toMatch(
      /^Lumen Studio12 Upper Street, London N1Receipt SC-7Tuesday 6 October 2026, 14:05Served by Maya/,
    )
    const rows = [...slip.querySelectorAll('.receipt-slip-row')].map((row) => row.textContent)
    expect(rows).toEqual([
      'Cleansing Balm2 × £16.00£32.00',
      'Member discount (10%)−£3.20',
      'Total£28.80',
      'Includes VAT 20%£4.80',
      'Paid: Cash£28.80',
    ])
    expect(within(slip).getByText('VAT number: GB 123 4567 89')).toBeInTheDocument()
    expect(within(slip).getByText('Thank you for coming in.')).toBeInTheDocument()
  })

  it('prints only the slip, on a till roll, and tidies up afterwards', () => {
    let during = { classes: '', slip: '', page: '' }
    vi.spyOn(window, 'print').mockImplementation(() => {
      during = {
        classes: document.body.className,
        slip: document.querySelector('#receipt-print-root .receipt-slip')?.className ?? '',
        page: document.getElementById('receipt-print-page')?.textContent ?? '',
      }
    })
    printReceipt(receipt, '58')
    expect(window.print).toHaveBeenCalledOnce()
    expect(during.classes).toContain('printing-receipt')
    expect(during.slip).toContain('receipt-slip-58')
    expect(during.page).toMatch(/^@page \{ size: 58mm \d+mm; margin: 0; \}$/)
    act(() => {
      window.dispatchEvent(new Event('afterprint'))
    })
    expect(document.body.className).not.toContain('printing-receipt')
    expect(document.getElementById('receipt-print-root')).toBeNull()
    expect(document.getElementById('receipt-print-page')).toBeNull()
  })

  it('shows what the test printer would have printed, and where it would cut', () => {
    render(
      <PaperPreview
        preview={{
          lines: [{ text: 'Lumen Studio', bold: true, centre: true, large: true }, { text: '' }],
          cut: true,
          drawer: true,
        }}
      />,
    )
    const paper = screen.getByLabelText('What the printer would have printed')
    expect(within(paper).getByText('Lumen Studio')).toHaveClass(
      'receipt-paper-bold',
      'receipt-paper-large',
    )
    expect(
      within(paper).getByText('The cash drawer would open here. The paper would be cut here.'),
    ).toBeInTheDocument()
  })
})

/** A studio of its own with a facial paid in cash at the desk. */
function paidVisit(printer: { mode: 'browser' | 'test'; drawer: boolean }) {
  let n = 0
  let s: BusinessState = createWorkspace({
    name: 'Lumen Studio',
    region: 'UK',
    address: '12 Upper Street, London N1',
  })
  const sample = seed('UK')
  for (const key of ['clients', 'services', 'staff', 'resources'] as const)
    Object.assign(s, {
      [key]: sample[key].map((row) => ({ ...row, organisationId: s.organisation.id })),
    })
  const apply = (command: Command) => {
    const result = execute(s, command, '2026-10-06T13:05:00.000Z', () => `r-${++n}`)
    if (!result.ok) throw new Error(result.error)
    s = result.state
  }
  apply({
    type: 'import-appointments',
    source: 'Old diary',
    reviewed: true,
    appointments: [
      {
        clientId: 'client-1',
        serviceId: 'service-facial',
        staffId: 'staff-maya',
        date: '2026-10-06',
        startMinutes: 900,
        priceMinor: 9500,
        depositPaidMinor: 0,
      },
    ],
  })
  const appointmentId = s.appointments.at(-1)!.id
  apply({ type: 'arrive', appointmentId })
  apply({ type: 'checkout', appointmentId, tipMinor: 0, method: 'cash' })
  apply({ type: 'till-settings', printer: { ...printer, paper: '80' } })
  store.current = {
    mode: 'server',
    session: { user: { id: 'account-ada', name: 'Ada Owner', email: 'ada@example.invalid' } },
    state: s,
    role: 'owner',
    blocked: false,
  }
  return { s, key: `visit:${s.sales.at(-1)!.id}` }
}

describe('Print receipt and Email receipt', () => {
  it('uses the print window when the location prints that way, never the server', async () => {
    const user = userEvent.setup()
    const { key } = paidVisit({ mode: 'browser', drawer: false })
    vi.spyOn(window, 'print').mockImplementation(() => undefined)
    render(<ReceiptActions receiptKey={key} />)
    await user.click(screen.getByRole('button', { name: 'Print receipt' }))
    expect(window.print).toHaveBeenCalledOnce()
    expect(api).not.toHaveBeenCalled()
    act(() => {
      window.dispatchEvent(new Event('afterprint'))
    })
  })

  it('shows the test printer’s paper and the test drawer, saying nothing was printed', async () => {
    const user = userEvent.setup()
    const { s, key } = paidVisit({ mode: 'test', drawer: true })
    const base = `/api/workspaces/${s.organisation.id}/till`
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === `${base}/events?receipt=${encodeURIComponent(key)}`)
        return { events: [{ kind: 'drawer', status: 'test', detail: null }] } as never
      if (path === `${base}/print`)
        return {
          kind: 'print',
          status: 'test',
          preview: { lines: [{ text: 'Lumen Studio', centre: true }], cut: true, drawer: false },
        } as never
      throw new Error(`Unexpected route ${path}`)
    })
    render(<ReceiptActions receiptKey={key} />)
    expect(await screen.findByText('Test drawer: it would have opened now.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Print receipt' }))
    expect(
      await screen.findByText(
        'Test printer: nothing was printed on paper. This is what it would have printed.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('The paper would be cut here.')).toBeInTheDocument()
    expect(api).toHaveBeenCalledWith(`${base}/print`, { method: 'POST', body: { receipt: key } })
  })

  it('queues an email with a request key and says it is not sent', async () => {
    const user = userEvent.setup()
    const { s, key } = paidVisit({ mode: 'browser', drawer: false })
    const email = s.clients.find((c) => c.id === 'client-1')!.email
    vi.mocked(api).mockResolvedValue({ recipient: email, testMode: true } as never)
    render(<ReceiptActions receiptKey={key} />)
    await user.click(screen.getByRole('button', { name: 'Email receipt' }))
    expect(
      await screen.findByText(
        `Receipt queued for ${email}. Email is in test mode, so it will not reach their inbox.`,
      ),
    ).toBeInTheDocument()
    expect(api).toHaveBeenCalledWith(`/api/workspaces/${s.organisation.id}/till/email`, {
      method: 'POST',
      body: { receipt: key },
      key: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
    expect(screen.queryByText(/\bsent\b(?! yet)/)).not.toBeInTheDocument()
  })
})
