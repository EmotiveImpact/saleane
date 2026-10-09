import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Droplet, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { useClock } from '../state/clock'
import { businessDate, businessMinutes, can, instantFor, operations } from '../domain/operations'
import {
  clearFrom,
  localDate,
  onlinePatchTestStop,
  patchTestSettings,
  patchTestStanding,
  patchTests,
  patchTestsDue,
  serviceNeedsPatchTest,
  visitPatchTest,
} from '../domain/patchTests'
import type { PatchTestState } from '../domain/patchTests'
import type { PatchTest } from '../domain/patchTestsSchema'
import type { Appointment } from '../domain/model'
import { dateLabel, timeLabel } from '../domain/format'
import { Button, ErrorMessage, Modal, TimeField } from '../design'
import { StudioDateField } from './StudioDateField'
import { useRun } from './usePayment'
import { useSeeAll } from './seeAll'
import { SeeAllButton } from './SeeAllButton'
import './management.css'
import './patchTests.css'
import './needsYou.css'

/**
 * V1.5 patch test screens: the record on a client's page, the form to add one, where a colour
 * visit stands, the list of booked visits still waiting on a test, and the studio's rules.
 * A salon record, not a clinical one: what was tested, when, by whom and what the skin did.
 */
const tagClass: Record<PatchTestState, string> = {
  clear: 'ops-tag is-active',
  waiting: 'ops-tag',
  'too-close': 'ops-tag',
  needed: 'ops-tag',
  reaction: 'ops-tag is-blocked',
}
const shortState: Record<PatchTestState, string> = {
  clear: 'Patch test clear',
  waiting: 'Result to record',
  'too-close': 'Test too close',
  needed: 'Patch test needed',
  reaction: 'Reaction recorded',
}
function whenLabel(s: Parameters<typeof localDate>[0], instant: string) {
  const locale = s.organisation.locale
  return `${dateLabel(localDate(s, instant), locale)}, ${timeLabel(businessMinutes(s, instant), locale)}`
}
function toMinutes(value: string) {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}
function clockTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Adds a test: when it went on, what was tested and, if the skin has been checked, the result. */
export function PatchTestForm({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { state, role } = useStore()
  const now = new Date().toISOString()
  const today = businessDate(state, now)
  const client = state.clients.find((c) => c.id === clientId)
  // Who can do patch-tested treatments come first, but nobody is chosen for you: a wrong name
  // here would end up in the client's record.
  const colour = new Set(state.services.filter((x) => x.patchTest).map((x) => x.id))
  const qualified = (p: { serviceIds: string[] }) => p.serviceIds.some((id) => colour.has(id))
  const team = state.staff
    .filter((p) => !p.archived)
    .sort((a, b) => Number(qualified(b)) - Number(qualified(a)))
  const [date, setDate] = useState(today)
  const [time, setTime] = useState(clockTime(Math.floor(businessMinutes(state, now) / 5) * 5))
  const [product, setProduct] = useState('')
  const [staffId, setStaffId] = useState('')
  const [notes, setNotes] = useState('')
  const [picked, setOutcome] = useState<'' | 'clear' | 'reaction'>('')
  const [resultNotes, setResultNotes] = useState('')
  const { run, pending, error, setError } = useRun()
  const tooSoon = (() => {
    try {
      const testedAt = instantFor(state, date, toMinutes(time))
      return Date.parse(now) < Date.parse(clearFrom(state, testedAt))
    } catch {
      return false
    }
  })()
  const outcome = tooSoon && picked === 'clear' ? '' : picked
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    let testedAt: string
    try {
      testedAt = instantFor(state, date, toMinutes(time))
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Check the date and time.')
      return
    }
    const done = await run({
      type: 'patch-test',
      input: {
        clientId,
        testedAt,
        product: product.trim(),
        ...(staffId ? { staffId } : {}),
        notes: notes.trim(),
      },
      ...(outcome ? { result: { outcome, notes: resultNotes.trim() } } : {}),
    })
    if (done) onClose()
  }
  const settings = patchTestSettings(state)
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={client ? `Record a patch test for ${client.name}` : 'Record a patch test'}
      description={`Check the skin ${settings.hoursBefore} hours later and record what you see. A clear test counts for ${settings.validMonths} months.`}
    >
      <form onSubmit={save} className="patch-form">
        <div className="ops-fields">
          <label>
            Date
            <StudioDateField max={today} value={date} onChange={setDate} />
          </label>
          <label>
            Time
            <TimeField
              locale={state.organisation.locale}
              required
              value={time}
              onChange={setTime}
            />
          </label>
          <label className="ops-wide">
            Product or shade tested
            <input
              required
              minLength={2}
              maxLength={150}
              value={product}
              placeholder="Gloss toner 7.1 with 2% developer"
              onChange={(e) => setProduct(e.target.value)}
            />
          </label>
          <label>
            Done by
            <select
              value={staffId}
              disabled={role === 'practitioner'}
              onChange={(e) => setStaffId(e.target.value)}
            >
              <option value="">Not recorded</option>
              {team.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Skin checked?
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as '' | 'clear' | 'reaction')}
            >
              <option value="">Not yet</option>
              <option value="clear" disabled={tooSoon}>
                {tooSoon ? `Clear (after ${settings.hoursBefore} hours)` : 'Yes, clear'}
              </option>
              <option value="reaction">Yes, a reaction</option>
            </select>
          </label>
          <label className="ops-wide">
            Where it was placed, or anything to note (optional)
            <input
              maxLength={300}
              value={notes}
              placeholder="Behind the left ear"
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {outcome && (
            <label className="ops-wide">
              What you saw (optional)
              <input
                maxLength={300}
                value={resultNotes}
                placeholder={outcome === 'clear' ? 'No redness' : 'Redness and itching'}
                onChange={(e) => setResultNotes(e.target.value)}
              />
            </label>
          )}
        </div>
        <p className="ops-help">
          Salon details only: no medical history.{' '}
          {operations(state).mode === 'sandbox'
            ? 'This is a sample studio, so use made-up details.'
            : ''}
        </p>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || product.trim().length < 2}>
            {pending ? 'Saving…' : 'Save patch test'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Records what the skin did for a test whose result is still to come. */
function ResultButtons({ test }: { test: PatchTest }) {
  const { state } = useStore()
  const now = useClock()
  const from = clearFrom(state, test.testedAt)
  const early = Date.parse(now) < Date.parse(from)
  const { run, pending, error } = useRun()
  const [notes, setNotes] = useState('')
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Record the result
      </Button>
    )
  return (
    <div className="patch-result">
      <label>
        What you saw (optional)
        <input maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="ops-actions">
        <Button
          disabled={pending || early}
          onClick={() =>
            void run({
              type: 'patch-test-result',
              patchTestId: test.id,
              outcome: 'clear',
              notes: notes.trim(),
            })
          }
        >
          Clear
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            void run({
              type: 'patch-test-result',
              patchTestId: test.id,
              outcome: 'reaction',
              notes: notes.trim(),
            })
          }
        >
          A reaction
        </Button>
        <Button variant="quiet" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {early && (
        <p className="ops-help">
          It can be called clear from {whenLabel(state, from)}. Record a reaction straight away if
          one shows.
        </p>
      )}
      <ErrorMessage error={error} />
    </div>
  )
}

/** The client's tests, newest first, with where their next colour visit stands. */
export function ClientPatchTests({ clientId }: { clientId: string }) {
  const { state, role, blocked } = useStore()
  const clock = useClock()
  const [adding, setAdding] = useState(false)
  const org = state.organisation
  const tests = patchTests(state)
    .filter((t) => t.clientId === clientId)
    .sort((a, b) => b.testedAt.localeCompare(a.testedAt))
  const today = businessDate(state, clock)
  const next = state.appointments
    .filter((a) => a.clientId === clientId && a.status === 'confirmed' && a.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)
    .map((a) => ({ a, standing: visitPatchTest(state, a) }))
    .find((row) => row.standing)
  const allowed = !blocked && can(role, 'patch-test')
  const staffName = (id?: string) => state.staff.find((p) => p.id === id)?.name
  if (!tests.length && !next) {
    return (
      <section className="surface ops-panel patch-panel" aria-labelledby="client-patch-tests">
        <header>
          <div>
            <h2 id="client-patch-tests">Patch tests</h2>
            <p>None recorded. Treatments that need one ask for it when booked.</p>
          </div>
          <Droplet size={21} aria-hidden="true" />
        </header>
        {allowed && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" /> Record a patch test
          </Button>
        )}
        {adding && <PatchTestForm clientId={clientId} onClose={() => setAdding(false)} />}
      </section>
    )
  }
  return (
    <section className="surface ops-panel patch-panel" aria-labelledby="client-patch-tests">
      <header>
        <div>
          <h2 id="client-patch-tests">Patch tests</h2>
          <p>What was tested, when, and what the skin did.</p>
        </div>
        <Droplet size={21} aria-hidden="true" />
      </header>
      {next?.standing && (
        <p className="patch-next">
          <span>
            For {dateLabel(next.a.date, org.locale)} at {timeLabel(next.a.startMinutes, org.locale)}
          </span>
          <span className={tagClass[next.standing.state]}>{next.standing.label}</span>
        </p>
      )}
      {tests.length > 0 && (
        <ul className="patch-list">
          {tests.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.product}</strong>
                <small>
                  {dateLabel(localDate(state, t.testedAt), org.locale)}
                  {staffName(t.staffId) ? ` · ${staffName(t.staffId)}` : ''}
                  {t.notes ? ` · ${t.notes}` : ''}
                </small>
                {t.result ? (
                  <small>
                    <span
                      className={
                        t.result.outcome === 'clear' ? 'ops-tag is-active' : 'ops-tag is-blocked'
                      }
                    >
                      {t.result.outcome === 'clear' ? 'Clear' : 'Reaction'}
                    </span>{' '}
                    {t.result.notes ? `${t.result.notes} · ` : ''}checked by {t.result.actor}
                  </small>
                ) : (
                  <small>Result not recorded yet.</small>
                )}
              </div>
              {!t.result && allowed && <ResultButtons test={t} />}
            </li>
          ))}
        </ul>
      )}
      {allowed && (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" /> Record a patch test
        </Button>
      )}
      {adding && <PatchTestForm clientId={clientId} onClose={() => setAdding(false)} />}
    </section>
  )
}

/** On a visit: where the guest's patch test stands, for a treatment that needs one. */
export function VisitPatchTest({ appointment }: { appointment: Appointment }) {
  const { state } = useStore()
  const standing = visitPatchTest(state, appointment)
  if (!standing) return null
  return (
    <p className="patch-visit">
      <span className={tagClass[standing.state]}>{standing.label}</span>
      {standing.state !== 'clear' && (
        <Link to={`/clients/${appointment.clientId}`}>Open their patch tests</Link>
      )}
    </p>
  )
}

/**
 * Stage 3: in the desk's booking dialog, for a treatment that needs a patch test: where the client
 * stands for the chosen time, whether online booking would have stopped it, and a quick way to
 * book the studio's patch test first. The desk is never stopped.
 */
export function BookingPatchTest({
  clientId,
  serviceId,
  date,
  start,
  test,
  onBookTest,
}: {
  /** Absent for someone new, who has had no test here. */
  clientId?: string
  serviceId: string
  date: string
  /** The chosen time; before one is chosen, midday that day. */
  start: number | null
  /** The studio's patch test, when it can be booked in this dialog. */
  test?: { id: string; name: string }
  onBookTest: (serviceId: string) => void
}) {
  const { state } = useStore()
  if (!serviceNeedsPatchTest(state, serviceId)) return null
  let at: string
  try {
    at = instantFor(state, date, start ?? 12 * 60)
  } catch {
    return null
  }
  const hours = patchTestSettings(state).hoursBefore
  const standing = clientId
    ? patchTestStanding(state, clientId, at)
    : {
        state: 'needed' as const,
        label: `Someone new needs a patch test at least ${hours} hours before`,
      }
  if (standing.state === 'clear')
    return (
      <p className="patch-visit">
        <span className={tagClass.clear}>{standing.label}</span>
      </p>
    )
  // The same rule the booking page follows, for this client at this time.
  const stopped = clientId
    ? onlinePatchTestStop(state, serviceId, { clientId, start: at })
    : onlinePatchTestStop(state, serviceId)
  return (
    <div className="booking-patch-note" role="note">
      <span className={tagClass[standing.state]}>{standing.label}</span>
      {stopped && (
        <p>
          Online booking would have stopped this visit, as the studio asks for a clear patch test
          first. You can still book it here.
        </p>
      )}
      {test && (
        <Button variant="secondary" onClick={() => onBookTest(test.id)}>
          Book the patch test first
        </Button>
      )}
    </div>
  )
}

/** For Today: booked visits in the next fortnight whose patch test is not yet in order. */
export function PatchTestsDue() {
  const { state } = useStore()
  const clock = useClock()
  const listId = useId()
  const today = businessDate(state, clock)
  const rows = patchTestsDue(state, today)
  const more = useSeeAll(rows)
  if (!rows.length) return null
  const org = state.organisation
  return (
    <section className="needs-card patch-card" aria-labelledby="patch-tests-due">
      <header className="needs-card-head">
        <Droplet size={18} aria-hidden="true" />
        <h3 id="patch-tests-due">Patch tests to sort</h3>
        <span className="needs-card-count">
          {rows.length}
          <span className="sr-only"> to sort</span>
        </span>
      </header>
      <p className="needs-note">Booked in the next two weeks, and needing a test first.</p>
      <ul className="needs-list" id={listId}>
        {more.shown.map(({ appointment: a, standing }) => (
          <li key={a.id}>
            <div className="needs-who">
              <span className={tagClass[standing.state]}>{shortState[standing.state]}</span>
              <Link to={`/clients/${a.clientId}`}>
                {state.clients.find((c) => c.id === a.clientId)?.name ?? 'Client'}
              </Link>
              <small>
                {a.bookedServiceName ?? state.services.find((s) => s.id === a.serviceId)?.name} ·{' '}
                {dateLabel(a.date, org.locale, true)}, {timeLabel(a.startMinutes, org.locale)}
              </small>
              <small>{standing.label}.</small>
            </div>
          </li>
        ))}
      </ul>
      {more.hidden > 0 && (
        <div className="needs-card-links">
          <SeeAllButton list={listId} {...more} />
        </div>
      )}
    </section>
  )
}

/**
 * For Settings: how long before a visit a test is needed, how long a clear one lasts, reminders,
 * and (Stage 3) whether online booking stops without one, with the patch test guests book.
 */
export function PatchTestRules() {
  const { state, role, blocked } = useStore()
  const current = patchTestSettings(state)
  const [hours, setHours] = useState(String(current.hoursBefore))
  const [months, setMonths] = useState(String(current.validMonths))
  const [remind, setRemind] = useState(current.remind)
  const [stopOnline, setStopOnline] = useState(!!current.stopOnline)
  const [testServiceId, setTestServiceId] = useState(current.testServiceId ?? '')
  const [saved, setSaved] = useState(false)
  const ids = useId()
  const { run, pending, error } = useRun()
  const allowed = !blocked && can(role, 'patch-test-settings')
  // The patch test itself: any treatment on the menu that does not need one.
  const tests = state.services.filter(
    (x) => !x.patchTest && (!x.archived || x.id === current.testServiceId),
  )
  const needing = state.services.filter((x) => x.patchTest && !x.archived)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    const done = await run({
      type: 'patch-test-settings',
      settings: {
        hoursBefore: Number(hours),
        validMonths: Number(months),
        remind,
        stopOnline,
        ...(testServiceId ? { testServiceId } : {}),
      },
    })
    setSaved(done)
  }
  return (
    <section className="surface ops-panel" aria-labelledby="patch-test-rules">
      <header>
        <div>
          <h2 id="patch-test-rules">Patch tests</h2>
          <p>
            For treatments marked as needing one, such as colour. Mark them in Treatments. Most
            colour brands ask for 48 hours.
          </p>
        </div>
        <Droplet size={21} aria-hidden="true" />
      </header>
      <form onSubmit={save}>
        <div className="ops-fields">
          <label>
            Hours before the visit
            <input
              type="number"
              min={24}
              max={168}
              required
              disabled={!allowed}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </label>
          <label>
            A clear test counts for (months)
            <input
              type="number"
              min={1}
              max={24}
              required
              disabled={!allowed}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
            />
          </label>
          <label className="ops-check ops-wide">
            <input
              type="checkbox"
              checked={remind}
              disabled={!allowed}
              onChange={(e) => setRemind(e.target.checked)}
            />
            Message a booked guest who needs a test, using their usual visit email and text
            settings. Sent once, up to two weeks before, while there is still time.
          </label>
          <div className="ops-wide">
            <label className="ops-check">
              <input
                type="checkbox"
                checked={stopOnline}
                disabled={!allowed}
                aria-describedby={`${ids}-online-help`}
                onChange={(e) => setStopOnline(e.target.checked)}
              />
              Stop online booking when a patch test is missing or out of date
            </label>
            <p className="ops-help" id={`${ids}-online-help`}>
              Guests booking online are never matched to your client records, so with this on nobody
              can book{' '}
              {needing.length === 1 ? needing[0].name : 'a treatment that needs a patch test'}{' '}
              online: on your booking page, through the AI receptionist or on Google. Every guest
              reads the same words: a patch test comes first, and how to book one or reach you. A
              guest moving a visit from their private link sees only times their clear test covers.
              The desk can still book anyone.
            </p>
          </div>
          <div className="ops-wide ops-field">
            <label htmlFor={`${ids}-test`}>The patch test guests can book online</label>
            <select
              id={`${ids}-test`}
              value={testServiceId}
              disabled={!allowed}
              aria-describedby={`${ids}-test-help`}
              onChange={(e) => setTestServiceId(e.target.value)}
            >
              <option value="">None: guests call or email you to arrange one</option>
              {tests.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <small id={`${ids}-test-help`}>
              Offered to guests when a treatment needs a patch test first, and to the desk as Book
              the patch test first.
            </small>
          </div>
        </div>
        <ErrorMessage error={error} />
        {allowed && (
          <div className="ops-actions">
            <span role="status" className="ops-help">
              {saved ? 'Saved.' : ''}
            </span>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save patch test rules'}
            </Button>
          </div>
        )}
      </form>
    </section>
  )
}
