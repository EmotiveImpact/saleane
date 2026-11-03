import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Extra options, shown only when asked for. The everyday choices stay in view; settings most
 * people never change sit behind one quiet line that opens in place. Built on the native
 * disclosure, so it opens by keyboard and screen readers announce whether it is open.
 */
export function MoreOptions({
  label,
  children,
  defaultOpen = false,
}: {
  /** Say what is inside, such as "More booking settings", not just "More". */
  label: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details className="more-options" open={defaultOpen}>
      <summary>
        {label}
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="more-options-body">{children}</div>
    </details>
  )
}
