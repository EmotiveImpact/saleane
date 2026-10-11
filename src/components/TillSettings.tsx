import { useState } from 'react'
import type { FormEvent } from 'react'
import { Printer } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { can, operations } from '../domain/operations'
import { hasLocations, places } from '../domain/locations'
import { PRINTER_PORT } from '../domain/lanAddress'
import { BROWSER_DRAWER, printerProblem, taxNumberProblem, tillPrinter } from '../domain/till'
import type { PaperWidth, PrintMode, TillPrinterInput } from '../domain/tillSchema'
import { Button, ErrorMessage, Select } from '../design'
import { PaperPreview } from './ReceiptActions'
import type { TillEvent } from './tillEvents'
import './receipt.css'

const MODES: { value: PrintMode; label: string; detail: string }[] = [
  {
    value: 'browser',
    label: 'The computer’s print window',
    detail: 'Works with any printer this computer can print to, including a receipt printer.',
  },
  {
    value: 'network',
    label: 'A receipt printer on the studio’s network',
    detail:
      'For thermal receipt printers that understand ESC/POS, as most do. SALEANE sends each receipt straight to the printer, and can open its cash drawer.',
  },
  {
    value: 'test',
    label: 'Test printer',
    detail: 'Prints nothing. Shows what each receipt and drawer opening would have been.',
  },
]

/** What the form holds, as text while it is being typed. */
type Draft = { mode: PrintMode; paper: PaperWidth; host: string; port: string; drawer: boolean }
const draftOf = (printer: TillPrinterInput): Draft => ({
  mode: printer.mode,
  paper: printer.paper,
  host: printer.host ?? '',
  port: String(printer.port ?? PRINTER_PORT),
  drawer: printer.drawer,
})
const inputOf = (draft: Draft): TillPrinterInput => ({
  mode: draft.mode,
  paper: draft.paper,
  drawer: draft.mode !== 'browser' && draft.drawer,
  ...(draft.mode === 'network'
    ? { host: draft.host.trim(), port: Number(draft.port) || PRINTER_PORT }
    : {}),
})

/**
 * Stage 2, Settings: how each location prints receipts, its paper width, whether SALEANE opens
 * the cash drawer for cash, and the VAT number or tax ID printed at the foot of every receipt.
 */
export function TillSettings() {
  const { state, commit, blocked, role, mode, session } = useStore()
  const org = state.organisation
  const sites = places(state).filter((site) => !site.archived)
  const [siteId, setSiteId] = useState(org.locationId)
  const [draft, setDraft] = useState(() => draftOf(tillPrinter(state, org.locationId)))
  const saved = operations(state).till?.taxNumber ?? ''
  const [taxNumber, setTaxNumber] = useState(saved)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<TillEvent | null>(null)
  const editable = can(role, 'till-settings') && !blocked
  const server = mode === 'server' && !!session
  const sample = operations(state).mode !== 'local'
  const current = tillPrinter(state, siteId)
  const changed =
    JSON.stringify(inputOf(draft)) !== JSON.stringify(inputOf(draftOf(current))) ||
    taxNumber.trim() !== saved
  const taxLabel = org.region === 'UK' ? 'VAT number' : 'Tax ID'
  const base = `/api/workspaces/${encodeURIComponent(org.id)}/till`
  const update = (next: Partial<Draft>) => {
    setDraft({ ...draft, ...next })
    setNotice('')
    setError('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !editable) return
    const printer = inputOf(draft)
    const problem =
      printerProblem(printer) ??
      (taxNumber.trim() ? taxNumberProblem(taxNumber.trim(), org.region) : null)
    if (problem) {
      setError(problem)
      return
    }
    setPending(true)
    setError('')
    setPreview(null)
    try {
      const result = await commit({
        type: 'till-settings',
        ...(siteId !== org.locationId ? { locationId: siteId } : {}),
        printer,
        taxNumber: taxNumber.trim(),
      })
      if (!result.ok) setError(result.error)
      else
        setNotice(
          printer.mode === 'browser'
            ? 'Saved. Receipts print through this computer’s print window.'
            : printer.mode === 'test'
              ? 'Saved. Receipts go to the test printer, which prints nothing.'
              : 'Saved. Print a test page to check the printer answers.',
        )
    } catch {
      setError('The settings could not be saved. Your choices are still here; try again.')
    } finally {
      setPending(false)
    }
  }

  async function testPage() {
    if (pending) return
    setPending(true)
    setError('')
    setNotice('')
    setPreview(null)
    try {
      const event = await api<TillEvent>(`${base}/test`, {
        method: 'POST',
        body: siteId !== org.locationId ? { locationId: siteId } : {},
      })
      if (event.status === 'test') {
        setPreview(event)
        setNotice('Test printer: nothing was printed on paper. This is what it would have printed.')
      } else if (event.status === 'sent')
        setNotice('Test page sent. Check it came out of the printer.')
      else setError(event.detail ?? 'The printer did not answer.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The test page could not be sent.')
    } finally {
      setPending(false)
    }
  }

  async function lastTestPrint() {
    if (pending) return
    setPending(true)
    setError('')
    setNotice('')
    try {
      const { events } = await api<{ events: TillEvent[] }>(`${base}/events`)
      const latest = events.find((event) => event.preview) ?? null
      setPreview(latest)
      if (!latest) setNotice('The test printer has not been sent anything yet.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The test prints could not be loaded.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="surface ops-panel settings-panel" aria-labelledby="till-settings-title">
      <header>
        <div>
          <h2 id="till-settings-title">Till and printer</h2>
          <p>How receipts print at each location, and the cash drawer.</p>
        </div>
        <Printer size={21} aria-hidden="true" />
      </header>
      <form className="settings-body till-settings-body" onSubmit={save} aria-busy={pending}>
        <fieldset className="message-settings" disabled={!editable || pending}>
          <legend className="sr-only">Receipt printer</legend>
          {hasLocations(state) && (
            <label>
              Location
              <Select
                value={siteId}
                onChange={(e) => {
                  setSiteId(e.target.value)
                  setDraft(draftOf(tillPrinter(state, e.target.value)))
                  setNotice('')
                  setError('')
                  setPreview(null)
                }}
              >
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <div role="radiogroup" aria-label="How receipts print" className="till-modes">
            {MODES.map((option) => (
              <label key={option.value} className="checkbox-label">
                <input
                  type="radio"
                  name="till-mode"
                  value={option.value}
                  checked={draft.mode === option.value}
                  onChange={() => update({ mode: option.value })}
                />
                <span>
                  {option.label}
                  <small className="subtle"> {option.detail}</small>
                </span>
              </label>
            ))}
          </div>
          {draft.mode === 'network' && (
            <label>
              Printer’s address on your network
              <input
                value={draft.host}
                maxLength={253}
                placeholder="192.168.1.50"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => update({ host: e.target.value })}
              />
              <small>
                Printed on the printer’s settings slip, often by holding the feed button as you
                switch it on. SALEANE connects only to an address on the studio’s network, never to
                the internet.
              </small>
            </label>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.mode !== 'browser' && draft.drawer}
              disabled={draft.mode === 'browser'}
              onChange={(e) => update({ drawer: e.target.checked })}
            />
            Open the drawer for cash payments
          </label>
          <p className="subtle">
            {draft.mode === 'browser'
              ? BROWSER_DRAWER
              : draft.mode === 'test'
                ? 'The test drawer opens nothing. The till count lists when it would have opened.'
                : 'The drawer plugs into the printer. It opens when cash is recorded, and from the till count with a reason.'}
          </p>
          {/* Set once and rarely changed, so tucked away until asked for. */}
          <details className="till-more">
            <summary>
              <span>
                {draft.mode === 'network'
                  ? `Paper width, port and ${taxLabel}`
                  : `Paper width and ${taxLabel}`}
                <small>
                  {draft.paper} mm roll
                  {draft.mode === 'network' ? `, port ${draft.port.trim() || '9100'}` : ''}
                  {taxNumber.trim() ? `, ${taxLabel} ${taxNumber.trim()}` : `, no ${taxLabel} yet`}
                </small>
              </span>
            </summary>
            <label>
              Paper width
              <Select
                value={draft.paper}
                onChange={(e) => update({ paper: e.target.value as PaperWidth })}
              >
                <option value="80">80 mm, the usual till roll</option>
                <option value="58">58 mm, a narrow roll</option>
              </Select>
            </label>
            {draft.mode === 'network' && (
              <label>
                Port
                <input
                  type="number"
                  inputMode="numeric"
                  min={9100}
                  max={9109}
                  value={draft.port}
                  onChange={(e) => update({ port: e.target.value })}
                />
                <small>Almost always 9100.</small>
              </label>
            )}
            <label>
              {taxLabel} (optional)
              <input
                value={taxNumber}
                maxLength={40}
                placeholder={org.region === 'UK' ? 'GB 123 4567 89' : '12-3456789'}
                onChange={(e) => {
                  setTaxNumber(e.target.value)
                  setNotice('')
                  setError('')
                }}
              />
              <small>Printed at the foot of every receipt, at every location.</small>
            </label>
          </details>
        </fieldset>
        {sample && draft.mode === 'network' && (
          <p className="subtle">
            This is a sample studio, so receipts and drawer openings go to the test printer whatever
            is chosen here.
          </p>
        )}
        <ErrorMessage error={error} />
        <p className="ops-save-note" role="status">
          {notice}
        </p>
        {preview?.preview && <PaperPreview preview={preview.preview} />}
        <div className="ops-actions">
          {editable && (
            <Button type="submit" disabled={pending || !changed}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          )}
          {server && editable && current.mode !== 'browser' && !changed && (
            <Button variant="secondary" disabled={pending} onClick={() => void testPage()}>
              Print a test page
            </Button>
          )}
          {server && can(role, 'checkout') && (current.mode === 'test' || sample) && (
            <Button variant="quiet" disabled={pending} onClick={() => void lastTestPrint()}>
              Show the test printer’s last job
            </Button>
          )}
        </div>
        {!editable && <p className="subtle">Owners and managers choose how receipts print.</p>}
      </form>
    </section>
  )
}
