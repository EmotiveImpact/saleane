import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Mic, Sparkles, Square } from 'lucide-react'
import { current, decide } from '../../lumane'
import type { PendingProposal, Usage } from '../../lumane'
import { ASK_WAIT_MS, HISTORY_TURNS, askSaleane } from '../assistant/ask'
import { ALLOWANCES } from '../assistant/saleane'
import { connectTalk } from '../assistant/talkLine'
import type { TalkConnection } from '../assistant/talkLine'
import type { Command } from '../domain/commands'
import { nudges } from '../domain/nudges'
import { api } from '../state/api'
import { useStore } from '../state/context'
import { Button, Modal } from '../design'
import './ask-saleane.css'

type Meter = { used: number; allowance: number; talk?: { used: number; allowance: number } }
type Suggestion = { id: string; summary: string; state: 'waiting' | 'saving' | 'done' | 'declined' }
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
 * and is then saved like any desk change.
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
  const held = useRef(new Map<string, PendingProposal<Command>>())
  const end = useRef<HTMLDivElement | null>(null)
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

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [entries])

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
          usage: ServerUsage
        }>(base, { method: 'POST', body: { text: trimmed, history }, timeoutMs: ASK_WAIT_MS })
        setMeter(meterFrom(r.usage))
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
          used: current(result.usage, at).used.typed,
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
          suggestions: answer.proposals.map((p) => ({
            id: p.id,
            summary: p.summary,
            state: 'waiting' as const,
          })),
        },
      ])
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Ask SALEANE could not answer. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  /** Adds each question heard and its answer to the conversation, once each. */
  function addTurns(turns: TalkTurn[]) {
    setEntries((list) => {
      const next = [...list]
      for (const turn of turns) {
        const you = `talk-${turn.id}`
        if (!next.some((e) => e.id === you))
          next.push({ id: you, from: 'you', text: turn.heard, spoken: true })
        if (turn.answer !== undefined && !next.some((e) => e.id === `${you}-reply`))
          next.push({
            id: `${you}-reply`,
            from: 'saleane',
            text: turn.answer,
            suggestions: turn.proposals.map((p) => ({
              id: p.id,
              summary: p.summary,
              state: 'waiting' as const,
            })),
          })
      }
      return next.length === list.length ? list : next
    })
  }

  function show(view: TalkView) {
    addTurns(view.turns)
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
            | { status: 'talking'; id: string; sdp: string; seconds: number; usage: ServerUsage }
            | { status: 'refused' | 'unavailable'; text: string; usage: ServerUsage }
          >(`${base}/talk`, {
            method: 'POST',
            body: { sdp },
            // Longer than SALEANE's own two waits on OpenAI (10 seconds each), so a slow start
            // is never left running with nobody holding its id.
            timeoutMs: 30_000,
          })
          setMeter(meterFrom(r.usage))
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

  const mark = (id: string, next: Suggestion['state']) =>
    setEntries((list) =>
      list.map((e) =>
        e.from === 'saleane'
          ? {
              ...e,
              suggestions: e.suggestions.map((s) => (s.id === id ? { ...s, state: next } : s)),
            }
          : e,
      ),
    )

  async function decide(id: string, approve: boolean) {
    setError('')
    mark(id, 'saving')
    try {
      let command: Command | undefined
      if (mode === 'server') {
        const r = await api<{ outcome: string; command?: Command }>(`${base}/proposals/${id}`, {
          method: 'POST',
          body: { approve },
        })
        if (r.outcome === 'expired') throw new Error('This suggestion has expired. Ask again.')
        command = r.command
      } else {
        const proposal = held.current.get(id)
        held.current.delete(id)
        command = demoDecision(proposal, approve)
      }
      if (!approve) {
        mark(id, 'declined')
        return
      }
      const result = await commit(command!)
      if (!result.ok) throw new Error(result.error)
      mark(id, 'done')
    } catch (caught) {
      mark(id, 'declined')
      setError(caught instanceof Error ? caught.message : 'This change could not be saved.')
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void ask(text)
  }

  return (
    <Modal
      open
      onClose={onClose}
      placement="side"
      title="Ask SALEANE"
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
        <div className="ask-thread" aria-live="polite">
          {!entries.length && opening.length > 0 && (
            <div className="ask-nudges">
              <span className="ask-name">
                <Sparkles size={14} aria-hidden="true" /> SALEANE noticed
              </span>
              <ul>
                {opening.map((n) => (
                  <li key={n.id}>
                    <p>{n.text}</p>
                    <button className="ask-starter" onClick={() => void ask(n.ask)}>
                      {n.ask}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!entries.length && (
            <div className="ask-starters">
              {STARTERS.map((starter) => (
                <button key={starter} className="ask-starter" onClick={() => void ask(starter)}>
                  {starter}
                </button>
              ))}
            </div>
          )}
          {entries.map((entry) =>
            entry.from === 'you' ? (
              <p key={entry.id} className="ask-bubble ask-you">
                {entry.spoken && <Mic size={13} aria-hidden="true" className="ask-spoken" />}
                <span className="sr-only">{entry.spoken ? 'You said: ' : 'You asked: '}</span>
                {entry.text}
              </p>
            ) : (
              <div key={entry.id} className="ask-bubble ask-reply">
                <span className="ask-name">
                  <Sparkles size={14} aria-hidden="true" /> SALEANE
                </span>
                <p>{entry.text}</p>
                {entry.suggestions.map((s) => (
                  <div key={s.id} className="ask-suggestion">
                    <p>{s.summary}</p>
                    {s.state === 'waiting' || s.state === 'saving' ? (
                      <div className="ask-actions">
                        <Button
                          disabled={s.state === 'saving'}
                          onClick={() => void decide(s.id, true)}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="quiet"
                          disabled={s.state === 'saving'}
                          onClick={() => void decide(s.id, false)}
                        >
                          Not now
                        </Button>
                      </div>
                    ) : (
                      <p className="ask-outcome" role="status">
                        {s.state === 'done' ? (
                          <>
                            <Check size={14} aria-hidden="true" /> Done. Saved to your records.
                          </>
                        ) : (
                          'Left as it was.'
                        )}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ),
          )}
          {(busy || talk?.thinking) && (
            <p className="ask-bubble ask-reply ask-thinking" role="status">
              Looking at your records…
            </p>
          )}
          <div ref={end} className="ask-end" />
        </div>
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
            <div className="ask-talk">
              <span className="ask-talk-dot" aria-hidden="true" />
              <p>
                {talk.ending ? 'Ending the talk…' : 'Talking'}
                {!talk.ending && (
                  <span className="ask-talk-left" role="timer" aria-live="off">
                    {' '}
                    · {clockLabel(talk.secondsLeft)} left
                  </span>
                )}
              </p>
              <Button variant="secondary" disabled={talk.ending} onClick={() => void stopTalk()}>
                <Square size={14} aria-hidden="true" /> Stop
              </Button>
            </div>
          )}
          <form className="ask-form" onSubmit={submit}>
            <label className="sr-only" htmlFor="ask-saleane-text">
              Your question
            </label>
            <input
              id="ask-saleane-text"
              value={text}
              maxLength={500}
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              placeholder="Ask about today or a client…"
            />
            <Button type="submit" disabled={busy || !text.trim()}>
              Ask
            </Button>
            {canTalk && !talk && (
              <Button variant="secondary" disabled={starting} onClick={() => void startTalk()}>
                <Mic size={16} aria-hidden="true" />
                {/* On a phone the microphone alone shows it, so the question box keeps its room. */}
                <span className="ask-talk-label">{starting ? 'Starting…' : 'Talk'}</span>
              </Button>
            )}
          </form>
          {meter && (
            <p className="ask-meter">
              {meter.used} of {meter.allowance} questions used this month.
              {/* While talking, its whole time is held, so the countdown shows what is left instead. */}
              {canTalk &&
                !talk &&
                meter.talk &&
                ` ${Math.ceil(meter.talk.used / 60)} of ${Math.floor(meter.talk.allowance / 60)} talking minutes used.`}
            </p>
          )}
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

/** Minutes and seconds, as a talk's countdown shows them: "4:05". */
function clockLabel(seconds: number) {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function demoMeter(orgId: string): Meter {
  return {
    used: current(demoUsage(orgId), new Date().toISOString()).used.typed,
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
