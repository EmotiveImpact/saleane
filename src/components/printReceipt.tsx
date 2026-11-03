import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Receipt } from '../domain/receipt'
import type { PaperWidth } from '../domain/tillSchema'
import { ReceiptSlip } from './ReceiptSlip'

/** How long the slip is on paper, so the print window cuts the roll after it rather than a page. */
const toMillimetres = (pixels: number) => Math.ceil((pixels * 25.4) / 96)

/**
 * Prints one receipt through the computer's print window, on a till roll of the chosen width and
 * nothing else from the page. Everything it adds is taken away again once printing ends.
 */
export function printReceipt(receipt: Receipt, paper: PaperWidth) {
  // A print window closed without an answer can leave the last one behind; it goes first.
  document.getElementById('receipt-print-root')?.remove()
  document.getElementById('receipt-print-page')?.remove()
  const host = document.createElement('div')
  host.id = 'receipt-print-root'
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(<ReceiptSlip receipt={receipt} paper={paper} />))
  const page = document.createElement('style')
  page.id = 'receipt-print-page'
  page.textContent = `@page { size: ${paper}mm ${Math.max(80, toMillimetres(host.scrollHeight) + 12)}mm; margin: 0; }`
  document.head.appendChild(page)
  document.body.classList.add('printing-receipt')
  const done = () => {
    window.removeEventListener('afterprint', done)
    document.body.classList.remove('printing-receipt')
    page.remove()
    root.unmount()
    host.remove()
  }
  window.addEventListener('afterprint', done)
  window.print()
}
