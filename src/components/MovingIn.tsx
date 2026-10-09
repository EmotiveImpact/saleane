import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, FileUp, Upload, X } from 'lucide-react'
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
type Step = 1 | 2 | 3 | 4
const STEPS = ['Old system', 'Your files', 'Check', 'Bring across'] as const
type Answers = Record<string, Record<string, ClientField | null>>

/** Rows that need the owner's eye are listed; everyone else is counted. */
const LIST_LIMIT = 60
/** Files read in one go; more can be added straight after. */
const FILES_AT_ONCE = 20

/**
 * Moving in, stage 1, as four steps: the old system, its files exactly as they come, one check
 * (with a question only where SALEANE is unsure of a column), then bringing the clients across.
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
  const [step, setStep] = useState<Step>(1)
  const sending = useRef(false)
  const top = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const shownStep = useRef<Step>(1)
  const inputId = useId()
  const helpId = useId()
  const headingId = useId()

  // Each new step starts at the top, with its heading read out.
  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    const dialog = top.current?.closest('.dialog-content')
    if (dialog) dialog.scrollTop = 0
    heading.current?.focus({ preventScroll: true })
  }, [step])

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
  const systemName = system && system !== 'other' ? SYSTEM_NAME[system] : ''
  const canContinue =
    step === 1
      ? !!system
      : step === 2
        ? !reading && clientFiles.length > 0
        : step === 3
          ? !questions.length && ready > 0
          : false

  function go(next: Step) {
    setError('')
    // Going back means looking again, so the last step asks for the tick afresh.
    if (next < step) setReviewed(false)
    setStep(next)
  }

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
      description="Four short steps. Nothing is saved until the last one."
    >
      <div className="moving" ref={top}>
        <ol className="moving-steps" aria-label="Moving in steps">
          {STEPS.map((name, i) => {
            const n = (i + 1) as Step
            return (
              <li
                key={name}
                aria-current={step === n ? 'step' : undefined}
                className={n < step ? 'is-done' : undefined}
              >
                <span className="moving-steps-mark" aria-hidden="true">
                  {n < step ? <Check size={13} /> : n}
                </span>
                <span className="moving-steps-label">
                  {name}
                  {n < step && <span className="sr-only"> (done)</span>}
                </span>
              </li>
            )
          })}
        </ol>

        {step === 1 && (
          <section aria-labelledby={headingId}>
            <h3 id={headingId} ref={heading} tabIndex={-1} className="moving-step">
              Where are you moving from?
            </h3>
            <p className="ops-help">
              Choose the system your clients are in now. SALEANE knows how each one lays out its
              files.
            </p>
            <div className="moving-tiles" role="group" aria-label="Your old system">
              {[...UK_FIRST, ...oldSystems.filter((s) => !UK_FIRST.includes(s))].map((s) => (
                <button
                  key={s}
                  type="button"
                  className="moving-tile"
                  aria-pressed={system === s}
                  onClick={() => setSystem(s)}
                >
                  {s === 'other' ? 'Something else' : SYSTEM_NAME[s]}
                  {system === s && <Check size={16} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 2 && system && (
          <section aria-labelledby={headingId}>
            <h3 id={headingId} ref={heading} tabIndex={-1} className="moving-step">
              {systemName ? `Add your ${systemName} client list` : 'Add your client list'}
            </h3>
            <div className="moving-guide">
              <strong>{systemName ? `Downloading it from ${systemName}` : 'Downloading it'}</strong>
              <p>{WHERE_TO_EXPORT[system]}</p>
            </div>
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
                CSV or Excel, exactly as they come. Add other lists from the same system too.
              </span>
              <input
                id={inputId}
                className="sr-only"
                type="file"
                multiple
                accept=".csv,.xlsx,.txt,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={!allowed}
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
            {!!files.length && !reading && !clientFiles.length && (
              <p className="ops-help">
                None of these is a client list yet. Add the list with your clients’ names and their
                emails or phone numbers.
              </p>
            )}
          </section>
        )}

        {step === 3 && (
          <section aria-labelledby={headingId}>
            <h3 id={headingId} ref={heading} tabIndex={-1} className="moving-step">
              {questions.length ? 'Check a few things first' : 'Check your clients'}
            </h3>
            {!!questions.length && (
              <div className="moving-questions">
                <p>
                  SALEANE was not sure about{' '}
                  {questions.length === 1 ? 'one column' : `${questions.length} columns`}. Look at
                  the examples and choose what each one is.
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
              </div>
            )}
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
            <Attention rows={review.rows} />
            {clientFiles.map((u) => (
              <details key={u.id} className="moving-columns">
                <summary>How each column in {u.file.fileName} was read</summary>
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
          </section>
        )}

        {step === 4 && (
          <section aria-labelledby={headingId}>
            <h3 id={headingId} ref={heading} tabIndex={-1} className="moving-step">
              Bring them across
            </h3>
            <p className="moving-lead">
              {ready.toLocaleString(state.organisation.locale)}{' '}
              {ready === 1 ? 'client is' : 'clients are'} ready to come across from{' '}
              {fromNames || 'your old system'}.
            </p>
            <ul className="moving-facts">
              <li>
                {review.marketing} agreed to marketing in their old system. Everyone else starts
                with marketing off.
              </li>
              <li>
                {review.birthdays} {review.birthdays === 1 ? 'birthday' : 'birthdays'} and{' '}
                {review.withNotes} {review.withNotes === 1 ? 'client' : 'clients'} with notes come
                with them.
              </li>
              {!!review.counts.here && (
                <li>
                  {review.counts.here} already in SALEANE{' '}
                  {review.counts.here === 1 ? 'stays' : 'stay'} exactly as they are.
                </li>
              )}
              {!!review.counts.problem && (
                <li>
                  {review.counts.problem} {review.counts.problem === 1 ? 'row' : 'rows'} cannot come
                  across; the Check step shows why.
                </li>
              )}
            </ul>
            <label className="ops-check">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={!ready || running}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              <span>
                I have checked these {ready.toLocaleString(state.organisation.locale)} clients
                against my old system and may bring them across.
              </span>
            </label>
            {running && (
              <p role="status" className="moving-progress">
                Bringing clients across: part {Math.min(run.next + 1, run.parts.length)} of{' '}
                {run.parts.length}…
              </p>
            )}
          </section>
        )}

        {!allowed && <p className="ops-help">Only an owner or manager can bring clients across.</p>}
        <ErrorMessage error={error} />
        <div className="moving-next">
          {step > 1 ? (
            <Button variant="quiet" disabled={running} onClick={() => go((step - 1) as Step)}>
              <ArrowLeft size={16} />
              Back
            </Button>
          ) : (
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
          )}
          {step < 4 ? (
            <Button disabled={!canContinue} onClick={() => go((step + 1) as Step)}>
              Continue <ArrowRight size={17} />
            </Button>
          ) : (
            <Button
              disabled={!canSave}
              onClick={() => {
                setError('')
                setRun({ parts: movingParts(review.ready), next: 0, saved: 0 })
              }}
            >
              {running
                ? 'Bringing clients across…'
                : `Bring ${ready.toLocaleString(state.organisation.locale)} ${ready === 1 ? 'client' : 'clients'} across`}
            </Button>
          )}
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
