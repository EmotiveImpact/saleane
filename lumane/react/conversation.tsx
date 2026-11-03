import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { PartButton, hidden } from './slot'
import { useWords } from './words'

type Div = HTMLAttributes<HTMLDivElement>
type Para = HTMLAttributes<HTMLParagraphElement>

const Follow = createContext<(() => void) | null>(null)

/** Keeps the newest line in view after something inside the conversation changes size. */
export const useKeepInView = () => useContext(Follow)

/**
 * The conversation: what the person asked and what the assistant answered, newest last. Screen
 * readers hear each new line without being interrupted. Whenever `follow` changes (pass the list
 * of lines), and whenever an approval card inside it changes, the newest line is scrolled into
 * view; opening it leaves the scroll where it is.
 */
export function Conversation({
  follow,
  endClassName,
  children,
  ...props
}: Div & { follow?: unknown; endClassName?: string }) {
  const end = useRef<HTMLDivElement | null>(null)
  const keep = useCallback(() => end.current?.scrollIntoView?.({ block: 'end' }), [])
  const last = useRef(follow)
  useEffect(() => {
    if (last.current === follow) return
    last.current = follow
    keep()
  }, [follow, keep])
  return (
    <Follow.Provider value={keep}>
      <div aria-live="polite" {...props} data-lumane="conversation">
        {children}
        <div ref={end} className={endClassName} data-lumane="conversation-end" />
      </div>
    </Follow.Provider>
  )
}

type PersonLine = Para & {
  from: 'person'
  /** Said out loud rather than typed. */
  spoken?: boolean
  /** Shown before the words, such as a microphone for a spoken question. */
  icon?: ReactNode
}
type AssistantLine = Div & { from: 'assistant' }

/**
 * One line of the conversation. A person's line tells screen readers whether it was asked or
 * said; an answer is a block the app fills, with any changes waiting for approval inside it.
 */
export function Message(props: PersonLine | AssistantLine) {
  const words = useWords()
  if (props.from === 'person') {
    const { from, spoken, icon, children, ...rest } = props
    return (
      <p {...rest} data-lumane="message" data-from={from} data-spoken={spoken ? '' : undefined}>
        {icon}
        <span style={hidden}>{spoken ? words.youSaid : words.youAsked}</span>
        {children}
      </p>
    )
  }
  const { from, children, ...rest } = props
  return (
    <div {...rest} data-lumane="message" data-from={from}>
      {children}
    </div>
  )
}

/** Shown while an answer is on its way, and read out once. */
export function Thinking({ children, ...props }: Para) {
  const words = useWords()
  return (
    <p role="status" {...props} data-lumane="thinking">
      {children ?? words.thinking}
    </p>
  )
}

/** A ready-made question: one tap asks it. */
export function Starter({
  text,
  onAsk,
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  text: string
  onAsk: (text: string) => void
  asChild?: boolean
}) {
  return (
    <PartButton
      asChild={asChild}
      ours={{ onClick: () => onAsk(text), 'data-lumane': 'starter' }}
      props={props}
      fallback={text}
    />
  )
}
