import { useMemo } from 'react'
import { clockLabel, clockMinutes, clockTime } from './dates'
import { Select } from './Select'
import type { SelectProps } from './Select'

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
}: Omit<SelectProps, 'value' | 'defaultValue' | 'onChange' | 'children'> & {
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
  const chosen = value ?? defaultValue ?? ''
  // A day at quarter hours is close to a hundred times and a week of opening hours shows fourteen
  // lists, so the times are only worked out again when what they offer changes.
  const times = useMemo(() => {
    const list: string[] = []
    for (let minute = clockMinutes(from); minute <= clockMinutes(until); minute += step)
      list.push(clockTime(minute))
    if (/^\d{2}:\d{2}$/.test(chosen) && !list.includes(chosen)) list.push(chosen)
    return list.sort()
  }, [chosen, from, until, step])
  return (
    <Select
      {...rest}
      className={`time-field ${className}`}
      {...(value !== undefined ? { value } : { defaultValue: defaultValue || undefined })}
      placeholder={placeholder}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {times.map((time) => (
        <option key={time} value={time}>
          {clockLabel(time, locale)}
        </option>
      ))}
    </Select>
  )
}
