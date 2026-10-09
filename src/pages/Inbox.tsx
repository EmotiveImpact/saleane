import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, FilePenLine, MailWarning, MessageSquarePlus, Plus, Search } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../state/context'
import { operations, can } from '../domain/operations'
import { dateLabel } from '../domain/format'
import { Avatar, Button, ErrorMessage, Modal, PageHeader, SegmentedControl } from '../design'
import type { BusinessState } from '../domain/model'
import { useInboxView } from '../state/inboxView'
import { isWaitlistOffer, staleOffer } from '../domain/waitlist'
import { conversations, savedReplies, snippet, socialWindowEnds } from '../domain/inbox'
import type { Conversation, Delivery, ThreadItem } from '../domain/inbox'
import { SOCIAL_ANSWER_LIMIT, isSocialChannel, noteWays, socialLabel } from '../domain/inboxSchema'
import type { Reply, SocialChannel } from '../domain/inboxSchema'
import { numberLabel } from '../domain/missedCalls'
import { outboxStatusLabel, textNumber } from '../domain/reminders'
import { SentMessages } from '../components/AppointmentMessages'
import { kindLabel, useSentMessages } from '../components/sentMessages'
import { useClock } from '../state/clock'
import '../components/management.css'

type QueuedMessage = ReturnType<typeof operations>['messages'][number]
type Filter = 'all' | 'unread' | 'draft'

const statusLabel = {
  draft: 'To approve',
  queued: 'Queued, not sent',
  suppressed: 'Not sent',
} as const

/** The guest's latest message on Instagram, Facebook or WhatsApp in a conversation, if any. */
function latestSocial(c: Conversation) {
  const found = [...c.items]
    .reverse()
    .find((item) => item.kind === 'reply' && isSocialChannel(item.reply.channel))
  return found?.kind === 'reply' ? found.reply : undefined
}

/** Who a conversation is with: a client's name, or the address or number that wrote in. */
function who(state: BusinessState, c: Conversation) {
  const client = c.clientId ? state.clients.find((x) => x.id === c.clientId) : undefined
  if (client) return client.name
  if (c.clientId) return 'Client no longer available'
  const social = latestSocial(c)
  // Instagram and Facebook give only an id; WhatsApp gives a name and a number.
  if (social?.name) return social.name
  if (social && social.channel !== 'whatsapp')
    return `Someone on ${socialLabel[social.channel as SocialChannel]}`
  return c.from?.startsWith('+') ? numberLabel(c.from) : (c.from ?? 'Unknown sender')
}

function itemText(item: ThreadItem) {
  if (item.kind === 'reply') return item.reply.body
  if (item.kind === 'message') return item.message.body
  if (item.kind === 'answer') return item.answer.body
  return `${kindLabel[item.sent.kind as keyof typeof kindLabel] ?? 'Message'}: ${item.sent.body}`
}

function matches(state: BusinessState, c: Conversation, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const words = c.items.map((item) =>
    item.kind === 'message' ? `${item.message.subject} ${item.message.body}` : itemText(item),
  )
  return `${who(state, c)} ${c.from ?? ''} ${words.join(' ')}`.toLowerCase().includes(q)
}

export function Inbox() {
  const clock = useClock()
  const { state, commit, blocked, role, session, mode } = useStore()
  const sent = useSentMessages()
  const live = !!sent.reply && (sent.reply.providers.email.live || sent.reply.providers.sms.live)
  const [filter, setFilter] = useState<Filter>('all')
  // "Message" on a visit opens a draft here, with its client and the visit already chosen.
  const [params, setParams] = useSearchParams()
  const writeTo = state.clients.find((c) => c.id === params.get('write'))
  const [composing, setComposing] = useState(() => !!writeTo && can(role, 'message'))
  const [editingId, setEditingId] = useState<string | undefined>()
  const [clientId, setClientId] = useState(writeTo?.id ?? state.clients[0]?.id ?? '')
  const [purpose, setPurpose] = useState<'appointment' | 'marketing'>('appointment')
  const [channel, setChannel] = useState<'email' | 'sms'>(() =>
    !writeTo || writeTo.email.trim() || !textNumber(writeTo.phone) ? 'email' : 'sms',
  )
  const [appointmentId, setAppointmentId] = useState(
    () =>
      state.appointments.find((a) => a.id === params.get('visit') && a.clientId === writeTo?.id)
        ?.id ?? '',
  )
  useEffect(() => {
    // The request is used once, so going back or reloading shows the inbox as it was.
    if (params.has('write') || params.has('visit')) setParams({}, { replace: true })
  }, [params, setParams])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const view = useInboxView(session?.user.id)
  const [selectedKey, setSelectedKey] = useState<string | undefined>(
    writeTo ? `client:${writeTo.id}` : undefined,
  )
  // On a phone the two-column view shows the list first, then one conversation.
  const [opened, setOpened] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [noting, setNoting] = useState(false)
  const [linkTo, setLinkTo] = useState('')
  const all = conversations(state, sent.reply?.messages ?? [])
  const shown = all
    .filter((c) => filter === 'all' || (filter === 'unread' ? c.unread > 0 : c.drafts > 0))
    .filter((c) => matches(state, c, query))
  const listed = shown.find((c) => c.key === selectedKey) ?? shown[0]
  // The list comes from the studio's newest messages; an open conversation reads that guest's own.
  const own = useSentMessages(listed?.clientId, { limit: 200, skip: !listed?.clientId })
  const selected =
    listed &&
    (own.reply
      ? conversations(state, [
          ...own.reply.messages,
          ...(sent.reply?.messages ?? []).filter(
            (row) => !own.reply!.messages.some((mine) => mine.id === row.id),
          ),
        ]).find((c) => c.key === listed.key)
      : undefined)
  const current = selected ?? listed
  const unread = all.reduce((n, c) => n + c.unread, 0)
  const drafts = all.reduce((n, c) => n + c.drafts, 0)
  const allowedDraft = can(role, 'message') && !blocked
  const allowedQueue = can(role, 'message.queue') && !blocked
  const client = state.clients.find((item) => item.id === clientId)
  const canText = !!client && !!textNumber(client.phone)
  const saved = savedReplies(state)
  // Sample studios never send; a studio of its own on the server sends what is approved.
  const sends = mode === 'server' && operations(state).mode === 'local'
  const approveLabel = sends ? 'Approve and send' : 'Approve and queue'

  async function act(key: string, run: () => Promise<boolean>, done?: string) {
    if (pending) return false
    setPending(key)
    setError('')
    setNotice('')
    try {
      const ok = await run()
      if (ok && done) setNotice(done)
      return ok
    } catch {
      setError('That could not be saved. Your writing is still here; try again.')
      return false
    } finally {
      setPending('')
    }
  }
  const attempt = async (command: Parameters<typeof commit>[0]) => {
    const result = await commit(command)
    if (!result.ok) setError(result.error)
    return result
  }

  function startDraft(forClient?: string) {
    setError('')
    setNotice('')
    setEditingId(undefined)
    setSubject('')
    setBody('')
    setAppointmentId('')
    setPurpose('appointment')
    if (forClient) setClientId(forClient)
    const c = state.clients.find((x) => x.id === (forClient ?? clientId))
    setChannel(c?.email.trim() || !c || !textNumber(c.phone) ? 'email' : 'sms')
    setComposing(true)
  }
  function close() {
    if (!pending) {
      setComposing(false)
      setError('')
    }
  }
  /** Saves the draft, and with `approve` sends it on for the outbox straight away. */
  async function save(approve: boolean) {
    if (!allowedDraft || (approve && !allowedQueue)) return
    const ok = await act(
      'draft',
      async () => {
        const result = await attempt({
          type: 'message',
          id: editingId,
          input: {
            clientId,
            appointmentId: appointmentId || undefined,
            purpose,
            channel,
            // A text has no subject line; one is kept so the studio can find it later.
            subject: channel === 'sms' ? subject.trim() || snippet(body, 60) || 'Text' : subject,
            body,
          },
          ...(approve ? { approve: true } : {}),
        })
        if (!result.ok) return false
        return true
      },
      approve
        ? sends
          ? live
            ? 'Approved. It goes out shortly; its status shows in the conversation.'
            : 'Approved. Test mode records it as it would be sent. Nothing was sent.'
          : 'Approved and queued. Sending is not connected in this sample, so nothing was sent.'
        : 'Draft saved. Nothing has been sent.',
    )
    if (ok) {
      setComposing(false)
      setEditingId(undefined)
      setSubject('')
      setBody('')
      setAppointmentId('')
      setFilter('all')
      setSelectedKey(`client:${clientId}`)
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await save(false)
  }
  const queue = (messageId: string) =>
    act(
      messageId,
      async () => (await attempt({ type: 'message-queue', messageId })).ok,
      sends
        ? 'Approved. Its status shows in the conversation.'
        : 'Approved and queued. Sending is not connected in this sample, so nothing was sent.',
    )
  const markRead = (c: Conversation) => {
    const ids = c.items
      .filter((i): i is Extract<ThreadItem, { kind: 'reply' }> => i.kind === 'reply')
      .filter((i) => !i.reply.readAt)
      .map((i) => i.reply.id)
    if (!ids.length || !allowedDraft) return
    void act(
      `read-${c.key}`,
      async () => (await attempt({ type: 'replies-read', replyIds: ids })).ok,
    )
  }
  function open(c: Conversation) {
    setSelectedKey(c.key)
    setOpened(true)
    setLinkTo('')
    if (view === 'panel') setPanelOpen(true)
    if (c.unread) markRead(c)
  }
  function edit(message: QueuedMessage) {
    setEditingId(message.id)
    setClientId(message.clientId)
    setPurpose(message.purpose)
    setChannel(message.channel ?? 'email')
    setAppointmentId(message.appointmentId ?? '')
    setSubject(message.subject)
    setBody(message.body)
    setError('')
    setPanelOpen(false)
    setComposing(true)
  }
  const when = (iso: string) =>
    new Intl.DateTimeFormat(state.organisation.locale, {
      day: 'numeric',
      month: 'short',
      timeZone: state.organisation.timeZone,
    }).format(new Date(iso))
  const at = (iso: string) =>
    new Intl.DateTimeFormat(state.organisation.locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: state.organisation.timeZone,
    }).format(new Date(iso))

  /** What became of a message the studio wrote, in honest words. */
  function messageStatus(message: QueuedMessage, delivery?: Delivery) {
    if (message.status === 'draft') return 'Draft, waiting for you'
    if (message.status === 'suppressed') return 'Not sent'
    if (!message.approvedAt) return statusLabel.queued
    if (delivery) return outboxStatusLabel[delivery.status]
    return sends
      ? 'Approved, waiting to go'
      : 'Approved. Sending is not connected in this sample, so nothing was sent.'
  }
  function replyLine(reply: Reply) {
    if (reply.channel === 'desk')
      return `Noted by ${reply.actor} · ${reply.from === 'elsewhere' ? 'answered another way' : `by ${reply.from}`}`
    const from = reply.from.startsWith('+') ? numberLabel(reply.from) : reply.from
    if (reply.channel === 'chat') return `Left with the AI receptionist · answer on ${from}`
    if (isSocialChannel(reply.channel))
      return `${socialLabel[reply.channel]} message${reply.channel === 'whatsapp' ? ` from ${from}` : ''}`
    return `${reply.channel === 'sms' ? 'Text' : 'Email'} from ${from}`
  }

  function conversationView(c: Conversation) {
    const recipient = c.clientId ? state.clients.find((item) => item.id === c.clientId) : undefined
    const name = who(state, c)
    const unreadIds = c.items.filter((i) => i.kind === 'reply' && !i.reply.readAt).length
    const social = latestSocial(c)
    return (
      <>
        <header className="inbox-pane-header">
          <Avatar identity={c.clientId ?? c.from} name={c.clientId ? name : '?'} />
          <div>
            <h2 className="inbox-name">{name}</h2>
            <p>
              {recipient
                ? [recipient.email, recipient.phone].filter(Boolean).join(' · ')
                : 'Not matched to a client yet.'}
            </p>
          </div>
          {recipient && (
            <Link className="button button-secondary" to={`/clients/${recipient.id}`}>
              Profile
            </Link>
          )}
        </header>
        <ol className="inbox-thread" aria-label={`Conversation with ${name}`}>
          {c.items.map((item) => {
            if (item.kind === 'reply')
              return (
                <li
                  key={item.reply.id}
                  className={`inbox-bubble inbox-bubble-theirs ${item.reply.readAt ? '' : 'is-unread'}`}
                >
                  <small>
                    {replyLine(item.reply)} · {at(item.reply.receivedAt)}
                    {!item.reply.readAt && ' · new'}
                  </small>
                  <p>{item.reply.body}</p>
                </li>
              )
            if (item.kind === 'answer')
              return (
                <li key={item.answer.id} className="inbox-bubble inbox-bubble-ours">
                  <small>
                    Answered on {socialLabel[item.answer.channel]} by {item.answer.actor} ·{' '}
                    {at(item.answer.answeredAt)} ·{' '}
                    {item.delivery
                      ? outboxStatusLabel[item.delivery.status]
                      : sends
                        ? 'Waiting to go'
                        : 'Not sent: nothing leaves this sample studio'}
                  </small>
                  <p>{item.answer.body}</p>
                  {item.delivery?.detail && <p className="subtle">{item.delivery.detail}</p>}
                </li>
              )
            if (item.kind === 'sent')
              return (
                <li key={item.sent.id} className="inbox-bubble inbox-bubble-ours is-automatic">
                  <small>
                    {kindLabel[item.sent.kind as keyof typeof kindLabel] ?? 'Message'} ·{' '}
                    {item.sent.channel === 'email'
                      ? 'email'
                      : isSocialChannel(item.sent.channel)
                        ? socialLabel[item.sent.channel]
                        : 'text'}{' '}
                    · {at(item.sent.createdAt)} · {outboxStatusLabel[item.sent.status]}
                  </small>
                  {item.sent.subject && <strong>{item.sent.subject}</strong>}
                  <p>{item.sent.body}</p>
                </li>
              )
            const message = item.message
            const stale = message.status === 'draft' ? staleOffer(state, message.id, clock) : null
            const missingConsent = message.purpose === 'marketing' && !recipient?.marketingConsent
            const visit = state.appointments.find((a) => a.id === message.appointmentId)
            return (
              <li
                key={message.id}
                className={`inbox-bubble inbox-bubble-ours is-${message.status}`}
              >
                <small>
                  {messageStatus(message, item.delivery)} ·{' '}
                  {message.purpose === 'marketing'
                    ? 'email news'
                    : message.channel === 'sms'
                      ? 'text'
                      : 'email'}
                  {visit && ` about ${dateLabel(visit.date, state.organisation.locale)}`} · saved{' '}
                  {when(message.createdAt)} by {message.actor}
                </small>
                {message.channel !== 'sms' && <strong>{message.subject}</strong>}
                <p>{message.body}</p>
                {item.delivery?.detail && <p className="subtle">{item.delivery.detail}</p>}
                {message.status === 'draft' && (
                  <div className="inbox-bubble-actions">
                    {missingConsent && (
                      <p className="ops-help">
                        Email news permission is not recorded. Review consent before approving.
                      </p>
                    )}
                    {stale && <p className="ops-help">{stale} This offer will not be sent.</p>}
                    {!stale && (
                      <Button
                        disabled={!allowedQueue || !!pending || missingConsent}
                        onClick={() => {
                          void queue(message.id)
                        }}
                      >
                        {pending === message.id ? 'Approving…' : approveLabel}
                      </Button>
                    )}
                    {!isWaitlistOffer(state, message.id) && (
                      <Button
                        variant="secondary"
                        aria-label={`Edit draft ${message.subject}`}
                        disabled={!allowedDraft || !!pending}
                        onClick={() => edit(message)}
                      >
                        Edit<span className="sr-only"> draft {message.subject}</span>
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        {social && (
          <SocialAnswer
            key={`${c.key}:${social.id}`}
            app={socialLabel[social.channel as SocialChannel]}
            ends={socialWindowEnds(
              state,
              social.channel as SocialChannel,
              social.from,
              social.account,
            )}
            now={Date.parse(clock)}
            allowed={allowedQueue}
            pending={!!pending}
            onSend={(words) =>
              act(
                'answer',
                async () =>
                  (await attempt({ type: 'social-answer', replyId: social.id, body: words })).ok,
                sends
                  ? 'Answer saved. It goes out on the next send.'
                  : 'Answer saved. Nothing leaves this sample studio.',
              )
            }
          />
        )}
        <footer className="inbox-pane-actions">
          {recipient ? (
            <>
              <Button disabled={!allowedDraft} onClick={() => startDraft(recipient.id)}>
                <MessageSquarePlus size={16} aria-hidden="true" /> Write to{' '}
                {recipient.name.split(' ')[0]}
              </Button>
              <Button
                variant="secondary"
                disabled={!allowedDraft}
                onClick={() => {
                  setClientId(recipient.id)
                  setNoting(true)
                  setError('')
                }}
              >
                Note a reply
              </Button>
            </>
          ) : (
            <form
              className="inbox-link"
              onSubmit={(event) => {
                event.preventDefault()
                const first = c.items.find((i) => i.kind === 'reply')
                if (!first || first.kind !== 'reply' || !linkTo) return
                void act(
                  'link',
                  async () =>
                    (
                      await attempt({
                        type: 'reply-link',
                        replyId: first.reply.id,
                        clientId: linkTo,
                      })
                    ).ok,
                  'Matched. The conversation is now with the client.',
                ).then((ok) => ok && setSelectedKey(`client:${linkTo}`))
              }}
            >
              <label>
                This is
                <select value={linkTo} onChange={(e) => setLinkTo(e.target.value)} required>
                  <option value="">Choose a client</option>
                  {state.clients.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="secondary" disabled={!allowedDraft || !!pending}>
                Match to this client
              </Button>
            </form>
          )}
          {unreadIds > 0 && (
            <Button
              variant="quiet"
              disabled={!allowedDraft || !!pending}
              onClick={() => markRead(c)}
            >
              Mark as read
            </Button>
          )}
        </footer>
      </>
    )
  }

  const banner = !sends
    ? {
        title: 'Nothing leaves this sample studio.',
        text: 'Approved messages wait in the queue and replies here are examples. In a studio of your own, approved messages go out by email or text and guests’ replies arrive here.',
      }
    : live
      ? {
          title: 'Approved messages go out by email or text.',
          text: 'Guests’ replies arrive here once your email address and text line are connected. Each message shows what the provider has told us.',
        }
      : {
          title: 'Test mode: nothing is sent.',
          text: 'Approved messages are recorded exactly as they would go, so you can read them. Replies arrive here once email and texting are connected.',
        }

  return (
    <div className="inbox-page">
      <PageHeader
        variant="compact"
        eyebrow="Inbox"
        title="A considered word."
        description="Each guest’s messages in one place: what you wrote, what went out on its own and what they wrote back."
        actions={
          <Button disabled={!allowedDraft || !state.clients.length} onClick={() => startDraft()}>
            <Plus size={17} />
            Write a draft
          </Button>
        }
      />
      <div className="ops-banner">
        <MailWarning size={20} />
        <div>
          <strong>{banner.title}</strong>
          <p>{banner.text}</p>
        </div>
      </div>
      <section className={`surface inbox-card inbox-${view} ${opened ? 'is-open' : ''}`}>
        <div className="inbox-list">
          <div className="inbox-toolbar">
            <SegmentedControl
              label="Conversations to show"
              appearance="chips"
              value={filter}
              onChange={(next) => {
                setFilter(next)
                setOpened(false)
              }}
              options={(['all', 'unread', 'draft'] as const).map((value) => ({
                value,
                label: (
                  <>
                    {{ all: 'All', unread: 'New replies', draft: 'To approve' }[value]}
                    <span className="chip-count">
                      {value === 'all' ? all.length : value === 'unread' ? unread : drafts}
                    </span>
                  </>
                ),
              }))}
            />
            <label className="search-field">
              <Search size={17} />
              <span className="sr-only">Search conversations</span>
              <input
                type="search"
                placeholder="Search conversations"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <ErrorMessage error={composing || noting ? '' : error || sent.error} />
          <p className="ops-save-note" role="status">
            {notice}
          </p>
          <ul className="inbox-rows">
            {shown.map((c) => {
              const isCurrent = view === 'columns' && current?.key === c.key
              const last = c.items[c.items.length - 1]
              const name = who(state, c)
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    className={`inbox-row ${isCurrent ? 'is-selected' : ''} ${c.unread ? 'is-unread' : ''}`}
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => open(c)}
                  >
                    <Avatar small identity={c.clientId ?? c.from} name={c.clientId ? name : '?'} />
                    <span className="inbox-row-text">
                      <span className="inbox-row-top">
                        <strong>{name}</strong>
                        <small>{when(c.lastAt)}</small>
                      </span>
                      <span className="inbox-preview">
                        {last?.kind === 'reply' ? '' : 'You: '}
                        {last ? snippet(itemText(last), 120) : ''}
                      </span>
                    </span>
                    {(c.unread > 0 || c.drafts > 0) && (
                      <span className={`ops-tag ${c.unread ? 'is-new' : ''}`}>
                        {c.unread
                          ? c.unread === 1
                            ? 'New reply'
                            : `${c.unread} new replies`
                          : c.drafts === 1
                            ? 'Draft'
                            : `${c.drafts} drafts`}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          {!shown.length && (
            <div className="ops-no-records">
              <FilePenLine size={27} />
              <h2>
                {filter === 'all' && !query
                  ? 'A little space to be thoughtful.'
                  : 'Nothing in this view.'}
              </h2>
              <p>
                {filter === 'all' && !query
                  ? 'Write to a guest, or wait for a reply. Each guest’s messages gather here as one conversation.'
                  : 'Choose another view or clear the search to see every conversation.'}
              </p>
            </div>
          )}
        </div>
        {view === 'columns' && (
          <div className="inbox-pane" aria-live="polite">
            {current ? (
              <>
                <button type="button" className="inbox-back" onClick={() => setOpened(false)}>
                  <ArrowLeft size={16} />
                  All conversations
                </button>
                {conversationView(current)}
              </>
            ) : (
              <p className="inbox-pane-empty">Choose a conversation to read it here.</p>
            )}
          </div>
        )}
      </section>
      <SentMessages />
      {view === 'panel' && panelOpen && current && (
        <Modal
          open
          placement="side"
          onClose={() => setPanelOpen(false)}
          title={who(state, current)}
          description={
            sends ? 'Each message shows what became of it.' : 'Nothing leaves this sample studio.'
          }
        >
          <div className="inbox-panel">{conversationView(current)}</div>
        </Modal>
      )}
      {noting && client && (
        <NoteReply
          clientName={client.name}
          pending={pending === 'note'}
          error={error}
          onClose={() => {
            if (!pending) {
              setNoting(false)
              setError('')
            }
          }}
          onSave={(how, words) =>
            act(
              'note',
              async () =>
                (await attempt({ type: 'reply-note', clientId: client.id, how, body: words })).ok,
              'Reply noted in the conversation.',
            ).then((ok) => {
              if (ok) setNoting(false)
            })
          }
        />
      )}
      {composing && (
        <Modal
          open
          onClose={close}
          title={editingId ? 'Edit draft' : 'Write a draft'}
          description={
            sends
              ? 'Save it as a draft, or approve it now. Only approved messages are sent.'
              : 'A draft in this sample studio. Nothing will be sent.'
          }
        >
          <form onSubmit={submit} aria-busy={!!pending}>
            <div className="ops-fields">
              <label>
                Client
                <select
                  required
                  disabled={!!editingId}
                  value={clientId}
                  onChange={(event) => {
                    setClientId(event.target.value)
                    setAppointmentId('')
                  }}
                >
                  <option value="" disabled>
                    Choose a client
                  </option>
                  {state.clients.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Purpose
                <select
                  disabled={!!editingId}
                  value={purpose}
                  onChange={(event) => {
                    const next = event.target.value as typeof purpose
                    setPurpose(next)
                    if (next === 'marketing') setChannel('email')
                  }}
                >
                  <option value="appointment">Appointment update</option>
                  <option value="marketing">Marketing</option>
                </select>
              </label>
              <label>
                Send by
                <select
                  value={channel}
                  onChange={(event) => setChannel(event.target.value as typeof channel)}
                >
                  <option value="email">Email</option>
                  <option value="sms" disabled={purpose === 'marketing' || !canText}>
                    Text{!canText ? ' (no mobile number)' : ''}
                  </option>
                </select>
              </label>
              {saved.length > 0 && (
                <label>
                  Start from a saved reply
                  <select
                    value=""
                    onChange={(event) => {
                      const pick = saved.find((r) => r.id === event.target.value)
                      if (pick) setBody(pick.body)
                    }}
                  >
                    <option value="">Choose one</option>
                    {saved.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="ops-wide">
                Related appointment (optional)
                <select
                  value={appointmentId}
                  onChange={(event) => setAppointmentId(event.target.value)}
                >
                  <option value="">No linked appointment</option>
                  {state.appointments
                    .filter((item) => item.clientId === clientId)
                    .slice()
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {dateLabel(item.date, state.organisation.locale)} ·{' '}
                        {state.services.find((service) => service.id === item.serviceId)?.name}
                      </option>
                    ))}
                </select>
              </label>
              {channel === 'email' && (
                <label className="ops-wide">
                  Subject
                  <input
                    required
                    maxLength={150}
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                  />
                </label>
              )}
              <label className="ops-wide">
                Message
                <textarea
                  required
                  maxLength={channel === 'sms' ? 640 : 3000}
                  rows={6}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Write the message you would like your client to receive…"
                />
              </label>
            </div>
            {channel === 'sms' && (
              <p className="ops-editor-note">
                {body.length} characters. A text over 160 characters goes as more than one part.
              </p>
            )}
            {purpose === 'marketing' && (
              <p className="ops-editor-note">
                {client?.marketingConsent
                  ? 'Email news permission is recorded.'
                  : 'Email news permission is not recorded. You can keep a draft, but it cannot be approved.'}
              </p>
            )}
            <ErrorMessage error={error} />
            <div className="ops-actions">
              <Button
                type="submit"
                variant={allowedQueue ? 'secondary' : 'primary'}
                disabled={!!pending || !allowedDraft}
              >
                {pending === 'draft' ? 'Saving…' : 'Save draft'}
              </Button>
              {allowedQueue && (
                <Button
                  disabled={!!pending || (purpose === 'marketing' && !client?.marketingConsent)}
                  onClick={() => {
                    void save(true)
                  }}
                >
                  {approveLabel}
                </Button>
              )}
              <Button variant="quiet" disabled={!!pending} onClick={close}>
                Close
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

/** A reply the guest gave by phone or in person, written down so the conversation is whole. */
function NoteReply({
  clientName,
  pending,
  error,
  onClose,
  onSave,
}: {
  clientName: string
  pending: boolean
  error: string
  onClose: () => void
  onSave: (how: (typeof noteWays)[number], words: string) => void
}) {
  const [how, setHow] = useState<(typeof noteWays)[number]>('phone')
  const [words, setWords] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      title={`Note a reply from ${clientName}`}
      description="For an answer given by phone, in person or another way, so the conversation stays whole. Everyday words only, nothing about health."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSave(how, words)
        }}
      >
        <div className="ops-fields">
          <label>
            They answered
            <select value={how} onChange={(e) => setHow(e.target.value as typeof how)}>
              <option value="phone">By phone</option>
              <option value="in person">In person</option>
              <option value="elsewhere">Another way</option>
            </select>
          </label>
          <label className="ops-wide">
            What they said
            <textarea
              required
              rows={4}
              maxLength={2000}
              value={words}
              onChange={(e) => setWords(e.target.value)}
            />
          </label>
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save note'}
          </Button>
          <Button variant="quiet" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** V4: the team's answer on the app the guest wrote on, within the day the app allows. */
function SocialAnswer({
  app,
  ends,
  now,
  allowed,
  pending,
  onSend,
}: {
  app: string
  ends: number | null
  now: number
  allowed: boolean
  pending: boolean
  onSend: (words: string) => Promise<boolean>
}) {
  const [words, setWords] = useState('')
  const open = !!ends && now < ends
  const hours = ends ? Math.max(1, Math.ceil((ends - now) / 3600000)) : 0
  return (
    <form
      className="inbox-social"
      onSubmit={(event) => {
        event.preventDefault()
        if (!words.trim()) return
        void onSend(words).then((ok) => ok && setWords(''))
      }}
    >
      <label>
        Answer on {app}
        <textarea
          value={words}
          maxLength={SOCIAL_ANSWER_LIMIT}
          rows={3}
          disabled={!open || !allowed || pending}
          onChange={(event) => setWords(event.target.value)}
        />
      </label>
      <p className="ops-help">
        {open
          ? `${app} lets you answer for about ${hours} more ${hours === 1 ? 'hour' : 'hours'}, until a day after their last message.`
          : `${app} lets a business answer only within a day of the guest’s last message. Answer another way, or wait for them to write again.`}
      </p>
      <Button type="submit" disabled={!open || !allowed || pending || !words.trim()}>
        Send on {app}
      </Button>
    </form>
  )
}
