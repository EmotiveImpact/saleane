import { lazy, Suspense, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import { Button } from '../design'
import type { Role } from '../domain/operations'

const HelpPanel = lazy(() =>
  import('./HelpPanel').then((module) => ({ default: module.HelpPanel })),
)

/**
 * NEXT-06: Help for the pages a practitioner or regional manager has instead of the studio's own
 * screens. It opens the same panel, with only the guides for their role.
 */
export function HelpButton({
  role,
  workspaceId,
  locale,
}: {
  role: Role
  workspaceId: string
  locale: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" className="help-open" onClick={() => setOpen(true)}>
        <CircleHelp size={16} aria-hidden="true" />
        <span className="help-open-label">Help</span>
      </Button>
      {open && (
        <Suspense fallback={null}>
          <HelpPanel
            open
            onClose={() => setOpen(false)}
            role={role}
            signedIn
            workspaceId={workspaceId}
            locale={locale}
          />
        </Suspense>
      )}
    </>
  )
}
