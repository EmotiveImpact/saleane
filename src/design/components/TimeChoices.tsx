import { useId, useState } from 'react'
import { groupTimes } from './timeGroups'

export function TimeChoices({
  times,
  value,
  onChange,
  label,
  tabs = false,
}: {
  times: { value: number; label: string }[]
  value: number | null
  onChange: (value: number) => void
  label: string
  /** Show one part of the day at a time, so a long day doesn't read as a wall of times. */
  tabs?: boolean
}) {
  const name = useId()
  const groups = groupTimes(times)
  const [open, setOpen] = useState<string | null>(null)
  // The part of the day the guest opened, else the one holding their time, else the earliest.
  const current =
    groups.find((group) => group.label === open) ??
    groups.find((group) => group.times.some((time) => time.value === value)) ??
    groups[0]
  const shown = tabs ? groups.filter((group) => group === current) : groups
  return (
    <fieldset className="time-fieldset">
      <legend>{label}</legend>
      {tabs && groups.length > 1 && (
        <div className="time-periods" role="group" aria-label="Part of the day">
          {groups.map((group) => (
            <button
              type="button"
              key={group.label}
              aria-pressed={group === current}
              className={group === current ? 'selected' : ''}
              onClick={() => setOpen(group.label)}
            >
              {group.label}
              <small>{group.times.length}</small>
            </button>
          ))}
        </div>
      )}
      {shown.map((group) => (
        <div className="time-group" key={group.label}>
          {!tabs && (
            <span className="time-group-label" aria-hidden>
              {group.label}
            </span>
          )}
          <div className="time-slots">
            {group.times.map((time) => (
              <label
                key={time.value}
                className={`time-choice time-slot ${value === time.value ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name={name}
                  value={time.value}
                  checked={value === time.value}
                  onChange={() => onChange(time.value)}
                />
                <span>{time.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      {!times.length && (
        <p className="subtle">No times available. Try another day or professional.</p>
      )}
    </fieldset>
  )
}
