import { useId, useMemo, useRef, useState } from 'react'
import { FileUp, Check } from 'lucide-react'
import { useStore } from '../state/context'
import { can } from '../domain/operations'
import type { ContactInput } from '../domain/commands'
import { Button, ErrorMessage, Modal } from '../design'
import {
  CLIENT_IMPORT_MAX_BYTES,
  CLIENT_IMPORT_MAX_PAYLOAD_BYTES,
  previewClientCsv,
} from './clientImportCsv'
import './management.css'

function fileText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('The file could not be read. Choose it again.'))
    reader.readAsText(file, 'UTF-8')
  })
}

export function ClientImport({ onClose }: { onClose: () => void }) {
  const { state, commit, role, blocked, saving } = useStore()
  const [source, setSource] = useState('')
  const [filename, setFilename] = useState('')
  const [provenance, setProvenance] = useState('')
  const [excluded, setExcluded] = useState<number[]>([])
  const [reviewed, setReviewed] = useState(false)
  const [reading, setReading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [imported, setImported] = useState<number | null>(null)
  const readerVersion = useRef(0)
  const helpId = useId()
  const allowed = !blocked && can(role, 'import-clients')
  const busy = reading || pending || saving
  const review = useMemo(() => {
    if (!source) return { preview: null, error: '' }
    try {
      return { preview: previewClientCsv(source, state.clients), error: '' }
    } catch (cause) {
      return {
        preview: null,
        error: cause instanceof Error ? cause.message : 'This CSV could not be read.',
      }
    }
  }, [source, state.clients])
  const rows = review.preview?.rows ?? []
  const contacts = rows
    .filter((row) => row.status === 'ready' && !excluded.includes(row.record))
    .map((row) => row.contact!)
    .filter(Boolean) as ContactInput[]
  const command = {
    type: 'import-clients' as const,
    contacts,
    reviewed: true as const,
    source: provenance.trim(),
  }
  const payloadTooLarge =
    new TextEncoder().encode(JSON.stringify({ revision: state.revision, command })).byteLength >
    CLIENT_IMPORT_MAX_PAYLOAD_BYTES
  async function choose(file?: File) {
    if (!file || busy) return
    const ticket = ++readerVersion.current
    setError('')
    setReviewed(false)
    setReading(true)
    setImported(null)
    try {
      if (file.size > CLIENT_IMPORT_MAX_BYTES)
        throw new Error(
          'This file exceeds 48 KiB. The previous preview is retained; choose a smaller CSV.',
        )
      const contents = await fileText(file)
      if (ticket !== readerVersion.current) return
      setSource(contents)
      setFilename(file.name)
      setProvenance(file.name.slice(0, 100))
      setExcluded([])
      if (!contents.trim())
        setError('This file is empty. Include a header and at least one client row.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This file could not be read.')
    } finally {
      if (ticket === readerVersion.current) setReading(false)
    }
  }
  async function save() {
    if (
      !allowed ||
      busy ||
      !reviewed ||
      !contacts.length ||
      payloadTooLarge ||
      provenance.trim().length < 2 ||
      review.error
    )
      return
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) {
        setError(result.error)
        setReviewed(false)
        return
      }
      setImported(contacts.length)
    } catch {
      setError(
        'Import could not be saved. The file and review are retained. Check the connection and review again.',
      )
      setReviewed(false)
    } finally {
      setPending(false)
    }
  }
  return (
    <Modal
      open
      wide
      onClose={() => {
        if (!busy) onClose()
      }}
      title={imported === null ? 'Review a client import' : 'Clients imported'}
      description={
        imported === null
          ? 'A bounded CSV import of contact details. Review the rows before saving.'
          : 'New client records saved. Marketing remains off.'
      }
    >
      {imported !== null ? (
        <div className="confirmation">
          <span className="confirmation-mark">
            <Check />
          </span>
          <h3>
            {imported} {imported === 1 ? 'client' : 'clients'} imported
          </h3>
          <p>
            Source: {provenance}. Existing clients, visits and financial records were not changed.
          </p>
          <Button autoFocus onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <>
          <div className="ops-banner">
            <FileUp size={20} />
            <div>
              <strong>Contact details only.</strong>
              <p>
                Use UTF-8 CSV with name, email and phone columns. Up to 500 rows and 48 KiB. Phone
                numbers need an international country code, such as +44 or +1.
              </p>
            </div>
          </div>
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
          <p id={helpId} className="ops-help">
            Example header: name,email,phone. Quoted commas, escaped quotes and multiline fields are
            supported. Formula-like values are displayed as text; nothing is executed or exported.
          </p>
          {reading && <p role="status">Reading file…</p>}
          {filename && <p className="ops-help">Selected: {filename}</p>}
          <ErrorMessage error={error || review.error} />
          {review.preview && (
            <>
              <div className="ops-summary" style={{ marginTop: 20 }}>
                <div>
                  <span>Selected to import</span>
                  <strong>{contacts.length}</strong>
                  <small>New client records only</small>
                </div>
                <div>
                  <span>Duplicates skipped</span>
                  <strong>{rows.filter((row) => row.status === 'duplicate').length}</strong>
                  <small>Exact name and email</small>
                </div>
                <div>
                  <span>Invalid rows skipped</span>
                  <strong>{rows.filter((row) => row.status === 'invalid').length}</strong>
                  <small>Correct these in the original file</small>
                </div>
              </div>
              {!!review.preview.ignoredColumns.length && (
                <p className="ops-editor-note">
                  Ignored columns: {review.preview.ignoredColumns.join(', ')}. Marketing consent is
                  never taken from this file.
                </p>
              )}
              <p className="ops-help">
                Only checked valid rows will be saved. Shared email addresses with different names
                stay separate. No automatic merging.
              </p>
              <div
                style={{
                  maxHeight: 330,
                  overflow: 'auto',
                  margin: '16px 0',
                  border: '1px solid var(--line)',
                  borderRadius: 5,
                }}
                tabIndex={0}
                role="region"
                aria-label="CSV import preview"
              >
                <table className="client-table" style={{ minWidth: 660 }}>
                  <caption className="sr-only">
                    CSV records, validation results and selection. Record one is the header.
                  </caption>
                  <thead>
                    <tr>
                      <th>Import</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.record}>
                        <td>
                          {row.status === 'ready' ? (
                            <input
                              type="checkbox"
                              aria-label={`Import record ${row.record}: ${row.name}`}
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
                        <td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                          {row.name || 'Missing name'}
                        </td>
                        <td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                          {row.email}
                        </td>
                        <td>{row.phone}</td>
                        <td style={{ whiteSpace: 'normal', minWidth: 180 }}>
                          <strong>
                            {row.status === 'ready'
                              ? 'Ready'
                              : row.status === 'duplicate'
                                ? 'Duplicate'
                                : 'Invalid'}{' '}
                            · record {row.record}
                          </strong>
                          <p>{row.detail}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="ops-field">
                Import source
                <input
                  aria-label="Import source"
                  value={provenance}
                  minLength={2}
                  maxLength={100}
                  required
                  disabled={busy}
                  onChange={(event) => {
                    setProvenance(event.target.value)
                    setReviewed(false)
                  }}
                  placeholder="Source system or file name"
                />
                <small>This label is recorded in the imported client history.</small>
              </label>
              {payloadTooLarge && (
                <p className="form-error" role="alert">
                  The selected records exceed the local request size limit. Deselect rows or split
                  the file, then review again.
                </p>
              )}
              <label className="ops-check">
                <input
                  type="checkbox"
                  disabled={busy || !contacts.length || payloadTooLarge}
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                <span>
                  I have reviewed these {contacts.length} selected records and am authorised to
                  import them. Marketing permission stays off.
                </span>
              </label>
            </>
          )}
          {!allowed && (
            <p className="ops-help">Only an owner or manager can import client records.</p>
          )}
          <div className="ops-actions">
            <Button
              disabled={
                !allowed ||
                busy ||
                !reviewed ||
                !contacts.length ||
                payloadTooLarge ||
                provenance.trim().length < 2 ||
                !!review.error
              }
              onClick={() => {
                void save()
              }}
            >
              {pending
                ? 'Importing…'
                : `Import ${contacts.length} reviewed ${contacts.length === 1 ? 'client' : 'clients'}`}
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
