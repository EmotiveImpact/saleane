import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, FileUp, Upload, X } from 'lucide-react'
import { useStore } from '../state/context'
import { can } from '../domain/operations'
import { dateLabel, money } from '../domain/format'
import {
  Button,
  ChoiceTiles,
  ErrorMessage,
  Modal,
  WizardFooter,
  WizardSteps,
  useWizardStep,
} from '../design'
import { readSheet } from '../domain/movingIn/sheet'
import type { Sheet } from '../domain/movingIn/sheet'
import { FIELD_LABEL, clientFields, headingKey } from '../domain/movingIn/fields'
import type { ColumnMatch } from '../domain/movingIn/fields'
import { VISIT_FIELD_LABEL, visitFields } from '../domain/movingIn/visitFields'
import {
  KIND_LABEL,
  SYSTEM_NAME,
  UK_FIRST,
  WHERE_TO_EXPORT,
  WHERE_TO_EXPORT_VISITS,
  oldSystems,
} from '../domain/movingIn/systems'
import type { OldSystem } from '../domain/movingIn/systems'
import { movingParts, reviewClients, understandFile } from '../domain/movingIn/clients'
import type { ColumnAnswers, MovingClient, MovingFile } from '../domain/movingIn/clients'
import { needsAnswer, reviewVisits, visitRows } from '../domain/movingIn/visits'
import type {
  NameChoices,
  NameMatch,
  PlannedVisit,
  VisitReview,
  VisitRow,
} from '../domain/movingIn/visits'
import './management.css'
import './movingIn.css'

type Added = { id: string; fileName: string; sheet?: Sheet; error?: string }
type StepId = 'system' | 'files' | 'check' | 'clients' | 'visits' | 'bring'
const STEP_LABEL: Record<StepId, string> = {
  system: 'Old system',
  files: 'Your files',
  check: 'Check',
  clients: 'Clients',
  visits: 'Visits',
  bring: 'Bring across',
}

/** Rows that need the owner's eye are listed; everyone else is counted. */
const LIST_LIMIT = 60
/** Files read in one go; more can be added straight after. */
const FILES_AT_ONCE = 20
/** Visits per request: the server takes up to 200 in one import. */
const VISIT_PART_ROWS = 200
/** The choice that leaves an old treatment's or person's visits behind. */
const LEAVE = '__leave'

/** The numbers the last step and the finished screen show, kept still while saving. */
type Plan = {
  from: string
  clients: MovingClient[]
  visits: PlannedVisit[]
  marketing: number
  birthdays: number
  withNotes: number
  clientsHere: number
  clientProblems: number
  newFromVisits: number
  valueMinor: number
  depositsMinor: number
  visitsHere: number
  past: number
  cancelled: number
  visitsBehind: number
  visitsLeft: number
  hasVisitFiles: boolean
}

type Run = {
  plan: Plan
  phase: 'clients' | 'visits'
  clientParts: MovingClient[][]
  visitParts: PlannedVisit[][]
  next: number
  savedClients: number
  savedVisits: number
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

/** "412 clients and 128 visits", leaving out whichever is none. */
function what(clients: number, visits: number) {
  return [clients ? plural(clients, 'client') : '', visits ? plural(visits, 'visit') : '']
    .filter(Boolean)
    .join(' and ')
}

/**
 * Moving in from another system, as a few short steps: the old system, its files exactly as they
 * come, a check of the clients and of the upcoming visits (with a question only where SALEANE is
 * unsure), then bringing them across: clients first, then the visits that belong to them.
 */
export function MovingIn({ onClose }: { onClose: () => void }) {
  const { state, commit, role, blocked, saving } = useStore()
  const allowed = !blocked && can(role, 'import-clients')
  const org = state.organisation
  const [now] = useState(() => new Date().toISOString())
  const [system, setSystem] = useState<OldSystem | null>(null)
  const [files, setFiles] = useState<Added[]>([])
  const [answers, setAnswers] = useState<Record<string, ColumnAnswers>>({})
  const [names, setNames] = useState<NameChoices>({ treatment: {}, professional: {} })
  const [reading, setReading] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [run, setRun] = useState<Run | null>(null)
  const [done, setDone] = useState<{ plan: Plan; clients: number; visits: number } | null>(null)
  const [step, setStep] = useState<StepId>('system')
  const sending = useRef(false)
  const inputId = useId()
  const helpId = useId()
  const headingId = useId()

  const understood = useMemo(
    () =>
      files
        .filter((f) => f.sheet)
        .map((f) => ({ id: f.id, file: understandFile(f.sheet!, answers[f.id]) })),
    [files, answers],
  )
  const clientFiles = useMemo(
    () => understood.filter((u) => u.file.kind === 'clients'),
    [understood],
  )
  const visitFiles = useMemo(() => understood.filter((u) => u.file.kind === 'visits'), [understood])
  const review = useMemo(
    () =>
      reviewClients(
        clientFiles.map((u) => u.file),
        state,
        system ?? 'other',
      ),
    [clientFiles, state, system],
  )
  const visits = useMemo(
    () =>
      reviewVisits(
        visitFiles.map((u) => u.file),
        state,
        review.ready,
        names,
        system ?? 'other',
        now,
        review.rows.flatMap((r) => r.name ?? []),
      ),
    [visitFiles, state, review, names, system, now],
  )
  const columnQuestions = (
    list: typeof understood,
    matches: (f: MovingFile) => ColumnMatch<string>[],
  ) =>
    list.flatMap((u) =>
      matches(u.file)
        .filter((m) => m.confidence === 'low' && m.field)
        .map((m) => ({ fileId: u.id, file: u.file, match: m })),
    )
  const clientQuestions = columnQuestions(clientFiles, (f) => f.matches)
  const visitQuestions = columnQuestions(visitFiles, (f) => f.visitMatches)
  const services = state.services.filter((s) => !s.archived)
  const team = state.staff.filter((p) => !p.archived)
  const canMatch = !!services.length && !!team.length
  const treatmentQuestions = canMatch ? visits.treatments.filter(needsAnswer) : []
  const personQuestions = canMatch ? visits.professionals.filter(needsAnswer) : []
  const nameQuestions = treatmentQuestions.length + personQuestions.length

  // Files SALEANE recognised name their own system; the rest belong to the system the owner chose.
  const namesOf = (list: typeof understood) =>
    new Intl.ListFormat('en-GB', { type: 'conjunction' }).format([
      ...new Set(
        list
          .map((u) => u.file.system ?? system ?? 'other')
          .filter((s) => s !== 'other')
          .map((s) => SYSTEM_NAME[s]),
      ),
    ])
  const clientNames = namesOf(clientFiles)
  const visitNames = namesOf(visitFiles)
  const fromNames = namesOf([...clientFiles, ...visitFiles])
  const label = clientNames
    ? `${clientNames} client ${clientFiles.length > 1 ? 'lists' : 'list'}`
    : 'Previous system client list'
  const visitSource = visitNames || 'your old system'
  const running = run !== null

  const live: Plan = {
    from: fromNames || 'your old system',
    clients: [...review.ready, ...visits.newClients],
    visits: visits.ready,
    marketing: review.marketing,
    birthdays: review.birthdays,
    withNotes: review.withNotes,
    clientsHere: review.counts.here,
    clientProblems: review.counts.problem,
    newFromVisits: visits.newClients.length,
    valueMinor: visits.valueMinor,
    depositsMinor: visits.depositsMinor,
    visitsHere: visits.counts.here,
    past: visits.counts.past,
    cancelled: visits.counts.cancelled,
    visitsBehind: visits.counts.problem,
    visitsLeft: visits.counts.skipped,
    hasVisitFiles: !!visitFiles.length,
  }
  const plan = run?.plan ?? live

  // Each part is sent once the studio has the previous one, so every request carries the latest
  // revision. Clients go first; each visit then finds the client the server saved for it.
  useEffect(() => {
    if (!run || saving || sending.current) return
    const stop = (message: string) => {
      const savedNote = [
        run.savedClients ? `${plural(run.savedClients, 'client')} came across` : '',
        run.savedVisits ? `${plural(run.savedVisits, 'visit')} came across` : '',
      ]
        .filter(Boolean)
        .join(' and ')
      setError(
        `${savedNote ? `${savedNote} before this stopped. ` : ''}${message} Review again to bring the rest across; anything already saved shows as already here.`,
      )
      setRun(null)
      setReviewed(false)
    }
    const finish = (next: Run) => {
      setDone({ plan: next.plan, clients: next.savedClients, visits: next.savedVisits })
      setRun(null)
    }
    if (run.phase === 'clients') {
      if (run.next >= run.clientParts.length) return
      const part = run.clientParts[run.next]
      const total = run.clientParts.length
      sending.current = true
      void commit({
        type: 'import-clients',
        source: total > 1 ? `${label} (part ${run.next + 1} of ${total})` : label,
        contacts: part,
        reviewed: true,
      })
        .then((result) => {
          // Cleared before the next part is asked for, so its effect is free to send it.
          sending.current = false
          if (!result.ok) return stop(result.error)
          const saved = { ...run, savedClients: run.savedClients + part.length }
          if (run.next + 1 < total) setRun({ ...saved, next: run.next + 1 })
          else if (run.visitParts.length) setRun({ ...saved, phase: 'visits', next: 0 })
          else finish(saved)
        })
        .catch(() => {
          sending.current = false
          stop('The connection dropped.')
        })
      return
    }
    if (run.next >= run.visitParts.length) return
    const { rows, lost } = visitRows(run.visitParts[run.next], state)
    if (lost) {
      stop(
        `${plural(lost, 'visit')} could not find the client brought across for ${lost === 1 ? 'it' : 'them'}.`,
      )
      return
    }
    sending.current = true
    void commit({
      type: 'import-appointments',
      source: visitSource,
      appointments: rows,
      reviewed: true,
    })
      .then((result) => {
        sending.current = false
        if (!result.ok) return stop(result.error)
        const saved = { ...run, savedVisits: run.savedVisits + rows.length }
        if (run.next + 1 < run.visitParts.length) setRun({ ...saved, next: run.next + 1 })
        else finish(saved)
      })
      .catch(() => {
        sending.current = false
        stop('The connection dropped.')
      })
  }, [run, saving, commit, label, visitSource, state])

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

  function answer(fileId: string, heading: string, field: string | null) {
    setAnswers((current) => ({
      ...current,
      [fileId]: { ...current[fileId], [headingKey(heading)]: field },
    }))
    setReviewed(false)
  }

  function choose(kind: keyof NameChoices, key: string, id: string | null) {
    setNames((current) => ({ ...current, [kind]: { ...current[kind], [key]: id } }))
    setReviewed(false)
  }

  // The steps follow the files: a check for clients, for visits, or for both.
  const steps: StepId[] = [
    'system',
    'files',
    ...(clientFiles.length || visitFiles.length
      ? [
          ...(clientFiles.length ? (['clients'] as const) : []),
          ...(visitFiles.length ? (['visits'] as const) : []),
        ]
      : (['check'] as const)),
    'bring',
  ]
  const at = Math.max(0, steps.indexOf(step))
  const heading = useWizardStep(at + 1)
  const ready = review.ready.length
  const readyVisits = visits.ready.length
  const toBring = plan.clients.length + plan.visits.length
  const questionsLeft =
    (clientFiles.length ? clientQuestions.length : 0) + visitQuestions.length + nameQuestions
  const canSave = allowed && !running && !saving && reviewed && toBring > 0 && !questionsLeft
  const systemName = system && system !== 'other' ? SYSTEM_NAME[system] : ''
  const canContinue =
    step === 'system'
      ? !!system
      : step === 'files'
        ? !reading && (clientFiles.length > 0 || visitFiles.length > 0)
        : step === 'clients'
          ? !clientQuestions.length && (ready > 0 || visitFiles.length > 0)
          : step === 'visits'
            ? !visitQuestions.length && !nameQuestions && (readyVisits > 0 || ready > 0)
            : false

  function go(next: StepId) {
    setError('')
    // Going back means looking again, so the last step asks for the tick afresh.
    if (steps.indexOf(next) < at) setReviewed(false)
    setStep(next)
  }

  const amount = (minor: number) => money(minor, org, true)
  const bringing = what(plan.clients.length, plan.visits.length) || 'them'

  if (done !== null)
    return (
      <Modal
        open
        wide
        onClose={onClose}
        title="Moved in"
        description={done.visits ? 'Your clients and visits are here.' : 'Your clients are here.'}
      >
        <div className="confirmation">
          <span className="confirmation-mark">
            <Check />
          </span>
          <h3>
            {what(done.clients, done.visits)} brought across from {done.plan.from}
          </h3>
          <p>
            {done.clients ? 'Each client shows where they came from on their timeline. ' : ''}
            {done.visits
              ? 'The visits are in the calendar with the price each guest was quoted, and nobody was sent a confirmation. '
              : ''}
            The move is listed under “What has come across” in Settings. Nothing already in SALEANE
            was changed.
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
      title="Move in from your old system"
      description="A few short steps. Nothing is saved until the last one."
    >
      <div className="moving">
        <WizardSteps
          steps={steps.map((s) => STEP_LABEL[s])}
          current={at + 1}
          label="Moving in steps"
        />

        {step === 'system' && (
          <section className="settle" aria-labelledby={headingId}>
            <h3 id={headingId} ref={heading} tabIndex={-1} className="wizard-heading">
              Where are you moving from?
            </h3>
            <p className="ops-help">
              Choose the system you use now. SALEANE knows how each one lays out its files.
            </p>
            <ChoiceTiles
              label="Your old system"
              options={[...UK_FIRST, ...oldSystems.filter((s) => !UK_FIRST.includes(s))].map(
                (s) => ({ value: s, label: s === 'other' ? 'Something else' : SYSTEM_NAME[s] }),
              )}
              value={system}
              onChange={setSystem}
            />
          </section>
        )}

        {step === 'files' && system && (
          <section className="settle" aria-labelledby={headingId}>
            <h3 id={headingId} ref={heading} tabIndex={-1} className="wizard-heading">
              {systemName ? `Add your ${systemName} files` : 'Add your files'}
            </h3>
            <div className="moving-guide">
              <strong>
                {systemName ? `Downloading them from ${systemName}` : 'Downloading them'}
              </strong>
              <p>
                <b>Your clients.</b> {WHERE_TO_EXPORT[system]}
              </p>
              <p>
                <b>Your upcoming visits.</b> {WHERE_TO_EXPORT_VISITS[system]}
              </p>
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
                CSV or Excel, exactly as they come. Add your client list and your upcoming visits
                together, or just one of them.
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
            {!!files.length && !reading && !clientFiles.length && !visitFiles.length && (
              <p className="ops-help">
                None of these is a client list or a list of visits yet. Add the list with your
                clients’ names and their emails or phone numbers, or the list of upcoming
                appointments.
              </p>
            )}
          </section>
        )}

        {step === 'clients' && (
          <section className="settle" aria-labelledby={headingId}>
            <h3 id={headingId} ref={heading} tabIndex={-1} className="wizard-heading">
              {clientQuestions.length ? 'Check a few things first' : 'Check your clients'}
            </h3>
            {!!clientQuestions.length && (
              <div className="moving-questions">
                <p>
                  SALEANE was not sure about{' '}
                  {clientQuestions.length === 1
                    ? 'one column'
                    : `${clientQuestions.length} columns`}
                  . Look at the examples and choose what each one is.
                </p>
                {clientQuestions.map(({ fileId, file, match }) => (
                  <FieldChoice
                    key={`${fileId}-${match.index}`}
                    id={`${fileId}-${match.index}`}
                    heading={match.heading}
                    samples={samples(file, match.index)}
                    value={match.field}
                    options={CLIENT_OPTIONS}
                    prompt={`Is “${match.heading}” in ${file.fileName} the ${FIELD_LABEL[match.field as keyof typeof FIELD_LABEL].toLowerCase()}?`}
                    onChange={(field) => answer(fileId, match.heading, field)}
                    confirm
                  />
                ))}
              </div>
            )}
            <div className="ops-summary">
              <div>
                <span>Ready to come across</span>
                <strong>{ready.toLocaleString(org.locale)}</strong>
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
              <ColumnsRead
                key={u.id}
                id={u.id}
                file={u.file}
                matches={u.file.matches}
                options={CLIENT_OPTIONS}
                onChange={(heading, field) => answer(u.id, heading, field)}
              />
            ))}
          </section>
        )}

        {step === 'visits' && (
          <section className="settle" aria-labelledby={headingId}>
            <h3 id={headingId} ref={heading} tabIndex={-1} className="wizard-heading">
              {visitQuestions.length || nameQuestions
                ? 'Check a few things first'
                : 'Check your visits'}
            </h3>
            {!canMatch && (
              <p className="moving-guide">
                Your studio has no {services.length ? 'team' : 'treatments'} in SALEANE yet, so
                these visits have nowhere to go. Add your {services.length ? 'team' : 'treatments'}{' '}
                in Settings first, then bring the visits across.
              </p>
            )}
            {(!!visitQuestions.length || !!nameQuestions) && (
              <div className="moving-questions">
                {!!visitQuestions.length && (
                  <>
                    <p>
                      SALEANE was not sure about{' '}
                      {visitQuestions.length === 1
                        ? 'one column'
                        : `${visitQuestions.length} columns`}
                      . Look at the examples and choose what each one is.
                    </p>
                    {visitQuestions.map(({ fileId, file, match }) => (
                      <FieldChoice
                        key={`${fileId}-${match.index}`}
                        id={`${fileId}-v-${match.index}`}
                        heading={match.heading}
                        samples={samples(file, match.index)}
                        value={match.field}
                        options={VISIT_OPTIONS}
                        prompt={`Is “${match.heading}” in ${file.fileName} the ${VISIT_FIELD_LABEL[match.field as keyof typeof VISIT_FIELD_LABEL].toLowerCase()}?`}
                        onChange={(field) => answer(fileId, match.heading, field)}
                        confirm
                      />
                    ))}
                  </>
                )}
                {!!treatmentQuestions.length && (
                  <NameQuestions
                    intro="Which of your treatments is each of these?"
                    matches={treatmentQuestions}
                    items={services}
                    choose="Choose a treatment"
                    onChange={(key, id) => choose('treatment', key, id)}
                  />
                )}
                {!!personQuestions.length && (
                  <NameQuestions
                    intro="Who is each of these on your team?"
                    matches={personQuestions}
                    items={team}
                    choose="Choose who it is"
                    onChange={(key, id) => choose('professional', key, id)}
                  />
                )}
              </div>
            )}
            <div className="ops-summary">
              <div>
                <span>Ready to come across</span>
                <strong>{readyVisits.toLocaleString(org.locale)}</strong>
                <small>
                  {amount(visits.valueMinor)} booked, {amount(visits.depositsMinor)} in deposits
                </small>
              </div>
              <div>
                <span>Already in SALEANE</span>
                <strong>{visits.counts.here}</strong>
                <small>Left exactly as they are</small>
              </div>
              <div>
                <span>Need a look</span>
                <strong>{visits.counts.problem}</strong>
                <small>Not coming across; see why below</small>
              </div>
            </div>
            <VisitTotals review={visits} from={visitNames || 'your old system'} />
            <VisitAttention rows={visits.rows} />
            {visitFiles.map((u) => (
              <ColumnsRead
                key={u.id}
                id={`${u.id}-v`}
                file={u.file}
                matches={u.file.visitMatches}
                options={VISIT_OPTIONS}
                onChange={(heading, field) => answer(u.id, heading, field)}
              />
            ))}
            {canMatch && !!visits.treatments.length && (
              <NamesMatched
                summary="How each treatment was matched"
                matches={visits.treatments}
                items={services}
                onChange={(key, id) => choose('treatment', key, id)}
              />
            )}
            {canMatch && !!visits.professionals.length && (
              <NamesMatched
                summary="How each person was matched"
                matches={visits.professionals}
                items={team}
                onChange={(key, id) => choose('professional', key, id)}
              />
            )}
          </section>
        )}

        {step === 'bring' && (
          <section className="settle" aria-labelledby={headingId}>
            <h3 id={headingId} ref={heading} tabIndex={-1} className="wizard-heading">
              Bring them across
            </h3>
            <p className="moving-lead">
              {plan.visits.length
                ? `${what(plan.clients.length, plan.visits.length)} ${toBring === 1 ? 'is' : 'are'} ready to come across from ${plan.from}.`
                : `${plural(plan.clients.length, 'client')} ${plan.clients.length === 1 ? 'is' : 'are'} ready to come across from ${plan.from}.`}
            </p>
            <ul className="moving-facts">
              {!!(plan.clients.length - plan.newFromVisits) && (
                <>
                  <li>
                    {plan.marketing} agreed to marketing in their old system. Everyone else starts
                    with marketing off.
                  </li>
                  <li>
                    {plural(plan.birthdays, 'birthday')} and {plural(plan.withNotes, 'client')} with
                    notes come with them.
                  </li>
                </>
              )}
              {!!plan.newFromVisits && (
                <li>
                  {plural(plan.newFromVisits, 'client')} named only in your visits file{' '}
                  {plan.newFromVisits === 1 ? 'comes' : 'come'} across too, with marketing off.
                </li>
              )}
              {!!plan.clientsHere && (
                <li>
                  {plan.clientsHere} already in SALEANE {plan.clientsHere === 1 ? 'stays' : 'stay'}{' '}
                  exactly as they are.
                </li>
              )}
              {!!plan.clientProblems && (
                <li>
                  {plural(plan.clientProblems, 'client row')} cannot come across; the Clients step
                  shows why.
                </li>
              )}
              {!!plan.visits.length && (
                <>
                  <li>
                    Each visit keeps the price the guest was quoted, {amount(plan.valueMinor)} in
                    all
                    {plan.depositsMinor
                      ? `, and ${amount(plan.depositsMinor)} in deposits already paid to ${plan.from} counts as paid. SALEANE takes no payment.`
                      : '. No deposits were paid before the move.'}
                  </li>
                  <li>Nobody is sent a confirmation. Reminders follow your message settings.</li>
                </>
              )}
              {!!plan.visitsHere && (
                <li>
                  {plural(plan.visitsHere, 'visit')} already in SALEANE{' '}
                  {plan.visitsHere === 1 ? 'stays' : 'stay'} as{' '}
                  {plan.visitsHere === 1 ? 'it is' : 'they are'}.
                </li>
              )}
              {!!(plan.past + plan.cancelled) && (
                <li>
                  {[
                    plan.past
                      ? `${plural(plan.past, 'past visit')} (history comes in a later step)`
                      : '',
                    plan.cancelled ? plural(plan.cancelled, 'cancelled or missed visit') : '',
                  ]
                    .filter(Boolean)
                    .join(' and ')}{' '}
                  stay behind.
                </li>
              )}
              {!!plan.visitsLeft && (
                <li>
                  {plural(plan.visitsLeft, 'visit')} you chose to leave behind{' '}
                  {plan.visitsLeft === 1 ? 'stays' : 'stay'} in {plan.from}.
                </li>
              )}
              {!!plan.visitsBehind && (
                <li>
                  {plural(plan.visitsBehind, 'other visit')} cannot come across; the Visits step
                  shows why.
                </li>
              )}
            </ul>
            <label className="ops-check">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={!toBring || running}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              <span>
                I have checked the {what(plan.clients.length, plan.visits.length)} against my old
                system and may bring them across.
              </span>
            </label>
            {run && (
              <p role="status" className="moving-progress">
                Bringing {run.phase} across: part{' '}
                {Math.min(
                  run.next + 1,
                  run.phase === 'clients' ? run.clientParts.length : run.visitParts.length,
                )}{' '}
                of {run.phase === 'clients' ? run.clientParts.length : run.visitParts.length}…
              </p>
            )}
          </section>
        )}

        {!allowed && (
          <p className="ops-help">Only an owner or manager can bring clients and visits across.</p>
        )}
        <ErrorMessage error={error} />
        <WizardFooter>
          {at > 0 ? (
            <Button variant="quiet" disabled={running} onClick={() => go(steps[at - 1])}>
              <ArrowLeft size={16} />
              Back
            </Button>
          ) : (
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
          )}
          {step !== 'bring' ? (
            <Button disabled={!canContinue} onClick={() => go(steps[at + 1])}>
              Continue <ArrowRight size={17} />
            </Button>
          ) : (
            <Button
              disabled={!canSave}
              aria-label={running ? undefined : `Bring ${bringing} across`}
              onClick={() => {
                setError('')
                setRun({
                  plan: live,
                  phase: live.clients.length ? 'clients' : 'visits',
                  clientParts: movingParts(live.clients),
                  visitParts: inParts(live.visits, VISIT_PART_ROWS),
                  next: 0,
                  savedClients: 0,
                  savedVisits: 0,
                })
              }}
            >
              {running ? (
                'Bringing them across…'
              ) : (
                <>
                  {/* On a phone the counts stay in the tick above, so the button fits. */}
                  <span className="moving-wide" aria-hidden="true">
                    Bring {bringing} across
                  </span>
                  <span className="moving-narrow" aria-hidden="true">
                    Bring them across
                  </span>
                </>
              )}
            </Button>
          )}
        </WizardFooter>
      </div>
    </Modal>
  )
}

function inParts<T>(items: T[], size: number) {
  const parts: T[][] = []
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size))
  return parts
}

type Option = { value: string; label: string }
const CLIENT_OPTIONS: Option[] = clientFields.map((f) => ({ value: f, label: FIELD_LABEL[f] }))
const VISIT_OPTIONS: Option[] = visitFields.map((f) => ({ value: f, label: VISIT_FIELD_LABEL[f] }))

function fileSummary(file: MovingFile) {
  const from = file.system ? `${SYSTEM_NAME[file.system]} ` : ''
  const count = plural(file.rows.length, 'row')
  if (file.kind === 'clients') return capital(`${from}${file.report ?? 'client list'} · ${count}`)
  if (file.kind === 'visits') return capital(`${from}${file.report ?? 'visits'} · ${count}`)
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
  options,
  prompt,
  note,
  confirm,
  onChange,
}: {
  id: string
  heading: string
  samples: string[]
  value: string | null
  options: Option[]
  prompt: string
  note?: string
  confirm?: boolean
  onChange: (field: string | null) => void
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
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">Leave it out</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
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

function ColumnsRead({
  id,
  file,
  matches,
  options,
  onChange,
}: {
  id: string
  file: MovingFile
  matches: ColumnMatch<string>[]
  options: Option[]
  onChange: (heading: string, field: string | null) => void
}) {
  return (
    <details className="moving-columns">
      <summary>How each column in {file.fileName} was read</summary>
      <ul>
        {matches.map((m) => (
          <li key={m.index}>
            <FieldChoice
              id={`${id}-all-${m.index}`}
              heading={m.heading}
              samples={samples(file, m.index)}
              value={m.field}
              options={options}
              prompt={m.heading}
              note={m.field ? undefined : m.leftOut}
              onChange={(field) => onChange(m.heading, field)}
            />
          </li>
        ))}
      </ul>
    </details>
  )
}

/** One old treatment or person: confirm the likely match, choose one, or leave their visits behind. */
function NameChoice({
  match,
  items,
  choose,
  confirm,
  onChange,
}: {
  match: NameMatch
  items: { id: string; name: string }[]
  choose: string
  confirm?: boolean
  onChange: (key: string, id: string | null) => void
}) {
  const selectId = useId()
  const value = match.id === null ? LEAVE : (match.id ?? '')
  return (
    <div className="moving-field">
      <div>
        <label htmlFor={selectId}>“{match.name}”</label>
        <small>
          {plural(match.visits, 'upcoming visit')}
          {match.how === 'suggested' ? '. Most likely the one shown' : ''}
        </small>
      </div>
      <div className="moving-field-actions">
        <select
          id={selectId}
          value={value}
          aria-label={`What “${match.name}” is`}
          onChange={(event) =>
            event.target.value &&
            onChange(match.key, event.target.value === LEAVE ? null : event.target.value)
          }
        >
          {match.id === undefined && <option value="">{choose}</option>}
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
          <option value={LEAVE}>Leave these visits behind</option>
        </select>
        {confirm && match.how === 'suggested' && (
          <Button variant="secondary" onClick={() => onChange(match.key, match.id ?? null)}>
            Yes, that’s right
          </Button>
        )}
      </div>
    </div>
  )
}

function NameQuestions({
  intro,
  matches,
  items,
  choose,
  onChange,
}: {
  intro: string
  matches: NameMatch[]
  items: { id: string; name: string }[]
  choose: string
  onChange: (key: string, id: string | null) => void
}) {
  return (
    <>
      <p>{intro}</p>
      {matches.map((m) => (
        <NameChoice
          key={m.key}
          match={m}
          items={items}
          choose={choose}
          confirm
          onChange={onChange}
        />
      ))}
    </>
  )
}

function NamesMatched({
  summary,
  matches,
  items,
  onChange,
}: {
  summary: string
  matches: NameMatch[]
  items: { id: string; name: string }[]
  onChange: (key: string, id: string | null) => void
}) {
  return (
    <details className="moving-columns">
      <summary>{summary}</summary>
      <ul>
        {matches.map((m) => (
          <li key={m.key}>
            <NameChoice match={m} items={items} choose="Choose one" onChange={onChange} />
          </li>
        ))}
      </ul>
    </details>
  )
}

/** The totals to hold up against the old system's own report, and what stays behind. */
function VisitTotals({ review, from }: { review: VisitReview; from: string }) {
  const { state } = useStore()
  const org = state.organisation
  const lines: ReactNode[] = []
  if (review.ready.length && review.first && review.last) {
    const when =
      review.first === review.last
        ? `on ${dateLabel(review.first, org.locale)}`
        : `from ${dateLabel(review.first, org.locale)} to ${dateLabel(review.last, org.locale)}`
    lines.push(
      `Check these against ${from}: ${plural(review.ready.length, 'visit')} ${when}, ${money(review.valueMinor, org, true)} booked and ${money(review.depositsMinor, org, true)} in deposits paid there.`,
    )
  }
  const { past, cancelled, skipped } = review.counts
  const behind = [
    past
      ? `${plural(past, 'past visit')}, which ${past === 1 ? 'comes' : 'come'} across in a later step`
      : '',
    cancelled
      ? `${plural(cancelled, 'cancelled or missed visit')}, which ${cancelled === 1 ? 'stays' : 'stay'} behind`
      : '',
  ].filter(Boolean)
  if (behind.length) lines.push(`Also in your files: ${behind.join(', and ')}.`)
  if (skipped)
    lines.push(
      `${plural(skipped, 'visit')} you chose to leave behind ${skipped === 1 ? 'stays' : 'stay'} in ${from}.`,
    )
  if (review.counts.combined)
    lines.push(
      `${plural(review.counts.combined, 'visit')} ${review.counts.combined === 1 ? 'was' : 'were'} listed twice and ${review.counts.combined === 1 ? 'comes' : 'come'} across once.`,
    )
  if (!lines.length) return null
  return (
    <div className="moving-totals">
      {lines.map((line, i) => (
        <p key={i} className="ops-help">
          {line}
        </p>
      ))}
    </div>
  )
}

/** Visits that need a look, grouped by reason, with a few examples each. */
function VisitAttention({ rows }: { rows: VisitRow[] }) {
  const groups = new Map<string, VisitRow[]>()
  const put = (reason: string, row: VisitRow) =>
    groups.set(reason, [...(groups.get(reason) ?? []), row])
  for (const row of rows) {
    if (row.status === 'problem') put(row.detail, row)
    for (const note of row.notes) put(note, row)
  }
  if (!groups.size) return null
  // With one visits file, each example needs only its line.
  const oneFile = new Set(rows.map((row) => row.fileName)).size === 1
  // What is not coming across first, then notes on visits that are; the commonest reason leads.
  const blocking = (group: VisitRow[]) => (group[0].status === 'problem' ? 0 : 1)
  const listed = [...groups.entries()].sort(
    (a, b) => blocking(a[1]) - blocking(b[1]) || b[1].length - a[1].length,
  )
  return (
    <div className="moving-attention" role="region" aria-label="Visits to look at" tabIndex={0}>
      <ul>
        {listed.slice(0, LIST_LIMIT).map(([reason, group]) => (
          <li key={reason}>
            <strong>
              {group[0].status === 'problem'
                ? `${plural(group.length, 'visit')} not coming across`
                : `${plural(group.length, 'visit')} coming across`}
            </strong>
            <p>{reason}</p>
            <ul className="moving-examples">
              {group.slice(0, 3).map((row) => (
                <li key={`${row.fileName}-${row.line}`}>
                  {row.label || 'No details'} · {oneFile ? '' : `${row.fileName}, `}line {row.line}
                </li>
              ))}
              {group.length > 3 && <li>And {plural(group.length - 3, 'more visit')}</li>}
            </ul>
          </li>
        ))}
      </ul>
      {listed.length > LIST_LIMIT && (
        <p className="ops-help">And {listed.length - LIST_LIMIT} more reasons like these.</p>
      )}
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
