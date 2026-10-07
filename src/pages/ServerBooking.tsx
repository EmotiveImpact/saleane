import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { api, ApiError } from '../state/api'
import { z } from 'zod'
import { contactSchema } from '../domain/commandSchema'
import { useStore } from '../state/context'
import type { BusinessState } from '../domain/model'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import { Button, ErrorMessage, TimeChoices } from '../design'
import { BotCheck } from '../components/BotCheck'
import { BookingFrame } from '../components/BookingFrame'
import { TreatmentPicker } from '../components/TreatmentPicker'
import { PriceSentence } from '../components/PriceSentence'
import { BeforeYouArrive } from '../components/BeforeYouArrive'
import { AddToCalendar } from '../components/AddToCalendar'
import { LocationChoice } from '../components/LocationChoice'
import type { LocationOption } from '../components/LocationChoice'
import { visitUid } from '../domain/calendarFile'
import { bookingChannel } from '../domain/bookingChannel'
import { fullPriceMinor } from '../domain/priceSentence'
import type { PriceTax } from '../domain/priceSentence'
import '../guest.css'

const pendingBookingSchema = z.object({
  payload: z.object({
    hold: z.string().min(32).max(100),
    contact: contactSchema,
    policy: z.literal(true),
  }),
  serviceId: z.string(),
  staffId: z.string(),
  date: z.iso.date(),
  start: z.number().int(),
  expiresAt: z.iso.datetime(),
  locationId: z.string().optional(),
})
type PendingBooking = z.infer<typeof pendingBookingSchema>
function readPendingBooking(key: string) {
  try {
    const raw = sessionStorage.getItem(key)
    return { value: raw ? pendingBookingSchema.parse(JSON.parse(raw)) : null, error: '' }
  } catch {
    return {
      value: null,
      error:
        'An unfinished confirmation could not be recovered in this tab. Contact the studio to check its calendar before booking again.',
    }
  }
}
/** The `from` value of a shared booking link, such as ?from=google. */
function urlChannel() {
  try {
    return new URLSearchParams(window.location.search).get('from') ?? undefined
  } catch {
    return undefined
  }
}
type Catalog = {
  organisation: BusinessState['organisation']
  services: BusinessState['services']
  /** V2: locationIds says where each person works; older servers send none. */
  staff: (BusinessState['staff'][number] & { locationIds?: string[] })[]
  today: string
  sample: boolean
  patchTestHours?: number
  botCheck?: { siteKey: string } | null
  tax?: PriceTax
  /** V2: open locations, main first. Older servers send none. */
  locations?: LocationOption[]
}
export function ServerBooking() {
  const { slug } = useParams(),
    base = `/api/public/${encodeURIComponent(slug ?? '')}`
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  useEffect(() => {
    let active = true
    api<Catalog>(base)
      .then((c) => {
        if (active) setCatalog(c)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [base])
  if (!catalog)
    return (
      <main className="account-main">
        <Link className="wordmark" to="/today">
          SALEANE
        </Link>
        <h1>{error ? 'Booking is unavailable.' : 'A moment for you…'}</h1>
        <ErrorMessage error={error} />
        <Link to="/today">Back to workspace</Link>
      </main>
    )
  return (
    <BookingFlow
      key={slug}
      catalog={catalog}
      base={base}
      pending={pending}
      setPending={setPending}
    />
  )
}
function BookingFlow({
  catalog,
  base,
  pending,
  setPending,
}: {
  catalog: Catalog
  base: string
  pending: boolean
  setPending: (value: boolean) => void
}) {
  const { organisation: org, services, staff, today, sample, botCheck, tax } = catalog
  const locations = catalog.locations ?? []
  const store = useStore(),
    navigate = useNavigate()
  const journalKey = `saleane.guest-confirmation:${base}`
  const [recovery] = useState(() => readPendingBooking(journalKey))
  const [attempt, setAttempt] = useState<PendingBooking | null>(recovery.value)
  const [picked, setPicked] = useState(false)
  // With one kind of treatment the list opens straight away, chosen as before;
  // otherwise nothing is chosen until the guest picks.
  const ready = picked || new Set(services.map((s) => s.category)).size < 2
  const [step, setStep] = useState(recovery.value ? 4 : 1),
    [serviceId, setServiceId] = useState(recovery.value?.serviceId ?? services[0]?.id ?? ''),
    [staffId, setStaffId] = useState(recovery.value?.staffId ?? 'any'),
    [date, setDate] = useState(recovery.value?.date ?? addDays(today, 1)),
    [chosenLocation, setLocationId] = useState(recovery.value?.locationId ?? locations[0]?.id ?? '')
  // Only places where someone does the chosen treatment are offered.
  const offered = locations.filter((l) =>
    staff.some(
      (p) => p.serviceIds.includes(serviceId) && (!p.locationIds || p.locationIds.includes(l.id)),
    ),
  )
  const locationId = offered.some((l) => l.id === chosenLocation)
    ? chosenLocation
    : (offered[0]?.id ?? chosenLocation)
  // Where the visit is: the chosen location, or the studio itself when it has only one.
  const place = locations.find((l) => l.id === locationId)
  const where = {
    name: place?.name ?? org.locationName,
    address: place?.address ?? org.address,
    arrivalNote: place ? place.arrivalNote : org.arrivalNote,
  }
  const located: { locationId?: string } = locations.length > 1 && locationId ? { locationId } : {}
  const [availability, setAvailability] = useState<{ key: string; times: number[] }>({
      key: '',
      times: [],
    }),
    [start, setStart] = useState<number | null>(recovery.value?.start ?? null)
  const queryKey = [serviceId, staffId, date, base, step, locationId].join('|'),
    loadingTimes = availability.key !== queryKey,
    times = loadingTimes ? [] : availability.times
  const [hold, setHold] = useState<{ hold: string; expiresAt: string } | null>(
      recovery.value
        ? { hold: recovery.value.payload.hold, expiresAt: recovery.value.expiresAt }
        : null,
    ),
    [seconds, setSeconds] = useState(0)
  const [botToken, setBotToken] = useState(''),
    [botAttempt, setBotAttempt] = useState(0)
  const [name, setName] = useState(recovery.value?.payload.contact.name ?? ''),
    [email, setEmail] = useState(recovery.value?.payload.contact.email ?? ''),
    [phone, setPhone] = useState(recovery.value?.payload.contact.phone ?? ''),
    [consent, setConsent] = useState(recovery.value?.payload.contact.marketingConsent ?? false),
    [policy, setPolicy] = useState(!!recovery.value),
    [error, setError] = useState(''),
    [confirmed, setConfirmed] = useState(''),
    [manageUrl, setManageUrl] = useState('')
  const service = services.find((s) => s.id === serviceId),
    professional = staff.find((s) => s.id === staffId)
  // Each step starts at the top, so a guest on a phone isn't left at the foot of the last one.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
  }, [step, confirmed])
  useEffect(() => {
    if (!serviceId || step !== 2) return
    let active = true
    api<{ times: number[] }>(
      `${base}/availability?${new URLSearchParams(located.locationId ? { serviceId, staffId, date, locationId: located.locationId } : { serviceId, staffId, date })}`,
    )
      .then((r) => {
        if (active) setAvailability({ key: queryKey, times: r.times })
      })
      .catch((e) => {
        if (active) {
          setError(e.message)
          setAvailability({ key: queryKey, times: [] })
        }
      })
    return () => {
      active = false
    }
    // `located` follows locationId, which is part of the query key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, staffId, date, base, step, queryKey])
  useEffect(() => {
    if (!hold) return
    const update = () =>
      setSeconds(Math.max(0, Math.ceil((Date.parse(hold.expiresAt) - Date.now()) / 1000)))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [hold])
  async function reserve() {
    if (start === null) return
    setPending(true)
    setError('')
    try {
      setHold(
        await api(`${base}/holds`, {
          method: 'POST',
          body: {
            serviceId,
            staffId,
            date,
            startMinutes: start,
            ...located,
            // Hand back any earlier hold so this guest never holds two times at once.
            ...(hold ? { replaces: hold.hold } : {}),
            ...(botCheck ? { botCheck: botToken } : {}),
          },
        }),
      )
      setStep(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This time could not be reserved.')
    } finally {
      // Turnstile tokens are single use, so every attempt needs a fresh check.
      if (botCheck) setBotAttempt((n) => n + 1)
      setPending(false)
    }
  }
  async function chooseAnotherTime() {
    if (attempt) return
    setPending(true)
    setError('')
    try {
      if (hold) await api(`${base}/holds/release`, { method: 'POST', body: { hold: hold.hold } })
      setHold(null)
      setStart(null)
      setStep(2)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'The hold could not be released. It expires automatically after five minutes.',
      )
    } finally {
      setPending(false)
    }
  }
  async function confirm() {
    if (!hold || (!attempt && !policy) || recovery.error) return
    setPending(true)
    setError('')
    const submitted = attempt ?? {
      payload: {
        hold: hold.hold,
        contact: { name, email, phone, marketingConsent: consent },
        policy: true as const,
      },
      serviceId,
      staffId,
      date,
      start: start!,
      expiresAt: hold.expiresAt,
      ...located,
    }
    try {
      // Preserve the exact consent/contact snapshot before any request leaves this tab.
      sessionStorage.setItem(journalKey, JSON.stringify(submitted))
      setAttempt(submitted)
      const result = await api<{ appointmentId: string; manage?: { url: string } }>(
        `${base}/book`,
        {
          method: 'POST',
          // Where the guest came from, when they followed one of the studio's shared links.
          body: { ...submitted.payload, from: bookingChannel(urlChannel()) },
        },
      )
      setManageUrl(result.manage?.url ?? '')
      setConfirmed(result.appointmentId)
      setAttempt(null)
      try {
        sessionStorage.removeItem(journalKey)
      } catch {
        /* Receipt replay remains safe if local cleanup fails. */
      }
    } catch (e) {
      if (e instanceof ApiError && [400, 409, 422].includes(e.status)) {
        setAttempt(null)
        try {
          sessionStorage.removeItem(journalKey)
        } catch {
          /* Preserve readable recovery until a later reload. */
        }
      }
      setError(
        e instanceof Error
          ? e.message
          : 'Confirmation is uncertain. Check this booking before choosing another time.',
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <BookingFrame
      studio={org.name}
      location={where.name}
      notice={
        sample
          ? 'Fictional sample studio. Reservations and deposits are simulated.'
          : 'Local booking preview. Pay at the studio; online payments and emails are not connected yet.'
      }
      pastWelcome={step > 1 || !!confirmed}
      team={!!store.session}
    >
      {confirmed ? (
        <div className="booking-confirmation">
          <span className="confirmation-mark">
            <Check size={32} />
          </span>
          <p className="date-caption">Saved in the studio calendar</p>
          <h2>Something to look forward to.</h2>
          <p>
            {service?.name}
            <br />
            {dateLabel(date, org.locale)} at {timeLabel(start!, org.locale)}
          </p>
          <p>Booking reference: {confirmed.slice(-8).toUpperCase()}</p>
          {locations.length > 1 && (
            <p>
              {where.name}
              {where.address ? `, ${where.address}` : ''}
            </p>
          )}
          <BeforeYouArrive
            studioNote={where.arrivalNote}
            serviceNote={service?.prepNote}
            patchTestHours={service?.patchTest ? (catalog.patchTestHours ?? 48) : undefined}
          />
          {service && start !== null && (
            <AddToCalendar
              visit={{
                uid: visitUid(confirmed),
                serviceName: service.name,
                studioName: org.name,
                date,
                startMinutes: start,
                durationMinutes: service.durationMinutes,
                timeZone: org.timeZone,
                location: where.address || where.name,
              }}
            />
          )}
          <p className="subtle">
            {sample
              ? 'This is a fictional sample reservation.'
              : 'Your reservation is saved on this local server.'}{' '}
            No money was collected and no email was sent. Keep this page for your records.
          </p>
          {manageUrl && (
            <div className="manage-link">
              <label htmlFor="manage-link">Your private link to view or cancel this visit</label>
              <input
                id="manage-link"
                readOnly
                value={manageUrl}
                onFocus={(e) => e.target.select()}
              />
              <small>
                Not sent anywhere. Copy it now; anyone with this link can cancel the visit.
              </small>
            </div>
          )}
          <Button
            onClick={async () => {
              if (store.mode === 'server' && store.state.organisation.id === org.id) {
                try {
                  await store.reload()
                } catch {
                  /* The workspace offers recovery controls. */
                }
              }
              navigate(`/calendar?date=${date}`)
            }}
          >
            Back to workspace
          </Button>
        </div>
      ) : !service && attempt ? (
        <div className="booking-confirmation">
          <h2>Check your booking.</h2>
          <p>
            The treatment menu changed after your confirmation was submitted. Check that reservation
            before starting another.
          </p>
          <Button disabled={pending} onClick={() => void confirm()}>
            Check booking status
          </Button>
          <ErrorMessage error={error} />
        </div>
      ) : !service ? (
        <div className="empty">
          <h2>Good things are taking shape.</h2>
          <p>This studio is still setting up its treatment menu.</p>
        </div>
      ) : (
        <>
          <nav className="booking-steps" aria-label="Booking progress">
            {['Your treatment', 'A time for you', 'Your details', 'A final look'].map(
              (label, i) => (
                <span key={label} aria-current={step === i + 1 ? 'step' : undefined}>
                  <span>{i + 1}</span>
                  <small>{label}</small>
                </span>
              ),
            )}
          </nav>
          <div className="booking-step-content">
            <h2>
              {
                [
                  'What brings you in?',
                  'Find your moment.',
                  'Let’s get to know you.',
                  'All the little details.',
                ][step - 1]
              }
            </h2>
            {step >= 3 && hold && (
              <p className="subtle" role="status">
                {attempt
                  ? 'Confirmation needs checking. Your submitted details are protected; check this booking before choosing another time.'
                  : seconds
                    ? `This time is held for ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.`
                    : 'Your hold expired. Choose a time again.'}
              </p>
            )}
            <ErrorMessage error={recovery.error} />
            <fieldset disabled={pending || !!recovery.error} className="booking-operation-fields">
              {step === 1 && (
                <>
                  <TreatmentPicker
                    treatments={services}
                    value={serviceId}
                    resume={picked}
                    renderChoice={(s) => (
                      <button
                        key={s.id}
                        aria-pressed={ready && s.id === serviceId}
                        className={`service-choice ${ready && s.id === serviceId ? 'selected' : ''}`}
                        onClick={() => {
                          setPicked(true)
                          setServiceId(s.id)
                          setStaffId('any')
                        }}
                      >
                        <span>
                          <span className="service-category">{s.category}</span>
                          <h3>{s.name}</h3>
                          <p>{s.description}</p>
                          {s.patchTest && (
                            <p className="service-patch">
                              Needs a patch test at least {catalog.patchTestHours ?? 48} hours
                              before
                            </p>
                          )}
                          <PriceSentence
                            service={s}
                            organisation={org}
                            tax={tax}
                            simulated={sample}
                          />
                        </span>
                        <strong>{money(fullPriceMinor(s, tax), org)}</strong>
                      </button>
                    )}
                    footer={
                      ready && (
                        <div className="booking-next">
                          <span>{service.name}</span>
                          <Button onClick={() => setStep(2)}>
                            Choose a time <ArrowRight size={17} />
                          </Button>
                        </div>
                      )
                    }
                  />
                </>
              )}
              {step === 2 && (
                <>
                  <LocationChoice
                    locations={offered}
                    value={locationId}
                    onChange={(id) => {
                      setLocationId(id)
                      // Someone who never works at the new location is no longer a choice.
                      if (!staff.find((p) => p.id === staffId)?.locationIds?.includes(id))
                        setStaffId('any')
                      setStart(null)
                      setError('')
                    }}
                  />
                  <label>
                    Your professional
                    <select
                      value={staffId}
                      onChange={(e) => {
                        setStaffId(e.target.value)
                        setStart(null)
                        setError('')
                      }}
                    >
                      <option value="any">No preference · first available</option>
                      {staff
                        .filter(
                          (p) =>
                            p.serviceIds.includes(serviceId) &&
                            (!located.locationId ||
                              !p.locationIds ||
                              p.locationIds.includes(located.locationId)),
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Choose a date
                    <input
                      type="date"
                      min={today}
                      max={addDays(today, 365)}
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value)
                        setStart(null)
                        setError('')
                      }}
                    />
                  </label>
                  {loadingTimes ? (
                    <p role="status">Finding available times…</p>
                  ) : (
                    <TimeChoices
                      label={`Available times · ${org.timeZone}`}
                      times={times.map((value) => ({
                        value,
                        label: timeLabel(value, org.locale),
                      }))}
                      value={start}
                      onChange={setStart}
                      tabs
                    />
                  )}
                  {!loadingTimes && !times.length && date < addDays(today, 365) && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setDate(addDays(date, 1))
                        setStart(null)
                        setError('')
                      }}
                    >
                      Try {dateLabel(addDays(date, 1), org.locale)}
                    </Button>
                  )}
                  {botCheck && (
                    <BotCheck key={botAttempt} siteKey={botCheck.siteKey} onToken={setBotToken} />
                  )}
                  <div className="booking-next">
                    <Button variant="quiet" onClick={() => setStep(1)}>
                      <ArrowLeft size={16} />
                      Back
                    </Button>
                    <Button
                      disabled={
                        start === null ||
                        loadingTimes ||
                        !times.includes(start) ||
                        (!!botCheck && !botToken)
                      }
                      onClick={() => void reserve()}
                    >
                      Hold this time <ArrowRight size={17} />
                    </Button>
                  </div>
                </>
              )}
              {step === 3 && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    setStep(4)
                  }}
                >
                  <div className="booking-contact-form">
                    <label>
                      Full name
                      <input
                        autoComplete="name"
                        required
                        minLength={2}
                        maxLength={100}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <label>
                      Email
                      <input
                        autoComplete="email"
                        required
                        type="email"
                        maxLength={254}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </label>
                    <label>
                      Phone with country code
                      <input
                        autoComplete="tel"
                        type="tel"
                        required
                        pattern={String.raw`\+[0-9\s\(\)\-]{6,29}`}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder={org.region === 'UK' ? '+44 7700 900123' : '+1 212 555 0123'}
                      />
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      I’d like occasional email news from {org.name}.
                    </label>
                    <p className="subtle">
                      Optional. Booking does not depend on marketing consent. Use fictional contact
                      details while this local candidate is under review.
                    </p>
                  </div>
                  <div className="booking-next">
                    <Button variant="quiet" onClick={() => void chooseAnotherTime()}>
                      Choose another time
                    </Button>
                    <Button type="submit" disabled={!seconds}>
                      Review your visit <ArrowRight size={17} />
                    </Button>
                  </div>
                </form>
              )}
              {step === 4 && (
                <>
                  <div className="booking-review">
                    <span className="service-category">{service.category}</span>
                    <h3>{service.name}</h3>
                    <p>
                      {dateLabel(date, org.locale)} at {timeLabel(start!, org.locale)}
                      <br />
                      {service.durationMinutes} minutes ·{' '}
                      {professional?.name ?? 'First available professional'}
                      <br />
                      {where.name}
                      {locations.length > 1 && where.address ? `, ${where.address}` : ''}
                    </p>
                    <div className="receipt-line">
                      <span>Service total</span>
                      <strong>{money(fullPriceMinor(service, tax), org)}</strong>
                    </div>
                    <div className="receipt-line">
                      <span>{sample ? 'Simulated deposit' : 'Online payment'}</span>
                      <strong>
                        {sample ? money(service.depositMinor, org) : 'None collected'}
                      </strong>
                    </div>
                    <p>
                      {name}
                      <br />
                      {email}
                      <br />
                      {phone}
                    </p>
                  </div>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={policy}
                      disabled={!!attempt}
                      onChange={(e) => setPolicy(e.target.checked)}
                    />
                    I understand this is a local booking preview. No real payment or email is sent.
                  </label>
                  <div className="booking-next">
                    <Button variant="quiet" disabled={!!attempt} onClick={() => setStep(3)}>
                      Edit details
                    </Button>
                    <Button
                      disabled={!attempt && (!policy || !seconds)}
                      onClick={() => void confirm()}
                    >
                      {attempt ? 'Check booking status' : `Confirm ${sample ? 'sample ' : ''}visit`}{' '}
                      <Check size={17} />
                    </Button>
                  </div>
                  {!seconds && !attempt && (
                    <Button variant="secondary" onClick={() => void chooseAnotherTime()}>
                      Choose a time again
                    </Button>
                  )}
                </>
              )}
            </fieldset>
            <ErrorMessage error={error} />
          </div>
          <footer className="booking-powered">
            Considered care. Connected by <span className="mini-saleane">SALEANE</span>
          </footer>
        </>
      )}
    </BookingFrame>
  )
}
