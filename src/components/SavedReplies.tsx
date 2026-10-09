import { useState } from 'react'
import type { FormEvent } from 'react'
import { useStore } from '../state/context'
import { can } from '../domain/operations'
import { savedReplies } from '../domain/inbox'
import { SAVED_REPLY_LIMIT } from '../domain/inboxSchema'
import type { SavedReply } from '../domain/inboxSchema'
import { Button, ErrorMessage } from '../design'
import { useRun } from './usePayment'

/**
 * V1.5: saved replies, the studio's own short wordings to start an inbox message from. Owners
 * and managers look after them; everyone who writes messages can use them.
 */
export function SavedReplies() {
  const { state, role, blocked } = useStore()
  const list = savedReplies(state)
  const allowed = !blocked && can(role, 'saved-replies')
  const [editing, setEditing] = useState<SavedReply | 'new' | null>(null)
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [done, setDone] = useState('')
  const { run, pending, error, setError } = useRun()
  function start(reply: SavedReply | 'new') {
    setEditing(reply)
    setName(reply === 'new' ? '' : reply.name)
    setBody(reply === 'new' ? '' : reply.body)
    setError('')
    setDone('')
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const ok = await run({
      type: 'saved-reply-save',
      ...(editing && editing !== 'new' ? { id: editing.id } : {}),
      input: { name, body },
    })
    if (ok) {
      setDone(`Saved “${name.trim()}”.`)
      setEditing(null)
    }
  }
  async function remove(reply: SavedReply) {
    setDone('')
    if (await run({ type: 'saved-reply-remove', id: reply.id }))
      setDone(`Removed “${reply.name}”. Messages already written with it are unchanged.`)
  }
  return (
    <section className="surface ops-panel settings-panel" aria-labelledby="saved-replies-title">
      <header>
        <div>
          <h2 id="saved-replies-title">Saved replies</h2>
          <p>
            Short wordings your team can start a message from in the Inbox, so common answers stay
            warm and consistent. Everything can still be changed before it is sent.
          </p>
        </div>
      </header>
      {list.length ? (
        <ul className="saved-replies">
          {list.map((reply) => (
            <li key={reply.id}>
              <div>
                <strong>{reply.name}</strong>
                <p>{reply.body}</p>
              </div>
              {allowed && (
                <div className="saved-reply-actions">
                  <Button variant="quiet" disabled={pending} onClick={() => start(reply)}>
                    Edit<span className="sr-only"> {reply.name}</span>
                  </Button>
                  <Button variant="quiet" disabled={pending} onClick={() => void remove(reply)}>
                    Remove<span className="sr-only"> {reply.name}</span>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="subtle">None yet.</p>
      )}
      {done && <p role="status">{done}</p>}
      {editing ? (
        <form className="saved-reply-form" onSubmit={(e) => void save(e)}>
          <label>
            Name
            <input
              required
              minLength={2}
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Words
            <textarea
              required
              minLength={2}
              maxLength={3000}
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <ErrorMessage error={error} />
          <div className="ops-actions">
            <Button variant="quiet" disabled={pending} onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {!editing && <ErrorMessage error={error} />}
          {allowed && list.length < SAVED_REPLY_LIMIT && (
            <Button variant="secondary" onClick={() => start('new')}>
              Add a saved reply
            </Button>
          )}
        </>
      )}
    </section>
  )
}
