import { useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { initials } from '../domain/format'

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'light'
}) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {children}
    </button>
  )
}
export function Avatar({
  name,
  tone = 'sage',
  small = false,
  identity,
}: {
  name: string
  tone?: string
  small?: boolean
  identity?: string
}) {
  // Only fictional seed identities have generated portraits. New clients keep initials.
  const portraits: Record<string, string> = {
    'staff-maya': '0% 0%',
    'client-2': '100% 0%',
    'client-1': '0% 100%',
    'client-6': '100% 100%',
  }
  const portrait = identity ? portraits[identity] : undefined
  return (
    <span
      aria-hidden="true"
      className={`avatar tone-${tone} ${small ? 'avatar-small' : ''} ${portrait ? 'avatar-photo' : ''}`}
      style={portrait ? { backgroundPosition: portrait } : undefined}
    >
      {portrait ? null : initials(name)}
    </span>
  )
}
export function Status({ status }: { status: string }) {
  const text =
    status === 'confirmed'
      ? 'Upcoming'
      : status === 'arrived'
        ? 'In the studio'
        : status === 'completed'
          ? 'Completed'
          : status
  return (
    <span className={`status status-${status}`}>
      <span />
      {text}
    </span>
  )
}
export function Metric({
  label,
  value,
  detail,
}: {
  label: string
  value: ReactNode
  detail: ReactNode
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}
export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null
}
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
  const heading = useRef<HTMLHeadingElement | null>(null)
  const previousTitle = useRef(title)
  useEffect(() => {
    if (open && placement === 'side' && previousTitle.current !== title) {
      heading.current?.focus()
      content.current?.scrollTo?.({ top: 0 })
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
              <button className="icon-button" aria-label="Close dialog">
                <X size={20} />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
