import type { ReactElement, ReactNode } from 'react'
import { Tooltip } from 'radix-ui'

/**
 * A short hint beside a button whose meaning is not written on it, such as an arrow or an icon in
 * the narrow sidebar. Built on Radix Tooltip: it shows on hover and on keyboard focus, and screen
 * readers hear it as the button's description. It never holds anything a person must read to act,
 * because a phone has no hover; the button keeps its own words or aria-label.
 */
export function Tip({
  label,
  children,
  side = 'top',
  disabled = false,
}: {
  label: ReactNode
  /** One element that can take focus, such as a button or link. */
  children: ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Show nothing extra, for example when the words are already on screen. */
  disabled?: boolean
}) {
  if (disabled) return children
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tip" side={side} sideOffset={8} collisionPadding={12}>
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
