import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays } from '../../domain/format'
import { addMonths, daysIn, firstWeekday, isDate, monthOf, noon, writtenDate } from './dates'
import './dateField.css'

/**
 * A date chosen from a small month calendar, written out in the studio's own style rather than
 * the browser's ("Tue 3 Nov 2026", never "11/03/2026"). The value stays an ISO date
 * (YYYY-MM-DD), so forms and records are unchanged. Used with `value` and `onChange`, or inside
 * a form with `name` (and `defaultValue`), where it submits and reports changes like an input.
 */
export function DateField({
  value,
  defaultValue,
  onChange,
  locale,
  today,
  min,
  max,
  name,
  required = false,
  disabled = false,
  id,
  placeholder = 'Choose a date',
  className = '',
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: {
  /** The chosen date as YYYY-MM-DD, or '' for none. Leave out to let the field keep its own. */
  value?: string
  defaultValue?: string
  onChange?: (date: string) => void
  locale: string
  /** The studio's today: marked in the calendar, and where it opens when nothing is chosen. */
  today: string
  min?: string
  max?: string
  /** Submits the ISO date under this name in the surrounding form. */
  name?: string
  required?: boolean
  disabled?: boolean
  id?: string
  placeholder?: string
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}) {
  const [own, setOwn] = useState(defaultValue ?? '')
  const chosen = value !== undefined ? value : own
  const [open, setOpen] = useState(false)
  // A required date left empty: the field itself turns to say so, as a hidden input cannot.
  const [invalid, setInvalid] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  const low = isDate(min) ? min : undefined
  const high = isDate(max) ? max : undefined
  const fit = (date: string) => (low && date < low ? low : high && date > high ? high : date)
  const shown = isDate(chosen) ? chosen : ''

  function choose(next: string) {
    if (value === undefined) setOwn(next)
    setInvalid(false)
    onChange?.(next)
    setOpen(false)
  }

  return (
    <span className={`date-field ${className}`}>
      <Popover.Root open={open} onOpenChange={setOpen} modal>
        <Popover.Trigger asChild>
          <button
            ref={trigger}
            type="button"
            id={id}
            className="date-field-trigger"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          >
            <span className={shown ? 'date-field-value' : 'date-field-placeholder'}>
              {shown ? writtenDate(shown, locale) : placeholder}
            </span>
            <CalendarDays size={17} aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            ref={content}
            className="date-field-popover"
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            aria-label="Choose a date"
            onOpenAutoFocus={(event) => {
              // Straight to the chosen day (or today), as in any calendar.
              event.preventDefault()
              content.current
                ?.querySelector<HTMLButtonElement>('button[data-day][tabindex="0"]')
                ?.focus()
            }}
          >
            <MonthCalendar
              chosen={shown}
              first={fit(shown || today)}
              today={today}
              min={low}
              max={high}
              locale={locale}
              onChoose={choose}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {name && (
        <FormValue
          name={name}
          value={shown}
          required={required}
          onInvalid={() => {
            setInvalid(true)
            trigger.current?.focus()
          }}
        />
      )}
    </span>
  )
}

const hidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  minHeight: 0,
  padding: 0,
  margin: 0,
  border: 0,
  opacity: 0,
  pointerEvents: 'none',
  overflow: 'hidden',
} as const

/**
 * The value as the form sees it: a hidden text field that carries the ISO date into FormData,
 * takes part in `required` checks, and tells the form when it changes, so a form listening for
 * changes (such as a preview of affected visits) hears about a date picked in the calendar.
 */
function FormValue({
  name,
  value,
  required,
  onInvalid,
}: {
  name: string
  value: string
  required: boolean
  onInvalid: () => void
}) {
  const input = useRef<HTMLInputElement | null>(null)
  const previous = useRef(value)
  const [initial] = useState(value)
  useEffect(() => {
    const field = input.current
    if (!field || previous.current === value) return
    previous.current = value
    // Set as typing would, so React's change tracking on the form notices it.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }, [value])
  return (
    <input
      ref={input}
      type="text"
      name={name}
      defaultValue={initial}
      required={required}
      tabIndex={-1}
      aria-hidden="true"
      autoComplete="off"
      style={hidden}
      onInvalid={(event) => {
        // The field says what is missing itself, rather than a browser bubble on a hidden input.
        event.preventDefault()
        onInvalid()
      }}
    />
  )
}

/**
 * One month as a grid of days. Arrow keys move a day or a week, Home and End go to the ends of
 * the week, Page Up and Page Down change the month (with Shift, the year), Enter or Space chooses.
 */
function MonthCalendar({
  chosen,
  first,
  today,
  min,
  max,
  locale,
  onChoose,
}: {
  chosen: string
  first: string
  today: string
  min?: string
  max?: string
  locale: string
  onChoose: (date: string) => void
}) {
  const [focus, setFocus] = useState(first)
  const [month, setMonth] = useState(monthOf(first))
  const grid = useRef<HTMLTableElement | null>(null)
  const moved = useRef(false)
  const titleId = useId()
  const fit = (date: string) => (min && date < min ? min : max && date > max ? max : date)
  const startDay = firstWeekday(locale)
  const firstOfMonth = `${month}-01`
  const lead = (noon(firstOfMonth).getUTCDay() - startDay + 7) % 7
  const count = daysIn(month)
  const weeks = Math.ceil((lead + count) / 7)
  const weekdayShort = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const weekdayLong = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
  const title = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(noon(firstOfMonth))
  // The day that takes Tab in this month: the focused day when it is shown, else the nearest one.
  const tabbable = monthOf(focus) === month ? focus : fit(firstOfMonth)
  const canBack = !min || monthOf(min) < month
  const canOn = !max || monthOf(max) > month
  const todayAllowed = (!min || today >= min) && (!max || today <= max)

  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    grid.current?.querySelector<HTMLButtonElement>('button[data-day][tabindex="0"]')?.focus()
  }, [focus])

  function go(next: string) {
    const date = fit(next)
    moved.current = true
    setFocus(date)
    setMonth(monthOf(date))
  }
  function turn(by: number) {
    setMonth(monthOf(addMonths(firstOfMonth, by)))
    // Keep the same day number ready, so the keyboard picks up where it was.
    setFocus(fit(addMonths(focus, by)))
  }
  function key(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const weekday = (noon(date).getUTCDay() - startDay + 7) % 7
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, -weekday),
      End: () => addDays(date, 6 - weekday),
      PageUp: () => addMonths(date, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(date, event.shiftKey ? 12 : 1),
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    go(move())
  }

  return (
    <div className="month-calendar">
      <div className="month-calendar-head">
        <button
          type="button"
          className="month-calendar-turn"
          aria-label="Previous month"
          disabled={!canBack}
          onClick={() => turn(-1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <h2 id={titleId} aria-live="polite">
          {title}
        </h2>
        <button
          type="button"
          className="month-calendar-turn"
          aria-label="Next month"
          disabled={!canOn}
          onClick={() => turn(1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <table ref={grid} role="grid" aria-labelledby={titleId} className="month-calendar-grid">
        <thead>
          <tr>
            {Array.from({ length: 7 }, (_, i) => {
              // 4 January 2026 was a Sunday; count on from there to the week's first day.
              const day = noon(addDays('2026-01-04', (startDay + i) % 7))
              return (
                <th key={i} scope="col" abbr={weekdayLong.format(day)}>
                  {weekdayShort.format(day)}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: weeks }, (_, week) => (
            <tr key={week}>
              {Array.from({ length: 7 }, (_, column) => {
                const n = week * 7 + column - lead + 1
                if (n < 1 || n > count) return <td key={column} />
                const date = `${month}-${String(n).padStart(2, '0')}`
                return (
                  <td key={column} aria-selected={date === chosen}>
                    <button
                      type="button"
                      data-day={date}
                      className={`month-calendar-day ${date === chosen ? 'is-chosen' : ''} ${date === today ? 'is-today' : ''}`}
                      tabIndex={date === tabbable ? 0 : -1}
                      disabled={(!!min && date < min) || (!!max && date > max)}
                      aria-label={writtenDate(date, locale, 'long')}
                      aria-current={date === today ? 'date' : undefined}
                      onClick={() => onChoose(date)}
                      onFocus={() => setFocus(date)}
                      onKeyDown={(event) => key(event, date)}
                    >
                      {n}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {todayAllowed && (
        <div className="month-calendar-foot">
          <button type="button" className="text-link" onClick={() => onChoose(today)}>
            Today, {writtenDate(today, locale)}
          </button>
        </div>
      )}
    </div>
  )
}
