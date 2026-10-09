import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Mail, Printer } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { can, operations } from '../domain/operations'
import { parseReceiptKey, receiptFor } from '../domain/receipt'
import { drawerConnected, tillPrinter } from '../domain/till'
import { Button, ErrorMessage, Modal } from '../design'
import { ReceiptSlip } from './ReceiptSlip'
import { printReceipt } from './printReceipt'
import { drawerWords } from './tillEvents'
import type { PaperPreviewLines, TillEvent } from './tillEvents'
import './receipt.css'

/** What the test printer would have put on paper, line by line, in the printer's own letters. */
export function PaperPreview({ preview }: { preview: PaperPreviewLines }) {
  const width = Math.max(32, ...preview.lines.map((line) => line.text.length))
  return (
    <div className="receipt-paper" aria-label="What the printer would have printed">
      {preview.lines.map((line, index) => (
        <span
          key={index}
          className={[
            line.bold ? 'receipt-paper-bold' : '',
            line.large ? 'receipt-paper-large' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            display: 'block',
            width: `${width}ch`,
            textAlign: line.centre ? 'center' : 'left',
          }}
        >
          {line.text || ' '}
        </span>
      ))}
      {(preview.cut || preview.drawer) && (
        <span className="receipt-paper-cut">
          {[
            preview.drawer ? 'The cash drawer would open here.' : '',
            preview.cut ? 'The paper would be cut here.' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        </span>
      )}
    </div>
  )
}

/**
 * Stage 2: Print receipt and Email receipt for one receipt, and whether its cash drawer opened.
 * Printing goes through the computer's print window unless the location has a network or test
 * printer. An email is queued, never said to be sent.
 */
export function ReceiptActions({ receiptKey }: { receiptKey: string }) {
  const { state, mode, role, session } = useStore()
  const ref = parseReceiptKey(receiptKey)
  const receipt = ref ? receiptFor(state, ref) : null
  const printer = tillPrinter(state, receipt?.locationId)
  const server = mode === 'server' && !!session && can(role, 'checkout')
  const sample = operations(state).mode !== 'local'
  const base = `/api/workspaces/${encodeURIComponent(state.organisation.id)}/till`
  const [busy, setBusy] = useState<'' | 'print' | 'email'>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [fallback, setFallback] = useState(false)
  const [shown, setShown] = useState<PaperPreviewLines | null>(null)
  const [drawer, setDrawer] = useState<TillEvent | null>(null)
  // Kept until the server answers, so pressing again after a dropped connection queues one email.
  const [emailKey, setEmailKey] = useState(() => crypto.randomUUID())
  const watchDrawer = server && !!receipt && drawerConnected(printer)
  const issuedAt = receipt?.issuedAt ?? ''

  // The drawer opens on the server just after the sale is saved: ask what happened, a few times.
  useEffect(() => {
    if (!watchDrawer) return
    let active = true
    let tries = 0
    // A receipt from just now may not have its drawer opening yet.
    const fresh = Date.now() - Date.parse(issuedAt) < 2 * 60_000
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      api<{ events: TillEvent[] }>(`${base}/events?receipt=${encodeURIComponent(receiptKey)}`)
        .then(({ events }) => {
          if (!active) return
          const latest = events.find((event) => event.kind === 'drawer') ?? null
          setDrawer(latest)
          const waiting = latest
            ? latest.status === 'pending' || latest.status === 'sending'
            : fresh
          if (waiting && ++tries < 4) timer = setTimeout(load, 1500)
        })
        .catch(() => null)
    }
    load()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [watchDrawer, base, receiptKey, issuedAt, state.revision])

  if (!receipt) return null
  const throughServer = server && printer.mode !== 'browser'
  const canEmail = server && !sample && !!receipt.email

  async function print() {
    if (!receipt || busy) return
    setError('')
    setNote('')
    setShown(null)
    setFallback(false)
    if (!throughServer) {
      printReceipt(receipt, printer.paper)
      return
    }
    setBusy('print')
    try {
      const event = await api<TillEvent>(`${base}/print`, {
        method: 'POST',
        body: { receipt: receiptKey },
      })
      if (event.status === 'test') {
        setShown(event.preview ?? null)
        setNote('Test printer: nothing was printed on paper. This is what it would have printed.')
      } else if (event.status === 'sent') {
        setNote('Sent to the receipt printer. Check the receipt came out.')
      } else {
        setError(event.detail ?? 'The receipt printer did not answer.')
        setFallback(true)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The receipt could not be printed.')
      setFallback(true)
    } finally {
      setBusy('')
    }
  }

  async function email() {
    if (!receipt || busy) return
    setError('')
    setNote('')
    setBusy('email')
    try {
      const reply = await api<{ recipient: string; testMode: boolean }>(`${base}/email`, {
        method: 'POST',
        body: { receipt: receiptKey },
        key: emailKey,
      })
      setEmailKey(crypto.randomUUID())
      setNote(
        reply.testMode
          ? `Receipt queued for ${reply.recipient}. Email is in test mode, so it will not reach their inbox.`
          : `Receipt queued for ${reply.recipient}. It goes out in a moment; it is not sent yet.`,
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The receipt could not be queued.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="receipt-actions">
      <div className="receipt-actions-buttons">
        <Button variant="secondary" disabled={!!busy} onClick={() => void print()}>
          <Printer size={16} aria-hidden="true" />
          {busy === 'print' ? 'Printing…' : 'Print receipt'}
        </Button>
        {canEmail && (
          <Button variant="secondary" disabled={!!busy} onClick={() => void email()}>
            <Mail size={16} aria-hidden="true" />
            {busy === 'email' ? 'Queuing…' : 'Email receipt'}
          </Button>
        )}
        {fallback && (
          <Button variant="quiet" onClick={() => printReceipt(receipt, printer.paper)}>
            Print through this computer instead
          </Button>
        )}
      </div>
      <ErrorMessage error={error} />
      <p className="receipt-actions-note" aria-live="polite">
        {note}
      </p>
      {shown && <PaperPreview preview={shown} />}
      {drawer && <p className="receipt-actions-note">{drawerWords(drawer)}</p>}
    </div>
  )
}

/** A receipt on its own: the till roll as it prints, with its buttons. */
export function ReceiptDialog({
  receiptKey,
  onClose,
  children,
}: {
  receiptKey: string
  onClose: () => void
  children?: ReactNode
}) {
  const { state } = useStore()
  const ref = parseReceiptKey(receiptKey)
  const receipt = ref ? receiptFor(state, ref) : null
  if (!receipt) return null
  const paper = tillPrinter(state, receipt.locationId).paper
  return (
    <Modal
      open
      placement="side"
      onClose={onClose}
      title={receipt.title}
      description={[receipt.clientName, receipt.number, receipt.date].filter(Boolean).join(' · ')}
    >
      <ReceiptSlip receipt={receipt} paper={paper} />
      <ReceiptActions receiptKey={receiptKey} />
      {children}
    </Modal>
  )
}
