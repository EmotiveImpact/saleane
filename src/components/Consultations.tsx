import { useState } from 'react'
import type { FormEvent } from 'react'
import { MessagesSquare, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { businessDate, can } from '../domain/operations'
import { clientConsultations, latestVersion, visitConsultation } from '../domain/consultations'
import { CONSULTATION_TEXT_LIMIT } from '../domain/consultationsSchema'
import type { Consultation } from '../domain/consultationsSchema'
import { healthWordIn } from '../domain/forms'
import type { Appointment } from '../domain/model'
import { dateLabel, money } from '../domain/format'
import { minorInput, parseMinor } from '../domain/money'
import { Button, ErrorMessage, Modal, Select } from '../design'
import { BookingDialog } from './BookingDialog'
import { StudioDateField } from './StudioDateField'
import { useRun } from './usePayment'
import './management.css'
import './consultations.css'

/**
 * V1.5: consultations on a client's page. Saving a change keeps the earlier version; booking from
 * one carries the current version into the visit, where the desk and the practitioner read it.
 * Everyday notes only: the form refuses health details, as guest forms do.
 */

export function ClientConsultations({ clientId }: { clientId: string }) {
  const { state, role, blocked } = useStore()
  const [editing, setEditing] = useState<Consultation | 'new' | null>(null)
  const [booking, setBooking] = useState<Consultation | null>(null)
  const list = clientConsultations(state, clientId)
  const org = state.organisation
  const allowed = !blocked && can(role, 'consultation')
  const bookable = !blocked && can(role, 'book')
  const name = (id?: string) => state.staff.find((p) => p.id === id)?.name
  const treatments = (ids: string[]) =>
    ids
      .map((id) => state.services.find((x) => x.id === id)?.name)
      .filter(Boolean)
      .join(', ')
  return (
    <section className="surface ops-panel" aria-labelledby="client-consultations">
      <header>
        <div>
          <h2 id="client-consultations">Consultations</h2>
          <p>
            {list.length
              ? 'What they wanted and what was agreed. Visits booked from one keep the version agreed.'
              : 'None yet. Note what a guest wants and what you agreed before a bigger change.'}
          </p>
        </div>
        <MessagesSquare size={21} aria-hidden="true" />
      </header>
      {list.map((c) => {
        const v = latestVersion(c)
        const fromIt = state.appointments.filter((a) => a.consultation?.id === c.id)
        const booked = fromIt.filter((a) => a.consultation!.version === v.version).length
        const earlier = fromIt.length - booked
        return (
          <article key={c.id} className="consultation">
            <h3>
              {dateLabel(c.heldOn, org.locale, true)}
              {name(c.staffId) ? ` with ${name(c.staffId)}` : ''}
              {v.serviceIds.length ? ` · ${treatments(v.serviceIds)}` : ''}
            </h3>
            {v.wants && (
              <p>
                <span className="consultation-label">They wanted</span> {v.wants}
              </p>
            )}
            <p>
              <span className="consultation-label">Agreed</span> {v.plan}
            </p>
            {v.quoteMinor !== null && (
              <p>
                <span className="consultation-label">Price given</span>{' '}
                {money(v.quoteMinor, org, true)}
              </p>
            )}
            {v.notes && <p className="subtle">{v.notes}</p>}
            <p className="subtle">
              Version {v.version}, saved by {v.savedBy || 'the studio'}
              {booked
                ? ` · ${booked === 1 ? 'one visit' : `${booked} visits`} booked from this version`
                : ''}
              {earlier
                ? ` · ${earlier === 1 ? 'one visit' : `${earlier} visits`} from an earlier version`
                : ''}
            </p>
            {c.versions.length > 1 && (
              <details>
                <summary>Earlier versions ({c.versions.length - 1})</summary>
                <ol>
                  {c.versions
                    .slice(0, -1)
                    .reverse()
                    .map((old) => (
                      <li key={old.version}>
                        <strong>Version {old.version}</strong>: {old.plan}
                        {old.quoteMinor !== null && ` · ${money(old.quoteMinor, org, true)}`}
                      </li>
                    ))}
                </ol>
              </details>
            )}
            <div className="consultation-actions">
              {bookable && (
                <Button variant="secondary" onClick={() => setBooking(c)}>
                  Book from this
                </Button>
              )}
              {allowed && (
                <Button variant="quiet" onClick={() => setEditing(c)}>
                  Update
                </Button>
              )}
            </div>
          </article>
        )
      })}
      {allowed && (
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <Plus size={16} aria-hidden="true" /> Record a consultation
        </Button>
      )}
      {editing && (
        <ConsultationForm
          clientId={clientId}
          existing={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {booking && (
        <BookingDialog
          defaults={{
            clientId,
            consultationId: booking.id,
            ...(latestVersion(booking).serviceIds[0]
              ? { serviceId: latestVersion(booking).serviceIds[0] }
              : {}),
            ...(booking.staffId ? { staffId: booking.staffId } : {}),
          }}
          onClose={() => setBooking(null)}
        />
      )}
    </section>
  )
}

function ConsultationForm({
  clientId,
  existing,
  onClose,
}: {
  clientId: string
  existing?: Consultation
  onClose: () => void
}) {
  const { state } = useStore()
  const today = businessDate(state, new Date().toISOString())
  const client = state.clients.find((c) => c.id === clientId)
  const current = existing && latestVersion(existing)
  const [heldOn, setHeldOn] = useState(existing?.heldOn ?? today)
  const [staffId, setStaffId] = useState(existing?.staffId ?? '')
  const [serviceIds, setServiceIds] = useState<string[]>(current?.serviceIds ?? [])
  const [wants, setWants] = useState(current?.wants ?? '')
  const [plan, setPlan] = useState(current?.plan ?? '')
  const [quote, setQuote] = useState(
    current?.quoteMinor !== null && current?.quoteMinor !== undefined
      ? minorInput(current.quoteMinor)
      : '',
  )
  const [notes, setNotes] = useState(current?.notes ?? '')
  const { run, pending, error, setError } = useRun()
  const health = healthWordIn([wants, plan, notes].join('\n'))
  const services = state.services.filter((x) => !x.archived || serviceIds.includes(x.id))
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const quoteMinor = quote.trim() ? parseMinor(quote) : null
    if (quoteMinor !== null && (!Number.isFinite(quoteMinor) || quoteMinor < 0)) {
      setError('Enter the price given, such as 85 or 85.50, or leave it empty.')
      return
    }
    const done = await run({
      type: 'consultation-save',
      ...(existing ? { id: existing.id } : {}),
      clientId,
      ...(staffId ? { staffId } : {}),
      heldOn,
      content: {
        serviceIds,
        wants: wants.trim(),
        plan: plan.trim(),
        quoteMinor,
        notes: notes.trim(),
      },
    })
    if (done) onClose()
  }
  const toggle = (id: string) =>
    setServiceIds((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]))
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={
        existing
          ? `Update the consultation with ${client?.name ?? 'this guest'}`
          : `Record a consultation with ${client?.name ?? 'this guest'}`
      }
      description={
        existing
          ? `Saving keeps version ${current!.version} as it was. Visits already booked keep the version they were booked against.`
          : 'What they would like, what you agreed and any price you gave. Everyday notes only, nothing about health.'
      }
    >
      <form onSubmit={save} className="consultation-form">
        <div className="ops-fields">
          <label>
            Date
            <StudioDateField
              max={today}
              disabled={!!existing}
              value={heldOn}
              onChange={setHeldOn}
            />
          </label>
          <label>
            With
            <Select
              value={staffId}
              disabled={!!existing}
              onChange={(e) => setStaffId(e.target.value)}
            >
              <option value="">Not recorded</option>
              {state.staff
                .filter((p) => !p.archived || p.id === staffId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </label>
        </div>
        <fieldset className="consultation-services">
          <legend>Treatments talked about</legend>
          <div>
            {services.map((x) => (
              <label key={x.id}>
                <input
                  type="checkbox"
                  checked={serviceIds.includes(x.id)}
                  disabled={!serviceIds.includes(x.id) && serviceIds.length >= 10}
                  onChange={() => toggle(x.id)}
                />
                {x.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          What they would like (optional)
          <textarea
            rows={2}
            maxLength={CONSULTATION_TEXT_LIMIT}
            value={wants}
            onChange={(e) => setWants(e.target.value)}
          />
        </label>
        <label>
          What you agreed
          <textarea
            rows={3}
            required
            minLength={2}
            maxLength={CONSULTATION_TEXT_LIMIT}
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          />
        </label>
        <div className="ops-fields">
          <label>
            Price given (optional)
            <input
              inputMode="decimal"
              value={quote}
              placeholder={state.organisation.currency === 'GBP' ? '85.00' : '120.00'}
              onChange={(e) => setQuote(e.target.value)}
            />
          </label>
        </div>
        <label>
          Other notes (optional)
          <textarea
            rows={2}
            maxLength={CONSULTATION_TEXT_LIMIT}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {health && (
          <p className="form-health" role="status">
            This mentions “{health}”. Consultations here are for everyday notes, so they cannot
            record health details. Patch tests have their own record.
          </p>
        )}
        <ErrorMessage error={error} />
        <div className="consultation-actions">
          <Button type="submit" disabled={pending || !!health}>
            {pending ? 'Saving…' : existing ? `Save as version ${current!.version + 1}` : 'Save'}
          </Button>
          <Button variant="quiet" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** On the visit: what was agreed at the consultation it was booked from, as agreed then. */
export function VisitConsultation({ appointment }: { appointment: Appointment }) {
  const { state } = useStore()
  const carried = visitConsultation(state, appointment)
  if (!carried) return null
  const { consultation, version, changedSince } = carried
  const org = state.organisation
  return (
    <section className="visit-forms" aria-label="Consultation">
      <h3>Agreed at consultation</h3>
      <p>{version.plan}</p>
      {version.wants && <p className="subtle">They wanted: {version.wants}</p>}
      <p className="subtle">
        {dateLabel(consultation.heldOn, org.locale, true)}, version {version.version}
        {version.quoteMinor !== null
          ? ` · price given ${money(version.quoteMinor, org, true)}`
          : ''}
        {changedSince
          ? `. Updated since this visit was booked (now version ${latestVersion(consultation).version}).`
          : '.'}
      </p>
    </section>
  )
}
