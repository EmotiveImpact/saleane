import { createContext, useContext } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { PartButton } from './slot'
import { useWords } from './words'

/** Minutes and seconds, as a talk's countdown shows them: "4:05". */
export function clock(seconds: number) {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * Starts talking out loud. It cannot be pressed again while a talk is starting. The app does the
 * talking itself, through LUMANE's voice layer on its own server.
 */
export function TalkButton({
  onStart,
  starting = false,
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  onStart: () => void
  starting?: boolean
  asChild?: boolean
}) {
  const words = useWords()
  return (
    <PartButton
      asChild={asChild}
      props={props}
      ours={{
        disabled: starting,
        'aria-busy': starting || undefined,
        onClick: () => onStart(),
        'data-lumane': 'talk-start',
        'data-state': starting ? 'starting' : 'idle',
      }}
      fallback={starting ? words.starting : words.talk}
    />
  )
}

const Ending = createContext(false)

/** The talk under way: shown while talking, with its time left and Stop. */
function Root({
  ending = false,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { ending?: boolean }) {
  return (
    <Ending.Provider value={ending}>
      <div {...props} data-lumane="talk" data-state={ending ? 'ending' : 'talking'}>
        {children}
      </div>
    </Ending.Provider>
  )
}

/** A small dot that shows the line is open. Hidden from screen readers. */
function Dot(props: HTMLAttributes<HTMLSpanElement>) {
  return <span aria-hidden="true" {...props} data-lumane="talk-dot" />
}

/** Says whether it is talking or ending, followed by its children, such as the countdown. */
function Status({
  label,
  children,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { label?: ReactNode }) {
  const ending = useContext(Ending)
  const words = useWords()
  return (
    <p {...props} data-lumane="talk-status">
      {label ?? (ending ? words.ending : words.talking)}
      {children}
    </p>
  )
}

/**
 * The time left, which screen readers can find but are not interrupted by each second. Gone
 * while the talk is ending.
 */
function Countdown({
  seconds,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  seconds: number
  children?: (time: string) => ReactNode
}) {
  const ending = useContext(Ending)
  const words = useWords()
  if (ending) return null
  return (
    <span role="timer" aria-live="off" {...props} data-lumane="talk-countdown">
      {children ? children(clock(seconds)) : ` · ${words.left(clock(seconds))}`}
    </span>
  )
}

/** Hangs up. It cannot be pressed again while the talk is ending. */
function Stop({
  onStop,
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { onStop: () => void; asChild?: boolean }) {
  const ending = useContext(Ending)
  const words = useWords()
  return (
    <PartButton
      asChild={asChild}
      props={props}
      ours={{ disabled: ending, onClick: () => onStop(), 'data-lumane': 'talk-stop' }}
      fallback={words.stop}
    />
  )
}

/** The talk bar's parts: `Root`, `Dot`, `Status`, `Countdown` and `Stop`. */
export const TalkBar = { Root, Dot, Status, Countdown, Stop }
