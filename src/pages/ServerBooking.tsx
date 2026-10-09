import { useEffect, useRef, useState } from 'react'
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
import { listPrice, offeredAt, serviceAt } from '../domain/locations'
import type { LocationOption } from '../components/LocationChoice'
import { ReceptionistChat } from '../components/ReceptionistChat'
import { visitUid } from '../domain/calendarFile'
import { bookingChannel } from '../domain/bookingChannel'
import { fullPriceMinor } from '../domain/priceSentence'
import type { PriceTax } from '../domain/priceSentence'
import { useGuestColours } from '../state/studioColours'
import type { StudioLook } from '../domain/brandRulesSchema'
import { guestPhone, phoneProblem } from '../domain/phone'
import { GUEST_CANCEL_CUTOFF_HOURS } from '../domain/guest'
import type { GuestPayment as GuestPaymentView } from '../domain/guest'
import {
  BOOKING_DAYS,
  STRIP_DAYS,
  cancellationTerms,
  civilTime,
  whenLabel,
} from '../domain/bookingTerms'
import { DayStrip } from '../components/DayStrip'
import type { DayStripDay } from '../components/DayStrip'
import { instantIn } from '../domain/operations'
import { useClock } from '../state/clock'
import { startGuestPayment } from '../state/guestPay'
import '../guest.css'

const pendingBookingSchema = z.object({
  payload: z.object({
    hold: z.string().min(32).max(100),
    contact: contactSchema,
    policy: z.literal(true),
    emailNewsVersion: z.number().int().min(1).optional(),
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
/** What a hold answers: its token, when it runs out and, from newer servers, who it is with. */
type HoldReply = { hold: string; expiresAt: string; staffId?: string }
/** A free time on some day, such as the first available one. */
type FreeTime = { date: string; startMinutes: number }
/** Whole seconds until a hold runs out, never below zero. */
function secondsLeft(expiresAt: string) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000))
}
/** Whole days from one date to another, both written yyyy-mm-dd. */
function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000)
}
/** The time zone the guest's own device is set to, when it says. */
function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return ''
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
  /** V1.5: the studio's current words for email news, by version. */
  emailNews?: { version: number; text: string }
  botCheck?: { siteKey: string } | null
  tax?: PriceTax
  /** V2: open locations, main first. Older servers send none. */
  locations?: LocationOption[]
  /** V4: the AI receptionist chat is switched on for this page. */
  receptionist?: boolean
  /** V5: the studio's colours. Older servers send none, and the house colours show. */
  look?: StudioLook
  /** PILOT-02: a sample studio simulates deposits; a real one takes them by card after booking. */
  depositPolicy?: 'simulated' | 'card'
  /** PILOT-02: card payments in a real studio; in test mode no money moves. Null for a sample. */
  cardPayments?: { testMode: boolean } | null
  /** PILOT-01: emails really go out. Absent or false: nothing is emailed. */
  emailsLive?: boolean
  /** LOCAL-02: the cancellation rule, and any late cancellation charge (PILOT-02). */
  cancellation?: { cutoffHours: number; feePercent: number }
}
export function ServerBooking() {
  const { slug } = useParams(),
    base = `/api/public/${encodeURIComponent(slug ?? '')}`
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  useGuestColours(catalog?.look)
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
/** The time in a booking link, when it names a treatment, person, date and start this page offers. */
function linkedTime(
  search: string,
  services: Catalog['services'],
  staff: Catalog['staff'],
  today: string,
) {
  const q = new URLSearchParams(search)
  const service = services.find((s) => s.id === q.get('service'))
  const staffId = q.get('staff') ?? 'any'
  const date = q.get('date') ?? ''
  const start = Number(q.get('start'))
  if (!service || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) return null
  if (
    staffId !== 'any' &&
    !staff.some((p) => p.id === staffId && p.serviceIds.includes(service.id))
  )
    return null
  if (!Number.isInteger(start) || start < 0 || start >= 24 * 60) return null
  return { serviceId: service.id, staffId, date, start }
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
  const { organisation: org, services, staff, today, sample, botCheck, tax, receptionist } = catalog
  const { cardPayments, emailsLive } = catalog
  const locations = catalog.locations ?? []
  const clock = useClock(30_000)
  const store = useStore(),
    navigate = useNavigate()
  const journalKey = `saleane.guest-confirmation:${base}`
  const [recovery] = useState(() => readPendingBooking(journalKey))
  // V4: a link from the AI receptionist opens step 2 with the offered time already chosen.
  const [linked] = useState(() =>
    recovery.value ? null : linkedTime(window.location.search, services, staff, today),
  )
  const [attempt, setAttempt] = useState<PendingBooking | null>(recovery.value)
  const [picked, setPicked] = useState(!!linked)
  // With one kind of treatment the list opens straight away, chosen as before;
  // otherwise nothing is chosen until the guest picks.
  const ready = picked || new Set(services.map((s) => s.category)).size < 2
  const [step, setStep] = useState(recovery.value ? 4 : linked ? 2 : 1),
    [serviceId, setServiceId] = useState(
      recovery.value?.serviceId ?? linked?.serviceId ?? services[0]?.id ?? '',
    ),
    [staffId, setStaffId] = useState(recovery.value?.staffId ?? linked?.staffId ?? 'any'),
    [chosenDate, setDate] = useState(recovery.value?.date ?? linked?.date ?? addDays(today, 1)),
    [chosenLocation, setLocationId] = useState(
      recovery.value?.locationId ??
        // V2: a location's own booking link opens with it chosen.
        locations.find((l) => l.id === new URLSearchParams(window.location.search).get('location'))
          ?.id ??
        locations[0]?.id ??
        '',
    )
  const [hold, setHold] = useState<HoldReply | null>(
      recovery.value
        ? { hold: recovery.value.payload.hold, expiresAt: recovery.value.expiresAt }
        : null,
    ),
    [seconds, setSeconds] = useState(() =>
      recovery.value ? secondsLeft(recovery.value.expiresAt) : 0,
    )
  // The studio's today: the server's, moved on by each midnight that passes in the studio while
  // the page stays open. A sample studio keeps its own fixed day.
  const [openedAt] = useState(clock)
  const studioToday = sample
    ? today
    : addDays(
        today,
        Math.max(
          0,
          daysBetween(
            civilTime(Date.parse(openedAt), org.timeZone).date,
            civilTime(Date.parse(clock), org.timeZone).date,
          ),
        ),
      )
  // No day before the studio's today is ever chosen or suggested. A held or submitted time keeps
  // its own date.
  const date = hold || attempt || chosenDate >= studioToday ? chosenDate : studioToday
  // Only places where someone does the chosen treatment are offered.
  /** A treatment's list price, from the locations where a guest can book it (V2). */
  const shown = (s: Catalog['services'][number]) =>
    listPrice(
      s,
      locations
        .filter(
          (l) =>
            offeredAt(s, l.id) &&
            staff.some(
              (p) =>
                p.serviceIds.includes(s.id) && (!p.locationIds || p.locationIds.includes(l.id)),
            ),
        )
        .map((l) => l.id),
    )
  const chosenService = services.find((s) => s.id === serviceId)
  const offered = locations.filter(
    (l) =>
      (!chosenService || offeredAt(chosenService, l.id)) &&
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
    [start, setStart] = useState<number | null>(recovery.value?.start ?? linked?.start ?? null)
  const queryKey = [serviceId, staffId, date, base, step, locationId].join('|'),
    loadingTimes = availability.key !== queryKey,
    times = loadingTimes ? [] : availability.times
  /** The search for times: what is booked, with whom and where. Day counts are kept by it. */
  const searchKey = [base, serviceId, staffId, located.locationId ?? ''].join('|')
  // The day strip runs from the studio's today, a fortnight at a time: as many fortnights as the
  // guest asked for, and enough to show the chosen day.
  const [fortnights, setFortnights] = useState(1)
  const stripLength = Math.min(
    BOOKING_DAYS,
    Math.max(fortnights, Math.floor(daysBetween(studioToday, date) / STRIP_DAYS) + 1) * STRIP_DAYS,
  )
  const runStarts = Array.from({ length: Math.ceil(stripLength / STRIP_DAYS) }, (_, i) =>
    addDays(studioToday, i * STRIP_DAYS),
  )
  const [dayCounts, setDayCounts] = useState<Record<string, { closed: boolean; free: number }>>({})
  const daysAsked = useRef(new Set<string>()),
    stepWas = useRef(0)
  const stripDays: DayStripDay[] = Array.from({ length: stripLength }, (_, i) => {
    const day = addDays(studioToday, i),
      known = dayCounts[`${searchKey}|${day}`]
    return known ? { date: day, ...known } : { date: day }
  })
  const dayClosed = !!dayCounts[`${searchKey}|${date}`]?.closed
  const [finding, setFinding] = useState(false),
    [nothingAhead, setNothingAhead] = useState('')
  // The next free time after a day with none, looked up for that day.
  const emptyDay = step === 2 && !loadingTimes && !times.length,
    nextKey = `${searchKey}|${date}`
  const [nextFree, setNextFree] = useState<{ key: string; next: FreeTime | null }>({
    key: '',
    next: null,
  })
  // When a hold runs out and its time has gone meanwhile: the nearest free times instead.
  const [holdGone, setHoldGone] = useState<{
    date: string
    start: number
    near: number[]
    next: FreeTime | null
  } | null>(null)
  const [botToken, setBotToken] = useState(''),
    [botAttempt, setBotAttempt] = useState(0)
  const [name, setName] = useState(recovery.value?.payload.contact.name ?? ''),
    [email, setEmail] = useState(recovery.value?.payload.contact.email ?? ''),
    [phone, setPhone] = useState(recovery.value?.payload.contact.phone ?? ''),
    [phoneMessage, setPhoneProblem] = useState(''),
    [consent, setConsent] = useState(recovery.value?.payload.contact.marketingConsent ?? false),
    [policy, setPolicy] = useState(!!recovery.value),
    [error, setError] = useState(''),
    [confirmed, setConfirmed] = useState(''),
    [manageUrl, setManageUrl] = useState(''),
    [payment, setPayment] = useState<GuestPaymentView | null>(null),
    [paying, setPaying] = useState(false),
    [payError, setPayError] = useState('')
  const phoneField = useRef<HTMLInputElement>(null)
  // A held time says who it is with, even when the guest had no preference.
  const service = services.find((s) => s.id === serviceId),
    professional = staff.find((s) => s.id === (hold?.staffId ?? staffId))
  // What the visit costs where it will be, and the deposit asked for when it is booked.
  const priceMinor = service ? fullPriceMinor(serviceAt(service, place?.id), tax) : 0
  const depositMinor = service ? Math.min(service.depositMinor, priceMinor) : 0
  // A sample studio lives on its own fixed day, so its clock reads the time of day on that day.
  const nowAt = (() => {
    const real = Date.parse(clock)
    if (!sample) return real
    try {
      return Date.parse(instantIn(org.timeZone, today, civilTime(real, org.timeZone).minutes))
    } catch {
      return real
    }
  })()
  const terms =
    start === null
      ? null
      : cancellationTerms({
          date,
          startMinutes: start,
          timeZone: org.timeZone,
          locale: org.locale,
          depositMinor,
          cutoffHours: catalog.cancellation?.cutoffHours ?? GUEST_CANCEL_CUTOFF_HOURS,
          feePercent: catalog.cancellation?.feePercent ?? 0,
          now: nowAt,
        })
  const depositWords = !depositMinor
    ? 'No deposit. You pay at the studio.'
    : sample
      ? `${money(depositMinor, org)} simulated deposit when you book. Nothing is charged in this sample studio.`
      : `${money(depositMinor, org)} deposit, which you can pay by card as soon as you confirm. It comes off your bill on the day.${cardPayments?.testMode ? ' Card payments are in test mode, so no money moves.' : ''}`
  // The private link's token, which opens the guest's own visit page and its payment.
  const manageToken = manageUrl.split('#')[1] ?? ''
  async function payDeposit() {
    setPaying(true)
    setPayError('')
    try {
      await startGuestPayment(manageToken, 'deposit')
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'The payment page could not be opened.')
      setPaying(false)
    }
  }
  // Each step starts at the top, so a guest on a phone isn't left at the foot of the last one.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
  }, [step, confirmed])
  /** The search for times as a query, with anything more it needs. */
  const searchFor = (more: Record<string, string>) =>
    new URLSearchParams({
      serviceId,
      staffId,
      ...(located.locationId ? { locationId: located.locationId } : {}),
      ...more,
    })
  useEffect(() => {
    if (!serviceId || step !== 2) return
    let active = true
    const counted = `${searchKey}|${date}`
    api<{ times: number[] }>(`${base}/availability?${searchFor({ date })}`)
      .then((r) => {
        if (!active) return
        setAvailability({ key: queryKey, times: r.times })
        // The chosen day's count follows its times, so the strip and the list agree.
        setDayCounts((known) => ({
          ...known,
          [counted]: { closed: known[counted]?.closed ?? false, free: r.times.length },
        }))
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
  // How many times each day in the strip has, a fortnight per question, asked afresh each time
  // the guest comes to this step.
  useEffect(() => {
    if (step === 2 && stepWas.current !== 2) daysAsked.current.clear()
    stepWas.current = step
    if (!serviceId || step !== 2) return
    for (const from of runStarts) {
      const asked = `${searchKey}|${from}`
      if (daysAsked.current.has(asked)) continue
      daysAsked.current.add(asked)
      api<{ days: { date: string; closed: boolean; times: number }[] }>(
        `${base}/days?${searchFor({ from })}`,
      )
        .then(({ days }) =>
          setDayCounts((known) => ({
            ...known,
            ...Object.fromEntries(
              days.map((day) => [
                `${searchKey}|${day.date}`,
                { closed: day.closed, free: day.times },
              ]),
            ),
          })),
        )
        // The counts only help a guest choose; the chosen day's own times stay the authority.
        .catch(() => daysAsked.current.delete(asked))
    }
    // `searchFor` and `runStarts` follow the search key and the strip's first days.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, serviceId, searchKey, runStarts.join()])
  // A day with no free times points to the next one, which is never before the studio's today.
  useEffect(() => {
    if (!emptyDay) return
    let active = true
    api<{ next: FreeTime | null }>(`${base}/next?${searchFor({ from: addDays(date, 1) })}`)
      .then(({ next }) => {
        if (active) setNextFree({ key: nextKey, next })
      })
      .catch(() => {
        if (active) setNextFree({ key: nextKey, next: null })
      })
    return () => {
      active = false
    }
    // `searchFor` and `date` are part of the next key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emptyDay, nextKey])
  useEffect(() => {
    if (!hold) return
    const update = () => setSeconds(secondsLeft(hold.expiresAt))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [hold])
  /** Moves to a free time on another day, such as the first available one. */
  function goTo(free: FreeTime) {
    setDate(free.date)
    setStart(free.startMinutes)
    setError('')
  }
  async function firstAvailable() {
    setFinding(true)
    setError('')
    setNothingAhead('')
    try {
      const { next } = await api<{ next: FreeTime | null }>(
        `${base}/next?${searchFor({ from: studioToday })}`,
      )
      if (next) goTo(next)
      else setNothingAhead(searchKey)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The first free time could not be found.')
    } finally {
      setFinding(false)
    }
  }
  /** Keeps a new hold and starts its countdown at once, so it never shows as run out. */
  function keepHold(reply: HoldReply) {
    setHold(reply)
    setSeconds(secondsLeft(reply.expiresAt))
    setHoldGone(null)
  }
  function holdBody(at: number, on: string) {
    return {
      serviceId,
      staffId,
      date: on,
      startMinutes: at,
      ...located,
      // Hand back any earlier hold so this guest never holds two times at once.
      ...(hold ? { replaces: hold.hold } : {}),
      ...(botCheck ? { botCheck: botToken } : {}),
    }
  }
  async function reserve() {
    if (start === null) return
    setPending(true)
    setError('')
    try {
      keepHold(
        await api<HoldReply>(`${base}/holds`, { method: 'POST', body: holdBody(start, date) }),
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
  /**
   * After a hold runs out: one tap holds the same time again, keeping the guest's details. When
   * the time has gone meanwhile, the guest is told and offered the nearest free times instead.
   */
  async function holdAgain(at: number, on = date) {
    if (!hold || attempt) return
    setPending(true)
    setError('')
    try {
      keepHold(await api<HoldReply>(`${base}/holds`, { method: 'POST', body: holdBody(at, on) }))
      if (at !== start || on !== date) {
        setDate(on)
        setStart(at)
        // A different time has its own cancellation cutoff, so the guest reads the terms again.
        setPolicy(false)
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        let near: number[] = [],
          next: FreeTime | null = null
        try {
          const { times: free } = await api<{ times: number[] }>(
            `${base}/availability?${searchFor({ date: on })}`,
          )
          near = [...free]
            .sort((a, b) => Math.abs(a - at) - Math.abs(b - at) || a - b)
            .slice(0, 4)
            .sort((a, b) => a - b)
          if (!near.length)
            next = (
              await api<{ next: FreeTime | null }>(
                `${base}/next?${searchFor({ from: addDays(on, 1) })}`,
              )
            ).next
        } catch {
          /* The guest can still choose another time. */
        }
        setHoldGone({ date: on, start: at, near, next })
      } else setError(e instanceof Error ? e.message : 'This time could not be held again.')
    } finally {
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
      setHoldGone(null)
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
        ...(consent && catalog.emailNews ? { emailNewsVersion: catalog.emailNews.version } : {}),
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
      const result = await api<{
        appointmentId: string
        manage?: { url: string }
        payment?: GuestPaymentView
      }>(`${base}/book`, {
        method: 'POST',
        // Where the guest came from, when they followed one of the studio's shared links.
        body: { ...submitted.payload, from: bookingChannel(urlChannel()) },
      })
      setManageUrl(result.manage?.url ?? '')
      setPayment(result.payment ?? null)
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
        // The studio changed its words for email news: the guest reads them again and re-ticks.
        if (/email news/.test(e.message)) {
          setConsent(false)
          setStep(3)
        }
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
  // Times are the studio's own; a guest whose device is set elsewhere is told so.
  const zone = deviceZone()
  // After a hold runs out, beside the step's own buttons: hold the same time again in one tap.
  // A held time from an earlier day is never offered again: the guest chooses a new one.
  const heldPassed = date < studioToday
  const canHold = !pending && (!botCheck || !!botToken)
  const holdPanel =
    step >= 3 && hold && !attempt && !seconds && start !== null ? (
      <section className="booking-hold-again" aria-labelledby="booking-hold-again-heading">
        <h3 id="booking-hold-again-heading">
          {heldPassed
            ? 'That time has passed'
            : holdGone
              ? 'That time has just gone'
              : 'Your hold has ended'}
        </h3>
        <p role="status">
          {heldPassed
            ? 'Choose another time to carry on; your details are kept.'
            : !holdGone
              ? `We kept ${whenLabel(date, start, org.locale)} for you for five minutes. Hold it again to carry on; your details are kept.`
              : `${whenLabel(holdGone.date, holdGone.start, org.locale)} is no longer free. ${
                  holdGone.near.length
                    ? 'These are the nearest free times that day. Choose one to hold it, and your details are kept.'
                    : holdGone.next
                      ? 'Nothing else is free that day. This is the next free time.'
                      : 'Nothing else is free soon with this choice. Choose another time to look further ahead.'
                }`}
        </p>
        {botCheck && !heldPassed && (
          <BotCheck key={botAttempt} siteKey={botCheck.siteKey} onToken={setBotToken} />
        )}
        <div className="booking-hold-actions">
          {!heldPassed && !holdGone && (
            <Button disabled={!canHold} onClick={() => void holdAgain(start)}>
              Hold it again
            </Button>
          )}
          {!heldPassed &&
            holdGone?.near.map((time) => (
              <Button
                key={time}
                variant="secondary"
                disabled={!canHold}
                aria-label={`Hold ${timeLabel(time, org.locale)} instead`}
                onClick={() => void holdAgain(time, holdGone.date)}
              >
                {timeLabel(time, org.locale)}
              </Button>
            ))}
          {!heldPassed && holdGone?.next && (
            <Button
              variant="secondary"
              disabled={!canHold}
              onClick={() => void holdAgain(holdGone.next!.startMinutes, holdGone.next!.date)}
            >
              Hold {whenLabel(holdGone.next.date, holdGone.next.startMinutes, org.locale)}
            </Button>
          )}
          {step === 4 && (
            <Button variant="quiet" disabled={pending} onClick={() => void chooseAnotherTime()}>
              Choose another time
            </Button>
          )}
        </div>
      </section>
    ) : null
  return (
    <BookingFrame
      studio={org.name}
      location={where.name}
      notice={
        sample
          ? 'Fictional sample studio. Reservations and deposits are simulated.'
          : [
              cardPayments?.testMode && 'Card payments are in test mode, so no money moves.',
              !emailsLive && 'Emails are not sent yet.',
            ]
              .filter(Boolean)
              .join(' ')
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
          {payment && payment.depositDueMinor > 0 && !payment.pending && manageToken && (
            <section className="booking-pay-now" aria-labelledby="booking-pay-now-heading">
              <h3 id="booking-pay-now-heading">Secure your visit</h3>
              <p>
                {org.name} asks for a {money(payment.depositDueMinor, org, true)} deposit. It comes
                off your bill on the day. You can also pay it later from your visit page.
              </p>
              {payment.testMode && (
                <p className="booking-test-note">
                  Test mode: the payment page is a test page. No card is asked for and no money
                  moves.
                </p>
              )}
              <Button disabled={paying} onClick={() => void payDeposit()}>
                {paying
                  ? 'Opening the payment page…'
                  : `Pay your ${money(payment.depositDueMinor, org, true)} deposit now`}
              </Button>
              <ErrorMessage error={payError} />
            </section>
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
              ? 'This is a fictional sample visit, and its deposit is simulated. Nothing is emailed.'
              : emailsLive
                ? 'Keep your private link to view or cancel this visit.'
                : 'Nothing has been emailed, so keep this page or your private link.'}
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
            {step >= 3 && hold && attempt && (
              <p className="subtle" role="status">
                Confirmation needs checking. Your submitted details are protected; check this
                booking before choosing another time.
              </p>
            )}
            {step >= 3 && hold && !attempt && seconds > 0 && (
              <p className="subtle">
                This time is held for {Math.floor(seconds / 60)}:
                {String(seconds % 60).padStart(2, '0')}.
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
                            service={{ ...s, priceMinor: shown(s).priceMinor }}
                            organisation={org}
                            tax={tax}
                            simulated={sample}
                          />
                        </span>
                        <strong>
                          {shown(s).from ? 'From ' : ''}
                          {money(fullPriceMinor({ priceMinor: shown(s).priceMinor }, tax), org)}
                        </strong>
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
                  <DayStrip
                    days={stripDays}
                    value={date}
                    today={studioToday}
                    locale={org.locale}
                    label="Choose a day"
                    onChange={(day) => {
                      setDate(day)
                      setStart(null)
                      setError('')
                    }}
                    onMore={
                      stripLength < BOOKING_DAYS
                        ? () => setFortnights(runStarts.length + 1)
                        : undefined
                    }
                    action={
                      <Button
                        variant="secondary"
                        className="booking-first-free"
                        disabled={finding}
                        onClick={() => void firstAvailable()}
                      >
                        {finding ? 'Looking…' : 'First available'}
                      </Button>
                    }
                  />
                  {nothingAhead === searchKey && (
                    <p role="status" className="booking-day-note">
                      Nothing is free in the next three months with this choice. Try another
                      professional{offered.length > 1 ? ' or location' : ''}.
                    </p>
                  )}
                  {loadingTimes ? (
                    <p role="status" className="booking-day-note">
                      Finding available times…
                    </p>
                  ) : times.length ? (
                    <TimeChoices
                      label={`Times on ${dateLabel(date, org.locale)}`}
                      times={times.map((value) => ({
                        value,
                        label: timeLabel(value, org.locale),
                      }))}
                      value={start}
                      onChange={setStart}
                    />
                  ) : (
                    <div className="booking-day-empty" role="status">
                      <p>
                        {dayClosed
                          ? `The studio is closed on ${dateLabel(date, org.locale)}.`
                          : `Nothing is free on ${dateLabel(date, org.locale)}.`}{' '}
                        {nextFree.key !== nextKey
                          ? 'Looking for the next free time…'
                          : nextFree.next
                            ? 'The next free time is:'
                            : 'Nothing is free in the next three months with this choice.'}
                      </p>
                      {nextFree.key === nextKey && nextFree.next && (
                        <Button variant="secondary" onClick={() => goTo(nextFree.next!)}>
                          {whenLabel(nextFree.next.date, nextFree.next.startMinutes, org.locale)}
                        </Button>
                      )}
                    </div>
                  )}
                  {!loadingTimes && start !== null && !times.includes(start) && (
                    <p role="status" className="subtle">
                      {timeLabel(start, org.locale)} is no longer free. Choose another time.
                    </p>
                  )}
                  {zone && zone !== org.timeZone && (
                    <p className="booking-day-note">
                      Times are {org.timeZone.split('/').pop()!.replace(/_/g, ' ')} time, where the
                      studio is.
                    </p>
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
                    // Kept as an international number, so the review shows how the studio sees it.
                    const number = guestPhone(org.region, phone)
                    if (!number) {
                      setPhoneProblem(phoneProblem(org.region))
                      phoneField.current?.focus()
                      return
                    }
                    setPhone(number)
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
                    <div className="booking-field">
                      <label>
                        Phone number
                        <input
                          ref={phoneField}
                          autoComplete="tel"
                          type="tel"
                          inputMode="tel"
                          required
                          maxLength={30}
                          value={phone}
                          aria-invalid={!!phoneMessage}
                          aria-describedby="booking-phone-help"
                          onChange={(e) => {
                            setPhone(e.target.value)
                            setPhoneProblem('')
                          }}
                          placeholder={org.region === 'US' ? '(212) 555-0123' : '07700 900123'}
                        />
                      </label>
                      <small
                        id="booking-phone-help"
                        className={phoneMessage ? 'booking-field-problem' : undefined}
                        role={phoneMessage ? 'alert' : undefined}
                      >
                        {phoneMessage ||
                          (org.region === 'US'
                            ? 'A US number, or any number with its country code.'
                            : 'A UK number, or any number with its country code.')}
                      </small>
                    </div>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      {catalog.emailNews?.text ??
                        `I’d like occasional email news from ${org.name}.`}
                    </label>
                    <p className="subtle">
                      Optional. Booking does not depend on marketing consent. Use fictional contact
                      details while this local candidate is under review.
                    </p>
                  </div>
                  {holdPanel}
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
                      <span>Treatment price</span>
                      <strong>{money(priceMinor, org)}</strong>
                    </div>
                    {depositMinor > 0 && (
                      <>
                        <div className="receipt-line">
                          <span>{sample ? 'Simulated deposit' : 'Deposit'}</span>
                          <strong>{money(depositMinor, org)}</strong>
                        </div>
                        <div className="receipt-line">
                          <span>Left to pay at the studio</span>
                          <strong>{money(priceMinor - depositMinor, org)}</strong>
                        </div>
                      </>
                    )}
                    <p>
                      {name}
                      <br />
                      {email}
                      <br />
                      {phone}
                    </p>
                  </div>
                  <section className="booking-terms" aria-labelledby="booking-terms-heading">
                    <h3 id="booking-terms-heading">Deposit and cancellation</h3>
                    <p>{depositWords}</p>
                    {terms && <p>{terms.rule}</p>}
                  </section>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={policy}
                      disabled={!!attempt}
                      onChange={(e) => setPolicy(e.target.checked)}
                    />
                    {sample
                      ? 'I understand this is a sample studio: nothing is charged or sent.'
                      : 'I agree to the deposit and cancellation terms.'}
                  </label>
                  {holdPanel}
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
                </>
              )}
            </fieldset>
            <ErrorMessage error={error} />
            {receptionist && step <= 2 && !attempt && !hold && (
              <ReceptionistChat
                base={base}
                studio={org.name}
                onTime={(offered) => {
                  // The guest finishes booking through the ordinary steps: hold, details, confirm.
                  setPicked(true)
                  setServiceId(offered.serviceId)
                  setStaffId(offered.staffId)
                  setDate(offered.date)
                  setStart(offered.startMinutes)
                  setError('')
                  setStep(2)
                }}
              />
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
