import type { ReactNode } from 'react'
import * as ToggleGroup from '@radix-ui/react-toggle-group'

/**
 * A single choice between a few views of the same content (a period, a
 * filter, a layout). Built on Radix Toggle Group: arrow keys move between
 * options and exactly one stays selected.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  appearance = 'underline',
  className = '',
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: { value: T; label: ReactNode; accessibleLabel?: string }[]
  appearance?: 'underline' | 'pill' | 'icon'
  className?: string
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        // A segmented control always keeps one option selected.
        if (next) onChange(next as T)
      }}
      className={`segmented segmented-${appearance} ${className}`}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          aria-label={option.accessibleLabel}
          className="segmented-item"
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
