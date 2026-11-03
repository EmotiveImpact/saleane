import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Client } from '../domain/model'
import type { SavedReply } from '../domain/inboxSchema'
import { textNumber } from '../domain/reminders'
import { Button, Select, Tip } from '../design'
import { quickReplies } from './quickReplies'
import './inboxReply.css'

type Channel = 'email' | 'sms'
export type ReplyDraft = { channel: Channel; subject: string; body: string }

/** The tallest the words grow before they scroll inside the box, so the thread keeps its room. */
const GROW_LIMIT = 280

/**
 * The reply box at the foot of an open conversation, always in reach. A reply is saved as a
 * draft in the conversation, where it waits for approval like any other message: nothing is sent
 * from here. The studio's saved replies sit above it as chips to start from.
 *
 * Stage 6: it stays one short line until someone starts to reply, so the conversation keeps the
 * room on a desk-sized screen. Once it is in use, the saved replies and the note about drafts
 * appear and the words grow with what is written, up to a limit.
 */
export function InboxReply({
  client,
  answering,
  textsOff = false,
  lastChannel,
  saved,
  studio,
  allowed,
  pending,
  sends,
  live,
  canEditSaved,
  onSave,
}: {
  client: Client
  /** The guest wrote last, so this answers them. */
  answering: boolean
  /** Stage 1: they asked for no texts, or their number replied STOP, so nothing goes by text. */
  textsOff?: boolean
  /** How the guest last wrote, to answer the same way. */
  lastChannel?: Channel
  saved: SavedReply[]
  studio: string
  allowed: boolean
  pending: boolean
  /** The studio sends approved messages (its own studio on the server), and sending is live. */
  sends: boolean
  live: boolean
  canEditSaved: boolean
  onSave: (draft: ReplyDraft) => Promise<{ ok: boolean; error?: string }>
}) {
  const textId = useId()
  const helpId = useId()
  const box = useRef<HTMLTextAreaElement>(null)
  const canText = !!textNumber(client.phone) && !textsOff
  const hasEmail = !!client.email.trim()
  const [channel, setChannel] = useState<Channel>(() =>
    lastChannel === 'sms' && canText
      ? 'sms'
      : lastChannel === 'email' || hasEmail || !canText
        ? 'email'
        : 'sms',
  )
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [using, setUsing] = useState(false)
  const open = using || !!text.trim() || !!error
  const first = client.name.split(' ')[0]
  const subject = `${answering ? 'A reply' : 'A note'} from ${studio}`.slice(0, 150)
  const chips = quickReplies(saved)
  const limit = channel === 'sms' ? 640 : 3000
  // The words grow with what is written, up to GROW_LIMIT, then scroll inside the box.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = ''
    if (!open || !text) return
    const tall = el.scrollHeight + el.offsetHeight - el.clientHeight
    if (tall > el.offsetHeight) el.style.height = `${Math.min(tall, GROW_LIMIT)}px`
  }, [text, open])

  function use(body: string) {
    setNotice('')
    setError('')
    const next = text.trim() ? `${text.trimEnd()}\n\n${body}` : body
    setText(next.slice(0, limit))
    // Back to the words, to change them before saving; the caret follows the new text.
    box.current?.focus()
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    setError('')
    if (!text.trim()) {
      setError(`Write a reply to ${first} first, or start from a saved reply.`)
      box.current?.focus()
      return
    }
    const result = await onSave({ channel, subject, body: text.trim() })
    if (!result.ok) {
      if (result.error) setError(result.error)
      return
    }
    setText('')
    setNotice('Draft saved in the conversation, waiting for approval. Nothing has been sent.')
  }

  const rule = !sends
    ? 'Replies are saved as drafts for approval. Nothing leaves this sample studio.'
    : live
      ? 'Replies are saved as drafts. Only approved messages are sent.'
      : 'Replies are saved as drafts for approval. Test mode sends nothing.'

  return (
    <form
      className={`inbox-reply ${open ? 'is-open' : 'is-compact'}`}
      onSubmit={(event) => void submit(event)}
      aria-busy={pending}
      onFocus={() => setUsing(true)}
      onBlur={(event) => {
        // Folds back to one line only when the person has left the box with nothing written.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setUsing(false)
      }}
    >
      <div className="inbox-reply-head">
        <label htmlFor={textId}>Reply to {first}</label>
        <label className="inbox-reply-channel">
          <span>Reply by</span>
          <Select
            value={channel}
            disabled={!allowed}
            onChange={(event) => setChannel(event.target.value as Channel)}
          >
            <option value="email">Email</option>
            <option value="sms" disabled={!canText}>
              Text{canText ? '' : textsOff ? ' (texts are off)' : ' (no mobile number)'}
            </option>
          </Select>
        </label>
      </div>
      {allowed && (
        <div
          className="inbox-quick"
          role="group"
          aria-label="Saved replies"
          // A chip keeps the focus in the words, so the box stays open while it is chosen.
          onMouseDown={(event) => event.preventDefault()}
        >
          {chips.map((reply) => (
            <Tip key={reply.id} label={reply.body}>
              <button type="button" className="inbox-quick-chip" onClick={() => use(reply.body)}>
                {reply.name}
              </button>
            </Tip>
          ))}
          {canEditSaved && (
            <Link className="inbox-quick-edit" to="/settings?section=messages">
              Edit saved replies
            </Link>
          )}
        </div>
      )}
      <div className="inbox-reply-write">
        <textarea
          id={textId}
          ref={box}
          rows={open ? 3 : 1}
          maxLength={limit}
          value={text}
          disabled={!allowed}
          aria-describedby={helpId}
          placeholder={`Write to ${first}…`}
          onChange={(event) => {
            setText(event.target.value)
            if (error) setError('')
          }}
        />
        <div className="inbox-reply-foot">
          <p id={helpId}>
            {rule}
            {channel === 'email' ? ` By email, with the subject “${subject}”.` : ''}
            {channel === 'sms' && text.length > 160
              ? ` ${text.length} characters, so it goes as more than one text.`
              : ''}
          </p>
          <Button type="submit" disabled={!allowed || pending}>
            {pending ? 'Saving…' : 'Save as draft'}
          </Button>
        </div>
      </div>
      {error && (
        <p className="inbox-reply-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="inbox-reply-notice" role="status">
          {notice}
        </p>
      )}
    </form>
  )
}
