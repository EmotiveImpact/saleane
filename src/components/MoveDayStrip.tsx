import { useEffect, useId, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import './moveDayStrip.css'

export type MoveStripDay = {
  date: string
  /** False when the studio is closed that day: shown greyed and not offered. */
  open: boolean
}

/**
 * The days a guest can move their visit to, in a row that scrolls sideways. Each day reads as its
 * weekday and date in the studio's own language; a closed day is greyed and says so in words.
 */
export function MoveDayStrip({
  days,
  value,
  onChange,
  locale,
  label,
  current,
}: {
  days: MoveStripDay[]
  value: string
  onChange: (date: string) => void
  locale: string
  label: string
  /** The day the visit is on now, marked so the guest can find their way back. */
  current?: string
}) {
  const name = useId()
  const strip = useRef<HTMLDivElement>(null)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const dayMonth = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  // The chosen day stays in sight, also when it was chosen for the guest.
  useEffect(() => {
    const row = strip.current
    const chosen = row?.querySelector<HTMLElement>('[data-chosen="true"]')
    if (!row || !chosen) return
    const left = chosen.offsetLeft
    if (left < row.scrollLeft || left + chosen.offsetWidth > row.scrollLeft + row.clientWidth)
      row.scrollLeft = Math.max(0, left - (row.clientWidth - chosen.offsetWidth) / 2)
  }, [value])
  const page = (direction: 1 | -1) => {
    const row = strip.current
    if (row) row.scrollLeft += direction * Math.max(row.clientWidth * 0.8, 160)
  }
  return (
    <fieldset className="move-days">
      <legend>{label}</legend>
      <div className="move-days-row">
        <button
          type="button"
          className="move-days-page"
          aria-label="Earlier days"
          onClick={() => page(-1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <div className="move-days-strip" ref={strip}>
          {days.map((day) => {
            const when = new Date(`${day.date}T12:00:00Z`)
            const chosen = day.date === value
            return (
              <label
                key={day.date}
                data-chosen={chosen}
                className={`move-day${chosen ? ' selected' : ''}${day.open ? '' : ' closed'}`}
              >
                <input
                  type="radio"
                  name={name}
                  value={day.date}
                  checked={chosen}
                  disabled={!day.open}
                  onChange={() => onChange(day.date)}
                />
                <span className="move-day-weekday">{weekday.format(when)}</span>{' '}
                <strong>{dayMonth.format(when)}</strong>{' '}
                <small>{!day.open ? 'Closed' : day.date === current ? 'Your visit' : ''}</small>
              </label>
            )
          })}
        </div>
        <button
          type="button"
          className="move-days-page"
          aria-label="Later days"
          onClick={() => page(1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
    </fieldset>
  )
}
