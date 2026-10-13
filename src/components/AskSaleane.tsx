import { useEffect, useRef, useState } from 'react'
import { Check, Mic, Sparkles, Square } from 'lucide-react'
import { decide, usedOf } from '../../lumane'
import type { PendingProposal, Usage } from '../../lumane'
import {
  ApprovalCard,
  Composer,
  Conversation,
  Message,
  Starter,
  TalkBar,
  TalkButton,
  Thinking,
  UsageLine,
} from '../../lumane/react'
import type { Decided, UsageItem } from '../../lumane/react'
import { ASK_WAIT_MS, HISTORY_TURNS, askSaleane } from '../assistant/ask'
import { ALLOWANCES } from '../assistant/saleane'
import { TALK_START_WAIT_MS } from '../assistant/talk'
import { connectTalk } from '../assistant/talkLine'
import type { TalkConnection } from '../assistant/talkLine'
import type { Command } from '../domain/commands'
import { nudges } from '../domain/nudges'
import { operations } from '../domain/operations'
import { DEFAULT_VOICE, VOICES } from '../assistant/voices'
import { ApiError, api } from '../state/api'
import { useStore } from '../state/context'
import { Button, Modal, Select } from '../design'
import './ask-saleane.css'
import { ASK_NAME } from '../assistant/name'

type Meter = { used: number; allowance: number; talk?: { used: number; allowance: number } }
/** A change Ask prepared. Whether it waits, is saving or was decided is kept by its card. */
type Suggestion = { id: string; summary: string }
type Entry =
  | { id: string; from: 'you'; text: string; spoken?: boolean }
  | { id: string; from: 'saleane'; text: string; suggestions: Suggestion[] }
type ServerUsage = {
  used: { typed: number; talkSeconds?: number }
  allowance: { typed: number; talkSeconds?: number }
}
type TalkTurn = {
  id: string
  heard: string
  answer?: string
  proposals: { id: string; summary: string }[]
}
type TalkView = {
  id: string
  status: 'talking' | 'ended'
  secondsLeft: number
  turns: TalkTurn[]
  usage: ServerUsage
}
/** The talk on screen: its time left, whether a question is being answered, and if it is ending. */
type Talking = { id: string; secondsLeft: number; thinking: boolean; ending: boolean }

const STARTERS = [
  'Give me my morning brief',
  "Who's my 10 o'clock?",
  'Anything I should be planning?',
  'How did we do today?',
]
const usageKey = (orgId: string) => `saleane.ask-usage.v1.${orgId}`

/**
 * Ask Saleane, the studio assistant. In the browser demo it runs here in test mode against the
 * demo record; signed in, the server answers, with Claude once SALEANE has its key (NEXT-12), and
 * keeps the studio's allowance. Anything that changes the record is a suggestion until approved,
 * and is then saved like any desk change. The panel is built from LUMANE's screen parts, dressed
 * in SALEANE's own design.
 */
export function AskSaleane({ onClose }: { onClose: () => void }) {
  const { state, mode, slug, session, role, commit, today } = useStore()
  const orgId = session?.workspaces.find((w) => w.slug === slug)?.id
  const [entries, setEntries] = useState<Entry[]>([])
  // What Saleane mentions first, read once when the panel opens.
  const [opening] = useState(() => nudges(state, role, today, new Date().toISOString()))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [meter, setMeter] = useState<Meter | null>(() =>
    mode === 'server' ? null : demoMeter(state.organisation.id),
  )
  // Whether a real AI answers. Until the server says, the panel describes test mode.
  const [live, setLive] = useState(false)
  // NEXT-12 part 2: whether this studio can talk to Ask SALEANE, and the talk under way.
  const [canTalk, setCanTalk] = useState(false)
  const [talk, setTalk] = useState<Talking | null>(null)
  const [starting, setStarting] = useState(false)
  // A line about talking: shown, or only read out when the talk bar already shows it.
  const [notice, setNotice] = useState<{ text: string; quiet?: boolean }>({ text: '' })
  const line = useRef<TalkConnection | null>(null)
  const talkId = useRef<string | null>(null)
  // A talk still starting when the panel closes is called off, and ended if SALEANE started it.
  const startCall = useRef<AbortController | null>(null)
  // NEXT-16: the voice this person hears, chosen here; empty means the studio's.
  const me = session?.user?.id
  const ownVoice = (me && operations(state).voices?.[me]) || ''
  const studioVoice = operations(state).aiVoice?.voice ?? DEFAULT_VOICE
  const [voicePending, setVoicePending] = useState(false)
  async function chooseVoice(voice: string) {
    setVoicePending(true)
    try {
      const result = await commit({ type: 'own-voice', voice: voice || null })
      setNotice({ text: result.ok ? 'Saved. Your next talk uses it.' : result.error })
    } catch {
      setNotice({ text: 'Your voice could not be saved. Try again.' })
    } finally {
      setVoicePending(false)
    }
  }
  const held = useRef(new Map<string, PendingProposal<Command>>())
  // Signed in, the server keeps this conversation's last few lines and reads only those, never
  // lines sent from here. Its id is named here, so a talk started first joins the same one.
  const conversation = useRef<string>(crypto.randomUUID())
  const base = orgId ? `/api/workspaces/${encodeURIComponent(orgId)}/assistant` : ''

  useEffect(() => {
    if (mode !== 'server' || !base) return
    api<{ mode: 'live' | 'test'; talk?: boolean; usage: ServerUsage }>(base)
      .then((r) => {
        setMeter(meterFrom(r.usage))
        setLive(r.mode === 'live')
        setCanTalk(!!r.talk)
      })
      .catch(() => {})
  }, [mode, base])

  // While talking, the panel reads the talk each second: the time left, what was heard and the
  // answers, with any suggestions to approve. It stops once the talk has ended.
  const talking = talk?.id
  useEffect(() => {
    if (!talking) return
    let reading = false
    let tries = 0
    const timer = setInterval(() => {
      if (reading) return
      reading = true
      api<TalkView>(`${base}/talk/${encodeURIComponent(talking)}`)
        .then((view) => {
          tries = 0
          show(view)
        })
        .catch(() => {
          // A talk SALEANE no longer knows has ended; a few failed reads in a row end it here.
          if (++tries >= 5 && talkId.current === talking) finish()
        })
        .finally(() => {
          reading = false
        })
    }, 1000)
    return () => clearInterval(timer)
    // `show` and `finish` only set state, so the reading starts once per talk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talking, base])

  // Closing the panel hangs up, and calls off a talk that is still starting.
  useEffect(
    () => () => {
      startCall.current?.abort()
      line.current?.stop()
      if (talkId.current)
        void api(`${base}/talk/${encodeURIComponent(talkId.current)}/end`, {
          method: 'POST',
          body: {},
        }).catch(() => {})
    },
    [base],
  )

  async function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError('')
    setText('')
    const id = crypto.randomUUID()
    const history = entries.slice(-HISTORY_TURNS).map((e) => ({ from: e.from, text: e.text }))
    setEntries((list) => [...list, { id, from: 'you', text: trimmed }])
    try {
      let answer: { text: string; proposals: { id: string; summary: string }[] }
      if (mode === 'server') {
        const r = await api<{
          text: string
          proposals: { id: string; summary: string }[]
          conversation?: string
          usage: ServerUsage
        }>(base, {
          method: 'POST',
          body: { text: trimmed, conversation: conversation.current },
          timeoutMs: ASK_WAIT_MS,
        })
        setMeter(meterFrom(r.usage))
        if (r.conversation) conversation.current = r.conversation
        answer = r
      } else {
        const at = new Date().toISOString()
        const result = await askSaleane({
          state,
          role,
          personId: 'demo',
          text: trimmed,
          history,
          usage: demoUsage(state.organisation.id),
          at,
        })
        if (result.status === 'answered') {
          saveDemoUsage(state.organisation.id, result.usage)
          for (const p of result.proposals) held.current.set(p.id, p as PendingProposal<Command>)
        }
        setMeter({
          used: usedOf(result.usage, 'typed', at),
          allowance: ALLOWANCES.included.monthly.typed,
        })
        answer = {
          text: result.text,
          proposals: result.status === 'answered' ? result.proposals : [],
        }
      }
      setEntries((list) => [
        ...list,
        {
          id: `${id}-reply`,
          from: 'saleane',
          text: answer.text,
          suggestions: answer.proposals.map((p) => ({ id: p.id, summary: p.summary })),
        },
      ])
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : `${ASK_NAME} could not answer. Try again.`,
      )
    } finally {
      setBusy(false)
    }
  }

  /** Adds each question heard and its answer to the conversation, once each. */
  function addTurns(talkId: string, turns: TalkTurn[]) {
    setEntries((list) => {
      const next = [...list]
      for (const turn of turns) {
        // A later talk can reuse a question's id, so each is kept apart by its talk.
        const you = `talk-${talkId}-${turn.id}`
        if (!next.some((e) => e.id === you))
          next.push({ id: you, from: 'you', text: turn.heard, spoken: true })
        if (turn.answer !== undefined && !next.some((e) => e.id === `${you}-reply`))
          next.push({
            id: `${you}-reply`,
            from: 'saleane',
            text: turn.answer,
            suggestions: turn.proposals.map((p) => ({ id: p.id, summary: p.summary })),
          })
      }
      return next.length === list.length ? list : next
    })
  }

  function show(view: TalkView) {
    addTurns(view.id, view.turns)
    setMeter(meterFrom(view.usage))
    // A late answer about an earlier talk never ends the one now running.
    if (view.status === 'ended') {
      if (view.id === talkId.current) finish()
      return
    }
    setTalk((now) =>
      now && now.id === view.id
        ? {
            ...now,
            secondsLeft: view.secondsLeft,
            thinking: view.turns.some((t) => t.answer === undefined),
          }
        : now,
    )
  }

  function finish() {
    line.current?.stop()
    line.current = null
    talkId.current = null
    setTalk(null)
    setNotice({ text: 'The talk has ended.' })
  }

  async function startTalk() {
    if (talk || starting) return
    setError('')
    setNotice({ text: '' })
    setStarting(true)
    const started: { id?: string; seconds?: number } = {}
    const call = new AbortController()
    startCall.current = call
    try {
      const connection = await connectTalk(
        async (sdp) => {
          if (call.signal.aborted) return null
          const r = await api<
            (
              | { status: 'talking'; id: string; sdp: string; seconds: number }
              | { status: 'refused' | 'unavailable'; text: string }
            ) & { usage: ServerUsage; conversation?: string }
          >(`${base}/talk`, {
            method: 'POST',
            body: { sdp, conversation: conversation.current },
            // Longer than SALEANE lets a start take, including a wait behind an earlier one, so
            // a slow start is never left running with nobody holding its id.
            timeoutMs: TALK_START_WAIT_MS,
          })
          setMeter(meterFrom(r.usage))
          if (r.conversation) conversation.current = r.conversation
          if (r.status !== 'talking') {
            setNotice({ text: r.text })
            return null
          }
          started.id = r.id
          started.seconds = r.seconds
          talkId.current = r.id
          return { sdp: r.sdp }
        },
        // The voice hung up or the line failed: SALEANE is told at once, so it counts only the
        // time used and holds nothing more, and the panel shows how the talk ended.
        () => void stopTalk(),
        call.signal,
      )
      if (call.signal.aborted) {
        // The panel closed while the talk was starting: nothing is left listening or held.
        connection?.stop()
        if (started.id)
          void api(`${base}/talk/${encodeURIComponent(started.id)}/end`, {
            method: 'POST',
            body: {},
          }).catch(() => {})
        return
      }
      if (!connection || !started.id) return
      if (talkId.current !== started.id) {
        // The line failed while it was connecting, and the talk has already been ended.
        connection.stop()
        return
      }
      line.current = connection
      setTalk({ id: started.id, secondsLeft: started.seconds ?? 0, thinking: false, ending: false })
      setNotice({ text: 'Talking. Ask whenever you are ready.', quiet: true })
    } catch (caught) {
      if (talkId.current) void stopTalk()
      setError(caught instanceof Error ? caught.message : 'Talking could not start. Try again.')
    } finally {
      if (startCall.current === call) startCall.current = null
      setStarting(false)
    }
  }

  /** Hangs up here at once; the panel keeps reading until SALEANE has counted the talk. */
  async function stopTalk() {
    line.current?.stop()
    line.current = null
    const id = talkId.current
    if (!id) return
    setTalk((now) => (now ? { ...now, ending: true } : now))
    try {
      show(
        await api<TalkView>(`${base}/talk/${encodeURIComponent(id)}/end`, {
          method: 'POST',
          body: {},
        }),
      )
    } catch {
      if (talkId.current === id) finish()
    }
  }

  /** Approves or turns down a suggestion, and says what its card shows next. */
  async function decide(id: string, approve: boolean): Promise<Decided> {
    setError('')
    // Signed in, the server keeps an approval until its change is saved, so an approval can be
    // tried again if its own request or the save after it fails, even when the answer never came.
    let retry = false
    try {
      let command: Command | undefined
      if (mode === 'server') {
        retry = approve
        const r = await api<{ outcome: string; command?: Command }>(`${base}/proposals/${id}`, {
          method: 'POST',
          body: { approve },
        })
        if (r.outcome === 'expired') {
          retry = false
          throw new Error('This suggestion has expired. Ask again.')
        }
        // Saved already, from another tab or before the connection dropped: nothing to save again.
        if (r.outcome === 'applied') return 'done'
        command = r.command
      } else {
        const proposal = held.current.get(id)
        held.current.delete(id)
        command = demoDecision(proposal, approve)
      }
      if (!approve) return 'declined'
      const result = await commit(command!)
      if (!result.ok) throw new Error(result.error)
      return 'done'
    } catch (caught) {
      // A suggestion the server no longer has (expired, turned down) cannot be tried again.
      const gone = caught instanceof ApiError && caught.status === 404
      setError(caught instanceof Error ? caught.message : 'This change could not be saved.')
      return retry && !gone ? 'waiting' : 'declined'
    }
  }

  // The usage line: typed questions, and talking minutes while the studio can talk.
  const usage: UsageItem[] = meter
    ? [
        { used: meter.used, allowance: meter.allowance, unit: 'uses', noun: 'questions' },
        // While talking, its whole time is held, so the countdown shows what is left instead.
        ...(canTalk && !talk && meter.talk
          ? [{ ...meter.talk, unit: 'seconds' as const, noun: 'talking minutes' }]
          : []),
      ]
    : []

  return (
    <Modal
      open
      onClose={onClose}
      placement="side"
      title={ASK_NAME}
      description="Ask about your day, your clients and your takings. Changes wait for your approval."
    >
      <div className="ask-saleane">
        <p className="ask-mode">
          {live
            ? 'Answers come from your studio records, read by Claude, an AI from Anthropic. Your question and the records needed to answer it are sent to Anthropic. Changes wait for your approval.'
            : 'Test mode: answers come from your studio records. No AI service is connected, and nothing is sent.'}
          {canTalk &&
            ' When you talk, your voice goes to OpenAI, which listens and speaks the answers Claude gives.'}
        </p>
        <Conversation className="ask-thread" follow={entries} endClassName="ask-end">
          {!entries.length && opening.length > 0 && (
            <div className="ask-nudges">
              <span className="ask-name">
                <Sparkles size={14} aria-hidden="true" /> SALEANE noticed
              </span>
              <ul>
                {opening.map((n) => (
                  <li key={n.id}>
                    <p>{n.text}</p>
                    <Starter className="ask-starter" text={n.ask} onAsk={(q) => void ask(q)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!entries.length && (
            <div className="ask-starters">
              {STARTERS.map((starter) => (
                <Starter
                  key={starter}
                  className="ask-starter"
                  text={starter}
                  onAsk={(q) => void ask(q)}
                />
              ))}
            </div>
          )}
          {entries.map((entry) =>
            entry.from === 'you' ? (
              <Message
                key={entry.id}
                from="person"
                spoken={entry.spoken}
                className="ask-bubble ask-you"
                icon={entry.spoken && <Mic size={13} aria-hidden="true" className="ask-spoken" />}
              >
                {entry.text}
              </Message>
            ) : (
              <Message key={entry.id} from="assistant" className="ask-bubble ask-reply">
                <span className="ask-name">
                  <Sparkles size={14} aria-hidden="true" /> SALEANE
                </span>
                <p>{entry.text}</p>
                {entry.suggestions.map((s) => (
                  <ApprovalCard.Root
                    key={s.id}
                    className="ask-suggestion"
                    onDecide={(approve) => decide(s.id, approve)}
                  >
                    <ApprovalCard.Summary>{s.summary}</ApprovalCard.Summary>
                    <ApprovalCard.Actions className="ask-actions">
                      <ApprovalCard.Approve asChild>
                        <Button>Approve</Button>
                      </ApprovalCard.Approve>
                      <ApprovalCard.Decline asChild>
                        <Button variant="quiet">Not now</Button>
                      </ApprovalCard.Decline>
                    </ApprovalCard.Actions>
                    <ApprovalCard.Outcome
                      className="ask-outcome"
                      done={
                        <>
                          <Check size={14} aria-hidden="true" /> Done. Saved to your records.
                        </>
                      }
                    />
                  </ApprovalCard.Root>
                ))}
              </Message>
            ),
          )}
          {(busy || talk?.thinking) && (
            <Thinking className="ask-bubble ask-reply ask-thinking">
              Looking at your records…
            </Thinking>
          )}
        </Conversation>
        {error && (
          <p role="alert" className="ask-error">
            {error}
          </p>
        )}
        <p role="status" className={notice.text && !notice.quiet ? 'ask-notice' : 'sr-only'}>
          {notice.text}
        </p>
        <div className="ask-footer">
          {talk && (
            <TalkBar.Root className="ask-talk" ending={talk.ending}>
              <TalkBar.Dot className="ask-talk-dot" />
              <TalkBar.Status>
                <TalkBar.Countdown className="ask-talk-left" seconds={talk.secondsLeft}>
                  {(time) => <> · {time} left</>}
                </TalkBar.Countdown>
              </TalkBar.Status>
              <TalkBar.Stop asChild onStop={() => void stopTalk()}>
                <Button variant="secondary">
                  <Square size={14} aria-hidden="true" /> Stop
                </Button>
              </TalkBar.Stop>
            </TalkBar.Root>
          )}
          <Composer.Root
            className="ask-form"
            onAsk={(question) => void ask(question)}
            busy={busy}
            value={text}
            onValueChange={setText}
            inputId="ask-saleane-text"
          >
            <Composer.Label />
            <Composer.Input placeholder="Ask about today or a client…" />
            <Composer.Send asChild>
              <Button>Ask</Button>
            </Composer.Send>
            {canTalk && !talk && (
              <TalkButton asChild starting={starting} onStart={() => void startTalk()}>
                <Button variant="secondary">
                  <Mic size={16} aria-hidden="true" />
                  {/* On a phone the microphone alone shows it, so the question box keeps its room. */}
                  <span className="ask-talk-label">{starting ? 'Starting…' : 'Talk'}</span>
                </Button>
              </TalkButton>
            )}
          </Composer.Root>
          {canTalk && !talk && (
            <label className="ask-voice">
              Voice
              <Select
                value={ownVoice}
                disabled={voicePending}
                onChange={(e) => void chooseVoice(e.target.value)}
              >
                <option value="">
                  The studio’s ({VOICES.find((v) => v.key === studioVoice)?.label ?? studioVoice})
                </option>
                {VOICES.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {meter && <UsageLine className="ask-meter" items={usage} />}
        </div>
      </div>
    </Modal>
  )
}

function meterFrom(usage: ServerUsage): Meter {
  return {
    used: usage.used.typed,
    allowance: usage.allowance.typed,
    ...(usage.allowance.talkSeconds === undefined
      ? {}
      : { talk: { used: usage.used.talkSeconds ?? 0, allowance: usage.allowance.talkSeconds } }),
  }
}

function demoMeter(orgId: string): Meter {
  return {
    used: usedOf(demoUsage(orgId), 'typed', new Date().toISOString()),
    allowance: ALLOWANCES.included.monthly.typed,
  }
}

/** The command an approved demo suggestion carries; a stale one is never carried out. */
function demoDecision(proposal: PendingProposal<Command> | undefined, approve: boolean) {
  if (!proposal) throw new Error('This suggestion has expired. Ask again.')
  const decision = decide(proposal, approve, new Date().toISOString())
  if (decision.outcome === 'expired') throw new Error('This suggestion has expired. Ask again.')
  return decision.outcome === 'approved' ? decision.effect : undefined
}

function demoUsage(orgId: string): Usage | undefined {
  try {
    const raw = localStorage.getItem(usageKey(orgId))
    return raw ? (JSON.parse(raw) as Usage) : undefined
  } catch {
    return undefined
  }
}

function saveDemoUsage(orgId: string, usage: Usage) {
  try {
    localStorage.setItem(usageKey(orgId), JSON.stringify(usage))
  } catch {
    // The demo still answers when this browser will not store anything.
  }
}
