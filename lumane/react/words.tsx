import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

/**
 * The words the parts write themselves, in plain British English. An app changes any of them
 * with `<AskWords>`, and gives its own words as children wherever a part takes them.
 */
export type Words = {
  /** Read out before a typed question, and before a spoken one. */
  youAsked: string
  youSaid: string
  thinking: string
  approve: string
  decline: string
  /** Shown on a change while it waits for a person. */
  waiting: string
  /** Shown once the app has saved an approved change, never before. */
  done: string
  declined: string
  question: string
  placeholder: string
  send: string
  talk: string
  starting: string
  talking: string
  ending: string
  stop: string
  /** A talk's time left, such as "4:05 left". */
  left: (clock: string) => string
}

export const ENGLISH: Words = {
  youAsked: 'You asked: ',
  youSaid: 'You said: ',
  thinking: 'Looking that up…',
  approve: 'Approve',
  decline: 'Not now',
  waiting: 'Waiting for your approval',
  done: 'Done. Saved.',
  declined: 'Left as it was.',
  question: 'Your question',
  placeholder: 'Ask a question…',
  send: 'Ask',
  talk: 'Talk',
  starting: 'Starting…',
  talking: 'Talking',
  ending: 'Ending the talk…',
  stop: 'Stop',
  left: (clock) => `${clock} left`,
}

const WordsContext = createContext<Words>(ENGLISH)

export function AskWords({ words, children }: { words: Partial<Words>; children?: ReactNode }) {
  const outer = useContext(WordsContext)
  return <WordsContext.Provider value={{ ...outer, ...words }}>{children}</WordsContext.Provider>
}

export const useWords = () => useContext(WordsContext)
