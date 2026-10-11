import { useState } from 'react'
import type { ReactNode } from 'react'
import { Collapsible } from 'radix-ui'
import { ChevronDown } from 'lucide-react'

/**
 * Something tucked away under one line that opens in place: earlier records, the working behind a
 * figure, a setting most people never change. Built on Radix Collapsible, so the line is a real
 * button that says whether it is open; the body unfolds to its height with the calm timing and
 * folds away a little quicker. Reduced motion simply shows and hides it.
 */
export function Fold({
  summary,
  children,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
  className = '',
}: {
  /** The line that opens it. Say what is inside, such as "Earlier pay", not just "More". */
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  const [own, setOwn] = useState(defaultOpen)
  const open = controlled ?? own
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={(next) => {
        setOwn(next)
        onOpenChange?.(next)
      }}
      className={`fold ${className}`}
      data-open={open || undefined}
    >
      <Collapsible.Trigger className="fold-summary">
        <span className="fold-summary-words">{summary}</span>
        <ChevronDown size={16} aria-hidden="true" className="fold-chevron" />
      </Collapsible.Trigger>
      <Collapsible.Content className="fold-body">
        <div className="fold-inner">{children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
