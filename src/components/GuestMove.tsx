import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CalendarClock } from 'lucide-react'
import { api, ApiError } from '../state/api'
import { GUEST_CANCEL_CUTOFF_HOURS, guestViewSchema } from '../domain/guest'
import type { GuestView } from '../domain/guest'
import { dateLabel, timeLabel } from '../domain/format'
import { instantIn } from '../domain/operations'
import { Button, ErrorMessage, SegmentedControl, TimeChoices } from '../design'
import { MoveDayStrip } from './MoveDayStrip'
import type { MoveStripDay } from './MoveDayStrip'
import { clearPendingMove, readPendingMove, savePendingMove } from '../state/guestMove'
import type { PendingMove } from '../state/guestMove'
import './guestMove.css'

/** What /api/guest/move-times answers: the days to choose from and the free times on one. */
type MoveTimes = {
  days: MoveStripDay[]
  date: string
  anyone: boolean
  times: { startMinutes: number; staffId: string; professional: string }[]
  /** Stage 3: only times a clear patch test covers are offered, under the studio's rule. */
  patchTest?: boolean
}
type Choice = Omit<PendingMove, 'requestKey'>

/** Answers that show a move did not happen under its request key. Any other may have landed. */
const SETTLED = [400, 404, 409, 422]

/**
 * The guest moves their own visit: the same treatment at the same place, to another free time
 * with the same professional or anyone qualified. They see the old and new time side by side
 * before they confirm. An answer that never arrives is kept in this tab and sent again unchanged,
 * so the visit moves at most once, and nothing else changes until it is settled.
 */
export function GuestMove({
  token,
  view,
  cutoff,
  busy,
  onMoved,
  onUnsure,
  onRefresh,
}: {
  token: string
  view: GuestView
  /** When moving online closes, in the studio's words. */
  cutoff: string
  /** Another change is under way on the page. */
  busy: boolean
  onMoved: (view: GuestView) => void
  /** True while a move may or may not have happened. */
  onUnsure: (unsure: boolean) => void
  /** Reads the visit again, after the studio's answer showed it changed. */
  onRefresh: () => void
}) {
  const { organisation: org, visit, deposit } = view
  const [pending, setPending] = useState(() => readPendingMove(visit.calendarUid))
  const [stage, setStage] = useState<'closed' | 'choosing' | 'confirming'>('closed')
  const [anyone, setAnyone] = useState(false)
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState<MoveTimes | null>(null)
  const [loading, setLoading] = useState(false)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [late, setLate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const asked = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (stage !== 'closed') heading.current?.focus()
  }, [stage])

  const when = (day: string, start: number) =>
    `${dateLabel(day, org.locale)} at ${timeLabel(start, org.locale)}`

  /**
   * Free times on a day; without one, the visit's own day or the first open day. A time already
   * chosen stays chosen while it is still free with the same person.
   */
  async function look(day: string, everyone: boolean) {
    const ticket = ++asked.current
    setLoading(true)
    try {
      const next = await api<MoveTimes>('/api/guest/move-times', {
        method: 'POST',
        body: { token, ...(day ? { date: day } : {}), anyone: everyone },
      })
      if (ticket !== asked.current) return
      setSlots(next)
      setDate(next.date)
      setChoice((chosen) =>
        chosen &&
        chosen.date === next.date &&
        next.times.some(
          (time) => time.startMinutes === chosen.startMinutes && time.staffId === chosen.staffId,
        )
          ? chosen
          : null,
      )
    } catch (e) {
      if (ticket !== asked.current) return
      setError(e instanceof Error ? e.message : 'Free times could not be loaded. Try again.')
    } finally {
      if (ticket === asked.current) setLoading(false)
    }
  }

  async function send(move: PendingMove, retry: boolean) {
    savePendingMove(visit.calendarUid, move)
    setSaving(true)
    setError('')
    try {
      const next = guestViewSchema.parse(
        await api<GuestView>('/api/guest/move', {
          method: 'POST',
          body: {
            token,
            date: move.date,
            startMinutes: move.startMinutes,
            staffId: move.staffId,
            requestKey: move.requestKey,
          },
        }),
      )
      clearPendingMove(visit.calendarUid)
      setPending(null)
      onUnsure(false)
      setStage('closed')
      setSlots(null)
      setChoice(null)
      onMoved(next)
    } catch (e) {
      // Refused before it changed anything, or never sent at all: nothing moved.
      const settled =
        e instanceof ApiError && (SETTLED.includes(e.status) || (e.status === 429 && !retry))
      if (settled) {
        clearPendingMove(visit.calendarUid)
        setPending(null)
        onUnsure(false)
        setError(e.message)
        if (e.status === 409) {
          onRefresh()
          // The time was taken meanwhile: show what is free now.
          if (!retry) {
            setChoice(null)
            setStage('choosing')
            void look(move.date, anyone)
          }
        }
      } else {
        setPending(move)
        onUnsure(true)
        setError(e instanceof Error && retry ? e.message : '')
      }
    } finally {
      setSaving(false)
    }
  }

  function open() {
    setStage('choosing')
    setChoice(null)
    setError('')
    void look('', anyone)
  }
  function review() {
    if (!choice) return
    setError('')
    // A new time inside the cutoff can't be changed online again afterwards.
    setLate(
      Date.parse(instantIn(org.timeZone, choice.date, choice.startMinutes)) -
        GUEST_CANCEL_CUTOFF_HOURS * 60 * 60000 <=
        Date.now(),
    )
    setStage('confirming')
  }

  if (pending)
    return (
      <div className="visit-plan guest-move-unsure" role="status">
        <p>
          <strong>We couldn’t confirm your move.</strong> You asked to move your visit to{' '}
          {when(pending.date, pending.startMinutes)} with {pending.professional}. Check again before
          you change anything else. Your visit moves at most once.
        </p>
        <ErrorMessage error={error} />
        <Button disabled={saving} onClick={() => void send(pending, true)}>
          {saving ? 'Checking…' : 'Check again'}
        </Button>
      </div>
    )
  if (!view.move) return null
  if (!view.move.available)
    return (
      <div className="visit-plan">
        <p>
          {view.move.reason === 'cutoff'
            ? `It is less than ${GUEST_CANCEL_CUTOFF_HOURS} hours until your visit, so it can no longer be moved online. To change it, contact the studio.`
            : view.move.reason === 'offer'
              ? 'This visit was booked at a quiet-time price for that time only, so it cannot be moved online. To change it, contact the studio.'
              : 'To move your visit, contact the studio.'}
        </p>
      </div>
    )
  if (stage === 'closed')
    return (
      <div className="visit-plan">
        <p>You can move your visit to another free time online until {cutoff}.</p>
        <ErrorMessage error={error} />
        <Button variant="secondary" disabled={busy} onClick={open}>
          <CalendarClock size={16} aria-hidden="true" />
          Move my visit
        </Button>
      </div>
    )

  const offered = slots?.date === date ? slots.times : []
  const day = slots?.days.find((d) => d.date === date)
  return (
    <section className="guest-move" aria-labelledby="move-heading">
      <h3 id="move-heading" ref={heading} tabIndex={-1}>
        {stage === 'confirming' ? 'Check your new time' : 'Choose a new time'}
      </h3>
      {stage === 'choosing' || !choice ? (
        <>
          <p className="subtle">
            {visit.serviceName} at {org.locationName}. Everything else stays as booked
            {deposit.paidMinor ? ', including your deposit' : ''}.
          </p>
          {slots?.patchTest && (
            <p className="subtle">
              This treatment needs a clear patch test that covers the visit, so only those times can
              be chosen here. For another time, contact the studio.
            </p>
          )}
          <SegmentedControl
            label="Who with"
            appearance="pill"
            className="guest-move-who"
            value={anyone ? 'anyone' : 'same'}
            onChange={(value) => {
              const everyone = value === 'anyone'
              setAnyone(everyone)
              setError('')
              void look(date, everyone)
            }}
            options={[
              { value: 'same', label: `With ${visit.professional}` },
              { value: 'anyone', label: 'Anyone available' },
            ]}
          />
          {slots && (
            <MoveDayStrip
              days={slots.days}
              value={date}
              current={visit.date}
              locale={org.locale}
              label="Choose a day"
              onChange={(next) => {
                setDate(next)
                setChoice(null)
                setError('')
                void look(next, anyone)
              }}
            />
          )}
          {loading && (
            <p role="status" className="subtle">
              Finding free times…
            </p>
          )}
          {/* While the same day loads again, its times stay put, on the part of the day in view. */}
          {offered.length ? (
            <TimeChoices
              tabs
              label={`Free times on ${dateLabel(date, org.locale)}`}
              times={offered.map((time) => ({
                value: time.startMinutes,
                label:
                  time.professional === visit.professional
                    ? timeLabel(time.startMinutes, org.locale)
                    : `${timeLabel(time.startMinutes, org.locale)} · ${time.professional}`,
              }))}
              value={choice?.date === date ? choice.startMinutes : null}
              onChange={(start) => {
                const time = offered.find((t) => t.startMinutes === start)
                if (time)
                  setChoice({
                    date,
                    startMinutes: start,
                    staffId: time.staffId,
                    professional: time.professional,
                  })
              }}
            />
          ) : (
            !loading &&
            slots &&
            day && (
              <p className="guest-move-none" role="status">
                {!day.open
                  ? `The studio is closed on ${dateLabel(date, org.locale)}.`
                  : slots.patchTest
                    ? `No times on ${dateLabel(date, org.locale)} can be chosen here. Try another day, or contact the studio.`
                    : anyone
                      ? `No free times on ${dateLabel(date, org.locale)}. Try another day.`
                      : `No free times with ${visit.professional} on ${dateLabel(date, org.locale)}. Try another day, or anyone available.`}
              </p>
            )
          )}
          <ErrorMessage error={error} />
          <div className="guest-actions">
            <Button disabled={!choice || loading} onClick={review}>
              Review the change <ArrowRight size={16} aria-hidden="true" />
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setStage('closed')
                setError('')
              }}
            >
              Keep my time
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="guest-move-compare">
            <div>
              <span>Now</span>
              <strong>{when(visit.date, visit.startMinutes)}</strong>
              <small>With {visit.professional}</small>
            </div>
            <ArrowRight className="guest-move-arrow" size={18} aria-hidden="true" />
            <div className="guest-move-new">
              <span>New time</span>
              <strong>{when(choice.date, choice.startMinutes)}</strong>
              <small>With {choice.professional}</small>
            </div>
          </div>
          {late && (
            <p className="guest-move-late">
              This new time is less than {GUEST_CANCEL_CUTOFF_HOURS} hours away, so after this your
              visit can’t be moved online again
              {deposit.paidMinor
                ? `, and if you cancel, the studio keeps your ${deposit.test ? 'test ' : deposit.simulated ? 'simulated ' : ''}deposit`
                : ''}
              .
            </p>
          )}
          <ErrorMessage error={error} />
          <div className="guest-actions">
            <Button
              disabled={saving || busy}
              onClick={() => void send({ ...choice, requestKey: crypto.randomUUID() }, false)}
            >
              {saving ? 'Moving your visit…' : 'Yes, move my visit'}
            </Button>
            <Button variant="secondary" disabled={saving} onClick={() => setStage('choosing')}>
              Choose another time
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
