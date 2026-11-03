import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { ToggleGroup } from 'radix-ui'
import { useScrollEdges } from './useScrollEdges'
import { ChosenMark } from './ChosenMark'

/**
 * A single choice between a few views of the same content (a period, a
 * filter, a layout). Built on Radix Toggle Group: arrow keys move between
 * options and exactly one stays selected. The underline or shape that marks the
 * choice slides across to a new one; chips, which wrap onto several lines, simply change.
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
  appearance?: 'underline' | 'pill' | 'icon' | 'chips'
  className?: string
}) {
  // Where a row of options scrolls sideways on a phone, the edge with more to see fades.
  const row = useRef<HTMLDivElement>(null)
  const more = useScrollEdges(row)
  const group = useId()
  const sliding = appearance !== 'chips'
  return (
    <ToggleGroup.Root
      ref={row}
      data-more-before={more.before || undefined}
      data-more-after={more.after || undefined}
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
          {sliding && option.value === value && (
            <ChosenMark group={group} radius={appearance === 'underline' ? 1 : 8} />
          )}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
