import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { initials } from '../../domain/format'
import { Definition } from './Definition'
import { photos } from '../photos'

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
      : status === 'here'
        ? 'Says they’re here'
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
export function Empty({
  title,
  children,
  photo,
  action,
  level = 3,
}: {
  title: string
  children?: ReactNode
  /**
   * A page with nothing in it yet: a house photograph beside the words. `true` uses the stacked
   * towels; pass one of `photos` to choose. Leave it off for a small gap inside a list or panel.
   */
  photo?: boolean | string
  /** The one next step, usually a single Button. A second, quieter one may sit beside it. */
  action?: ReactNode
  /** 2 when the empty state sits straight under the page title, so no heading level is skipped. */
  level?: 1 | 2 | 3
}) {
  const Heading = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
  const picture = photo === true ? photos.towels : photo
  return (
    <div className={`empty ${picture ? 'empty-photo' : ''}`}>
      {picture && <img className="empty-picture" src={picture} alt="" />}
      <div className="empty-words">
        <Heading>{title}</Heading>
        {children && <p>{children}</p>}
        {action && <div className="empty-action">{action}</div>}
      </div>
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
