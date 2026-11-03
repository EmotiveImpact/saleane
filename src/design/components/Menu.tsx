import type { ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { rememberOpener } from '../opener'

/**
 * A short list of things to do, opened from one button: the studio and your own name at the top,
 * or "More" on a row with several actions. Built on Radix Dropdown Menu, so arrow keys move
 * through it, typing a letter jumps, Escape closes and focus goes back to the button.
 */
export function Menu({
  trigger,
  label,
  children,
  align = 'end',
  side = 'bottom',
  className = '',
}: {
  /** The button that opens it. It must have words or an aria-label. */
  trigger: ReactNode
  /** What the menu is for, read out as it opens. */
  label: string
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={`menu ${className}`}
          aria-label={label}
          align={align}
          side={side}
          sideOffset={8}
          collisionPadding={12}
          onCloseAutoFocus={(event) => {
            // An item that opened a dialog or panel keeps the focus there.
            if (document.activeElement?.closest('[role="dialog"]')) event.preventDefault()
          }}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

type ItemProps = {
  children: ReactNode
  icon?: ReactNode
  /** A quieter second line, such as which location is open. */
  detail?: ReactNode
  disabled?: boolean
  tone?: 'danger'
}

const itemBody = ({ icon, children, detail }: ItemProps) => (
  <>
    {icon && (
      <span className="menu-icon" aria-hidden="true">
        {icon}
      </span>
    )}
    <span className="menu-words">
      <span>{children}</span>
      {detail && <small>{detail}</small>}
    </span>
  </>
)

/** One thing to do. `to` goes to a page in the app; `onSelect` does something here. */
export function MenuItem(props: ItemProps & { to?: string; onSelect?: () => void }) {
  const { to, onSelect, disabled, tone } = props
  const className = `menu-item${tone ? ` menu-item-${tone}` : ''}`
  if (to)
    return (
      <DropdownMenu.Item asChild disabled={disabled} className={className}>
        <Link to={to}>{itemBody(props)}</Link>
      </DropdownMenu.Item>
    )
  return (
    <DropdownMenu.Item
      disabled={disabled}
      className={className}
      onSelect={(event) => {
        rememberOpener(event.currentTarget as Element)
        onSelect?.()
      }}
    >
      {itemBody(props)}
    </DropdownMenu.Item>
  )
}

/** A quiet heading over a few items, such as the studio's locations. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="menu-label">{children}</DropdownMenu.Label>
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="menu-separator" />
}

/** One choice from a few, shown with a tick, such as the location you are looking at. */
export function MenuChoices<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: ReactNode; detail?: ReactNode }[]
}) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
      {options.map((option) => (
        <DropdownMenu.RadioItem
          key={option.value}
          value={option.value}
          className="menu-item menu-choice"
        >
          <span className="menu-words">
            <span>{option.label}</span>
            {option.detail && <small>{option.detail}</small>}
          </span>
          <DropdownMenu.ItemIndicator className="menu-tick" aria-hidden="true">
            <Check size={16} />
          </DropdownMenu.ItemIndicator>
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  )
}
