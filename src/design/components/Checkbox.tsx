import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Checkbox as RadixCheckbox, Switch as RadixSwitch } from 'radix-ui'
import { Check } from 'lucide-react'

/** What the old checkbox's change handler read, so handlers move across as they are. */
type Read = { checked: boolean; name?: string; value: string; form: HTMLFormElement | null }
type Change = {
  target: Read
  currentTarget: Read
  /** Nothing to stop: the form hears the change from its own hidden checkbox afterwards. */
  stopPropagation: () => void
}

export type TickProps = {
  checked?: boolean
  defaultChecked?: boolean
  onChange?: (event: Change) => void
  onCheckedChange?: (checked: boolean) => void
  id?: string
  name?: string
  /** What a form reads when it is ticked; "on" unless said otherwise, as with a checkbox. */
  value?: string
  disabled?: boolean
  required?: boolean
  className?: string
  style?: CSSProperties
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  autoFocus?: boolean
}

/** The words a screen reader hears, passed straight to the control. */
const labelOf = (props: TickProps) => ({
  'aria-label': props['aria-label'],
  'aria-labelledby': props['aria-labelledby'],
  'aria-describedby': props['aria-describedby'],
  'aria-invalid': props['aria-invalid'],
})

/** Keeps its own state when no `checked` is given, as a checkbox does. */
function useTick({ checked, defaultChecked, onChange, onCheckedChange, name, value }: TickProps) {
  const [own, setOwn] = useState(!!defaultChecked)
  const control = useRef<HTMLButtonElement>(null)
  const on = checked ?? own
  const change = (next: boolean) => {
    if (checked === undefined) setOwn(next)
    onCheckedChange?.(next)
    const read = { checked: next, name, value: value ?? 'on', form: control.current?.form ?? null }
    onChange?.({ target: read, currentTarget: read, stopPropagation: () => {} })
  }
  return [on, change, control] as const
}

/**
 * A tick for one thing that is on or off in a list or a form ("Hide completed", "Archive for
 * future bookings"). Built on Radix Checkbox: a real checkbox to screen readers and the keyboard,
 * drawn as SALEANE's own soft square with an ink tick that settles in. Write it as a checkbox
 * input would be written; `onChange` receives `{ target: { checked } }`.
 */
export function Checkbox(props: TickProps) {
  const { id, name, value, disabled, required, className = '', style, autoFocus } = props
  const [on, change, control] = useTick(props)
  return (
    <RadixCheckbox.Root
      ref={control}
      id={id}
      checked={on}
      onCheckedChange={(next) => change(next === true)}
      name={name}
      value={value}
      disabled={disabled}
      required={required}
      className={`tick ${className}`}
      style={style}
      autoFocus={autoFocus}
      {...labelOf(props)}
    >
      <RadixCheckbox.Indicator className="tick-mark">
        <Check size={13} strokeWidth={3} aria-hidden="true" />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
}

/**
 * A setting that is simply on or off and takes effect as a whole ("Send reminders"). Built on Radix
 * Switch: screen readers hear a switch, and the knob slides across with the calm timing.
 */
export function Switch(props: TickProps) {
  const { id, name, value, disabled, required, className = '', style, autoFocus } = props
  const [on, change, control] = useTick(props)
  return (
    <RadixSwitch.Root
      ref={control}
      id={id}
      checked={on}
      onCheckedChange={change}
      name={name}
      value={value}
      disabled={disabled}
      required={required}
      className={`switch ${className}`}
      style={style}
      autoFocus={autoFocus}
      {...labelOf(props)}
    >
      <RadixSwitch.Thumb className="switch-knob" />
    </RadixSwitch.Root>
  )
}
