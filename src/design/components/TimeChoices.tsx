import { useId } from 'react'

export function TimeChoices({
  times,
  value,
  onChange,
  label,
}: {
  times: { value: number; label: string }[]
  value: number | null
  onChange: (value: number) => void
  label: string
}) {
  const name = useId()
  return (
    <fieldset className="time-fieldset">
      <legend>{label}</legend>
      <div className="time-slots">
        {times.map((time) => (
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
      {!times.length && (
        <p className="subtle">No times available. Try another day or professional.</p>
      )}
    </fieldset>
  )
}
