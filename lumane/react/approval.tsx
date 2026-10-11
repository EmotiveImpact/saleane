import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { useKeepInView } from './conversation'
import { PartButton } from './slot'
import { useWords } from './words'

/**
 * Where a change the assistant prepared stands. It waits for a person; while their answer is
 * being saved nothing else can be tapped; it shows as done only once the app says it has saved
 * the change, and as left alone when they said no.
 */
export type ApprovalState = 'waiting' | 'saving' | 'done' | 'declined'
/** What a decision can end on. `waiting` lets the person try again. */
export type Decided = Exclude<ApprovalState, 'saving'>

type Card = {
  state: ApprovalState
  /** What the person tapped while it is saving: true for approve. */
  choice: boolean | null
  decide: (approve: boolean) => Promise<void>
}
const CardContext = createContext<Card | null>(null)

/** The card's state and its `decide`, for an app building its own controls inside the card. */
export function useApproval() {
  const card = useContext(CardContext)
  if (!card) throw new Error('useApproval belongs inside an ApprovalCard.')
  return card
}

/**
 * One change waiting for a person's yes. `onDecide` is the app's own path: it saves an approved
 * change through the app's permission checks and says what to show next. The card makes sure
 * of the rest: one answer at a time, however fast the taps; a failure goes back to waiting,
 * never to done; and a "not now" never shows as done.
 */
function Root({
  onDecide,
  initial = 'waiting',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  onDecide: (approve: boolean) => Promise<Decided> | Decided
  /** A change already decided elsewhere, such as in another tab. */
  initial?: Decided
}) {
  const [state, setState] = useState<ApprovalState>(initial)
  const [choice, setChoice] = useState<boolean | null>(null)
  // Read and set at once, so a second tap before the screen updates is ignored.
  const now = useRef<ApprovalState>(initial)
  const shown = useRef(true)
  useEffect(() => {
    shown.current = true
    return () => {
      shown.current = false
    }
  }, [])
  const decide = useCallback(
    async (approve: boolean) => {
      if (now.current !== 'waiting') return
      now.current = 'saving'
      setState('saving')
      setChoice(approve)
      let next: Decided
      try {
        next = await onDecide(approve)
      } catch {
        next = 'waiting'
      }
      if (!approve && next === 'done') next = 'declined'
      now.current = next
      if (!shown.current) return
      setState(next)
      setChoice(null)
    },
    [onDecide],
  )
  // The card grows or shrinks as it changes, so the conversation keeps its newest line in view.
  const keepInView = useKeepInView()
  const last = useRef(state)
  useEffect(() => {
    if (last.current === state) return
    last.current = state
    keepInView?.()
  }, [state, keepInView])
  const card = useMemo(() => ({ state, choice, decide }), [state, choice, decide])
  return (
    <CardContext.Provider value={card}>
      <div {...props} data-lumane="approval" data-state={state}>
        {children}
      </div>
    </CardContext.Provider>
  )
}

const open = (state: ApprovalState) => state === 'waiting' || state === 'saving'

/** The change in one plain sentence, or a few lines of detail. */
function Summary({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p {...props} data-lumane="approval-summary">
      {children}
    </p>
  )
}

/** The change's details, a label and a value on each row, such as "From" and "Wed 11:00". */
function Details({
  rows,
  ...props
}: HTMLAttributes<HTMLDListElement> & { rows: { label: string; value: string }[] }) {
  if (!rows.length) return null
  return (
    <dl {...props} data-lumane="approval-details">
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'contents' }}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A short line saying it waits for the person, shown until they decide. */
function Label({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const { state } = useApproval()
  const words = useWords()
  if (!open(state)) return null
  return (
    <p {...props} data-lumane="approval-label">
      {children ?? words.waiting}
    </p>
  )
}

/** Holds Approve and Not now, until the person has decided. */
function Actions({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const { state } = useApproval()
  if (!open(state)) return null
  return (
    <div {...props} data-lumane="approval-actions">
      {children}
    </div>
  )
}

type ActionProps = ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }

function Approve({ asChild, ...props }: ActionProps) {
  return <Choice approve asChild={asChild} props={props} />
}

function Decline({ asChild, ...props }: ActionProps) {
  return <Choice approve={false} asChild={asChild} props={props} />
}

function Choice({
  approve,
  asChild,
  props,
}: {
  approve: boolean
  asChild?: boolean
  props: ButtonHTMLAttributes<HTMLButtonElement>
}) {
  const { state, choice, decide } = useApproval()
  const words = useWords()
  return (
    <PartButton
      asChild={asChild}
      props={props}
      ours={{
        disabled: state === 'saving',
        'aria-busy': state === 'saving' && choice === approve ? true : undefined,
        onClick: () => void decide(approve),
        'data-lumane': approve ? 'approve' : 'decline',
      }}
      fallback={approve ? words.approve : words.decline}
    />
  )
}

/** What came of it, read out once: done after saving, or left as it was. */
function Outcome({
  done,
  declined,
  ...props
}: Omit<HTMLAttributes<HTMLParagraphElement>, 'children'> & {
  done?: ReactNode
  declined?: ReactNode
}) {
  const { state } = useApproval()
  const words = useWords()
  if (open(state)) return null
  return (
    <p role="status" {...props} data-lumane="approval-outcome" data-state={state}>
      {state === 'done' ? (done ?? words.done) : (declined ?? words.declined)}
    </p>
  )
}

/**
 * The approval card's parts. Each app lays them out and dresses them in its own design:
 * `Root` holds one change, `Summary` says what it is and `Details` lists it, `Label` says it
 * is waiting, `Actions`
 * holds `Approve` and `Decline`, and `Outcome` says what came of it.
 */
export const ApprovalCard = { Root, Summary, Details, Label, Actions, Approve, Decline, Outcome }
