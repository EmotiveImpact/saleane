import type { ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Info } from 'lucide-react'

/**
 * A short, on-demand explanation of how a figure is measured. A popover
 * rather than a tooltip, so it opens by tap, click or keyboard alike.
 */
export function Definition({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="definition-trigger" aria-label={`How ${label} is measured`}>
        <Info size={14} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="definition-content"
          aria-label={`How ${label} is measured`}
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <strong>{label}</strong>
          <div>{children}</div>
          <Popover.Arrow className="definition-arrow" width={12} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
