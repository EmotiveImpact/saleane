import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import './wizard.css'

/**
 * A wizard: a few named steps, one job each, inside a Modal. Moving in is the first; setting up
 * a studio or a new location can use the same pieces.
 *
 * - `WizardSteps` names every step along the top, ticks the finished ones and marks the current
 *   one for screen readers. On a phone only the current step is named.
 * - `useWizardStep` (useWizardStep.ts) starts each new step at the top of the dialog and moves
 *   focus to its heading, so the change is read out. Give the heading `tabIndex={-1}` and the
 *   returned ref.
 * - `ChoiceTiles` is one large-target choice from a short list (an old system, a kind of studio).
 * - `WizardFooter` keeps Back and Continue at the bottom of the dialog however long a step is.
 */
export function WizardSteps({
  steps,
  current,
  label,
}: {
  steps: readonly string[]
  /** The step on now, counted from 1. */
  current: number
  label: string
}) {
  return (
    <ol className="wizard-steps" aria-label={label}>
      {steps.map((name, i) => {
        const n = i + 1
        return (
          <li
            key={name}
            aria-current={current === n ? 'step' : undefined}
            className={n < current ? 'is-done' : undefined}
          >
            <span className="wizard-steps-mark" aria-hidden="true">
              {n < current ? <Check size={13} /> : n}
            </span>
            <span className="wizard-steps-label">
              {name}
              {n < current && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function ChoiceTiles<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T | null
  onChange: (value: T) => void
}) {
  return (
    <div className="choice-tiles" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="choice-tile"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {value === option.value && <Check size={16} aria-hidden="true" />}
        </button>
      ))}
    </div>
  )
}

export function WizardFooter({ children }: { children: ReactNode }) {
  return <div className="wizard-footer">{children}</div>
}
