import { useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRightLeft, Check, FileUp, Wallet } from 'lucide-react'
import { useStore } from '../state/context'
import { can, operations } from '../domain/operations'
import type { ImportBatch, OpeningBalance } from '../domain/operations'
import { importStanding } from '../domain/switching'
import { dateLabel, money } from '../domain/format'
import type { Command } from '../domain/commands'
import { Button, ErrorMessage, Modal } from '../design'
import { MovingIn } from './MovingIn'
import { CLIENT_IMPORT_MAX_BYTES, CLIENT_IMPORT_MAX_PAYLOAD_BYTES } from './clientImportCsv'
import { SWITCH_COLUMNS, previewBalancesCsv, previewServicesCsv } from './switchingCsv'
import type { SwitchKind, SwitchPreview } from './switchingCsv'
import './management.css'
import './switching.css'

const KIND_COPY = {
  services: {
    title: 'Treatments',
    noun: ['treatment', 'treatments'],
    body: 'Names, lengths, prices and deposits, and who gives each one.',
    example:
      'name,duration,price,deposit,category,professionals\nSignature facial,60,85.00,20.00,Skin,Amara Okafor',
  },
  balances: {
    title: 'Balances',
    noun: ['balance', 'balances'],
    body: 'Credit a client holds with you, or money they still owe.',
    example: 'email,amount,type,note\nguest@example.com,25.00,credit,Gift card from 2025',
  },
} as const
const KIND_LABEL: Record<ImportBatch['kind'], string> = {
  clients: 'Clients',
  services: 'Treatments',
  appointments: 'Upcoming visits',
  balances: 'Balances',
}

function fileText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('The file could not be read. Choose it again.'))
    reader.readAsText(file, 'UTF-8')
  })
}

/** PILOT-03: the Settings section for moving a studio across from its previous system. */
export function SwitchingSettings() {
  const { state, role, blocked } = useStore()
  // Clients and upcoming visits come across through moving in, which reads the old system's own
  // files; treatments and balances still use SALEANE's own CSV layout.
  const [open, setOpen] = useState<SwitchKind | 'moving' | null>(null)
  const allowed = !blocked && can(role, 'import-services')
  const imports = (operations(state).imports ?? []).slice().reverse()
  const steps: { key: string; opens: SwitchKind | 'moving'; title: string; body: string }[] = [
    {
      key: 'clients',
      opens: 'moving',
      title: 'Clients',
      body: 'Straight from Fresha, Phorest, Timely, Treatwell, Booksy or any other system, with notes, birthdays and the marketing choices your old system recorded.',
    },
    { key: 'services', opens: 'services', ...KIND_COPY.services },
    {
      key: 'visits',
      opens: 'moving',
      title: 'Upcoming visits',
      body: 'Straight from your old system’s appointments list. Each visit keeps the price the guest was quoted and any deposit they already paid. Add them with your clients, or on their own.',
    },
    { key: 'balances', opens: 'balances', ...KIND_COPY.balances },
  ]
  return (
    <section className="surface ops-panel settings-panel">
      <header>
        <div>
          <h2>Moving from another system</h2>
          <p>Bring your studio across one checked file at a time.</p>
        </div>
        <ArrowRightLeft size={21} />
      </header>
      <div className="settings-body">
        <div className="ops-banner">
          <FileUp size={20} />
          <div>
            <strong>Nothing already here is changed or removed.</strong>
            <p>
              Export each list from your old system. Clients and upcoming visits can be CSV or
              Excel, exactly as they come; treatments and balances are CSV files. You see every row
              before it is saved, with totals to check against your old system’s own report. Add
              your team and spaces first, so treatments and visits have somewhere to go.
            </p>
          </div>
        </div>
        <ol className="switch-steps">
          {steps.map((step, index) => (
            <li key={step.key}>
              <span className="switch-step-number" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
              <Button
                variant="secondary"
                disabled={!allowed}
                onClick={() => setOpen(step.opens)}
                aria-label={`Review a file: ${step.title.toLowerCase()}`}
              >
                Review a file
              </Button>
            </li>
          ))}
        </ol>
        {!allowed && <p className="ops-help">Only an owner or manager can bring records across.</p>}
        <h3 className="ops-section-title">What has come across</h3>
        {imports.length ? (
          <ul className="switch-log">
            {imports.map((batch) => (
              <ImportLogRow key={batch.id} batch={batch} />
            ))}
          </ul>
        ) : (
          <p className="ops-help">
            Nothing yet. Each reviewed file is listed here with its totals.
          </p>
        )}
      </div>
      {open === 'moving' && <MovingIn onClose={() => setOpen(null)} />}
      {open && open !== 'moving' && <ImportReview kind={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

function ImportLogRow({ batch }: { batch: ImportBatch }) {
  const { state } = useStore()
  const org = state.organisation
  const standing = importStanding(state, batch)
  const count = batch.recordIds.length
  const money2 = (amount: number) => money(amount, org, true)
  return (
    <li className="ops-record">
      <div className="ops-record-copy">
        <strong>
          {KIND_LABEL[batch.kind]} from {batch.source}
        </strong>
        <small>
          {dateLabel(batch.createdAt.slice(0, 10), org.locale)} · {batch.actor} · {count}{' '}
          {count === 1 ? 'record' : 'records'}
        </small>
        {batch.kind === 'appointments' && (
          <small>
            {money2(batch.totalMinor)} booked, {money2(batch.depositsMinor ?? 0)} in deposits paid
            to {batch.source}. {standing.upcoming} still upcoming
            {standing.changed ? `, ${standing.changed} since seen, moved on or cancelled` : ''}.
          </small>
        )}
        {batch.kind === 'balances' && (
          <small>
            {money2(batch.totalMinor)} carried over. {standing.upcoming} open
            {standing.changed ? `, ${standing.changed} closed` : ''}.
          </small>
        )}
        {batch.kind === 'services' && <small>Price list total {money2(batch.totalMinor)}.</small>}
      </div>
    </li>
  )
}

type AnyPreview = SwitchPreview<unknown>

/** A row as the file had it, in two readable lines rather than a column per heading. */
function summary(kind: SwitchKind, columns: string[], cells: string[]) {
  const cell = (name: string) => cells[columns.indexOf(name)] ?? ''
  const join = (...parts: string[]) => parts.filter(Boolean).join(' · ')
  if (kind === 'services')
    return [
      cell('name') || 'No name',
      join(
        cell('duration') && `${cell('duration')} min`,
        cell('price') && `price ${cell('price')}`,
        cell('deposit') && `deposit ${cell('deposit')}`,
        cell('category'),
        cell('professionals'),
      ),
    ]
  return [
    cell('name') ? `${cell('name')} (${cell('email')})` : cell('email'),
    join(cell('amount'), cell('type') || 'credit', cell('note')),
  ]
}

function ImportReview({ kind, onClose }: { kind: SwitchKind; onClose: () => void }) {
  const { state, commit, role, blocked, saving } = useStore()
  const copy = KIND_COPY[kind]
  const org = state.organisation
  const [source, setSource] = useState('')
  const [filename, setFilename] = useState('')
  const [provenance, setProvenance] = useState('')
  const [excluded, setExcluded] = useState<number[]>([])
  const [reviewed, setReviewed] = useState(false)
  const [reading, setReading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<number | null>(null)
  const readerVersion = useRef(0)
  const helpId = useId()
  const allowed = !blocked && can(role, `import-${kind}`)
  const busy = reading || pending || saving
  const review = useMemo((): { preview: AnyPreview | null; error: string } => {
    if (!source) return { preview: null, error: '' }
    try {
      const preview =
        kind === 'services' ? previewServicesCsv(source, state) : previewBalancesCsv(source, state)
      return { preview: preview as AnyPreview, error: '' }
    } catch (cause) {
      return {
        preview: null,
        error: cause instanceof Error ? cause.message : 'This CSV could not be read.',
      }
    }
  }, [source, state, kind])
  const rows = review.preview?.rows ?? []
  const chosen = rows.filter((row) => row.status === 'ready' && !excluded.includes(row.record))
  const values = chosen.map((row) => row.value!)
  const total = chosen.reduce((sum, row) => sum + row.amountMinor, 0)
  const deposits = chosen.reduce((sum, row) => sum + row.depositMinor, 0)
  const label = provenance.trim()
  const command = (
    kind === 'services'
      ? { type: 'import-services', source: label, services: values, reviewed: true }
      : { type: 'import-balances', source: label, balances: values, reviewed: true }
  ) as Command
  const payloadTooLarge =
    new TextEncoder().encode(JSON.stringify({ revision: state.revision, command })).byteLength >
    CLIENT_IMPORT_MAX_PAYLOAD_BYTES
  const ready =
    allowed &&
    !busy &&
    reviewed &&
    chosen.length > 0 &&
    !payloadTooLarge &&
    label.length >= 2 &&
    !review.error
  const format = (amount: number) => money(amount, org, true)
  const [one, many] = copy.noun
  const credit = chosen
    .filter((row) => (row.value as { kind?: string }).kind === 'credit')
    .reduce((sum, row) => sum + row.amountMinor, 0)

  async function choose(file?: File) {
    if (!file || busy) return
    const ticket = ++readerVersion.current
    setError('')
    setReviewed(false)
    setReading(true)
    setDone(null)
    try {
      if (file.size > CLIENT_IMPORT_MAX_BYTES)
        throw new Error('This file exceeds 48 KiB. Split it into smaller CSV files.')
      const contents = await fileText(file)
      if (ticket !== readerVersion.current) return
      setSource(contents)
      setFilename(file.name)
      setExcluded([])
      if (!contents.trim()) setError('This file is empty. Include a heading row and some rows.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This file could not be read.')
    } finally {
      if (ticket === readerVersion.current) setReading(false)
    }
  }
  async function save() {
    if (!ready) return
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) {
        setError(result.error)
        setReviewed(false)
        return
      }
      setDone(chosen.length)
    } catch {
      setError('The import could not be saved. Your file and choices are still here; try again.')
      setReviewed(false)
    } finally {
      setPending(false)
    }
  }
  const columns = review.preview?.columns ?? []
  return (
    <Modal
      open
      wide
      onClose={() => {
        if (!busy) onClose()
      }}
      title={
        done === null ? `Review ${copy.title.toLowerCase()} to bring across` : 'Brought across'
      }
      description={
        done === null
          ? 'Check every row and the totals before anything is saved.'
          : 'Saved, and listed under “What has come across”.'
      }
    >
      {done !== null ? (
        <div className="confirmation">
          <span className="confirmation-mark">
            <Check />
          </span>
          <h3>
            {done} {done === 1 ? one : many} brought across
          </h3>
          <p>Source: {label}. Nothing already in SALEANE was changed.</p>
          <Button autoFocus onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <>
          <p className="ops-help">{copy.body}</p>
          <label className="ops-field">
            Choose CSV
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy || !allowed}
              aria-describedby={helpId}
              onChange={(event) => {
                void choose(event.target.files?.[0])
              }}
            />
          </label>
          <div id={helpId} className="ops-help">
            <p>
              Needs the columns {SWITCH_COLUMNS[kind].required.join(', ')}. May also have{' '}
              {SWITCH_COLUMNS[kind].optional.join(', ')}. Other columns are left out.
            </p>
            <p>
              Example:{' '}
              <a
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(copy.example)}`}
                download={`saleane-${kind}-example.csv`}
              >
                download an example file
              </a>
              .
            </p>
          </div>
          {reading && <p role="status">Reading file…</p>}
          {filename && <p className="ops-help">Selected: {filename}</p>}
          <ErrorMessage error={error || review.error} />
          {review.preview && (
            <>
              <div className="ops-summary switch-totals">
                <div>
                  <span>Ready to bring across</span>
                  <strong>{chosen.length}</strong>
                  <small>
                    {rows.filter((row) => row.status === 'duplicate').length} already here,{' '}
                    {rows.filter((row) => row.status === 'problem').length} to fix in the file
                  </small>
                </div>
                <div>
                  <span>{kind === 'services' ? 'Price list total' : 'Credit held'}</span>
                  <strong>{format(kind === 'balances' ? credit : total)}</strong>
                  <small>
                    {kind === 'balances'
                      ? 'For clients to use or have returned'
                      : 'Across the chosen treatments'}
                  </small>
                </div>
                <div>
                  <span>{kind === 'balances' ? 'Owed to you' : 'Deposits asked'}</span>
                  <strong>{format(kind === 'balances' ? total - credit : deposits)}</strong>
                  <small>
                    {kind === 'balances'
                      ? 'Collected at the desk as usual'
                      : 'Across the chosen treatments'}
                  </small>
                </div>
              </div>
              {!!review.preview.ignored.length && (
                <p className="ops-editor-note">Left out: {review.preview.ignored.join(', ')}.</p>
              )}
              <div
                className="switch-table"
                tabIndex={0}
                role="region"
                aria-label={`${copy.title} file preview`}
              >
                <table className="client-table">
                  <caption className="sr-only">
                    Rows from the file, what was found and whether each will be brought across. Row
                    one is the heading.
                  </caption>
                  <thead>
                    <tr>
                      <th>Bring</th>
                      <th>From the file</th>
                      <th>Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.record}>
                        <td>
                          {row.status === 'ready' ? (
                            <input
                              type="checkbox"
                              aria-label={`Bring row ${row.record} across`}
                              disabled={busy}
                              checked={!excluded.includes(row.record)}
                              onChange={(event) => {
                                setExcluded((current) =>
                                  event.target.checked
                                    ? current.filter((item) => item !== row.record)
                                    : [...current, row.record],
                                )
                                setReviewed(false)
                              }}
                            />
                          ) : (
                            <span>Skip</span>
                          )}
                        </td>
                        <td className="switch-row">
                          {summary(kind, columns, row.cells).map((line, index) =>
                            index ? <p key={index}>{line}</p> : <strong key={index}>{line}</strong>,
                          )}
                        </td>
                        <td className="switch-check">
                          <strong>
                            {row.status === 'ready'
                              ? 'Ready'
                              : row.status === 'duplicate'
                                ? 'Already here'
                                : 'To fix'}{' '}
                            · row {row.record}
                          </strong>
                          <p>{row.detail}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="ops-field">
                Old system
                <input
                  value={provenance}
                  minLength={2}
                  maxLength={100}
                  required
                  disabled={busy}
                  onChange={(event) => {
                    setProvenance(event.target.value)
                    setReviewed(false)
                  }}
                  placeholder="For example Fresha, Phorest or Mindbody"
                />
                <small>Recorded with every record brought across.</small>
              </label>
              {payloadTooLarge && (
                <p className="form-error" role="alert">
                  Too many rows to send at once. Leave some out or split the file, then review
                  again.
                </p>
              )}
              <label className="ops-check">
                <input
                  type="checkbox"
                  disabled={busy || !chosen.length || payloadTooLarge}
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                <span>
                  I have checked these {chosen.length} {chosen.length === 1 ? one : many} and the
                  totals against {label || 'the old system'}, and I may bring them across.
                </span>
              </label>
            </>
          )}
          <div className="ops-actions">
            <Button disabled={!ready} onClick={() => void save()}>
              {pending
                ? 'Saving…'
                : `Bring ${chosen.length} ${chosen.length === 1 ? one : many} across`}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

/** Carried-over balances, open first. Used in Money and on a client's page. */
export function CarriedBalances({ clientId }: { clientId?: string }) {
  const { state, commit, role, blocked } = useStore()
  const org = state.organisation
  const [closing, setClosing] = useState<OpeningBalance | null>(null)
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const balances = (operations(state).balances ?? [])
    .filter((b) => !clientId || b.clientId === clientId)
    .sort((a, b) => Number(!!a.settled) - Number(!!b.settled))
  if (!balances.length) return null
  const allowed = !blocked && can(role, 'balance-settle')
  const name = (id: string) => state.clients.find((c) => c.id === id)?.name ?? 'Client'
  const source = (balance: OpeningBalance) =>
    operations(state).imports?.find((batch) => batch.id === balance.importId)?.source ??
    'the previous system'
  async function settle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!closing || pending) return
    setPending(true)
    setError('')
    try {
      const result = await commit({ type: 'balance-settle', balanceId: closing.id, note })
      if (!result.ok) setError(result.error)
      else {
        setClosing(null)
        setNote('')
      }
    } catch {
      setError('This could not be saved. Your note is still here; try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <div className={clientId ? 'surface client-cards switch-balances' : 'switch-balances'}>
      {clientId && (
        <h3>
          <Wallet size={18} aria-hidden="true" /> Carried over
        </h3>
      )}
      {balances.map((balance) => (
        <div className="ops-record" key={balance.id}>
          <Wallet size={21} aria-hidden="true" />
          <div className="ops-record-copy">
            <strong>
              {clientId ? '' : `${name(balance.clientId)} · `}
              {balance.kind === 'credit' ? 'Credit to use or return' : 'Owed to the studio'}
            </strong>
            <small>
              From {source(balance)}
              {balance.note ? `: ${balance.note}` : ''}
            </small>
            <small>
              {balance.settled
                ? `Closed ${dateLabel(balance.settled.at.slice(0, 10), org.locale)} by ${balance.settled.actor}: ${balance.settled.note}`
                : balance.kind === 'credit'
                  ? 'Open. SALEANE does not take this off a bill by itself; apply it at the desk, then close it here.'
                  : 'Open. Collect it at the desk as usual, then close it here.'}
            </small>
          </div>
          <span className="ops-record-money">{money(balance.amountMinor, org, true)}</span>
          {!balance.settled && allowed && (
            <Button
              variant="quiet"
              aria-label={`Close ${name(balance.clientId)}’s balance`}
              onClick={() => {
                setClosing(balance)
                setNote('')
                setError('')
              }}
            >
              Close
            </Button>
          )}
        </div>
      ))}
      {closing && (
        <Modal
          open
          onClose={() => {
            if (!pending) setClosing(null)
          }}
          title="Close a carried-over balance"
          description={`${name(closing.clientId)} · ${money(closing.amountMinor, org, true)} ${closing.kind === 'credit' ? 'credit' : 'owed'}`}
        >
          <form onSubmit={settle}>
            <label className="ops-field">
              What happened
              <input
                value={note}
                minLength={2}
                maxLength={200}
                required
                autoFocus
                onChange={(event) => setNote(event.target.value)}
                placeholder={
                  closing.kind === 'credit'
                    ? 'For example: taken off the 12 November visit'
                    : 'For example: paid in cash at the desk'
                }
              />
              <small>The balance stays on record with this note. No money moves.</small>
            </label>
            <ErrorMessage error={error} />
            <div className="ops-actions">
              <Button type="submit" disabled={pending || note.trim().length < 2}>
                {pending ? 'Saving…' : 'Close balance'}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => setClosing(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
