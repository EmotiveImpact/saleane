import { Children, cloneElement, isValidElement } from 'react'
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'

type Props = Record<string, unknown>

/**
 * Puts a part's behaviour on the app's own element, so the app keeps its design:
 * `<ApprovalCard.Approve asChild><Button>Approve</Button></ApprovalCard.Approve>` gives the app's
 * button LUMANE's click, its disabled state and its data attributes. The app's own props win,
 * except that both click handlers run (the app's first), class names join and styles merge.
 */
export function Slot({ children, ...slot }: Props & { children?: ReactNode }) {
  const only = Children.only(children)
  if (!isValidElement(only)) return null
  const child = only as ReactElement<Props>
  return cloneElement(child, mergeProps(slot, child.props))
}

/** A part's own props with the app's on top, merged the way `Slot` merges them. */
export function mergeProps(slot: Props, child: Props): Props {
  const merged: Props = { ...slot, ...child }
  for (const [key, ours] of Object.entries(slot)) {
    const theirs = child[key]
    if (/^on[A-Z]/.test(key) && typeof ours === 'function') {
      merged[key] =
        typeof theirs === 'function'
          ? (...args: unknown[]) => {
              theirs(...args)
              if (!(args[0] as { defaultPrevented?: boolean } | undefined)?.defaultPrevented)
                ours(...args)
            }
          : ours
    } else if (key === 'className') {
      merged[key] = [ours, theirs].filter(Boolean).join(' ') || undefined
    } else if (key === 'style') {
      merged[key] = { ...(ours as object), ...(theirs as object) }
    } else if (theirs === undefined) {
      merged[key] = ours
    }
  }
  return merged
}

/** Text a screen reader announces and nobody sees, with no styling needed from the app. */
export const hidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
} as const

/**
 * A part that is a button: LUMANE's own `<button>`, or the app's element when `asChild`. Either
 * way it gets the part's behaviour, and `fallback` is the label when the app gives none.
 */
export function PartButton({
  asChild,
  ours,
  props,
  fallback,
}: {
  asChild?: boolean
  ours: Props
  props: ButtonHTMLAttributes<HTMLButtonElement>
  fallback?: ReactNode
}) {
  const { children, ...rest } = props
  const merged = mergeProps({ type: 'button', ...ours }, rest)
  if (asChild) return <Slot {...merged}>{children}</Slot>
  return (
    <button {...(merged as ButtonHTMLAttributes<HTMLButtonElement>)}>{children ?? fallback}</button>
  )
}
