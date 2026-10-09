import { memo } from 'react'
import type { SelectHTMLAttributes } from 'react'
import { clockLabel, clockMinutes, clockTime } from './dates'

/**
 * A time of day chosen from a list at a sensible step, written the studio's way: 24-hour in the
 * UK ("18:00"), 12-hour in the US ("06:00 PM"), whatever language the browser speaks. The value
 * stays "HH:MM", as a native time input gives it, so forms and records are unchanged. A time
 * already saved off the step (such as 09:10) is kept and offered too.
 */
export function TimeField({
  value,
  defaultValue,
  onChange,
  locale,
  step = 15,
  from = '00:00',
  until = '23:45',
  placeholder = 'Choose a time',
  className = '',
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'defaultValue' | 'onChange'> & {
  /** The chosen time as "HH:MM", or '' for none. Leave out to let the field keep its own. */
  value?: string
  defaultValue?: string
  onChange?: (time: string) => void
  locale: string
  /** Minutes between the times offered. */
  step?: number
  /** The earliest and latest times offered, as "HH:MM". */
  from?: string
  until?: string
  placeholder?: string
}) {
  return (
    <select
      {...rest}
      className={`time-field ${className}`}
      {...(value !== undefined ? { value } : { defaultValue: defaultValue ?? '' })}
      onChange={(event) => onChange?.(event.target.value)}
    >
      <TimeOptions
        chosen={value ?? defaultValue ?? ''}
        locale={locale}
        step={step}
        from={from}
        until={until}
        placeholder={placeholder}
      />
    </select>
  )
}

/**
 * The times offered. A day at quarter hours is close to a hundred options and a week of opening
 * hours shows fourteen lists, so the options are only redrawn when what they offer changes.
 */
const TimeOptions = memo(function TimeOptions({
  chosen,
  locale,
  step,
  from,
  until,
  placeholder,
}: {
  chosen: string
  locale: string
  step: number
  from: string
  until: string
  placeholder: string
}) {
  const times: string[] = []
  for (let minute = clockMinutes(from); minute <= clockMinutes(until); minute += step)
    times.push(clockTime(minute))
  if (/^\d{2}:\d{2}$/.test(chosen) && !times.includes(chosen)) times.push(chosen)
  times.sort()
  return (
    <>
      {!chosen && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {times.map((time) => (
        <option key={time} value={time}>
          {clockLabel(time, locale)}
        </option>
      ))}
    </>
  )
})
