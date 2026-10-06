import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { initials } from '../../domain/format'
import { Definition } from './Definition'

export function Button({
  children,
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'light'
}) {
  return (
    <button type={type} className={`button button-${variant} ${className}`} {...props}>
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
          : status === 'cancelled'
            ? 'Cancelled'
            : status === 'no_show'
              ? 'Missed visit'
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
  definition,
}: {
  label: string
  value: ReactNode
  detail: ReactNode
  definition?: ReactNode
}) {
  return (
    <div className="metric">
      <span>
        {label}
        {definition && <Definition label={label}>{definition}</Definition>}
      </span>
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
