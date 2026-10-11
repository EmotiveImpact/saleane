import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, CircleAlert, FileUp, Upload, X } from 'lucide-react'
import { useStore } from '../state/context'
import type { Command } from '../domain/commands'
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
  Select,
  Checkbox,
  LoadingShapes,
} from '../design'
import { readSheet } from '../domain/movingIn/sheet'
import type { Sheet } from '../domain/movingIn/sheet'
import { FIELD_LABEL, clientFields, headingKey } from '../domain/movingIn/fields'
import type { ColumnMatch } from '../domain/movingIn/fields'
import { VISIT_FIELD_LABEL, visitFields } from '../domain/movingIn/visitFields'
import { MONEY_FIELD_LABEL, moneyFields } from '../domain/movingIn/moneyFields'
import {
  KIND_LABEL,
  MONEY_KINDS,
  SYSTEM_NAME,
  UK_FIRST,
  WHERE_TO_EXPORT,
  WHERE_TO_EXPORT_MONEY,
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
import { moneyParts, moneyRows, reviewMoney } from '../domain/movingIn/money'
import type {
  MoneyChoices,
  MoneyKind,
  MoneyRow,
  MoneyRowStatus,
  PlannedCard,
  PlannedCredit,
  PlannedPackage,
  SignQuestion,
  TotalCheck,
} from '../domain/movingIn/money'
import './management.css'
import './movingIn.css'

type Added = { id: string; fileName: string; sheet?: Sheet; error?: string }
type StepId = 'system' | 'files' | 'check' | 'clients' | 'visits' | 'money' | 'bring'
const STEP_LABEL: Record<StepId, string> = {
  system: 'Old system',
  files: 'Your files',
  check: 'Check',
  clients: 'Clients',
  visits: 'Visits',
  money: 'Money held',
  bring: 'Bring across',
}

/** Rows that need the owner's eye are listed; everyone else is counted. */
const LIST_LIMIT = 60
/** Files read in one go; more can be added straight after. */
const FILES_AT_ONCE = 20
/** Visits, gift cards and packages per request: the server takes up to 200 in one import. */
const VISIT_PART_ROWS = 200
/** Carried balances per request: the server takes up to 500. */
const CREDIT_PART_ROWS = 500
/** The choice that leaves an old treatment's or person's visits behind. */
const LEAVE = '__leave'

/** The numbers the last step and the finished screen show, kept still while saving. */
type Plan = {
  from: string
  clients: MovingClient[]
  visits: PlannedVisit[]
  cards: PlannedCard[]
  packages: PlannedPackage[]
  credit: PlannedCredit[]
  marketing: number
  birthdays: number
  withNotes: number
  clientsHere: number
  clientProblems: number
  newFromVisits: number
  newFromMoney: number
  valueMinor: number
  depositsMinor: number
  visitsHere: number
  past: number
  cancelled: number
  visitsBehind: number
  visitsLeft: number
  hasVisitFiles: boolean
  cardsMinor: number
  newCodes: number
  packagesMinor: number
  packageVisits: number
  creditMinor: number
  owedMinor: number
  moneyHere: number
  moneyStaying: number
  moneyBehind: number
  moneyLeft: number
  memberships: boolean
}

type PartKind = 'clients' | 'visits' | 'cards' | 'packages' | 'credit'
/** One request's worth of records, and where it sits among the parts of its kind. */
type Part = { index: number; of: number } & (
  | { kind: 'clients'; rows: MovingClient[] }
  | { kind: 'visits'; rows: PlannedVisit[] }
  | { kind: 'cards'; rows: PlannedCard[] }
  | { kind: 'packages'; rows: PlannedPackage[] }
  | { kind: 'credit'; rows: PlannedCredit[] }
)
type Counts = Record<PartKind, number>
type Run = { plan: Plan; parts: Part[]; next: number; saved: Counts }

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

const PART_WORDS: Record<PartKind, [string, string]> = {
  clients: ['client', 'clients'],
  visits: ['visit', 'visits'],
  cards: ['gift card', 'gift cards'],
  packages: ['package', 'packages'],
  credit: ['balance', 'balances'],
}

/** "412 clients, 128 visits and 3 gift cards", leaving out whatever is none. */
function what(counts: Partial<Counts>) {
  const parts = (Object.keys(PART_WORDS) as PartKind[])
    .filter((kind) => counts[kind])
    .map((kind) => plural(counts[kind]!, ...PART_WORDS[kind]))
  return new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(parts)
}

const planCounts = (plan: Plan): Counts => ({
  clients: plan.clients.length,
  visits: plan.visits.length,
  cards: plan.cards.length,
  packages: plan.packages.length,
  credit: plan.credit.length,
})

/** Every part to send, in order: clients first, then what belongs to them. */
function partsOf(plan: Plan): Part[] {
  const split = <K extends PartKind, T>(kind: K, parts: T[][]) =>
    parts.map((rows, index) => ({ kind, rows, index, of: parts.length }))
  return [
    ...split('clients', movingParts(plan.clients)),
    ...split('visits', moneyParts(plan.visits, VISIT_PART_ROWS)),
    ...split('cards', moneyParts(plan.cards, VISIT_PART_ROWS)),
    ...split('packages', moneyParts(plan.packages, VISIT_PART_ROWS)),
    ...split('credit', moneyParts(plan.credit, CREDIT_PART_ROWS)),
  ] as Part[]
}

/**
 * Moving in from another system, as a few short steps: the old system, its files exactly as they
 * come, a check of the clients, the upcoming visits and the money held for clients (with a
 * question only where SALEANE is unsure), then bringing them across: clients first, then the
 * visits, gift cards, packages and credit that belong to them.
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
  const [moneyChoices, setMoneyChoices] = useState<MoneyChoices>({ packages: {}, signs: {} })
  const [reading, setReading] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [run, setRun] = useState<Run | null>(null)
  const [done, setDone] = useState<{ plan: Plan; saved: Counts } | null>(null)
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
  const moneyFiles = useMemo(
    () => understood.filter((u) => MONEY_KINDS.includes(u.file.kind) && !u.file.unread),
    [understood],
  )
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
  // Credit can sit in a client list as well as in a file of its own.
  const moneyHeld = useMemo(
    () =>
      reviewMoney(
        [...clientFiles, ...moneyFiles].map((u) => u.file),
        state,
        [...review.ready, ...visits.newClients],
        moneyChoices,
        system ?? 'other',
        now,
        review.rows.flatMap((r) => r.name ?? []),
      ),
    [clientFiles, moneyFiles, state, review, visits, moneyChoices, system, now],
  )
  const hasMoney = moneyFiles.length > 0 || moneyHeld.rows.length > 0
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
  const moneyQuestions = columnQuestions(moneyFiles, (f) => f.moneyMatches)
  const services = state.services.filter((s) => !s.archived)
  const team = state.staff.filter((p) => !p.archived)
  const canMatch = !!services.length && !!team.length
  const treatmentQuestions = canMatch ? visits.treatments.filter(needsAnswer) : []
  const personQuestions = canMatch ? visits.professionals.filter(needsAnswer) : []
  const nameQuestions = treatmentQuestions.length + personQuestions.length
  const packageQuestions = services.length ? moneyHeld.treatments.filter(needsAnswer) : []
  const signQuestions = moneyHeld.signs.filter((q) => q.how === 'suggested')
  const moneyAsks = moneyQuestions.length + packageQuestions.length + signQuestions.length

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
  const moneyNames = namesOf(moneyFiles.length ? moneyFiles : clientFiles)
  const fromNames = namesOf([...clientFiles, ...visitFiles, ...moneyFiles])
  const label = clientNames
    ? `${clientNames} client ${clientFiles.length > 1 ? 'lists' : 'list'}`
    : 'Previous system client list'
  const visitSource = visitNames || 'your old system'
  const moneySource = moneyNames || 'your old system'
  const running = run !== null
  const { counts: held } = moneyHeld

  const live: Plan = {
    from: fromNames || 'your old system',
    clients: [...review.ready, ...visits.newClients, ...moneyHeld.newClients],
    visits: visits.ready,
    cards: moneyHeld.cards,
    packages: moneyHeld.packages,
    credit: moneyHeld.credit,
    marketing: review.marketing,
    birthdays: review.birthdays,
    withNotes: review.withNotes,
    clientsHere: review.counts.here,
    clientProblems: review.counts.problem,
    newFromVisits: visits.newClients.length,
    newFromMoney: moneyHeld.newClients.length,
    valueMinor: visits.valueMinor,
    depositsMinor: visits.depositsMinor,
    visitsHere: visits.counts.here,
    past: visits.counts.past,
    cancelled: visits.counts.cancelled,
    visitsBehind: visits.counts.problem,
    visitsLeft: visits.counts.skipped,
    hasVisitFiles: !!visitFiles.length,
    cardsMinor: moneyHeld.cardsMinor,
    newCodes: moneyHeld.cards.filter((c) => !c.code).length,
    packagesMinor: moneyHeld.packagesMinor,
    packageVisits: moneyHeld.packageVisits,
    creditMinor: moneyHeld.creditMinor,
    owedMinor: moneyHeld.owedMinor,
    moneyHere: held.here,
    moneyStaying: moneyHeld.rows.filter(
      (r) => r.status === 'expired' || r.status === 'cancelled' || (r.status === 'used' && r.left),
    ).length,
    moneyBehind: held.problem,
    moneyLeft: held.skipped,
    memberships: understood.some((u) => u.file.kind === 'memberships'),
  }
  const plan = run?.plan ?? live

  // Each part is sent once the studio has the previous one, so every request carries the latest
  // revision. Clients go first; each visit, package and balance then finds the client the server
  // saved for it.
  useEffect(() => {
    if (!run || saving || sending.current || run.next >= run.parts.length) return
    const part = run.parts[run.next]
    const stop = (message: string) => {
      const savedNote = what(run.saved)
      setError(
        `${savedNote ? `${savedNote} came across before this stopped. ` : ''}${message} Review again to bring the rest across; anything already saved shows as already here.`,
      )
      setRun(null)
      setReviewed(false)
    }
    let command: Command
    let count = part.rows.length
    if (part.kind === 'clients')
      command = {
        type: 'import-clients',
        source: part.of > 1 ? `${label} (part ${part.index + 1} of ${part.of})` : label,
        contacts: part.rows,
        reviewed: true,
      }
    else if (part.kind === 'visits') {
      const { rows, lost } = visitRows(part.rows, state)
      if (lost)
        return stop(
          `${plural(lost, 'visit')} could not find the client brought across for ${lost === 1 ? 'it' : 'them'}.`,
        )
      command = {
        type: 'import-appointments',
        source: visitSource,
        appointments: rows,
        reviewed: true,
      }
      count = rows.length
    } else {
      const found = moneyRows({ [part.kind]: part.rows }, state)
      if (found.lost)
        return stop(
          `${plural(found.lost, ...PART_WORDS[part.kind])} could not find the client brought across for ${found.lost === 1 ? 'it' : 'them'}.`,
        )
      command =
        part.kind === 'cards'
          ? { type: 'import-gift-cards', source: moneySource, cards: found.cards, reviewed: true }
          : part.kind === 'packages'
            ? {
                type: 'import-packages',
                source: moneySource,
                packages: found.packages,
                reviewed: true,
              }
            : {
                type: 'import-balances',
                source: moneySource,
                balances: found.credit,
                reviewed: true,
              }
    }
    sending.current = true
    void commit(command)
      .then((result) => {
        // Cleared before the next part is asked for, so its effect is free to send it.
        sending.current = false
        if (!result.ok) return stop(result.error)
        const saved = { ...run.saved, [part.kind]: run.saved[part.kind] + count }
        if (run.next + 1 < run.parts.length) setRun({ ...run, saved, next: run.next + 1 })
        else {
          setDone({ plan: run.plan, saved })
          setRun(null)
        }
      })
      .catch(() => {
        sending.current = false
        stop('The connection dropped.')
      })
  }, [run, saving, commit, label, visitSource, moneySource, state])

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

  function chooseMoney<K extends keyof MoneyChoices>(
    kind: K,
    key: string,
    value: MoneyChoices[K][string],
  ) {
    setMoneyChoices((current) => ({ ...current, [kind]: { ...current[kind], [key]: value } }))
    setReviewed(false)
  }

  // The steps follow the files: a check for clients, for visits, for money held, or for each.
  const steps: StepId[] = [
    'system',
    'files',
    ...(clientFiles.length || visitFiles.length || hasMoney
      ? [
          ...(clientFiles.length ? (['clients'] as const) : []),
          ...(visitFiles.length ? (['visits'] as const) : []),
          ...(hasMoney ? (['money'] as const) : []),
        ]
      : (['check'] as const)),
    'bring',
  ]
  const at = Math.max(0, steps.indexOf(step))
  const heading = useWizardStep(at + 1)
  const ready = review.ready.length
  const readyVisits = visits.ready.length
  const readyMoney = moneyHeld.cards.length + moneyHeld.packages.length + moneyHeld.credit.length
  const toBring = Object.values(planCounts(plan)).reduce((sum, n) => sum + n, 0)
  const questionsLeft =
    (clientFiles.length ? clientQuestions.length : 0) +
    visitQuestions.length +
    nameQuestions +
    moneyAsks
  const canSave = allowed && !running && !saving && reviewed && toBring > 0 && !questionsLeft
  const systemName = system && system !== 'other' ? SYSTEM_NAME[system] : ''
  const anythingReady = ready > 0 || readyVisits > 0 || readyMoney > 0
  const canContinue =
    step === 'system'
      ? !!system
      : step === 'files'
        ? !reading && (clientFiles.length > 0 || visitFiles.length > 0 || hasMoney)
        : step === 'clients'
          ? !clientQuestions.length && (ready > 0 || visitFiles.length > 0 || hasMoney)
          : step === 'visits'
            ? !visitQuestions.length && !nameQuestions && (anythingReady || hasMoney)
            : step === 'money'
              ? !moneyAsks && anythingReady
              : false

  function go(next: StepId) {
    setError('')
    // Going back means looking again, so the last step asks for the tick afresh.
    if (steps.indexOf(next) < at) setReviewed(false)
    setStep(next)
  }

  const amount = (minor: number) => money(minor, org, true)
  const bringing = what(planCounts(plan)) || 'them'

  if (done !== null)
    return (
      <Modal
        open
        wide
        onClose={onClose}
        title="Moved in"
        description="Everything you checked is here."
      >
        <div className="confirmation">
          <span className="confirmation-mark">
            <Check />
          </span>
          <h3>
            {what(done.saved)} brought across from {done.plan.from}
          </h3>
          <p>
            {done.saved.clients ? 'Each client shows where they came from on their timeline. ' : ''}
            {done.saved.visits
              ? 'The visits are in the calendar with the price each guest was quoted, and nobody was sent a confirmation. '
              : ''}
            {done.saved.cards
              ? 'Gift cards work at the desk with the codes guests already have; any new code is on the Gift cards page. '
              : ''}
            {done.saved.packages || done.saved.credit
              ? `${done.saved.packages && done.saved.credit ? 'Packages and credit show' : done.saved.packages ? 'Packages show' : 'Credit shows'} on each client’s record. `
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
              <p>
                <b>Gift cards, packages and credit.</b> {WHERE_TO_EXPORT_MONEY[system]}
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
                CSV or Excel, exactly as they come. Add them all together, or just some of them.
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
            {reading && <LoadingShapes rows={2} label="Reading your files…" />}
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
            {!!files.length &&
              !reading &&
              !clientFiles.length &&
              !visitFiles.length &&
              !hasMoney && (
                <p className="ops-help">
                  None of these is a list SALEANE can bring across yet. Add the list with your
                  clients’ names and their emails or phone numbers, the list of upcoming
                  appointments, or your gift cards, packages or credit.
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

        {step === 'money' && (
          <section className="settle" aria-labelledby={headingId}>
            <h3 id={headingId} ref={heading} tabIndex={-1} className="wizard-heading">
              {moneyAsks ? 'Check a few things first' : 'Check gift cards, packages and credit'}
            </h3>
            <p className="moving-lead">
              Your clients paid for these in {moneySource}, so they come across as paid there and
              never count as takings twice.
            </p>
            {!services.length && moneyHeld.rows.some((r) => r.kind === 'packages') && (
              <p className="moving-guide">
                Your studio has no treatments in SALEANE yet, so packages have nothing to cover. Add
                your treatments in Settings first, then bring the packages across.
              </p>
            )}
            {!!moneyAsks && (
              <div className="moving-questions">
                {!!moneyQuestions.length && (
                  <>
                    <p>
                      SALEANE was not sure about{' '}
                      {moneyQuestions.length === 1
                        ? 'one column'
                        : `${moneyQuestions.length} columns`}
                      . Look at the examples and choose what each one is.
                    </p>
                    {moneyQuestions.map(({ fileId, file, match }) => (
                      <FieldChoice
                        key={`${fileId}-${match.index}`}
                        id={`${fileId}-m-${match.index}`}
                        heading={match.heading}
                        samples={samples(file, match.index)}
                        value={match.field}
                        options={MONEY_OPTIONS}
                        prompt={`Is “${match.heading}” in ${file.fileName} ${moneyFieldWords(match.field)}?`}
                        onChange={(field) => answer(fileId, match.heading, field)}
                        confirm
                      />
                    ))}
                  </>
                )}
                {!!signQuestions.length && (
                  <>
                    <p>
                      Which way round are the amounts in{' '}
                      {signQuestions.length === 1 ? 'this file' : 'these files'}?
                    </p>
                    {signQuestions.map((question) => (
                      <SignChoice
                        key={question.fileName}
                        question={question}
                        system={system}
                        onChange={(positive) => chooseMoney('signs', question.fileName, positive)}
                      />
                    ))}
                  </>
                )}
                {!!packageQuestions.length && (
                  <NameQuestions
                    intro="Which of your treatments is each package for?"
                    matches={packageQuestions}
                    items={services}
                    choose="Choose a treatment"
                    noun="package"
                    leave="Leave these packages behind"
                    onChange={(key, id) => chooseMoney('packages', key, id)}
                  />
                )}
              </div>
            )}
            <div className="ops-summary">
              <div>
                <span>Gift cards</span>
                <strong>{moneyHeld.cards.length.toLocaleString(org.locale)}</strong>
                <small>{amount(moneyHeld.cardsMinor)} left to spend</small>
              </div>
              <div>
                <span>Packages</span>
                <strong>{moneyHeld.packages.length.toLocaleString(org.locale)}</strong>
                <small>{plural(moneyHeld.packageVisits, 'visit')} left</small>
              </div>
              <div>
                <span>Credit</span>
                <strong>{amount(moneyHeld.creditMinor)}</strong>
                <small>
                  {plural(moneyHeld.credit.filter((c) => c.kind === 'credit').length, 'client')}
                  {moneyHeld.owedMinor ? `; ${amount(moneyHeld.owedMinor)} owed to you` : ''}
                </small>
              </div>
            </div>
            <MoneyChecks checks={moneyHeld.checks} />
            <MoneyAttention rows={moneyHeld.rows} />
            {moneyFiles.map((u) => (
              <ColumnsRead
                key={u.id}
                id={`${u.id}-m`}
                file={u.file}
                matches={u.file.moneyMatches}
                options={MONEY_OPTIONS}
                onChange={(heading, field) => answer(u.id, heading, field)}
              />
            ))}
            {!!services.length && !!moneyHeld.treatments.length && (
              <NamesMatched
                summary="How each package was matched"
                matches={moneyHeld.treatments}
                items={services}
                noun="package"
                leave="Leave these packages behind"
                onChange={(key, id) => chooseMoney('packages', key, id)}
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
              {capital(what(planCounts(plan)))} {toBring === 1 ? 'is' : 'are'} ready to come across
              from {plan.from}.
            </p>
            <ul className="moving-facts">
              {!!(plan.clients.length - plan.newFromVisits - plan.newFromMoney) && (
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
              {!!plan.newFromMoney && (
                <li>
                  {plural(plan.newFromMoney, 'client')} named only in your package or credit files{' '}
                  {plan.newFromMoney === 1 ? 'comes' : 'come'} across too, with marketing off.
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
              {!!plan.cards.length && (
                <li>
                  {plural(plan.cards.length, 'gift card')} with {amount(plan.cardsMinor)} left to
                  spend.{' '}
                  {plan.newCodes
                    ? `${plural(plan.newCodes, 'card')} ${plan.newCodes === 1 ? 'gets' : 'get'} a new SALEANE code for the desk to give the guest; the rest keep their codes.`
                    : 'Each keeps its code, so guests use the card they already have.'}
                </li>
              )}
              {!!plan.packages.length && (
                <li>
                  {plural(plan.packages.length, 'package')} with{' '}
                  {plural(plan.packageVisits, 'visit')} left, worth {amount(plan.packagesMinor)}.
                  Each visit comes off the package at the desk.
                </li>
              )}
              {!!plan.credit.length && (
                <li>
                  {[
                    plan.creditMinor
                      ? `${amount(plan.creditMinor)} in credit for ${plural(plan.credit.filter((c) => c.kind === 'credit').length, 'client')}`
                      : '',
                    plan.owedMinor
                      ? `${amount(plan.owedMinor)} owed to you by ${plural(plan.credit.filter((c) => c.kind === 'owed').length, 'client')}`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(', and ')}
                  , recorded on each client’s record for the desk.
                </li>
              )}
              {!!(plan.cards.length + plan.packages.length + plan.credit.length) && (
                <li>
                  All of it was settled in {plan.from}, so none of it counts as takings in SALEANE.
                  No card is charged and no money is given back.
                </li>
              )}
              {!!plan.moneyHere && (
                <li>
                  {plural(
                    plan.moneyHere,
                    'gift card, package or balance',
                    'gift cards, packages or balances',
                  )}{' '}
                  already in SALEANE {plan.moneyHere === 1 ? 'stays' : 'stay'} as{' '}
                  {plan.moneyHere === 1 ? 'it is' : 'they are'}.
                </li>
              )}
              {!!plan.moneyStaying && (
                <li>
                  {plural(plan.moneyStaying, 'expired or cancelled item')} with money still on{' '}
                  {plan.moneyStaying === 1 ? 'it stays' : 'them stay'} in {plan.from}.
                </li>
              )}
              {!!plan.moneyLeft && (
                <li>
                  {plural(plan.moneyLeft, 'package')} you chose to leave behind{' '}
                  {plan.moneyLeft === 1 ? 'stays' : 'stay'} in {plan.from}.
                </li>
              )}
              {!!plan.moneyBehind && (
                <li>
                  {plural(plan.moneyBehind, 'other row')} of gift cards, packages or credit cannot
                  come across; the Money held step shows why.
                </li>
              )}
              {plan.memberships && (
                <li>
                  Memberships come across once clients save their card again, so your memberships
                  file stays behind for now.
                </li>
              )}
            </ul>
            <label className="ops-check">
              <Checkbox
                checked={reviewed}
                disabled={!toBring || running}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              <span>
                I have checked the {what(planCounts(plan))} against my old system and may bring them
                across.
              </span>
            </label>
            {run && run.next < run.parts.length && (
              <p role="status" className="moving-progress">
                Bringing {PART_WORDS[run.parts[run.next].kind][1]} across: part{' '}
                {run.parts[run.next].index + 1} of {run.parts[run.next].of}…
              </p>
            )}
          </section>
        )}

        {!allowed && <p className="ops-help">Only an owner or manager can bring records across.</p>}
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
                  parts: partsOf(live),
                  next: 0,
                  saved: { clients: 0, visits: 0, cards: 0, packages: 0, credit: 0 },
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

type Option = { value: string; label: string }
const CLIENT_OPTIONS: Option[] = clientFields.map((f) => ({ value: f, label: FIELD_LABEL[f] }))
const VISIT_OPTIONS: Option[] = visitFields.map((f) => ({ value: f, label: VISIT_FIELD_LABEL[f] }))
const MONEY_OPTIONS: Option[] = moneyFields.map((f) => ({ value: f, label: MONEY_FIELD_LABEL[f] }))

/** "the code", "what is left to spend": a money column's meaning, to ask about it. */
function moneyFieldWords(field: string | null) {
  const label = MONEY_FIELD_LABEL[field as keyof typeof MONEY_FIELD_LABEL] ?? ''
  return field === 'balance' ? 'what is left to spend' : `the ${label.toLowerCase()}`
}

function fileSummary(file: MovingFile) {
  const from = file.system ? `${SYSTEM_NAME[file.system]} ` : ''
  const count = plural(file.rows.length, 'row')
  const named = capital(`${from}${file.report ?? KIND_LABEL[file.kind]} · ${count}`)
  if (file.unread) return `${named}. ${file.unread}`
  if (file.kind === 'unknown')
    return `${count}. SALEANE could not tell what this list is. If it is your clients, check it has a name column and an email or phone column.`
  if (file.kind === 'totals') return `${named}. Used to check your totals.`
  if (file.kind === 'memberships')
    return `${named}. Memberships come across once clients save their card again, so this file stays behind for now.`
  if (file.kind === 'payments')
    return `${named}. Past payments stay in your old system; SALEANE counts takings from the day you move.`
  return named
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
        <Select
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
        </Select>
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

/**
 * One old treatment, person or package: confirm the likely match, choose one, or leave what uses
 * it behind.
 */
function NameChoice({
  match,
  items,
  choose,
  confirm,
  noun = 'upcoming visit',
  leave = 'Leave these visits behind',
  onChange,
}: {
  match: NameMatch
  items: { id: string; name: string }[]
  choose: string
  confirm?: boolean
  noun?: string
  leave?: string
  onChange: (key: string, id: string | null) => void
}) {
  const selectId = useId()
  const value = match.id === null ? LEAVE : (match.id ?? '')
  return (
    <div className="moving-field">
      <div>
        <label htmlFor={selectId}>“{match.name}”</label>
        <small>
          {plural(match.visits, noun)}
          {match.how === 'suggested' ? '. Most likely the one shown' : ''}
        </small>
      </div>
      <div className="moving-field-actions">
        <Select
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
          <option value={LEAVE}>{leave}</option>
        </Select>
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
  noun,
  leave,
  onChange,
}: {
  intro: string
  matches: NameMatch[]
  items: { id: string; name: string }[]
  choose: string
  noun?: string
  leave?: string
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
          noun={noun}
          leave={leave}
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
  noun,
  leave,
  onChange,
}: {
  summary: string
  matches: NameMatch[]
  items: { id: string; name: string }[]
  noun?: string
  leave?: string
  onChange: (key: string, id: string | null) => void
}) {
  return (
    <details className="moving-columns">
      <summary>{summary}</summary>
      <ul>
        {matches.map((m) => (
          <li key={m.key}>
            <NameChoice
              match={m}
              items={items}
              choose="Choose one"
              noun={noun}
              leave={leave}
              onChange={onChange}
            />
          </li>
        ))}
      </ul>
    </details>
  )
}

/** A credit file whose amounts could go either way: what an amount above zero means. */
function SignChoice({
  question,
  system,
  onChange,
}: {
  question: SignQuestion
  system: OldSystem | null
  onChange: (positive: 'credit' | 'owed') => void
}) {
  const selectId = useId()
  return (
    <div className="moving-field">
      <div>
        <label htmlFor={selectId}>In {question.fileName}, an amount above zero means</label>
        <small>
          For example: {question.samples.join(', ')}
          {system === 'phorest' && question.positive === 'owed'
            ? '. Phorest writes what a client owes above zero, and their credit below it'
            : ''}
        </small>
      </div>
      <div className="moving-field-actions">
        <Select
          id={selectId}
          value={question.positive}
          aria-label={`What an amount above zero means in ${question.fileName}`}
          onChange={(event) => onChange(event.target.value as 'credit' | 'owed')}
        >
          <option value="credit">The client has credit</option>
          <option value="owed">The client owes you</option>
        </Select>
        {question.how === 'suggested' && (
          <Button variant="secondary" onClick={() => onChange(question.positive)}>
            Yes, that’s right
          </Button>
        )}
      </div>
    </div>
  )
}

const MONEY_NOUN: Record<MoneyKind, [string, string]> = {
  giftCards: ['gift card', 'gift cards'],
  packages: ['package', 'packages'],
  credit: ['balance', 'balances'],
}
const CHECK_NAME: Record<MoneyKind, [string, string, string]> = {
  giftCards: ['Gift cards', 'match', 'do not match'],
  packages: ['Packages', 'match', 'do not match'],
  credit: ['Credit', 'matches', 'does not match'],
}
/** Why some of a total stays behind, after "on 1 card". */
const BEHIND_WORDS: Partial<Record<MoneyRowStatus, (one: boolean) => string>> = {
  expired: () => 'that expired',
  cancelled: () => 'cancelled in the old system',
  used: () => 'marked as used',
  here: () => 'already in SALEANE',
  problem: (one) => (one ? 'that needs a look' : 'that need a look'),
  skipped: () => 'you chose to leave behind',
  combined: () => 'listed twice',
}

/** What comes across, held up against the old system's own totals. */
function MoneyChecks({ checks }: { checks: TotalCheck[] }) {
  const { state } = useStore()
  const org = state.organisation
  if (!checks.length) return null
  return (
    <ul className="moving-checks" aria-label="Checked against your old system’s totals">
      {checks.map((check, i) => {
        const [name, match, mismatch] = CHECK_NAME[check.kind]
        const [one, many] =
          check.unit === 'visits' ? ['package', 'packages'] : MONEY_NOUN[check.kind]
        const figure = (n: number) =>
          check.unit === 'visits' ? plural(n, 'visit') : money(n, org, true)
        const behind = check.behind.map((group) =>
          `${figure(group.amount)} on ${plural(group.count, one, many)} ${BEHIND_WORDS[group.status]?.(group.count === 1) ?? ''}`.trim(),
        )
        const comes = check.unit === 'visits' && check.coming !== 1 ? 'come' : 'comes'
        const stays =
          behind.length === 1 && (check.unit === 'money' || check.behind[0].amount === 1)
            ? 'stays'
            : 'stay'
        return (
          <li key={i} className={check.agrees ? 'is-agreed' : 'is-different'}>
            {check.agrees ? (
              <Check size={18} aria-hidden="true" />
            ) : (
              <CircleAlert size={18} aria-hidden="true" />
            )}
            <div>
              <strong>
                {name} {check.agrees ? match : mismatch} {check.source}
              </strong>
              <p>
                {check.agrees
                  ? `${figure(check.theirs)} in all. ${figure(check.coming)} ${comes} across${behind.length ? `, and ${behind.join(' and ')} ${stays} behind` : ''}.`
                  : check.unreadable
                    ? `It says ${figure(check.theirs)}, but ${plural(check.unreadable, 'row')} could not be read, so the rows cannot be checked against it yet.`
                    : `It says ${figure(check.theirs)}, but the rows add up to ${figure(check.rows)}. Check the file has every row before bringing them across.`}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Gift cards, packages and credit that need a look or stay behind, grouped by reason. */
function MoneyAttention({ rows }: { rows: MoneyRow[] }) {
  type Group = { kind: MoneyKind; reason: string; order: number; verb: string; rows: MoneyRow[] }
  const groups = new Map<string, Group>()
  const put = (row: MoneyRow, reason: string, order: number, verb: string) => {
    const key = `${row.kind}|${order}|${reason}`
    const found = groups.get(key)
    groups.set(key, {
      kind: row.kind,
      reason,
      order,
      verb,
      rows: [...(found?.rows ?? []), row],
    })
  }
  for (const row of rows) {
    if (row.status === 'problem') put(row, row.detail, 0, 'not coming across')
    else if (
      row.status === 'expired' ||
      row.status === 'cancelled' ||
      row.status === 'here' ||
      (row.status === 'used' && row.left)
    )
      put(row, row.detail, 1, 'staying behind')
    for (const note of row.notes) put(row, note, 2, 'coming across')
  }
  if (!groups.size) return null
  const oneFile = new Set(rows.map((row) => row.fileName)).size === 1
  const listed = [...groups.values()].sort(
    (a, b) => a.order - b.order || b.rows.length - a.rows.length,
  )
  return (
    <div
      className="moving-attention"
      role="region"
      aria-label="Gift cards, packages and credit to look at"
      tabIndex={0}
    >
      <ul>
        {listed.slice(0, LIST_LIMIT).map((group) => (
          <li key={`${group.kind}-${group.order}-${group.reason}`}>
            <strong>
              {plural(group.rows.length, ...MONEY_NOUN[group.kind])} {group.verb}
            </strong>
            <p>{group.reason}</p>
            <ul className="moving-examples">
              {group.rows.slice(0, 3).map((row) => (
                <li key={`${row.fileName}-${row.line}`}>
                  {row.label || 'No details'} · {oneFile ? '' : `${row.fileName}, `}line {row.line}
                </li>
              ))}
              {group.rows.length > 3 && <li>And {group.rows.length - 3} more</li>}
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
