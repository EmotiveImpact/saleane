import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Clock3, ShieldCheck, Users } from 'lucide-react'
import { useStore } from '../state/context'
import { DEMO_DATE } from '../domain/model'
import { slots } from '../domain/commands'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import {
  Avatar,
  Button,
  DateField,
  DateStrip,
  ErrorMessage,
  TimeChoices,
  useStepArrival,
  Select,
  Checkbox,
} from '../design'
import { operations } from '../domain/operations'
import { BookingFrame } from '../components/BookingFrame'
import { TreatmentPicker } from '../components/TreatmentPicker'
import { PriceSentence } from '../components/PriceSentence'
import { BeforeYouArrive } from '../components/BeforeYouArrive'
import { AddToCalendar } from '../components/AddToCalendar'
import { visitUid } from '../domain/calendarFile'
import { guestPhone, phoneProblem } from '../domain/phone'
import { bookingChannel } from '../domain/bookingChannel'
import { fullPriceMinor } from '../domain/priceSentence'
import { listPrice, offeredAt, places, serviceAt, staffPlaces } from '../domain/locations'
import { LocationChoice } from '../components/LocationChoice'
import { patchTestBooking, patchTestFirst, patchTestSettings } from '../domain/patchTests'
import { PatchTestFirst } from '../components/PatchTestFirst'
import { currentWording } from '../domain/consent'

export function BrandedBooking() {
  const { state, commit, region, changeRegion, saving } = useStore()
  const [step, setStep] = useState(1)
  // Stage 3: a link naming a treatment, such as the studio's patch test, opens with it chosen.
  const [linkedService] = useState(
    () =>
      state.services.find(
        (s) => !s.archived && s.id === new URLSearchParams(window.location.search).get('service'),
      )?.id,
  )
  const [picked, setPicked] = useState(!!linkedService)
  // With one kind of treatment the list opens straight away, chosen as before;
  // otherwise nothing is chosen until the guest picks.
  const ready = picked || new Set(state.services.map((s) => s.category)).size < 2
  const [serviceId, setServiceId] = useState(linkedService ?? state.services[0].id)
  // 'any' lets the guest take the first professional free at the time they choose.
  const [staffId, setStaffId] = useState('any')
  const [date, setDate] = useState(addDays(DEMO_DATE, 1))
  const [start, setStart] = useState<number | null>(null)
  // V2: where the visit is, when the studio has more than one location.
  const locations = places(state)
  const [locationId, setLocationId] = useState(
    // V2: a location's own booking link opens with it chosen.
    locations.find((l) => l.id === new URLSearchParams(window.location.search).get('location'))
      ?.id ?? locations[0].id,
  )
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [policy, setPolicy] = useState(false)
  const [error, setError] = useState('')
  const [confirmedId, setConfirmedId] = useState('')
  const service = state.services.find((s) => s.id === serviceId)!
  const qualified = state.staff.filter((s) => s.serviceIds.includes(serviceId))
  // With several locations, offer only places where someone does this treatment, and only the
  // people who work at the chosen one.
  const offered =
    locations.length < 2
      ? locations
      : locations.filter(
          (l) =>
            offeredAt(service, l.id) &&
            qualified.some((p) => staffPlaces(state, p.id).includes(l.id)),
        )
  const where = offered.find((l) => l.id === locationId) ?? offered[0] ?? locations[0]
  const professionals =
    locations.length < 2
      ? qualified
      : qualified.filter((p) => staffPlaces(state, p.id).includes(where.id))
  const anyone = staffId === 'any' && professionals.length > 1
  const pool = anyone
    ? professionals
    : professionals
        .filter((p) => p.id === staffId)
        .concat(professionals)
        .slice(0, 1)
  /** Every time someone in the pool is free on a day, earliest first. */
  const freeTimes = (day: string) =>
    [...new Set(pool.flatMap((p) => slots(state, serviceId, p.id, day, undefined, where.id)))].sort(
      (a, b) => a - b,
    )
  const times = freeTimes(date)
  // With no preference, the visit goes to the first professional free at the chosen time.
  const staff =
    (start !== null &&
      pool.find((p) => slots(state, serviceId, p.id, date, undefined, where.id).includes(start))) ||
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
  // Each new step drifts in from the side it comes from; the first simply appears.
  const stepHolder = useStepArrival<HTMLDivElement>(step)
  // Each step starts at the top, so a guest on a phone isn't left at the foot of the last one.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
  }, [step, confirmedId])
  const tax = operations(state).tax
  const fullPrice = (s: { priceMinor: number }) => fullPriceMinor(s, tax)
  // V2: the treatment as priced where the guest is coming.
  const booked = serviceAt(service, where.id)
  /** A treatment's list price, from the locations where a guest can book it. */
  const shown = (s: (typeof state.services)[number]) =>
    listPrice(
      s,
      locations
        .filter(
          (l) =>
            offeredAt(s, l.id) &&
            state.staff.some(
              (p) =>
                !p.archived &&
                p.serviceIds.includes(s.id) &&
                staffPlaces(state, p.id).includes(l.id),
            ),
        )
        .map((l) => l.id),
    )
  async function confirm() {
    if (start === null || !policy) {
      setError('Choose a time and acknowledge the demo booking policy.')
      return
    }
    // A local number in the studio's own country works as well as one with its country code.
    const number = guestPhone(region, phone)
    if (!number) {
      setError(phoneProblem(region))
      return
    }
    const result = await commit({
      type: 'book',
      input: {
        serviceId,
        staffId: staff.id,
        date,
        startMinutes: start,
        ...(where.main ? {} : { locationId: where.id }),
        contact: { name, email, phone: number, marketingConsent: consent },
        source: 'online',
        // Where the guest came from, when they followed one of the studio's shared links.
        channel: bookingChannel(new URLSearchParams(window.location.search).get('from')),
        ...(consent ? { consentVersion: currentWording(state).version } : {}),
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
      location={where.name}
      notice="Demo booking experience. Use fictional details. No real reservation or payment is made."
      pastWelcome={step > 1 || !!confirmedId}
      team
      controls={
        <>
          <label className="sr-only" htmlFor="booking-market">
            Demo market
          </label>
          <Select
            id="booking-market"
            value={region}
            onChange={(e) => changeRegion(e.target.value as typeof region)}
          >
            <option value="UK">London · GBP</option>
            <option value="US">New York · USD</option>
          </Select>
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
              Treatment price<strong>{money(fullPrice(booked), state.organisation)}</strong>
            </span>
            <span>
              Demo deposit<strong>{money(service.depositMinor, state.organisation)}</strong>
            </span>
          </div>
          <BeforeYouArrive
            studioNote={where.arrivalNote}
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
                location: where.address || where.name,
                description: `With ${staff.name.split(' ')[0]}.`,
              }}
            />
          )}
          <p className="subtle">
            No money was taken and no email was sent. This made-up booking is saved in this browser.
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
          <div className="booking-step-content" ref={stepHolder}>
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
                    ? 'Just what we need to look after your visit.'
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
                          service={{ ...s, priceMinor: shown(s).priceMinor }}
                          organisation={state.organisation}
                          tax={tax}
                          simulated
                        />
                      </div>
                      <span>
                        <strong>
                          {shown(s).from ? 'From ' : ''}
                          {money(
                            fullPrice({ priceMinor: shown(s).priceMinor }),
                            state.organisation,
                          )}
                        </strong>
                        <span className="selection-circle">
                          {ready && serviceId === s.id && <Check size={14} />}
                        </span>
                      </span>
                    </button>
                  )}
                  footer={
                    ready &&
                    (patchTestFirst(state, serviceId) ? (
                      // Stage 3: the studio books this only with the guest, after a patch test.
                      <PatchTestFirst
                        treatment={service.name}
                        hours={patchTestSettings(state).hoursBefore}
                        studio={{
                          name: state.organisation.name,
                          phone: where.phone ?? state.organisation.phone,
                          email: where.email ?? state.organisation.email,
                          address: where.address,
                          region: state.organisation.region,
                        }}
                        test={(() => {
                          const test = patchTestBooking(state)
                          return test
                            ? {
                                href: `?service=${encodeURIComponent(test.id)}`,
                                onChoose: () => {
                                  setServiceId(test.id)
                                  setStaffId('any')
                                  setStart(null)
                                  setError('')
                                  setStep(2)
                                },
                              }
                            : undefined
                        })()}
                      />
                    ) : (
                      <div className="booking-next">
                        <span>
                          {service.name}
                          <strong>{money(fullPrice(booked), state.organisation)}</strong>
                        </span>
                        <Button
                          onClick={() => {
                            setStep(2)
                          }}
                        >
                          Choose a time <ArrowRight size={17} />
                        </Button>
                      </div>
                    ))
                  }
                />
              </>
            )}
            {step === 2 && (
              <>
                <LocationChoice
                  locations={offered}
                  value={where.id}
                  onChange={(id) => {
                    setLocationId(id)
                    setStaffId('any')
                    setStart(null)
                    setError('')
                  }}
                />
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
                  <DateField
                    value={date}
                    locale={state.organisation.locale}
                    today={DEMO_DATE}
                    min={DEMO_DATE}
                    max="2027-10-06"
                    onChange={(next) => {
                      if (!next) return
                      setDate(next)
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
                    Phone
                    <input
                      autoComplete="off"
                      required
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={region === 'UK' ? '07700 900123' : '(212) 555-0123'}
                    />
                  </label>
                  <label className="checkbox-label">
                    <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    {currentWording(state).text}
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
                    <br /> {where.name}
                    {locations.length > 1 && where.address ? `, ${where.address}` : ''}
                  </p>
                  <div className="receipt-line">
                    <span>Treatment total</span>
                    <strong>{money(fullPrice(booked), state.organisation)}</strong>
                  </div>
                  <div className="receipt-line">
                    <span>Demo deposit today</span>
                    <strong>{money(service.depositMinor, state.organisation)}</strong>
                  </div>
                  <div className="receipt-line subtle">
                    <span>Remaining at visit</span>
                    <span>
                      {money(fullPrice(booked) - service.depositMinor, state.organisation)}
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
                  <Checkbox checked={policy} onChange={(e) => setPolicy(e.target.checked)} />I
                  understand this is a demo booking and no real payment is taken.
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
