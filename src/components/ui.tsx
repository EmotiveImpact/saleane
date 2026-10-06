import { useRef } from 'react'
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
}: {
  name: string
  tone?: string
  small?: boolean
}) {
  return (
    <span aria-hidden="true" className={`avatar tone-${tone} ${small ? 'avatar-small' : ''}`}>
      {initials(name)}
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
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  children: ReactNode
  wide?: boolean
}) {
  const previousFocus = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          ref={content}
          className={`dialog-content ${wide ? 'dialog-wide' : ''}`}
          onOpenAutoFocus={(event) => {
            previousFocus.current = document.activeElement as HTMLElement
            event.preventDefault()
            const target =
              content.current?.querySelector<HTMLElement>(
                'input:not([type="checkbox"]), select, textarea',
              ) ?? content.current?.querySelector<HTMLElement>('button')
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
              <Dialog.Title>{title}</Dialog.Title>
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
