import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { dateLabel } from '../domain/format'
import { Tip } from '../design'
import './dayStrip.css'

export type DayStripDay = {
  /** The date, written yyyy-mm-dd. */
  date: string
  /** Shut all day: shown as closed, and it can't be chosen. */
  closed?: boolean
  /** How many times are free that day. Left out while unknown; zero shows the day as full. */
  free?: number
}

function freeWords(day: DayStripDay) {
  if (day.closed) return 'Closed'
  if (day.free === undefined) return ''
  if (!day.free) return 'Full'
  return `${day.free} ${day.free === 1 ? 'time' : 'times'}`
}

/**
 * A run of days side by side, each saying whether it is closed, full or how many times it has,
 * so a guest sees where there is space before opening a day. It only shows days and reports a
 * choice: the page decides which days to pass and what choosing one means.
 *
 * Each day is a native radio, so the arrow keys move between days and skip closed ones. The row
 * scrolls sideways; the day chosen from outside, such as the first available one, is scrolled
 * into view, and so are the first of any days added at the end.
 */
export function DayStrip({
  days,
  value,
  onChange,
  locale,
  label,
  today,
  action,
  onMore,
  moreLabel = 'More dates',
}: {
  /** The days to show, earliest first. */
  days: DayStripDay[]
  /** The chosen date, yyyy-mm-dd. */
  value: string
  onChange: (date: string) => void
  /** The locale the days are written in, such as en-GB or en-US. */
  locale: string
  /** What the row is for, such as "Choose a day". */
  label: string
  /** This date shows as "Today" rather than as its weekday. */
  today?: string
  /** A control beside the label, such as a "First available" button. */
  action?: ReactNode
  /** When given, a last tile asks for more days. */
  onMore?: () => void
  moreLabel?: string
}) {
  const name = useId(),
    labelId = useId()
  const row = useRef<HTMLDivElement>(null),
    shown = useRef(days.length)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const dayMonth = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  const smooth = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  // Brings a day into view without moving the page up or down.
  const reveal = (
    tile: HTMLElement | undefined,
    align: 'start' | 'centre',
    behavior: ScrollBehavior = smooth(),
  ) => {
    const strip = row.current
    if (!strip || !tile) return
    const left = tile.offsetLeft,
      right = left + tile.offsetWidth
    if (left >= strip.scrollLeft && right <= strip.scrollLeft + strip.clientWidth) return
    strip.scrollTo?.({
      left: align === 'start' ? left - 4 : left - (strip.clientWidth - tile.offsetWidth) / 2,
      behavior,
    })
  }
  const tiles = () => [...(row.current?.querySelectorAll<HTMLElement>('.day-strip-day') ?? [])]
  // A day chosen before the strip appears, such as from a link to a day weeks ahead, is shown at
  // once: a gliding scroll as the page opens is cut short when the day counts arrive.
  const opened = useRef(false)
  useEffect(() => {
    reveal(
      tiles().find((tile) => tile.dataset.date === value),
      'centre',
      opened.current ? smooth() : 'auto',
    )
    opened.current = true
    // Only a new choice scrolls; the helpers read the row as it is now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  useEffect(() => {
    if (days.length > shown.current) reveal(tiles()[shown.current], 'start')
    shown.current = days.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length])
  const scroll = (direction: 1 | -1) => {
    const strip = row.current
    strip?.scrollBy?.({ left: direction * strip.clientWidth * 0.8, behavior: smooth() })
  }
  return (
    <div className="day-strip">
      <div className="day-strip-head">
        <span className="day-strip-label" id={labelId}>
          {label}
        </span>
        {action}
        <span className="day-strip-scroll">
          <Tip label="Earlier dates">
            <button type="button" aria-label="Earlier dates" onClick={() => scroll(-1)}>
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
          </Tip>
          <Tip label="Later dates">
            <button type="button" aria-label="Later dates" onClick={() => scroll(1)}>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </Tip>
        </span>
      </div>
      <div className="day-strip-row" ref={row}>
        <div className="day-strip-days" role="radiogroup" aria-labelledby={labelId}>
          {days.map((day) => {
            const when = new Date(`${day.date}T12:00:00Z`),
              words = freeWords(day),
              chosen = day.date === value
            const full = day.free === 0 && !day.closed
            return (
              <label
                key={day.date}
                data-date={day.date}
                className={`day-strip-day${chosen ? ' is-chosen' : ''}${day.closed ? ' is-closed' : ''}${full ? ' is-full' : ''}`}
              >
                <input
                  type="radio"
                  name={name}
                  value={day.date}
                  checked={chosen}
                  disabled={day.closed}
                  aria-label={[
                    day.date === today
                      ? `Today, ${dateLabel(day.date, locale)}`
                      : dateLabel(day.date, locale),
                    day.closed
                      ? 'closed'
                      : day.free === undefined
                        ? ''
                        : day.free
                          ? `${words} free`
                          : 'full',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  onChange={() => onChange(day.date)}
                />
                <span className="day-strip-weekday" aria-hidden="true">
                  {day.date === today ? 'Today' : weekday.format(when)}
                </span>
                <strong aria-hidden="true">{dayMonth.format(when)}</strong>
                <small aria-hidden="true">{words || ' '}</small>
              </label>
            )
          })}
        </div>
        {onMore && (
          <button type="button" className="day-strip-more" onClick={onMore}>
            {moreLabel}
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
