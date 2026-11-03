import { useEffect, useRef, useState } from 'react'
import { ApprovalCard } from './approval'
import type { Decided } from './approval'
import { Composer } from './composer'
import { Conversation, Message, Starter, Thinking } from './conversation'
import { LookScope } from './look'
import type { Look } from './look'
import { TalkBar, TalkButton } from './talk'
import { UsageLine } from './usage'
import type { UsageItem } from './usage'
import { AskWords } from './words'
import type { Words } from './words'

/** A change the assistant prepared, as the panel shows it. */
export type AskProposal = {
  id: string
  summary: string
  details?: { label: string; value: string }[]
}

/** One answer: what the assistant said, any changes for approval and the usage after it. */
export type AskAnswer = { text: string; proposals: AskProposal[]; usage?: UsageItem[] }

/**
 * How the panel reaches the app. Each call goes through the app's own server, which runs LUMANE
 * with the app's pack, keeps the conversation and saves an approved change through its own
 * permission checks. `decide` says what the card shows next, and shows done only once saved.
 */
export type AskTransport = {
  ask: (question: string) => Promise<AskAnswer>
  decide: (id: string, approve: boolean) => Promise<Decided>
  /** Talking out loud, when the app offers it: start gives the seconds the talk may last. */
  talk?: { start: () => Promise<{ seconds: number } | null>; stop: () => Promise<void> }
}

type Entry =
  | { id: string; from: 'person'; text: string }
  | { id: string; from: 'assistant'; text: string; proposals: AskProposal[] }

/**
 * The whole Ask panel, made of LUMANE's parts, for an app that takes LUMANE's default look or
 * dresses the plain parts with its own stylesheet. It is the panel's contents: the app puts it
 * in its own drawer, dialog or page, behind its own Ask button. An app with its own design
 * system builds its panel from the parts instead, as SALEANE does.
 */
export function AskPanel({
  name,
  about,
  greeting,
  starters = [],
  usage: startingUsage,
  transport,
  look,
  words,
  placeholder,
  className,
}: {
  /** What the team sees, such as "Ask Caleane". */
  name: string
  /** A short line under the name, such as "AI assistant". */
  about?: string
  greeting?: string
  starters?: string[]
  usage?: UsageItem[]
  transport: AskTransport
  /** LUMANE's default look from four choices, or `'plain'` for no look at all. */
  look?: Partial<Look> | 'plain'
  words?: Partial<Words>
  placeholder?: string
  className?: string
}) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The usage the last answer reported, or what the app gave until there is one.
  const [reported, setUsage] = useState<UsageItem[]>()
  const usage = reported ?? startingUsage
  const [talk, setTalk] = useState<{ left: number; ending: boolean } | null>(null)
  const [starting, setStarting] = useState(false)
  const count = useRef(0)

  // A talk counts down here each second, and ends itself when its time is up.
  const talking = !!talk && !talk.ending
  useEffect(() => {
    if (!talking) return
    const timer = setInterval(() => {
      setTalk((now) => (now && !now.ending ? { ...now, left: Math.max(0, now.left - 1) } : now))
    }, 1000)
    return () => clearInterval(timer)
  }, [talking])
  useEffect(() => {
    if (talk && !talk.ending && talk.left === 0) void stop()
    // `stop` only reads the transport, which the app keeps for the panel's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talk])

  async function ask(question: string) {
    if (busy) return
    setBusy(true)
    setError('')
    const id = `line-${++count.current}`
    setEntries((list) => [...list, { id, from: 'person', text: question }])
    try {
      const answer = await transport.ask(question)
      setEntries((list) => [
        ...list,
        { id: `${id}-reply`, from: 'assistant', text: answer.text, proposals: answer.proposals },
      ])
      if (answer.usage) setUsage(answer.usage)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That could not be answered. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    if (!transport.talk || starting || talk) return
    setStarting(true)
    setError('')
    try {
      const started = await transport.talk.start()
      if (started) setTalk({ left: started.seconds, ending: false })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Talking could not start. Try again.')
    } finally {
      setStarting(false)
    }
  }

  async function stop() {
    if (!transport.talk) return
    setTalk((now) => (now ? { ...now, ending: true } : now))
    try {
      await transport.talk.stop()
    } finally {
      setTalk(null)
    }
  }

  return (
    <AskWords words={{ ...words, ...(placeholder ? { placeholder } : {}) }}>
      <LookScope look={look} className={className} aria-label={name} data-lumane="panel">
        <header data-lumane="panel-header">
          <span data-lumane="panel-mark" aria-hidden="true">
            {name.replace(/^Ask\s+/i, '').charAt(0)}
          </span>
          <div>
            <h2>{name}</h2>
            {about && <p>{about}</p>}
          </div>
        </header>
        <Conversation follow={entries} tabIndex={0} aria-label="Conversation">
          {greeting && (
            <Message from="assistant">
              <p>{greeting}</p>
            </Message>
          )}
          {entries.map((entry) =>
            entry.from === 'person' ? (
              <Message key={entry.id} from="person">
                {entry.text}
              </Message>
            ) : (
              <Message key={entry.id} from="assistant">
                <p>{entry.text}</p>
                {entry.proposals.map((proposal) => (
                  <ApprovalCard.Root
                    key={proposal.id}
                    onDecide={(approve) => transport.decide(proposal.id, approve)}
                  >
                    <ApprovalCard.Label />
                    <ApprovalCard.Summary>{proposal.summary}</ApprovalCard.Summary>
                    <ApprovalCard.Details rows={proposal.details ?? []} />
                    <ApprovalCard.Actions>
                      <ApprovalCard.Approve />
                      <ApprovalCard.Decline />
                    </ApprovalCard.Actions>
                    <ApprovalCard.Outcome />
                  </ApprovalCard.Root>
                ))}
              </Message>
            ),
          )}
          {busy && <Thinking />}
        </Conversation>
        {error && (
          <p role="alert" data-lumane="error">
            {error}
          </p>
        )}
        <footer data-lumane="panel-footer">
          {talk && (
            <TalkBar.Root ending={talk.ending}>
              <TalkBar.Dot />
              <TalkBar.Status>
                <TalkBar.Countdown seconds={talk.left} />
              </TalkBar.Status>
              <TalkBar.Stop onStop={() => void stop()} />
            </TalkBar.Root>
          )}
          {starters.length > 0 && (
            <div data-lumane="starters">
              {starters.map((text) => (
                <Starter key={text} text={text} onAsk={(t) => void ask(t)} disabled={busy} />
              ))}
            </div>
          )}
          <Composer.Root onAsk={(question) => void ask(question)} busy={busy}>
            <Composer.Label />
            <Composer.Input />
            <Composer.Send />
            {transport.talk && !talk && (
              <TalkButton onStart={() => void start()} starting={starting} />
            )}
          </Composer.Root>
          {usage && <UsageLine items={usage} />}
        </footer>
      </LookScope>
    </AskWords>
  )
}
