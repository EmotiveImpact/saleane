import { receiptRows } from '../domain/receipt'
import type { Receipt } from '../domain/receipt'
import type { PaperWidth } from '../domain/tillSchema'
import './receipt.css'

/**
 * Stage 2: a receipt laid out as a till roll, the same on screen and on paper. The rows come from
 * `receiptRows`, which the receipt printer and the email use too, so all three agree.
 */
export function ReceiptSlip({ receipt, paper = '80' }: { receipt: Receipt; paper?: PaperWidth }) {
  const { studio } = receipt
  return (
    <article
      className={`receipt-slip receipt-slip-${paper}`}
      aria-label={`Receipt ${receipt.number}`}
    >
      <header className="receipt-slip-head">
        <strong className="receipt-slip-name">{studio.name}</strong>
        {studio.location && <span>{studio.location}</span>}
        {studio.address && <span>{studio.address}</span>}
        {studio.phone && <span>{studio.phone}</span>}
      </header>
      <div className="receipt-slip-meta">
        <span>
          {receipt.title} {receipt.number}
        </span>
        <span>
          {receipt.date}, {receipt.time}
        </span>
        {receipt.servedBy && <span>Served by {receipt.servedBy}</span>}
      </div>
      <div className="receipt-slip-rows">
        {receiptRows(receipt).map((row, index) => (
          <div className={`receipt-slip-row receipt-slip-${row.kind}`} key={`${row.kind}-${index}`}>
            <span className="receipt-slip-label">
              {row.label}
              {row.detail && <small>{row.detail}</small>}
            </span>
            <span className="receipt-slip-amount">{row.amount}</span>
          </div>
        ))}
      </div>
      {receipt.notes.length > 0 && (
        <div className="receipt-slip-notes">
          {receipt.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
      <footer className="receipt-slip-foot">
        <p>{receipt.thanks}</p>
        {studio.taxNumber && (
          <p>
            {studio.taxNumber.label}: {studio.taxNumber.value}
          </p>
        )}
      </footer>
    </article>
  )
}
