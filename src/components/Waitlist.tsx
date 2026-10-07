import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Hourglass, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { businessDate, can } from '../domain/operations'
import { isOpen, openings, timesLabel, waitlistList } from '../domain/waitlist'
import type { Opening } from '../domain/waitlist'
import { WAITLIST_MAX_DAYS, WAITLIST_TIMES } from '../domain/waitlistSchema'
import type { WaitlistEntry, WaitlistInput, WaitlistTime } from '../domain/waitlistSchema'
import { addDays, dateLabel, timeLabel } from '../domain/format'
import { feedbackDay } from '../domain/feedback'
import type { Command } from '../domain/commands'
import { Button, ErrorMessage, Modal } from '../design'
import './management.css'
import './waitlist.css'

/**
 * V1.5 waitlist screens: the add form, one card per person waiting with the times that would suit
 * them, and the panel on a client's page. Filling a time is always the team's choice.
 */
const TIME_NAMES: Record<WaitlistTime, string> = {
  morning: 'Mornings',
  afternoon: 'Afternoons',
  evening: 'Evenings',
}

function useRun() {
  const { commit } = useStore()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function run(command: Command) {
    if (pending) return false
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) setError(result.error)
      return result.ok
    } catch {
      setError('This could not be saved. Your entries are still here; try again.')
      return false
    } finally {
      setPending(false)
    }
  }
  return { run, pending, error, setError }
}

function useWaitlistAllowed() {
  const { role, blocked } = useStore()
  return !blocked && can(role, 'waitlist-add')
}

/** Adds someone to the waitlist; the client is fixed when opened from their page. */
export function WaitlistForm({ clientId, onClose }: { clientId?: string; onClose: () => void }) {
  const { state } = useStore()
  const today = businessDate(state, new Date().toISOString())
  const services = state.services.filter((s) => !s.archived)
  const clients = [...state.clients].sort((a, b) => a.name.localeCompare(b.name))
  const [input, setInput] = useState<WaitlistInput>({
    clientId: clientId ?? '',
    serviceId: services[0]?.id ?? '',
    fromDate: today,
    toDate: addDays(today, 13),
    times: [],
    note: '',
  })
  const { run, pending, error } = useRun()
  const team = state.staff.filter((p) => !p.archived && p.serviceIds.includes(input.serviceId))
  const change = (patch: Partial<WaitlistInput>) =>
    setInput((current) => ({ ...current, ...patch }))
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const { staffId, ...rest } = input
    if (await run({ type: 'waitlist-add', input: staffId ? input : rest })) onClose()
  }
  const client = state.clients.find((c) => c.id === clientId)
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={client ? `Add ${client.name} to the waitlist` : 'Add to the waitlist'}
      description="When a time opens that suits them, it shows here. Nobody is contacted until you choose to."
    >
      <form onSubmit={save} className="waitlist-form">
        <div className="ops-fields">
          {!clientId && (
            <label className="ops-wide">
              Client
              <select
                required
                value={input.clientId}
                onChange={(e) => change({ clientId: e.target.value })}
              >
                <option value="">Choose a client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Service
            <select
              value={input.serviceId}
              onChange={(e) => change({ serviceId: e.target.value, staffId: undefined })}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            With
            <select
              value={input.staffId ?? ''}
              onChange={(e) => change({ staffId: e.target.value || undefined })}
            >
              <option value="">Anyone</option>
              {team.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              required
              min={today}
              value={input.fromDate}
              onChange={(e) => change({ fromDate: e.target.value })}
            />
          </label>
          <label>
            Until
            <input
              type="date"
              required
              min={input.fromDate}
              max={addDays(input.fromDate, WAITLIST_MAX_DAYS - 1)}
              value={input.toDate}
              onChange={(e) => change({ toDate: e.target.value })}
            />
          </label>
          <fieldset className="ops-checks ops-wide">
            <legend>Times that suit (none ticked means any time)</legend>
            {WAITLIST_TIMES.map((time) => (
              <label key={time}>
                <input
                  type="checkbox"
                  checked={input.times.includes(time)}
                  onChange={(e) =>
                    change({
                      times: e.target.checked
                        ? WAITLIST_TIMES.filter((t) => t === time || input.times.includes(t))
                        : input.times.filter((t) => t !== time),
                    })
                  }
                />
                {TIME_NAMES[time]}
              </label>
            ))}
          </fieldset>
          <label className="ops-wide">
            Note for the team (optional)
            <input
              maxLength={300}
              value={input.note}
              placeholder="Can come at short notice"
              onChange={(e) => change({ note: e.target.value })}
            />
          </label>
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || !input.clientId || !input.serviceId}>
            {pending ? 'Saving…' : 'Add to the waitlist'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** One person waiting: what they asked for and the earliest times that would suit them. */
export function WaitlistCard({
  entry,
  showClient = true,
}: {
  entry: WaitlistEntry
  showClient?: boolean
}) {
  const { state } = useStore()
  const allowed = useWaitlistAllowed()
  const now = new Date().toISOString()
  const org = state.organisation
  const [chosen, setChosen] = useState<Opening | null>(null)
  const [removing, setRemoving] = useState(false)
  const client = state.clients.find((c) => c.id === entry.clientId)
  const service = state.services.find((s) => s.id === entry.serviceId)
  const person = (id?: string) => state.staff.find((p) => p.id === id)?.name ?? 'anyone'
  const visit = state.appointments.find((a) => a.id === entry.appointmentId)
  const times = openings(state, entry, now)
  const when = (o: Opening) =>
    `${dateLabel(o.date, org.locale)} at ${timeLabel(o.startMinutes, org.locale)}`
  const heading = `${showClient ? `${client?.name ?? 'Client'} · ` : ''}${service?.name ?? 'Service'}`
  return (
    <li className="waitlist-card">
      <div className="waitlist-card-copy">
        <strong>
          {showClient && client ? (
            <>
              <Link to={`/clients/${client.id}`}>{client.name}</Link> · {service?.name}
            </>
          ) : (
            heading
          )}
        </strong>
        <small>
          With {person(entry.staffId)}, {dateLabel(entry.fromDate, org.locale)} to{' '}
          {dateLabel(entry.toDate, org.locale)}, {timesLabel(entry.times)}
        </small>
        {visit && (
          <small>
            Booked for {dateLabel(visit.date, org.locale)} and would like to come in sooner
          </small>
        )}
        {entry.note && <small>“{entry.note}”</small>}
        {!!entry.offers?.length && (
          <small>
            {entry.offers.length === 1 ? 'One offer' : `${entry.offers.length} offers`} written,
            latest for {when(entry.offers.at(-1)!)}
          </small>
        )}
        <span className="ops-tag">
          {entry.source === 'guest' ? 'Asked online' : 'Added by the desk'}
        </span>
      </div>
      <div className="waitlist-openings">
        <p>{times.length ? 'Times that would suit' : 'Nothing free yet that suits'}</p>
        {times.length > 0 && (
          <ul>
            {times.map((o) => (
              <li key={`${o.date}-${o.startMinutes}-${o.staffId}`}>
                {allowed ? (
                  <button type="button" className="waitlist-time" onClick={() => setChosen(o)}>
                    <span>{when(o)}</span>
                    <small>
                      {person(o.staffId)}
                      <span className="sr-only">, for {client?.name}</span>
                    </small>
                  </button>
                ) : (
                  <span className="waitlist-time">
                    <span>{when(o)}</span>
                    <small>{person(o.staffId)}</small>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {allowed && (
          <Button variant="quiet" onClick={() => setRemoving(true)}>
            Take off the list
            <span className="sr-only">
              : {client?.name}, {service?.name}
            </span>
          </Button>
        )}
      </div>
      {chosen && (
        <FillDialog
          entry={entry}
          opening={chosen}
          label={when(chosen)}
          onClose={() => setChosen(null)}
        />
      )}
      {removing && <RemoveDialog entry={entry} onClose={() => setRemoving(false)} />}
    </li>
  )
}

function FillDialog({
  entry,
  opening,
  label,
  onClose,
}: {
  entry: WaitlistEntry
  opening: Opening
  label: string
  onClose: () => void
}) {
  const { state } = useStore()
  const { run, pending, error } = useRun()
  const [done, setDone] = useState('')
  const client = state.clients.find((c) => c.id === entry.clientId)!
  const service = state.services.find((s) => s.id === entry.serviceId)
  const person = state.staff.find((p) => p.id === opening.staffId)?.name
  const moving = !!entry.appointmentId
  async function fill() {
    const ok = await run(
      moving
        ? {
            type: 'reschedule',
            appointmentId: entry.appointmentId!,
            waitlistId: entry.id,
            ...opening,
          }
        : {
            type: 'book',
            input: {
              clientId: client.id,
              serviceId: entry.serviceId,
              source: 'desk',
              waitlistId: entry.id,
              ...opening,
            },
          },
    )
    if (ok) onClose()
  }
  async function offer() {
    if (await run({ type: 'waitlist-offer', entryId: entry.id, ...opening }))
      setDone('The offer is waiting in the Inbox for you to approve. Nothing has been sent.')
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={`${label} for ${client.name}`}
      description={`${service?.name} with ${person}.`}
    >
      {done ? (
        <div className="waitlist-done">
          <p role="status">{done}</p>
          <div className="ops-actions">
            <Link className="button button-primary" to="/inbox">
              Open the Inbox
            </Link>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <div className="waitlist-fill">
          <p>
            {moving
              ? `If ${client.name.split(' ')[0]} has already said yes, move their visit to this time now. Otherwise write them an offer; it waits in the Inbox until you approve it.`
              : `If ${client.name.split(' ')[0]} has already said yes, book it now. Otherwise write them an offer; it waits in the Inbox until you approve it.`}
          </p>
          <ErrorMessage error={error} />
          <div className="ops-actions">
            <Button disabled={pending} onClick={fill}>
              {moving ? 'Move their visit here' : 'Book it for them'}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={offer}>
              Write an offer
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function RemoveDialog({ entry, onClose }: { entry: WaitlistEntry; onClose: () => void }) {
  const { state } = useStore()
  const { run, pending, error } = useRun()
  const [reason, setReason] = useState('')
  const client = state.clients.find((c) => c.id === entry.clientId)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (await run({ type: 'waitlist-remove', entryId: entry.id, reason: reason.trim() })) onClose()
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={`Take ${client?.name ?? 'this client'} off the waitlist`}
      description="The request stays in their history with your reason."
    >
      <form onSubmit={save} className="waitlist-form">
        <div className="ops-fields">
          <label className="ops-wide">
            Reason
            <input
              required
              minLength={2}
              maxLength={300}
              value={reason}
              placeholder="Booked elsewhere, no longer needed"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || reason.trim().length < 2}>
            Take off the list
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** The waitlist panel on a client's page. */
export function ClientWaitlist({ clientId }: { clientId: string }) {
  const { state } = useStore()
  const allowed = useWaitlistAllowed()
  const [adding, setAdding] = useState(false)
  const rows = waitlistList(state).filter((e) => e.clientId === clientId)
  const open = rows.filter((e) => isOpen(state, e))
  const closed = rows
    .filter((e) => !isOpen(state, e))
    .sort((a, b) => (b.closedAt ?? b.toDate).localeCompare(a.closedAt ?? a.toDate))
    .slice(0, 3)
  const org = state.organisation
  return (
    <section className="surface ops-panel client-waitlist" aria-labelledby="client-waitlist">
      <header>
        <div>
          <h2 id="client-waitlist">Waitlist</h2>
          <p>Times this client would take if one opened.</p>
        </div>
        <Hourglass size={21} aria-hidden="true" />
      </header>
      {open.length ? (
        <ul className="waitlist-cards">
          {open.map((entry) => (
            <WaitlistCard key={entry.id} entry={entry} showClient={false} />
          ))}
        </ul>
      ) : (
        <p className="ops-help">Not waiting for anything.</p>
      )}
      {closed.length > 0 && (
        <ul className="waitlist-closed">
          {closed.map((e) => (
            <li key={e.id}>
              {state.services.find((s) => s.id === e.serviceId)?.name}:{' '}
              {e.status === 'booked'
                ? 'filled'
                : e.status === 'removed'
                  ? `taken off (${e.removedReason})`
                  : 'its dates passed'}
              {e.closedAt ? `, ${dateLabel(feedbackDay(state, e.closedAt), org.locale)}` : ''}
            </li>
          ))}
        </ul>
      )}
      {allowed && (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" /> Add to the waitlist
        </Button>
      )}
      {adding && <WaitlistForm clientId={clientId} onClose={() => setAdding(false)} />}
    </section>
  )
}
