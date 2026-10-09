import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, FileUp, Upload, X } from 'lucide-react'
import { useStore } from '../state/context'
import { can } from '../domain/operations'
import { Button, ErrorMessage, Modal } from '../design'
import { readSheet } from '../domain/movingIn/sheet'
import type { Sheet } from '../domain/movingIn/sheet'
import { FIELD_LABEL, clientFields, headingKey } from '../domain/movingIn/fields'
import type { ClientField } from '../domain/movingIn/fields'
import {
  KIND_LABEL,
  SYSTEM_NAME,
  UK_FIRST,
  WHERE_TO_EXPORT,
  oldSystems,
} from '../domain/movingIn/systems'
import type { OldSystem } from '../domain/movingIn/systems'
import { movingParts, reviewClients, understandFile } from '../domain/movingIn/clients'
import type { MovingClient, MovingFile } from '../domain/movingIn/clients'
import './management.css'
import './movingIn.css'

type Added = { id: string; fileName: string; sheet?: Sheet; error?: string }
type Answers = Record<string, Record<string, ClientField | null>>

/** Rows that need the owner's eye are listed; everyone else is counted. */
const LIST_LIMIT = 60
/** Files read in one go; more can be added straight after. */
const FILES_AT_ONCE = 20

/**
 * Moving in, stage 1: the owner adds the files from their old system as they come, SALEANE works
 * out what each file and column is, and the client list comes across after one review.
 */
export function MovingIn({ onClose }: { onClose: () => void }) {
  const { state, commit, role, blocked, saving } = useStore()
  const allowed = !blocked && can(role, 'import-clients')
  const [system, setSystem] = useState<OldSystem | null>(null)
  const [files, setFiles] = useState<Added[]>([])
  const [answers, setAnswers] = useState<Answers>({})
  const [reading, setReading] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [run, setRun] = useState<{ parts: MovingClient[][]; next: number; saved: number } | null>(
    null,
  )
  const [done, setDone] = useState<number | null>(null)
  const sending = useRef(false)
  const inputId = useId()
  const helpId = useId()

  const understood = useMemo(
    () =>
      files
        .filter((f) => f.sheet)
        .map((f) => ({ id: f.id, file: understandFile(f.sheet!, answers[f.id]) })),
    [files, answers],
  )
  const clientFiles = understood.filter((u) => u.file.kind === 'clients')
  const review = useMemo(
    () =>
      reviewClients(
        clientFiles.map((u) => u.file),
        state,
        system ?? 'other',
      ),
    [clientFiles, state, system],
  )
  const questions = clientFiles.flatMap((u) =>
    u.file.matches
      .filter((m) => m.confidence === 'low' && m.field)
      .map((m) => ({ fileId: u.id, file: u.file, match: m })),
  )
  // Files SALEANE recognised name their own system; the rest belong to the system the owner chose.
  const fromNames = new Intl.ListFormat('en-GB', { type: 'conjunction' }).format([
    ...new Set(
      clientFiles
        .map((u) => u.file.system ?? system ?? 'other')
        .filter((s) => s !== 'other')
        .map((s) => SYSTEM_NAME[s]),
    ),
  ])
  const label = fromNames
    ? `${fromNames} client ${clientFiles.length > 1 ? 'lists' : 'list'}`
    : 'Previous system client list'
  const running = run !== null

  // Each part is sent once the studio has the previous one, so every request carries the
  // latest revision.
  useEffect(() => {
    if (!run || saving || sending.current || run.next >= run.parts.length) return
    const part = run.parts[run.next]
    const total = run.parts.length
    sending.current = true
    void commit({
      type: 'import-clients',
      source: total > 1 ? `${label} (part ${run.next + 1} of ${total})` : label,
      contacts: part,
      reviewed: true,
    })
      .then((result) => {
        if (!result.ok) {
          setError(
            `${run.saved ? `${run.saved} clients came across before this stopped. ` : ''}${result.error} Review again to bring the rest across; anyone already saved shows as already here.`,
          )
          setRun(null)
          setReviewed(false)
          return
        }
        const saved = run.saved + part.length
        if (run.next + 1 >= total) {
          setDone(saved)
          setRun(null)
        } else setRun({ ...run, next: run.next + 1, saved })
      })
      .catch(() => {
        setError(
          `${run.saved ? `${run.saved} clients came across before this stopped. ` : ''}The connection dropped. Review again to bring the rest across.`,
        )
        setRun(null)
        setReviewed(false)
      })
      .finally(() => {
        sending.current = false
      })
  }, [run, saving, commit, label])

  async function add(list: FileList | File[] | null) {
    if (!list?.length || running) return
    setReading(true)
    setError('')
    setReviewed(false)
    const added: Added[] = []
    const chosen = Array.from(list)
    for (const file of chosen.slice(0, FILES_AT_ONCE)) {
      const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`
      try {
        const sheet = await readSheet(file.name, new Uint8Array(await file.arrayBuffer()))
        added.push({ id, fileName: file.name, sheet })
      } catch (cause) {
        added.push({
          id,
          fileName: file.name,
          error: cause instanceof Error ? cause.message : `${file.name} could not be read.`,
        })
      }
    }
    setFiles((current) => [...current, ...added])
    setReading(false)
    if (chosen.length > FILES_AT_ONCE)
      setError(
        `Only ${FILES_AT_ONCE} files can be added at once, so the first ${FILES_AT_ONCE} were added. Add the other ${chosen.length - FILES_AT_ONCE} next.`,
      )
  }

  function answer(fileId: string, heading: string, field: ClientField | null) {
    setAnswers((current) => ({
      ...current,
      [fileId]: { ...current[fileId], [headingKey(heading)]: field },
    }))
    setReviewed(false)
  }

  const ready = review.ready.length
  const canSave = allowed && !running && !saving && reviewed && ready > 0 && !questions.length

  if (done !== null)
    return (
      <Modal open wide onClose={onClose} title="Moved in" description="Your clients are here.">
        <div className="confirmation">
          <span className="confirmation-mark">
            <Check />
          </span>
          <h3>
            {done.toLocaleString(state.organisation.locale)} {done === 1 ? 'client' : 'clients'}{' '}
            brought across from {fromNames || 'your old system'}
          </h3>
          <p>
            Each one shows where they came from on their timeline, and the move is listed under
            “What has come across”. Nothing already in SALEANE was changed.
          </p>
          <Button autoFocus onClick={onClose}>
            Done
          </Button>
        </div>
      </Modal>
    )

  return (
    <Modal
      open
      wide
      onClose={() => {
        if (!running) onClose()
      }}
      title="Move your clients in"
      description="Add the files from your old system exactly as they come. You check everything before anything is saved."
    >
      <div className="moving">
        <section aria-labelledby="moving-from">
          <h3 id="moving-from" className="moving-step">
            Where are you moving from?
          </h3>
          <div className="moving-systems" role="group" aria-label="Your old system">
            {[...UK_FIRST, ...oldSystems.filter((s) => !UK_FIRST.includes(s))].map((s) => (
              <button
                key={s}
                type="button"
                className="moving-system"
                aria-pressed={system === s}
                disabled={running}
                onClick={() => setSystem(s)}
              >
                {s === 'other' ? 'Something else' : SYSTEM_NAME[s]}
              </button>
            ))}
          </div>
          {system && <p className="moving-guide">{WHERE_TO_EXPORT[system]}</p>}
        </section>

        <section aria-labelledby="moving-files">
          <h3 id="moving-files" className="moving-step">
            Add your files
          </h3>
          <label
            htmlFor={inputId}
            className={`moving-drop${dragging ? ' is-dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              if (allowed) void add(event.dataTransfer.files)
            }}
          >
            <Upload size={22} aria-hidden="true" />
            <strong>Drop files here, or choose them</strong>
            <span id={helpId}>
              CSV or Excel, as many as you like, straight from your old system. No need to rename
              anything.
            </span>
            <input
              id={inputId}
              className="sr-only"
              type="file"
              multiple
              accept=".csv,.xlsx,.txt,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={!allowed || running}
              aria-describedby={helpId}
              onChange={(event) => {
                void add(event.target.files)
                event.target.value = ''
              }}
            />
          </label>
          {reading && <p role="status">Reading your files…</p>}
          {!!files.length && (
            <ul className="moving-files">
              {files.map((f) => {
                const u = understood.find((x) => x.id === f.id)
                return (
                  <li key={f.id}>
                    <FileUp size={18} aria-hidden="true" />
                    <div>
                      <strong>{f.fileName}</strong>
                      <span>{f.error ?? (u ? fileSummary(u.file) : '')}</span>
                    </div>
                    <button
                      type="button"
                      className="moving-remove"
                      aria-label={`Remove ${f.fileName}`}
                      disabled={running}
                      onClick={() => {
                        setFiles((current) => current.filter((x) => x.id !== f.id))
                        setReviewed(false)
                      }}
                    >
                      <X size={16} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {!!questions.length && (
          <section aria-labelledby="moving-questions" className="moving-questions">
            <h3 id="moving-questions" className="moving-step">
              {questions.length === 1
                ? 'One thing to check'
                : `${questions.length} things to check`}
            </h3>
            <p className="ops-help">
              SALEANE was not sure about these columns. Look at the examples and choose what each
              one is.
            </p>
            {questions.map(({ fileId, file, match }) => (
              <FieldChoice
                key={`${fileId}-${match.index}`}
                id={`${fileId}-${match.index}`}
                heading={match.heading}
                samples={samples(file, match.index)}
                value={match.field}
                prompt={`Is “${match.heading}” in ${file.fileName} the ${FIELD_LABEL[match.field!].toLowerCase()}?`}
                onChange={(field) => answer(fileId, match.heading, field)}
                confirm
              />
            ))}
          </section>
        )}

        {!!clientFiles.length && (
          <section aria-labelledby="moving-review">
            <h3 id="moving-review" className="moving-step">
              Check before it comes across
            </h3>
            <div className="ops-summary">
              <div>
                <span>Ready to come across</span>
                <strong>{ready.toLocaleString(state.organisation.locale)}</strong>
                <small>
                  {review.marketing} agreed to marketing, {review.birthdays} with birthdays
                </small>
              </div>
              <div>
                <span>Already in SALEANE</span>
                <strong>{review.counts.here}</strong>
                <small>Left exactly as they are</small>
              </div>
              <div>
                <span>Need a look</span>
                <strong>{review.counts.problem}</strong>
                <small>Not coming across; see why below</small>
              </div>
            </div>
            {!!review.counts.combined && (
              <p className="ops-help">
                {review.counts.combined}{' '}
                {review.counts.combined === 1 ? 'person was' : 'people were'} in more than one row
                or file and {review.counts.combined === 1 ? 'was' : 'were'} combined into one
                client.
              </p>
            )}
            <p className="ops-help">
              Marketing comes across only for clients your old system shows agreed. Everyone else
              starts with marketing off. Nobody is merged with a client already here.
            </p>
            <Attention rows={review.rows} />
            {clientFiles.map((u) => (
              <details key={u.id} className="moving-columns">
                <summary>What each column in {u.file.fileName} becomes</summary>
                <ul>
                  {u.file.matches.map((m) => (
                    <li key={m.index}>
                      <FieldChoice
                        id={`${u.id}-all-${m.index}`}
                        heading={m.heading}
                        samples={samples(u.file, m.index)}
                        value={m.field}
                        prompt={m.heading}
                        note={m.field ? undefined : m.leftOut}
                        onChange={(field) => answer(u.id, m.heading, field)}
                      />
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            <label className="ops-check">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={!ready || running || !!questions.length}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              <span>
                I have checked these {ready.toLocaleString(state.organisation.locale)} clients
                against my old system and may bring them across.
              </span>
            </label>
          </section>
        )}

        {!allowed && <p className="ops-help">Only an owner or manager can bring clients across.</p>}
        {running && (
          <p role="status" className="moving-progress">
            Bringing clients across: part {Math.min(run.next + 1, run.parts.length)} of{' '}
            {run.parts.length}…
          </p>
        )}
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button
            disabled={!canSave}
            onClick={() => {
              setError('')
              setRun({ parts: movingParts(review.ready), next: 0, saved: 0 })
            }}
          >
            {running
              ? 'Bringing clients across…'
              : ready
                ? `Bring ${ready.toLocaleString(state.organisation.locale)} ${ready === 1 ? 'client' : 'clients'} across`
                : 'Bring clients across'}
          </Button>
          <Button variant="secondary" disabled={running} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function fileSummary(file: MovingFile) {
  const from = file.system ? `${SYSTEM_NAME[file.system]} ` : ''
  const count = `${file.rows.length.toLocaleString('en-GB')} ${file.rows.length === 1 ? 'row' : 'rows'}`
  if (file.kind === 'clients') return capital(`${from}${file.report ?? 'client list'} · ${count}`)
  if (file.kind === 'unknown')
    return `${count}. SALEANE could not tell what this list is. If it is your clients, check it has a name column and an email or phone column.`
  return capital(
    `${from}${file.report ?? KIND_LABEL[file.kind]} · ${count}. Not brought across yet: a later step of moving in brings ${KIND_LABEL[file.kind]} across, and you add this file again then.`,
  )
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function samples(file: MovingFile, index: number) {
  return file.rows
    .map((row) => row[index] ?? '')
    .filter((value) => value.trim())
    .slice(0, 3)
}

function FieldChoice({
  id,
  heading,
  samples: examples,
  value,
  prompt,
  note,
  confirm,
  onChange,
}: {
  id: string
  heading: string
  samples: string[]
  value: ClientField | null
  prompt: string
  note?: string
  confirm?: boolean
  onChange: (field: ClientField | null) => void
}) {
  const selectId = `${id}-field`
  return (
    <div className="moving-field">
      <div>
        <label htmlFor={selectId}>{prompt}</label>
        <small>
          {examples.length
            ? `For example: ${examples.map((e) => e.slice(0, 40)).join(', ')}`
            : 'Empty in this file'}
          {note ? `. ${note}` : ''}
        </small>
      </div>
      <div className="moving-field-actions">
        <select
          id={selectId}
          value={value ?? ''}
          aria-label={`What “${heading}” is`}
          onChange={(event) => onChange((event.target.value || null) as ClientField | null)}
        >
          <option value="">Leave it out</option>
          {clientFields.map((field) => (
            <option key={field} value={field}>
              {FIELD_LABEL[field]}
            </option>
          ))}
        </select>
        {confirm && (
          <Button variant="secondary" onClick={() => onChange(value)}>
            Yes, that’s right
          </Button>
        )}
      </div>
    </div>
  )
}

function Attention({ rows }: { rows: ReturnType<typeof reviewClients>['rows'] }) {
  const listed = rows.filter((r) => r.status === 'problem' || r.notes.length)
  if (!listed.length) return null
  return (
    <div className="moving-attention" role="region" aria-label="Rows to look at" tabIndex={0}>
      <ul>
        {listed.slice(0, LIST_LIMIT).map((r) => (
          <li key={`${r.fileName}-${r.line}`}>
            <strong>
              {r.client?.name ? `${r.client.name} · ` : ''}
              {r.fileName}, line {r.line}
            </strong>
            {r.status === 'problem' && <p>{r.detail} It is not coming across.</p>}
            {r.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </li>
        ))}
      </ul>
      {listed.length > LIST_LIMIT && (
        <p className="ops-help">And {listed.length - LIST_LIMIT} more like these.</p>
      )}
    </div>
  )
}
