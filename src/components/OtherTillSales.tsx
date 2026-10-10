import { ChevronRight } from 'lucide-react'
import { Modal } from '../design'
import { useStore } from '../state/context'
import { dateLabel, money, timeLabel } from '../domain/format'
import { METHOD_WORDS, tillMethod } from '../domain/accounts'
import { otherTillSales, refundedOn, shelfShort, tillDay, tillMinutes } from '../domain/otherTill'
import type { OtherTillSale } from '../domain/otherTillSchema'

/**
 * Stage 5: sales and refunds a chain's own till sent in through an access key. Each is money that
 * till took or gave back, never SALEANE, so every one says which till it came from and that
 * SALEANE only recorded it.
 */

const methodWords = (method: string) => METHOD_WORDS[method] ?? method

/** One sale from another till, as a row among the day's receipts. */
export function OtherTillRow({ sale, onOpen }: { sale: OtherTillSale; onOpen: () => void }) {
  const { state } = useStore()
  const back = refundedOn(state, sale.id)
  const format = (amount: number) => money(amount, state.organisation, true)
  return (
    <button type="button" className="receipt-row" onClick={onOpen}>
      <span className="receipt-row-copy">
        <span className="sr-only">Open sale from another till, </span>
        <strong>Sold on {sale.till.name}</strong>
        <small>
          {sale.lines.map((line) => line.name).join(', ')} ·{' '}
          {methodWords(tillMethod(sale.payments))} · {sale.receipt}
          {back > 0 ? ` · ${format(back)} given back` : ''}
        </small>
      </span>
      <span className="ops-record-money">{format(sale.totalMinor)}</span>
      <ChevronRight size={16} />
    </button>
  )
}

/** A sale or refund from another till, opened on its own. */
export function OtherTillDialog({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { state } = useStore()
  const sale = otherTillSales(state).find((x) => x.id === saleId)
  if (!sale) return null
  const format = (amount: number) => money(amount, state.organisation, true)
  const locale = state.organisation.locale
  const refund = sale.kind === 'refund'
  const original = refund ? otherTillSales(state).find((x) => x.id === sale.refundOf) : undefined
  const person = state.staff.find((p) => p.id === sale.staffId)?.name
  const back = refund ? 0 : refundedOn(state, sale.id)
  const short = shelfShort(sale)
  return (
    <Modal
      open
      placement="side"
      onClose={onClose}
      title={refund ? 'Given back on another till' : 'Sale from another till'}
      description={`${sale.till.name} · receipt ${sale.receipt}`}
    >
      <div className="ops-receipt">
        {sale.lines.map((line, i) => (
          <div key={i}>
            <span>
              {line.quantity > 1 ? `${line.quantity} × ` : ''}
              {line.name}
              {line.serviceId || line.productId ? '' : ' (not on your menu)'}
            </span>
            <strong>{format(line.totalMinor)}</strong>
          </div>
        ))}
        {sale.taxMinor > 0 && (
          <div>
            <span>Tax (included)</span>
            <strong>{format(sale.taxMinor)}</strong>
          </div>
        )}
        <div className="ops-total">
          <span>{refund ? 'Total given back' : 'Total sale'}</span>
          <strong>{format(sale.totalMinor)}</strong>
        </div>
        {sale.payments.map((p, i) => (
          <div key={`pay-${i}`}>
            <span>{methodWords(`other_till_${p.method}`)}</span>
            <strong>{format(p.amountMinor)}</strong>
          </div>
        ))}
        {!refund && (
          <div>
            <span>Given back on that till</span>
            <strong>{format(back)}</strong>
          </div>
        )}
      </div>
      <p className="ops-help">
        {refund ? 'Given back' : 'Taken'} on {sale.till.name} on{' '}
        {dateLabel(tillDay(state, sale), locale)} at {timeLabel(tillMinutes(state, sale), locale)}
        {person ? `, by ${person}` : ''}. SALEANE recorded it when that till sent it in and{' '}
        {refund ? 'gave nothing back itself' : 'took no payment itself'}.
      </p>
      {refund && (
        <p className="ops-help">
          {sale.reason}
          {original ? `. On receipt ${original.receipt}.` : ''}
        </p>
      )}
      {short.length > 0 && (
        <p className="ops-help">
          {short
            .map(
              (item) =>
                `${item.short} ${item.name} sold here ${item.short === 1 ? 'was' : 'were'} not on SALEANE’s count`,
            )
            .join('. ')}
          . Count the shelf when you can.
        </p>
      )}
    </Modal>
  )
}

/** Money given back on other tills, for the refund records. */
export function OtherTillRefunds({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useStore()
  const format = (amount: number) => money(amount, state.organisation, true)
  const refunds = otherTillSales(state)
    .filter((x) => x.kind === 'refund')
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  return (
    <>
      {refunds.map((entry) => (
        <button
          type="button"
          className="receipt-row"
          key={entry.id}
          onClick={() => onOpen(entry.id)}
        >
          <span className="receipt-row-copy">
            <span className="sr-only">Open money given back on another till, </span>
            <strong>
              Given back on {entry.till.name} · {entry.reason}
            </strong>
            <small>
              Receipt {entry.receipt} ·{' '}
              {dateLabel(tillDay(state, entry), state.organisation.locale)} · Recorded from that
              till
            </small>
          </span>
          <span className="ops-record-money">−{format(entry.totalMinor)}</span>
          <ChevronRight size={16} />
        </button>
      ))}
    </>
  )
}
