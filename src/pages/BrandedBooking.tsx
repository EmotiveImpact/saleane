import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Clock3, ShieldCheck, Users } from 'lucide-react'
import { useStore } from '../state/context'
import { DEMO_DATE } from '../domain/model'
import { slots } from '../domain/commands'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import { Avatar, Button, DateStrip, ErrorMessage, TimeChoices } from '../design'
import { operations } from '../domain/operations'
import { BookingFrame } from '../components/BookingFrame'
import { TreatmentPicker } from '../components/TreatmentPicker'
import { PriceSentence } from '../components/PriceSentence'
import { BeforeYouArrive } from '../components/BeforeYouArrive'
import { AddToCalendar } from '../components/AddToCalendar'
import { visitUid } from '../domain/calendarFile'
import { bookingChannel } from '../domain/bookingChannel'
import { fullPriceMinor } from '../domain/priceSentence'
import { patchTestSettings } from '../domain/patchTests'

export function BrandedBooking() {
  const { state, commit, region, changeRegion, saving } = useStore()
  const [step, setStep] = useState(1)
  const [picked, setPicked] = useState(false)
  // With one kind of treatment the list opens straight away, chosen as before;
  // otherwise nothing is chosen until the guest picks.
  const ready = picked || new Set(state.services.map((s) => s.category)).size < 2
  const [serviceId, setServiceId] = useState(state.services[0].id)
  // 'any' lets the guest take the first professional free at the time they choose.
  const [staffId, setStaffId] = useState('any')
  const [date, setDate] = useState(addDays(DEMO_DATE, 1))
  const [start, setStart] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [policy, setPolicy] = useState(false)
  const [error, setError] = useState('')
  const [confirmedId, setConfirmedId] = useState('')
  const service = state.services.find((s) => s.id === serviceId)!
  const professionals = state.staff.filter((s) => s.serviceIds.includes(serviceId))
  const anyone = staffId === 'any' && professionals.length > 1
  const pool = anyone
    ? professionals
    : professionals
        .filter((p) => p.id === staffId)
        .concat(professionals)
        .slice(0, 1)
  /** Every time someone in the pool is free on a day, earliest first. */
  const freeTimes = (day: string) =>
    [...new Set(pool.flatMap((p) => slots(state, serviceId, p.id, day)))].sort((a, b) => a - b)
  const times = freeTimes(date)
  // With no preference, the visit goes to the first professional free at the chosen time.
  const staff =
    (start !== null && pool.find((p) => slots(state, serviceId, p.id, date).includes(start))) ||
    pool[0]
  // Only work out the fortnight and the next opening while the guest is choosing a time.
  const fortnight =
    step === 2
      ? Array.from({ length: 14 }, (_, i) => {
          const day = addDays(DEMO_DATE, i)
          return { date: day, free: freeTimes(day).length }
        })
      : []
  const nextOpen = (() => {
    if (step !== 2 || times.length) return null
    for (let i = 1; i <= 60; i++) {
      const day = addDays(date, i)
      const open = freeTimes(day)
      if (open.length) return { date: day, time: open[0] }
    }
    return null
  })()
  const steps = ['Your treatment', 'A time for you', 'Your details', 'A final look']
  // Each step starts at the top, so a guest on a phone isn't left at the foot of the last one.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
  }, [step, confirmedId])
  const tax = operations(state).tax
  const fullPrice = (s: { priceMinor: number }) => fullPriceMinor(s, tax)
  async function confirm() {
    if (start === null || !policy) {
      setError('Choose a time and acknowledge the demo booking policy.')
      return
    }
    const result = await commit({
      type: 'book',
      input: {
        serviceId,
        staffId: staff.id,
        date,
        startMinutes: start,
        contact: { name, email, phone, marketingConsent: consent },
        source: 'online',
        // Where the guest came from, when they followed one of the studio's shared links.
        channel: bookingChannel(new URLSearchParams(window.location.search).get('from')),
      },
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfirmedId(result.recordId)
  }
  return (
    <BookingFrame
      studio={state.organisation.name}
      location={state.organisation.locationName}
      notice="Demo booking experience. Use fictional details. No real reservation or payment is made."
      pastWelcome={step > 1 || !!confirmedId}
      team
      controls={
        <>
          <label className="sr-only" htmlFor="booking-market">
            Demo market
          </label>
          <select
            id="booking-market"
            value={region}
            onChange={(e) => changeRegion(e.target.value as typeof region)}
          >
            <option value="UK">London · GBP</option>
            <option value="US">New York · USD</option>
          </select>
        </>
      }
    >
      {confirmedId ? (
        <div className="booking-confirmation">
          <span className="confirmation-mark">
            <Check size={32} />
          </span>
          <p className="date-caption">Your demo visit is in the calendar</p>
          <h2>
            Something to
            <br /> look forward to, {name.split(' ')[0]}.
          </h2>
          <p>
            {service.name} with {staff.name}
            <br /> {dateLabel(date, state.organisation.locale)} at{' '}
            {timeLabel(start!, state.organisation.locale)}
          </p>
          <div className="confirmation-details">
            <span>
              Service total<strong>{money(fullPrice(service), state.organisation)}</strong>
            </span>
            <span>
              Demo deposit<strong>{money(service.depositMinor, state.organisation)}</strong>
            </span>
          </div>
          <BeforeYouArrive
            studioNote={state.organisation.arrivalNote}
            serviceNote={service.prepNote}
            patchTestHours={service.patchTest ? patchTestSettings(state).hoursBefore : undefined}
          />
          {start !== null && (
            <AddToCalendar
              visit={{
                uid: visitUid(confirmedId),
                serviceName: service.name,
                studioName: state.organisation.name,
                date,
                startMinutes: start,
                durationMinutes: service.durationMinutes,
                timeZone: state.organisation.timeZone,
                location: state.organisation.address || state.organisation.locationName,
                description: `With ${staff.name.split(' ')[0]}.`,
              }}
            />
          )}
          <p className="subtle">
            No money was taken and no email was sent. This fictional booking is saved in this
            browser’s workspace.
          </p>
          <Link className="button button-primary" to="/calendar">
            View in the workspace <ArrowRight size={17} />
          </Link>
          <button
            className="text-link"
            onClick={() => {
              setConfirmedId('')
              setStep(1)
              setStart(null)
              setName('')
              setEmail('')
              setPhone('')
              setConsent(false)
              setPolicy(false)
            }}
          >
            Book another demo visit
          </button>
        </div>
      ) : (
        <>
          <nav className="booking-steps" aria-label="Booking progress">
            {steps.map((label, i) => (
              <button
                key={label}
                disabled={i + 1 > step}
                aria-current={step === i + 1 ? 'step' : undefined}
                onClick={() => {
                  setStep(i + 1)
                  setError('')
                }}
              >
                <span>{step > i + 1 ? <Check size={14} /> : i + 1}</span>
                <small>{label}</small>
              </button>
            ))}
          </nav>
          <div className="booking-step-content">
            <h2>
              {step === 1
                ? 'What brings you in?'
                : step === 2
                  ? 'Find your moment.'
                  : step === 3
                    ? 'Let’s get to know you.'
                    : 'All the little details.'}
            </h2>
            <p>
              {step === 1
                ? 'Choose a treatment. We’ll take care of the rest.'
                : step === 2
                  ? 'A familiar professional, at a time that suits you.'
                  : step === 3
                    ? 'Just what we need to look after your appointment.'
                    : 'Take a moment to review your visit.'}
            </p>
            {step === 1 && (
              <>
                <TreatmentPicker
                  treatments={state.services}
                  value={serviceId}
                  resume={picked}
                  renderChoice={(s) => (
                    <button
                      key={s.id}
                      aria-pressed={ready && serviceId === s.id}
                      className={`service-choice ${ready && serviceId === s.id ? 'selected' : ''}`}
                      onClick={() => {
                        setPicked(true)
                        setServiceId(s.id)
                        setStaffId('any')
                        setStart(null)
                      }}
                    >
                      <div>
                        <span className="service-category">{s.category}</span>
                        <h3>{s.name}</h3>
                        <p>{s.description}</p>
                        {s.patchTest && (
                          <p className="service-patch">
                            Needs a patch test at least {patchTestSettings(state).hoursBefore} hours
                            before
                          </p>
                        )}
                        <span className="service-time">
                          <Clock3 size={14} />
                          {s.durationMinutes} minutes
                        </span>
                        <PriceSentence
                          service={s}
                          organisation={state.organisation}
                          tax={tax}
                          simulated
                        />
                      </div>
                      <span>
                        <strong>{money(fullPrice(s), state.organisation)}</strong>
                        <span className="selection-circle">
                          {ready && serviceId === s.id && <Check size={14} />}
                        </span>
                      </span>
                    </button>
                  )}
                  footer={
                    ready && (
                      <div className="booking-next">
                        <span>
                          {service.name}
                          <strong>{money(fullPrice(service), state.organisation)}</strong>
                        </span>
                        <Button
                          onClick={() => {
                            setStep(2)
                          }}
                        >
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
                <fieldset className="time-fieldset">
                  <legend>Your professional</legend>
                  <div className="professional-choices">
                    {professionals.length > 1 && (
                      <button
                        aria-pressed={anyone}
                        className={anyone ? 'selected' : ''}
                        onClick={() => {
                          setStaffId('any')
                          setStart(null)
                        }}
                      >
                        <span className="anyone-mark" aria-hidden="true">
                          <Users size={18} />
                        </span>
                        <span>
                          <strong>Anyone available</strong>
                          <small>The most times to choose from</small>
                        </span>
                        {anyone && <Check size={16} />}
                      </button>
                    )}
                    {professionals.map((person) => (
                      <button
                        key={person.id}
                        aria-pressed={!anyone && staff.id === person.id}
                        className={!anyone && staff.id === person.id ? 'selected' : ''}
                        onClick={() => {
                          setStaffId(person.id)
                          setStart(null)
                        }}
                      >
                        <Avatar identity={person.id} name={person.name} tone={person.tone} />
                        <span>
                          <strong>{person.name}</strong>
                          <small>{person.role}</small>
                        </span>
                        {!anyone && staff.id === person.id && <Check size={16} />}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <DateStrip
                  label="Choose a day"
                  locale={state.organisation.locale}
                  days={fortnight}
                  value={date}
                  onChange={(next) => {
                    setDate(next)
                    setStart(null)
                  }}
                />
                <label className="date-strip-other">
                  Or pick another date
                  <input
                    type="date"
                    value={date}
                    min={DEMO_DATE}
                    max="2027-10-06"
                    onChange={(e) => {
                      if (!e.target.value) return
                      setDate(e.target.value)
                      setStart(null)
                    }}
                  />
                </label>
                {times.length ? (
                  <TimeChoices
                    label={`Times on ${dateLabel(date, state.organisation.locale)} · ${state.organisation.timeZone}`}
                    times={times.map((value) => ({
                      value,
                      label: timeLabel(value, state.organisation.locale),
                    }))}
                    value={start}
                    onChange={setStart}
                    tabs
                  />
                ) : (
                  <div className="next-available">
                    <p>
                      {anyone
                        ? 'Nobody has times left on this day.'
                        : `${staff.name.split(' ')[0]} has no times left on this day.`}
                    </p>
                    {nextOpen && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setDate(nextOpen.date)
                          setStart(nextOpen.time)
                        }}
                      >
                        Next available: {dateLabel(nextOpen.date, state.organisation.locale)} at{' '}
                        {timeLabel(nextOpen.time, state.organisation.locale)}
                      </Button>
                    )}
                  </div>
                )}
                <div className="booking-next">
                  <Button variant="quiet" onClick={() => setStep(1)}>
                    <ArrowLeft size={16} />
                    Back
                  </Button>
                  <Button disabled={start === null} onClick={() => setStep(3)}>
                    Your details <ArrowRight size={17} />
                  </Button>
                </div>
              </>
            )}
            {step === 3 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  setStep(4)
                  setError('')
                }}
              >
                <div className="booking-contact-form">
                  <label>
                    Full name
                    <input
                      autoComplete="off"
                      required
                      minLength={2}
                      maxLength={100}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Alex Morgan"
                    />
                  </label>
                  <label>
                    Email
                    <input
                      autoComplete="off"
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="alex@example.com"
                    />
                  </label>
                  <label>
                    Phone with country code
                    <input
                      autoComplete="off"
                      required
                      type="tel"
                      pattern={String.raw`\+[0-9\s\(\)\-]{6,29}`}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={region === 'UK' ? '+44 7700 900123' : '+1 212 555 0123'}
                    />
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    I’d like occasional email news from Atelier House.
                  </label>
                  <p className="subtle">
                    Optional. Your booking doesn’t depend on marketing consent. Use fictional
                    details in this demo.
                  </p>
                </div>
                <div className="booking-next">
                  <Button type="button" variant="quiet" onClick={() => setStep(2)}>
                    <ArrowLeft size={16} />
                    Back
                  </Button>
                  <Button type="submit">
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
                    {dateLabel(date, state.organisation.locale)} at{' '}
                    {timeLabel(start!, state.organisation.locale)}
                    <br /> {service.durationMinutes} minutes with {staff.name}
                    <br /> {state.organisation.locationName}
                  </p>
                  <div className="receipt-line">
                    <span>Service total</span>
                    <strong>{money(fullPrice(service), state.organisation)}</strong>
                  </div>
                  <div className="receipt-line">
                    <span>Demo deposit today</span>
                    <strong>{money(service.depositMinor, state.organisation)}</strong>
                  </div>
                  <div className="receipt-line subtle">
                    <span>Remaining at visit</span>
                    <span>
                      {money(fullPrice(service) - service.depositMinor, state.organisation)}
                    </span>
                  </div>
                  <div className="detail-divider" />
                  <strong>{name}</strong>
                  <p>
                    {email}
                    <br /> {phone}
                  </p>
                </div>
                <div className="policy-note">
                  <ShieldCheck size={21} />
                  <span>
                    Demo cancellation policy: please give 24 hours’ notice. A live business will set
                    its own terms, tax and deposit policy.
                  </span>
                </div>
                <label className="checkbox-label">
                  <input
                    checked={policy}
                    onChange={(e) => setPolicy(e.target.checked)}
                    type="checkbox"
                  />
                  I understand this is a demo booking and no real payment is taken.
                </label>
                <ErrorMessage error={error} />
                <div className="booking-next">
                  <Button variant="quiet" onClick={() => setStep(3)}>
                    <ArrowLeft size={16} />
                    Back
                  </Button>
                  <Button disabled={!policy || saving} onClick={confirm}>
                    Confirm demo visit <Check size={17} />
                  </Button>
                </div>
              </>
            )}
          </div>
          <footer className="booking-powered">
            Considered care. Connected by <span className="mini-saleane">SALEANE</span>
          </footer>
        </>
      )}
    </BookingFrame>
  )
}
