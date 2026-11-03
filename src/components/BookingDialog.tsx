import { useMemo, useState } from 'react'
import { hasLocations, placeOf, serviceAt, staffLocationOn } from '../domain/locations'
import { Check, CalendarDays, Repeat2 } from 'lucide-react'
import { useStore } from '../state/context'
import { operations, can } from '../domain/operations'
import { slots } from '../domain/commands'
import { usualWeeks } from '../domain/selectors'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import { numberLabel } from '../domain/missedCalls'
import { consultationsList, latestVersion } from '../domain/consultations'
import { Button, ErrorMessage, Modal, TimeChoices, Select } from '../design'
import { StudioDateField } from './StudioDateField'
import { ClientPicker } from './ClientPicker'
import { TogetherSection } from './BookingTogether'
import { partyRows } from './party'
import type { PartyGuest } from './party'
import { togetherLine, togetherVisits } from '../domain/together'
import {
  REPEAT_AHEAD_DAYS,
  REPEAT_COUNTS,
  REPEAT_EVERY,
  everyLabel,
  repeatDates,
} from '../domain/repeat'
import { patchTestBooking } from '../domain/patchTests'
import { BookingPatchTest } from './PatchTests'
import './repeat.css'

/** NEXT-09: a later visit of a repeat, at the time it would be booked, or left out. */
type RepeatRow = {
  date: string
  times: number[]
  start: number | null
  why: 'same' | 'moved' | 'full' | 'beyond' | 'left'
}

export type BookingDefaults = {
  clientId?: string
  serviceId?: string
  staffId?: string
  date?: string
  /** A time chosen on the calendar, or the time of the visit being rebooked. */
  startMinutes?: number
  rebookedFromId?: string
  /** V1.5: a missed call the desk is booking for, from Today's list. */
  callId?: string
  /** V1.5: the consultation this visit comes from; the visit keeps its current version. */
  consultationId?: string
}

export function BookingDialog({
  onClose,
  defaults = {},
}: {
  onClose: () => void
  defaults?: BookingDefaults
}) {
  const { state, commit, today, blocked, saving, role } = useStore()
  const sandbox = operations(state).mode === 'sandbox'
  const consultation = defaults.consultationId
    ? consultationsList(state).find((c) => c.id === defaults.consultationId)
    : undefined
  // A visit booked from a consultation is for one of the treatments talked about, when any were.
  const agreed = consultation ? latestVersion(consultation).serviceIds : []
  const services = state.services.filter(
    (item) => !item.archived && (!agreed.length || agreed.includes(item.id)),
  )
  // V2: a person works at one location a day, so their times are at that location.
  const free = (service: string, person: string, day: string) =>
    slots(state, service, person, day, undefined, staffLocationOn(state, person, day))
  const multiSite = hasLocations(state)
  const [pending, setPending] = useState(false)
  const busy = pending || saving
  const [clientId, setClientId] = useState(defaults.clientId ?? '')
  const call = defaults.callId
    ? operations(state).missedCalls?.find((c) => c.id === defaults.callId)
    : undefined
  // A caller nobody recognises may be new: the desk can add them while booking.
  const [someoneNew, setSomeoneNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState(call ? numberLabel(call.number) : '')
  const newReady =
    someoneNew && newName.trim().length >= 2 && !!newEmail.trim() && !!newPhone.trim()
  const firstService = () => {
    // A time picked on the calendar should open with a service that person can fit in there.
    const person = state.staff.find((item) => item.id === defaults.staffId && !item.archived)
    if (person && defaults.startMinutes !== undefined && !defaults.serviceId) {
      const date = defaults.date ?? addDays(today, 1)
      const fits = services.find(
        (item) =>
          person.serviceIds.includes(item.id) &&
          free(item.id, person.id, date).some(
            (time) => Math.abs(time - defaults.startMinutes!) <= 90,
          ),
      )
      if (fits) return fits.id
      const offered = services.find((item) => person.serviceIds.includes(item.id))
      if (offered) return offered.id
    }
    return (
      services.find((item) => item.id === defaults.serviceId)?.id ??
      services.find((item) =>
        state.staff.some((person) => !person.archived && person.serviceIds.includes(item.id)),
      )?.id ??
      services[0]?.id ??
      ''
    )
  }
  const [serviceId, setServiceId] = useState(firstService)
  const service = services.find((s) => s.id === serviceId)
  const eligible = state.staff.filter((s) => !s.archived && s.serviceIds.includes(serviceId))
  const [staffId, setStaffId] = useState(
    eligible.find((item) => item.id === defaults.staffId)?.id ?? eligible[0]?.id ?? '',
  )
  const [date, setDate] = useState(defaults.date ?? addDays(today, 1))
  const [start, setStart] = useState<number | null>(() => {
    const wanted = defaults.startMinutes
    if (wanted === undefined) return null
    // A spot on the calendar may sit too close to the next visit, so take the nearest time that fits.
    const nearest = free(serviceId, staffId, date).sort(
      (a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b,
    )[0]
    return nearest !== undefined && Math.abs(nearest - wanted) <= 90 ? nearest : null
  })
  const [error, setError] = useState('')
  const [confirmedId, setConfirmedId] = useState('')
  const [booked, setBooked] = useState<{ date: string; start: number }[]>([])
  const available = free(serviceId, staffId, date)
  // NEXT-09: repeat visits, every few weeks after the first, each at a time free that day.
  const [everyWeeks, setEveryWeeks] = useState(0)
  const [count, setCount] = useState(6)
  const [picks, setPicks] = useState<Record<string, number | 'left'>>({})
  const lastDay = addDays(today, REPEAT_AHEAD_DAYS)
  const repeatRows: RepeatRow[] =
    everyWeeks && start !== null && staffId
      ? repeatDates(date, everyWeeks, count)
          .slice(1)
          .map((day) => {
            if (day > lastDay) return { date: day, times: [], start: null, why: 'beyond' }
            const times = free(serviceId, staffId, day)
            const pick = picks[day]
            if (pick === 'left') return { date: day, times, start: null, why: 'left' }
            if (pick !== undefined && times.includes(pick))
              return { date: day, times, start: pick, why: pick === start ? 'same' : 'moved' }
            if (times.includes(start)) return { date: day, times, start, why: 'same' }
            const near = [...times].sort(
              (a, b) => Math.abs(a - start) - Math.abs(b - start) || a - b,
            )[0]
            return near !== undefined && Math.abs(near - start) <= 90
              ? { date: day, times, start: near, why: 'moved' }
              : { date: day, times, start: null, why: 'full' }
          })
      : []
  const repeatVisits = repeatRows.filter((row) => row.start !== null)
  // Stage 3: the studio's patch test, offered when a treatment needs one first.
  const studioTest = patchTestBooking(state)
  const bookableTest =
    studioTest && services.some((x) => x.id === studioTest.id) ? studioTest : undefined
  const repeating = everyWeeks > 0
  // NEXT-08: others coming with them on the same day, each a client with a visit of their own.
  const [guests, setGuests] = useState<PartyGuest[]>([])
  const together = guests.length > 0 && !repeating
  const firstPlace = multiSite && staffId ? staffLocationOn(state, staffId, date) : undefined
  const leadFirst =
    (someoneNew ? newName : state.clients.find((c) => c.id === clientId)?.name)
      ?.trim()
      .split(/\s+/)[0] || 'the first person'
  const personName = (index: number) =>
    index === 0
      ? leadFirst
      : (() => {
          const guest = guests[index - 1]
          const name = guest?.someoneNew
            ? guest.name
            : state.clients.find((c) => c.id === guest?.clientId)?.name
          return name?.trim().split(/\s+/)[0] || `Person ${index + 1}`
        })()
  // The others' treatments, at the first person's location, for the totals.
  const partyTotal = (field: 'priceMinor' | 'depositMinor') =>
    guests.reduce((sum, guest) => {
      const item = state.services.find((x) => x.id === guest.serviceId)
      return (
        sum +
        (item
          ? field === 'priceMinor'
            ? serviceAt(item, firstPlace).priceMinor
            : item.depositMinor
          : 0)
      )
    }, 0)
  const rows = useMemo(
    () =>
      together
        ? partyRows(
            state,
            date,
            start !== null && serviceId && staffId
              ? {
                  ...(clientId && !someoneNew ? { clientId } : {}),
                  serviceId,
                  staffId,
                  startMinutes: start,
                }
              : null,
            guests,
            firstPlace,
            personName,
          )
        : [],
    // personName reads only the names held in the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      together,
      state,
      date,
      start,
      serviceId,
      staffId,
      clientId,
      someoneNew,
      newName,
      guests,
      firstPlace,
    ],
  )
  const client = state.clients.find((c) => c.id === clientId)
  const confirmedVisit = state.appointments.find((a) => a.id === confirmedId)
  const party = confirmedVisit ? togetherVisits(state, confirmedVisit) : []
  const several = booked.length > 1 || party.length > 1
  const bookedClient = state.clients.find(
    (c) => c.id === (state.appointments.find((a) => a.id === confirmedId)?.clientId ?? clientId),
  )
  const locale = state.organisation.locale
  const pastVisits = state.appointments
    .filter(
      (a) =>
        a.clientId === clientId &&
        a.date <= today &&
        (a.status === 'completed' || a.status === 'arrived'),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.startMinutes - a.startMinutes)
  const lastVisit = pastVisits[0]
  const lastService = lastVisit && state.services.find((s) => s.id === lastVisit.serviceId)
  const rebookedFrom = state.appointments.find((a) => a.id === defaults.rebookedFromId)
  const usual = usualWeeks(pastVisits.map((a) => a.date))
  const rhythm = rebookedFrom
    ? [...new Set([usual, 4, 6, 8].filter((w): w is number => w !== null))]
        .map((weeks) => ({ weeks, date: addDays(rebookedFrom.date, weeks * 7) }))
        .filter((choice) => choice.date > today)
    : []
  function chooseDate(next: string) {
    setDate(next)
    setPicks({})
    // Keep a familiar time when it is free on the new day.
    const keep = defaults.startMinutes
    setStart(keep !== undefined && free(serviceId, staffId, next).includes(keep) ? keep : null)
  }
  async function save() {
    if (busy || blocked || !can(role, 'book')) return
    if (!clientId && !newReady) {
      setError(someoneNew ? 'Enter their name, email and phone.' : 'Choose a client.')
      return
    }
    if (start === null) {
      setError('Choose an available time.')
      return
    }
    if (repeating && !repeatVisits.length) {
      setError('Every later visit is left out. Give one a time, or choose Just this visit.')
      return
    }
    if (together)
      for (const [i, guest] of guests.entries()) {
        const person = `Person ${i + 2}`
        const problem = guest.someoneNew
          ? guest.name.trim().length < 2 || !guest.email.trim() || !guest.phone.trim()
            ? `Enter ${person}’s name, email and phone.`
            : ''
          : !guest.clientId
            ? `Choose who ${person} is, or add them as someone new.`
            : ''
        if (problem || rows[i]?.start == null) {
          setError(problem || `Choose a time for ${person}.`)
          return
        }
      }
    setPending(true)
    setError('')
    try {
      const booking = {
        ...(someoneNew
          ? {
              contact: {
                name: newName.trim(),
                email: newEmail.trim(),
                phone: newPhone.trim(),
                marketingConsent: false,
              },
            }
          : { clientId }),
        serviceId,
        staffId,
        date,
        startMinutes: start,
        ...(multiSite ? { locationId: staffLocationOn(state, staffId, date) } : {}),
        source: defaults.rebookedFromId ? 'rebook' : 'desk',
        rebookedFromId: defaults.rebookedFromId,
        ...(call ? { callId: call.id } : {}),
        ...(consultation ? { consultationId: consultation.id } : {}),
      } as const
      const result = await commit(
        repeating
          ? {
              type: 'book-repeat',
              booking,
              everyWeeks,
              visits: repeatVisits.map((row) => ({ date: row.date, startMinutes: row.start! })),
            }
          : together
            ? {
                type: 'book-together',
                booking,
                guests: guests.map((guest, i) => ({
                  ...(guest.someoneNew
                    ? {
                        contact: {
                          name: guest.name.trim(),
                          email: guest.email.trim(),
                          phone: guest.phone.trim(),
                          marketingConsent: false,
                        },
                      }
                    : { clientId: guest.clientId }),
                  serviceId: guest.serviceId,
                  staffId: guest.staffId,
                  startMinutes: rows[i].start!,
                })),
              }
            : { type: 'book', input: booking },
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      setBooked(
        repeating
          ? [{ date, start }, ...repeatVisits.map((row) => ({ date: row.date, start: row.start! }))]
          : [],
      )
      setConfirmedId(result.recordId)
    } catch {
      setError('Could not save this visit. Your choices are still here; try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose()
      }}
      title={
        confirmedId
          ? several
            ? 'Visits to look forward to'
            : 'A visit to look forward to'
          : defaults.rebookedFromId
            ? 'Keep the relationship going'
            : 'Book a visit'
      }
      description={
        confirmedId
          ? 'The calendar and client timeline are updated.'
          : 'Availability includes the professional, treatment space and turnaround time.'
      }
    >
      {!service || (!state.clients.length && !call) ? (
        <div className="empty">
          <h3>A little setup is needed.</h3>
          <p>
            {!state.clients.length
              ? 'Add a client before reserving their visit.'
              : !service
                ? 'Add a treatment in Settings first.'
                : 'In Settings, choose who gives this treatment first.'}
          </p>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Close
          </Button>
        </div>
      ) : confirmedId ? (
        <div className="confirmation">
          <span className="confirmation-mark">
            <Check />
          </span>
          <h3>{bookedClient?.name}</h3>
          {party.length > 1 ? (
            <>
              <p>
                {party.length} people, booked together on{' '}
                {dateLabel(party[0].date, state.organisation.locale)}
              </p>
              <ul className="repeat-booked" aria-label="Visits booked">
                {party.map((visit) => (
                  <li key={visit.id}>{togetherLine(state, visit)}</li>
                ))}
              </ul>
            </>
          ) : booked.length > 1 ? (
            <>
              <p>
                {service.name}, {booked.length} visits {everyLabel(everyWeeks)}
              </p>
              <ul className="repeat-booked" aria-label="Visits booked">
                {booked.map((visit) => (
                  <li key={visit.date}>
                    {dateLabel(visit.date, locale)} at {timeLabel(visit.start, locale)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              {service.name}
              <br /> {dateLabel(date, state.organisation.locale)} at{' '}
              {timeLabel(start!, state.organisation.locale)}
            </p>
          )}
          <p className="subtle">
            {sandbox
              ? several
                ? 'Deposits simulated. No real payment taken.'
                : 'Deposit simulated. No real payment taken.'
              : several
                ? 'Visits reserved. Record any deposit already received in Money; no card has been charged.'
                : 'Visit reserved. Record any deposit already received in Money; no card has been charged.'}
          </p>
          {call && <p className="subtle">The call is off the missed calls list.</p>}
          <Button autoFocus onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <>
          {consultation && (
            <p className="booking-call-note">
              From the consultation on {dateLabel(consultation.heldOn, state.organisation.locale)}{' '}
              (version {latestVersion(consultation).version}): {latestVersion(consultation).plan}
            </p>
          )}
          {call && (
            <p className="booking-call-note">
              For the missed call from {numberLabel(call.number)}. Booking takes it off the list.
            </p>
          )}
          {someoneNew ? (
            <fieldset className="booking-new-client">
              <legend>Someone new</legend>
              <div className="form-grid">
                <label className="form-grid-wide">
                  Name
                  <input
                    value={newName}
                    autoComplete="off"
                    maxLength={100}
                    disabled={busy}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={newEmail}
                    autoComplete="off"
                    disabled={busy}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </label>
                <label>
                  Phone
                  <input
                    type="tel"
                    value={newPhone}
                    autoComplete="off"
                    disabled={busy}
                    onChange={(e) => setNewPhone(e.target.value)}
                  />
                </label>
              </div>
              <small>
                They are added as a client when you confirm. Ask before sending them news.
              </small>
              <Button variant="quiet" disabled={busy} onClick={() => setSomeoneNew(false)}>
                Choose an existing client instead
              </Button>
            </fieldset>
          ) : (
            <>
              <ClientPicker
                clientId={clientId}
                locked={busy || !!defaults.rebookedFromId || !!call?.clientId || !!consultation}
                initialQuery={call && !call.clientId ? call.number : ''}
                onChange={(id) => {
                  setClientId(id)
                  setError('')
                }}
              />
              {call && !call.clientId && !clientId && (
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    setSomeoneNew(true)
                    setError('')
                  }}
                >
                  They are new: add them while booking
                </Button>
              )}
            </>
          )}
          {client && !someoneNew && (
            <div className="booking-client-context">
              <div className="preference-note">
                <span>Good to remember</span>
                <p>{client.preferences || 'No preferences recorded yet.'}</p>
              </div>
              <p className="subtle">
                {lastVisit
                  ? `Last visit ${dateLabel(lastVisit.date, locale)}${lastService ? `, ${lastService.name}` : ''}. ${pastVisits.length} ${pastVisits.length === 1 ? 'visit' : 'visits'} so far.`
                  : 'First visit with you.'}
              </p>
            </div>
          )}
          <div className="form-grid">
            <label className="form-grid-wide">
              Treatment
              <Select
                value={serviceId}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value
                  setServiceId(next)
                  setStaffId(
                    state.staff.find((s) => !s.archived && s.serviceIds.includes(next))?.id ?? '',
                  )
                  setStart(null)
                }}
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.durationMinutes} min · {money(s.priceMinor, state.organisation)}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Professional
              <Select
                value={staffId}
                disabled={busy || !eligible.length}
                onChange={(e) => {
                  setStaffId(e.target.value)
                  setStart(null)
                }}
              >
                {!eligible.length && <option value="">No qualified professional</option>}
                {eligible.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </label>
            {rhythm.length > 0 && (
              <fieldset className="rebook-rhythm">
                <legend>Next visit</legend>
                <div>
                  {rhythm.map((choice) => (
                    <button
                      type="button"
                      key={choice.weeks}
                      className={`time-slot ${date === choice.date ? 'selected' : ''}`}
                      aria-pressed={date === choice.date}
                      disabled={busy}
                      onClick={() => chooseDate(choice.date)}
                    >
                      In {choice.weeks} weeks
                      <small>
                        {choice.weeks === usual
                          ? 'Their usual rhythm'
                          : dateLabel(choice.date, locale)}
                      </small>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <label>
              Date
              <StudioDateField
                value={date}
                min={today}
                max={addDays(today, 365)}
                disabled={busy}
                onChange={chooseDate}
              />
            </label>
          </div>
          {multiSite && staffId && (
            <p className="subtle">
              At {placeOf(state, staffLocationOn(state, staffId, date))?.name}, where{' '}
              {state.staff.find((p) => p.id === staffId)?.name.split(' ')[0]} works that day.
            </p>
          )}
          <TimeChoices
            label="Available times"
            times={available.map((value) => ({ value, label: timeLabel(value, locale) }))}
            value={start}
            onChange={(time) => {
              setStart(time)
              setError('')
            }}
          />
          {(someoneNew || clientId) && (
            <BookingPatchTest
              clientId={someoneNew ? undefined : clientId}
              serviceId={serviceId}
              date={date}
              start={start}
              test={bookableTest}
              onBookTest={(id) => {
                setServiceId(id)
                setStaffId(
                  state.staff.find((s) => !s.archived && s.serviceIds.includes(id))?.id ?? '',
                )
                setStart(null)
                setEveryWeeks(0)
                setError('')
              }}
            />
          )}
          {!repeating && (
            <TogetherSection
              state={state}
              guests={guests}
              rows={rows}
              firstName={leadFirst}
              firstStart={start}
              firstServiceId={serviceId}
              chosen={[clientId, ...guests.map((guest) => guest.clientId)].filter(Boolean)}
              locationId={firstPlace}
              busy={busy}
              onChange={(next) => {
                setGuests(next)
                setError('')
              }}
            />
          )}
          {guests.length > 0 ? (
            <p className="subtle booking-repeat-off">
              A repeat is for one person, so it is off while others are coming.
            </p>
          ) : (
            <fieldset className="booking-repeat">
              <legend>
                <Repeat2 size={17} aria-hidden="true" /> Repeat
              </legend>
              <div className="form-grid">
                <label>
                  How often
                  <Select
                    value={everyWeeks}
                    disabled={busy}
                    onChange={(e) => {
                      setEveryWeeks(Number(e.target.value))
                      setPicks({})
                      setError('')
                    }}
                  >
                    <option value={0}>Just this visit</option>
                    {REPEAT_EVERY.map((weeks) => (
                      <option key={weeks} value={weeks}>
                        {weeks === 1 ? 'Every week' : `Every ${weeks} weeks`}
                      </option>
                    ))}
                  </Select>
                </label>
                {repeating && (
                  <label>
                    Visits in all
                    <Select
                      value={count}
                      disabled={busy}
                      onChange={(e) => {
                        setCount(Number(e.target.value))
                        setError('')
                      }}
                    >
                      {REPEAT_COUNTS.map((n) => (
                        <option key={n} value={n}>
                          {n} visits
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
              </div>
              {repeating &&
                (start === null ? (
                  <p className="subtle">Choose a time for the first visit; the others follow it.</p>
                ) : (
                  <>
                    <ul className="repeat-plan" aria-label="The later visits">
                      {repeatRows.map((row) => (
                        <li key={row.date} className={row.start === null ? 'repeat-left' : ''}>
                          <span>
                            <strong>{dateLabel(row.date, locale)}</strong>
                            <small>
                              {
                                {
                                  same: `Free at ${timeLabel(start, locale)}.`,
                                  moved:
                                    picks[row.date] === row.start
                                      ? 'At the time you chose.'
                                      : `${timeLabel(start, locale)} is taken, so the nearest free time.`,
                                  full: 'Nothing free near that time, so it is left out.',
                                  beyond: 'More than a year ahead, so it is left out.',
                                  left: 'Left out.',
                                }[row.why]
                              }
                            </small>
                          </span>
                          {row.times.length > 0 && (
                            <Select
                              aria-label={`Time on ${dateLabel(row.date, locale)}`}
                              value={row.start ?? 'left'}
                              disabled={busy}
                              onChange={(e) => {
                                const value = e.target.value
                                setPicks({
                                  ...picks,
                                  [row.date]: value === 'left' ? 'left' : Number(value),
                                })
                                setError('')
                              }}
                            >
                              {row.times.map((time) => (
                                <option key={time} value={time}>
                                  {timeLabel(time, locale)}
                                </option>
                              ))}
                              <option value="left">Leave this one out</option>
                            </Select>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="subtle">
                      {repeatVisits.length + 1} visits, each its own booking: any one can move or be
                      cancelled alone.
                    </p>
                  </>
                ))}
            </fieldset>
          )}
          <div className="booking-summary">
            <CalendarDays size={20} />
            <span>
              {together ? `${leadFirst[0].toUpperCase()}${leadFirst.slice(1)}: ` : ''}
              {service.durationMinutes} minutes, with {service.bufferMinutes} minutes to turn the
              room around.
            </span>
          </div>
          <div className="receipt-line">
            <span>
              {repeating
                ? 'Treatment total, each visit'
                : together
                  ? `Treatment total, ${guests.length + 1} people`
                  : 'Treatment total'}
            </span>
            <strong>
              {money(
                serviceAt(service, firstPlace).priceMinor +
                  (together ? partyTotal('priceMinor') : 0),
                state.organisation,
              )}
            </strong>
          </div>
          <div className="receipt-line subtle">
            <span>
              {together
                ? `${sandbox ? 'Simulated deposits' : 'Deposits requested'}, ${guests.length + 1} people`
                : `${sandbox ? 'Simulated deposit' : 'Deposit requested'}${repeating ? ', each visit' : ''}`}
            </span>
            <span>
              {money(
                service.depositMinor + (together ? partyTotal('depositMinor') : 0),
                state.organisation,
              )}
            </span>
          </div>
          <ErrorMessage error={error} />
          <div className="dialog-footer">
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={
                busy ||
                blocked ||
                !can(role, 'book') ||
                !(someoneNew ? newReady : clientId) ||
                start === null ||
                !available.includes(start)
              }
            >
              {busy
                ? 'Saving visit…'
                : repeating && start !== null && repeatVisits.length
                  ? `Confirm ${repeatVisits.length + 1} visits`
                  : together
                    ? `Confirm ${guests.length + 1} visits`
                    : sandbox
                      ? 'Confirm demo booking'
                      : 'Confirm booking'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
