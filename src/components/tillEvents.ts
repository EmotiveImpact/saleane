/** Stage 2: what the server says about a print job or a drawer opening, shared by the till screens. */
/** One print job or drawer opening, as the server keeps it. A test print carries its preview. */
export type TillEvent = {
  id: string
  kind: 'drawer' | 'print'
  cause: 'cash' | 'refund' | 'no_sale' | 'receipt' | 'test_page'
  locationId: string
  receipt: string | null
  receiptNumber: string | null
  amountMinor: number | null
  reason: string | null
  printer: 'network' | 'test'
  status: 'pending' | 'sending' | 'sent' | 'test' | 'failed' | 'skipped'
  detail: string | null
  actorName: string
  createdAt: string
  preview?: PaperPreviewLines
}
export type PaperPreviewLines = {
  lines: { text: string; bold?: boolean; centre?: boolean; large?: boolean }[]
  cut: boolean
  drawer: boolean
}

/** What a drawer opening came to, in words that never claim more than SALEANE knows. */
export function drawerWords(event: Pick<TillEvent, 'status' | 'detail'>) {
  if (event.status === 'test') return 'Test drawer: it would have opened now.'
  if (event.status === 'sent') return 'The drawer was sent the signal to open.'
  if (event.status === 'pending' || event.status === 'sending') return 'Opening the drawer…'
  if (event.status === 'skipped') return event.detail ?? 'The drawer was not opened.'
  return `The drawer may not have opened. ${event.detail ?? 'The printer did not answer.'}`
}
