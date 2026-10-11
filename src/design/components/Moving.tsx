import { createContext, useContext } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ComponentPropsWithRef, ElementType, ReactNode } from 'react'
import { calm, leave, useMotionAllowed } from '../motion'

/** Whether a row sits in a moving list. A row anywhere else never moves, even as a page opens. */
const Listed = createContext(false)

/**
 * A list that changes while someone is looking at it: a visit arrives on Today, a filter hides
 * what is done, a request on the waitlist is offered. Rows already there when the page opens
 * simply appear; after that a new row settles in, a row that goes fades out, and the rows around
 * it slide into their new places instead of jumping. Rows are `MovingRow`s with their own keys.
 */
export function MovingList({ children }: { children: ReactNode }) {
  const moving = useMotionAllowed()
  return moving ? (
    <Listed.Provider value>
      <AnimatePresence initial={false} mode="popLayout">
        {children}
      </AnimatePresence>
    </Listed.Provider>
  ) : (
    <>{children}</>
  )
}

const rows = {
  div: motion.div,
  li: motion.li,
  button: motion.button,
  article: motion.article,
}
type Row = keyof typeof rows

/** One row of a `MovingList`, drawn as a `div` unless `as` says otherwise. */
export function MovingRow<T extends Row = 'div'>({
  as,
  ...props
}: { as?: T } & ComponentPropsWithRef<T>) {
  const moving = useContext(Listed)
  const tag = as ?? 'div'
  if (!moving) {
    const Plain = tag as ElementType
    return <Plain {...props} />
  }
  // Motion's own props replace a few of React's event types, so the row is passed through as is.
  const Moves = rows[tag] as unknown as ElementType
  return (
    <Moves
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: leave }}
      transition={calm}
      {...props}
    />
  )
}
