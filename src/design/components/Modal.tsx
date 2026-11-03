import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { leaveGently } from '../motion'
import { takeOpener } from '../opener'

type Placement = 'center' | 'side' | 'start'

/** Where each kind of dialog goes as it leaves: back towards the edge it came from. */
function leaving(placement: Placement, element: HTMLElement) {
  if (placement === 'side') return { x: 32 }
  if (placement === 'start') return { x: -element.getBoundingClientRect().right }
  return { y: 6 }
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  placement = 'center',
  className = '',
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  children: ReactNode
  wide?: boolean
  /**
   * `side` is a panel beside the page (a visit, checkout, Ask SALEANE). `start` is a drawer from
   * the leading edge, for the phone menu. Everything else opens in the centre.
   */
  placement?: Placement
  className?: string
}) {
  const previousFocus = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  const overlay = useRef<HTMLDivElement | null>(null)
  const body = useRef<HTMLDivElement | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const previousTitle = useRef(title)
  const where = useRef(placement)
  const panel = placement !== 'center'
  useEffect(() => {
    where.current = placement
  }, [placement])
  // Noted before the dialog's own fields can take the focus (one with autoFocus does so as it
  // appears). Opened from a menu, it is the menu's button: the item is gone by the time it closes.
  useLayoutEffect(() => {
    if (open) previousFocus.current = takeOpener() ?? (document.activeElement as HTMLElement)
  }, [open])
  useEffect(() => {
    if (open && panel && previousTitle.current !== title) {
      heading.current?.focus()
      body.current?.scrollTo?.({ top: 0 })
    }
    previousTitle.current = title
  }, [open, panel, title])
  // Closing removes the dialog at once, so focus and screen readers move on; a still copy then
  // leaves gently, back the way it came. Stable callbacks, so this runs only when it really goes.
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    const was = content.current
    content.current = node
    if (!node && was) leaveGently(was, leaving(where.current, was))
  }, [])
  const overlayRef = useCallback((node: HTMLDivElement | null) => {
    const was = overlay.current
    overlay.current = node
    if (!node && was) leaveGently(was, { fade: true })
  }, [])
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          ref={overlayRef}
          className={`dialog-overlay ${panel ? 'dialog-overlay-side' : ''}`}
        />
        <Dialog.Content
          ref={contentRef}
          className={[
            'dialog-content',
            wide && 'dialog-wide',
            panel && 'dialog-side',
            placement === 'start' && 'dialog-start',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (placement === 'side') {
              heading.current?.focus()
              return
            }
            const target =
              placement === 'start'
                ? content.current?.querySelector<HTMLElement>('[aria-current="page"], a, button')
                : (content.current?.querySelector<HTMLElement>(
                    'input:not([type="checkbox"]):not(:disabled), select:not(:disabled), .select-trigger:not(:disabled), textarea:not(:disabled)',
                  ) ?? content.current?.querySelector<HTMLElement>('button:not(:disabled)'))
            target?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = previousFocus.current?.isConnected
              ? previousFocus.current
              : document.querySelector<HTMLElement>('[data-focus-fallback]')
            target?.focus()
          }}
        >
          <div className="dialog-heading">
            <div>
              <Dialog.Title ref={heading} tabIndex={panel ? -1 : undefined}>
                {title}
              </Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="icon-button dialog-close" aria-label="Close dialog">
                <X size={20} />
              </button>
            </Dialog.Close>
          </div>
          <div ref={body} className="dialog-body">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
