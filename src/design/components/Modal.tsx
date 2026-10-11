import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  placement = 'center',
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  children: ReactNode
  wide?: boolean
  placement?: 'center' | 'side'
}) {
  const previousFocus = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  const body = useRef<HTMLDivElement | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const previousTitle = useRef(title)
  useEffect(() => {
    if (open && placement === 'side' && previousTitle.current !== title) {
      heading.current?.focus()
      body.current?.scrollTo?.({ top: 0 })
    }
    previousTitle.current = title
  }, [open, placement, title])
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={`dialog-overlay ${placement === 'side' ? 'dialog-overlay-side' : ''}`}
        />
        <Dialog.Content
          ref={content}
          className={`dialog-content ${wide ? 'dialog-wide' : ''} ${placement === 'side' ? 'dialog-side' : ''}`}
          onOpenAutoFocus={(event) => {
            previousFocus.current = document.activeElement as HTMLElement
            event.preventDefault()
            if (placement === 'side') {
              heading.current?.focus()
              return
            }
            const target =
              content.current?.querySelector<HTMLElement>(
                'input:not([type="checkbox"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)',
              ) ?? content.current?.querySelector<HTMLElement>('button:not(:disabled)')
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
              <Dialog.Title ref={heading} tabIndex={placement === 'side' ? -1 : undefined}>
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
