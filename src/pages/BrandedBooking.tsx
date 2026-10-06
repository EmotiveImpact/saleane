import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Clock3, MapPin, ShieldCheck, Leaf } from 'lucide-react'
import { useStore } from '../state/context'
import { DEMO_DATE } from '../domain/model'
import { slots } from '../domain/commands'
import { addDays, dateLabel, money, timeLabel } from '../domain/format'
import { Avatar, Button, DateStrip, ErrorMessage, TimeChoices } from '../design'

export function BrandedBooking() {
  const { state, commit, region, changeRegion, saving } = useStore()
  const [step, setStep] = useState(1)
  const [category, setCategory] = useState('All')
  const [serviceId, setServiceId] = useState(state.services[0].id)
  const [staffId, setStaffId] = useState(state.staff[0].id)
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
  const staff = state.staff.find((s) => s.id === staffId)!
  const professionals = state.staff.filter((s) => s.serviceIds.includes(serviceId))
  const times = slots(state, serviceId, staffId, date)
  // Only work out the fortnight and the next opening while the guest is choosing a time.
  const fortnight =
    step === 2
      ? Array.from({ length: 14 }, (_, i) => {
          const day = addDays(DEMO_DATE, i)
          return { date: day, free: slots(state, serviceId, staffId, day).length }
        })
      : []
  const nextOpen = (() => {
    if (step !== 2 || times.length) return null
    for (let i = 1; i <= 60; i++) {
      const day = addDays(date, i)
      const open = slots(state, serviceId, staffId, day)
      if (open.length) return { date: day, time: open[0] }
    }
    return null
  })()
  const steps = ['Your treatment', 'A time for you', 'Your details', 'A final look']
  async function confirm() {
    if (start === null || !policy) {
      setError('Choose a time and acknowledge the demo booking policy.')
      return
    }
    const result = await commit({
      type: 'book',
      input: {
        serviceId,
        staffId,
        date,
        startMinutes: start,
        contact: { name, email, phone, marketingConsent: consent },
        source: 'online',
      },
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfirmedId(result.recordId)
  }
  return (
    <div className="public-booking">
      <a className="skip-link" href="#main-content">
        Skip to booking
      </a>
      <header className="booking-header">
        <Link className="public-brand" to="/booking">
          <span className="atelier-monogram">AH</span>
          <span>
            Atelier House<small>Beauty & wellbeing</small>
          </span>
        </Link>
        <div>
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
          <Link to="/today">
            Back to workspace <ArrowRight size={15} />
          </Link>
        </div>
      </header>
      <section className="booking-demo-banner" aria-label="About this booking page">
        Demo booking experience. Use fictional details. No real reservation or payment is made.
      </section>
      <div className="public-booking-layout">
        <aside className="booking-story">
          <img
            className="booking-story-image"
            src="/images/saleane-studio-warm.png"
            alt="Sunlit treatment room with linen, natural stone and olive branches"
          />
          <div className="booking-story-copy">
            <Leaf size={28} />
            <h1>
              Care,
              <br /> considered.
            </h1>
            <p>
              A little time, just for you.
              <br /> Thoughtful treatments. Familiar faces.
              <br /> A place to feel yourself again.
            </p>
            <div className="story-location">
              <MapPin size={17} />
              <span>{state.organisation.locationName}</span>
            </div>
          </div>
          <div className="story-footer">
            <span>Atelier House</span>
            <span>Make yourself at home.</span>
          </div>
        </aside>
        <main className="booking-main" tabIndex={-1} data-focus-fallback id="main-content">
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
                  Service total<strong>{money(service.priceMinor, state.organisation)}</strong>
                </span>
                <span>
                  Demo deposit<strong>{money(service.depositMinor, state.organisation)}</strong>
                </span>
              </div>
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
                    <div
                      className="segment-tabs booking-categories"
                      aria-label="Treatment category"
                    >
                      {['All', 'Skin', 'Body', 'Hair'].map((value) => (
                        <button
                          className={category === value ? 'active' : ''}
                          aria-pressed={category === value}
                          onClick={() => setCategory(value)}
                          key={value}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                    <div className="service-choices">
                      {state.services
                        .filter((s) => category === 'All' || s.category === category)
                        .map((s) => (
                          <button
                            key={s.id}
                            aria-pressed={serviceId === s.id}
                            className={`service-choice ${serviceId === s.id ? 'selected' : ''}`}
                            onClick={() => {
                              setServiceId(s.id)
                              setStaffId(
                                state.staff.find((person) => person.serviceIds.includes(s.id))!.id,
                              )
                              setStart(null)
                            }}
                          >
                            <div>
                              <span className="service-category">{s.category}</span>
                              <h3>{s.name}</h3>
                              <p>{s.description}</p>
                              <span className="service-time">
                                <Clock3 size={14} />
                                {s.durationMinutes} minutes
                              </span>
                            </div>
                            <span>
                              <strong>{money(s.priceMinor, state.organisation)}</strong>
                              <span className="selection-circle">
                                {serviceId === s.id && <Check size={14} />}
                              </span>
                            </span>
                          </button>
                        ))}
                    </div>
                    <div className="booking-next">
                      <span>
                        {service.name}
                        <strong>{money(service.priceMinor, state.organisation)}</strong>
                      </span>
                      <Button
                        onClick={() => {
                          setStep(2)
                          setCategory('All')
                        }}
                      >
                        Choose a time <ArrowRight size={17} />
                      </Button>
                    </div>
                  </>
                )}
                {step === 2 && (
                  <>
                    <fieldset className="time-fieldset">
                      <legend>Your professional</legend>
                      <div className="professional-choices">
                        {professionals.map((person) => (
                          <button
                            key={person.id}
                            aria-pressed={staffId === person.id}
                            className={staffId === person.id ? 'selected' : ''}
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
                            {staffId === person.id && <Check size={16} />}
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
                      />
                    ) : (
                      <div className="next-available">
                        <p>{staff.name.split(' ')[0]} has no times left on this day.</p>
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
                        <strong>{money(service.priceMinor, state.organisation)}</strong>
                      </div>
                      <div className="receipt-line">
                        <span>Demo deposit today</span>
                        <strong>{money(service.depositMinor, state.organisation)}</strong>
                      </div>
                      <div className="receipt-line subtle">
                        <span>Remaining at visit</span>
                        <span>
                          {money(service.priceMinor - service.depositMinor, state.organisation)}
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
                        Demo cancellation policy: please give 24 hours’ notice. A live business will
                        set its own terms, tax and deposit policy.
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
        </main>
      </div>
    </div>
  )
}
