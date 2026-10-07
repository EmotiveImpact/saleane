import { useId } from 'react'

export type StripDay = {
  date: string
  /** How many times are free that day; zero shows the day as full. */
  free: number
}

/**
 * The next fortnight at a glance: each day says whether it has space, so a guest
 * never has to open a date picker to discover a full day.
 */
export function DateStrip({
  days,
  value,
  onChange,
  locale,
  label,
}: {
  days: StripDay[]
  value: string
  onChange: (date: string) => void
  locale: string
  label: string
}) {
  const name = useId()
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const dayMonth = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  return (
    <fieldset className="date-strip">
      <legend>{label}</legend>
      <div className="date-strip-days">
        {days.map((day) => {
          const when = new Date(`${day.date}T00:00:00Z`)
          return (
            <label
              key={day.date}
              className={`date-strip-day ${value === day.date ? 'selected' : ''} ${day.free ? '' : 'full'}`}
            >
              <input
                type="radio"
                name={name}
                value={day.date}
                checked={value === day.date}
                onChange={() => onChange(day.date)}
              />
              <span className="date-strip-weekday">{weekday.format(when)}</span>
              <strong>{dayMonth.format(when)}</strong>
              <small>
                {day.free ? `${day.free} ${day.free === 1 ? 'time' : 'times'}` : 'Full'}
              </small>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
