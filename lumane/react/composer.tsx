import { createContext, useContext, useId, useState } from 'react'
import type {
  ButtonHTMLAttributes,
  FormEvent,
  FormHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
} from 'react'
import { PartButton, hidden } from './slot'
import { useWords } from './words'

type Box = { text: string; setText: (text: string) => void; busy: boolean; inputId: string }
const BoxContext = createContext<Box | null>(null)

/** The question box's text and whether an answer is on its way, for an app's own controls. */
export function useComposer() {
  const box = useContext(BoxContext)
  if (!box) throw new Error('useComposer belongs inside a Composer.')
  return box
}

/**
 * Where the person types a question. `onAsk` gets the question, trimmed, and the box empties.
 * Nothing is asked while `busy` (an answer is on its way) or while the box is empty. The text
 * is kept here unless the app holds it itself with `value` and `onValueChange`.
 */
function Root({
  onAsk,
  busy = false,
  value,
  onValueChange,
  inputId,
  children,
  ...props
}: Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> & {
  onAsk: (question: string) => void
  busy?: boolean
  value?: string
  onValueChange?: (text: string) => void
  /** The question box's id, when the app needs a fixed one. */
  inputId?: string
}) {
  const [own, setOwn] = useState('')
  const made = useId()
  const text = value ?? own
  const setText = (next: string) => {
    if (value === undefined) setOwn(next)
    onValueChange?.(next)
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const question = text.trim()
    if (!question || busy) return
    setText('')
    onAsk(question)
  }
  return (
    <BoxContext.Provider value={{ text, setText, busy, inputId: inputId ?? made }}>
      <form {...props} onSubmit={submit} data-lumane="composer">
        {children}
      </form>
    </BoxContext.Provider>
  )
}

/** The box's name for screen readers. Hidden on screen unless `visible`. */
function Label({
  visible = false,
  children,
  style,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { visible?: boolean }) {
  const { inputId } = useComposer()
  const words = useWords()
  return (
    <label
      htmlFor={inputId}
      {...props}
      style={visible ? style : { ...hidden, ...style }}
      data-lumane="composer-label"
    >
      {children ?? words.question}
    </label>
  )
}

function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { text, setText, inputId } = useComposer()
  const words = useWords()
  return (
    <input
      id={inputId}
      maxLength={500}
      autoComplete="off"
      placeholder={words.placeholder}
      {...props}
      value={text}
      onChange={(event) => {
        props.onChange?.(event)
        setText(event.target.value)
      }}
      data-lumane="composer-input"
    />
  )
}

/** Sends the question. It cannot be pressed while the box is empty or an answer is coming. */
function Send({
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const { text, busy } = useComposer()
  const words = useWords()
  return (
    <PartButton
      asChild={asChild}
      props={props}
      ours={{ type: 'submit', disabled: busy || !text.trim(), 'data-lumane': 'send' }}
      fallback={words.send}
    />
  )
}

/** The question box's parts: `Root` (the form), `Label`, `Input` and `Send`. */
export const Composer = { Root, Label, Input, Send }
