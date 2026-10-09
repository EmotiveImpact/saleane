import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { current, decide } from '../../lumane'
import type { PendingProposal, Usage } from '../../lumane'
import { HISTORY_TURNS, askSaleane } from '../assistant/ask'
import { ALLOWANCES } from '../assistant/saleane'
import type { Command } from '../domain/commands'
import { nudges } from '../domain/nudges'
import { api } from '../state/api'
import { useStore } from '../state/context'
import { Button, Modal } from '../design'
import './ask-saleane.css'

type Meter = { used: number; allowance: number }
type Suggestion = { id: string; summary: string; state: 'waiting' | 'saving' | 'done' | 'declined' }
type Entry =
  | { id: string; from: 'you'; text: string }
  | { id: string; from: 'saleane'; text: string; suggestions: Suggestion[] }

const STARTERS = [
  'Give me my morning brief',
  "Who's my 10 o'clock?",
  'Anything I should be planning?',
  'How did we do today?',
]
const usageKey = (orgId: string) => `saleane.ask-usage.v1.${orgId}`

/**
 * Ask Saleane, the studio assistant, in test mode. In the browser demo it runs here against the
 * demo record; signed in, the server answers and keeps the studio's allowance. Anything that
 * changes the record is a suggestion until approved, and is then saved like any desk change.
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
  const held = useRef(new Map<string, PendingProposal<Command>>())
  const end = useRef<HTMLDivElement | null>(null)
  const base = orgId ? `/api/workspaces/${encodeURIComponent(orgId)}/assistant` : ''

  useEffect(() => {
    if (mode !== 'server' || !base) return
    api<{ usage: { used: { typed: number }; allowance: { typed: number } } }>(base)
      .then((r) => setMeter({ used: r.usage.used.typed, allowance: r.usage.allowance.typed }))
      .catch(() => {})
  }, [mode, base])

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
          usage: { used: { typed: number }; allowance: { typed: number } }
        }>(base, { method: 'POST', body: { text: trimmed, history } })
        setMeter({ used: r.usage.used.typed, allowance: r.usage.allowance.typed })
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
          Test mode: answers come from your studio records. No AI service is connected, and nothing
          is sent.
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
                <span className="sr-only">You asked: </span>
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
          {busy && (
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
        <div className="ask-footer">
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
          </form>
          {meter && (
            <p className="ask-meter">
              {meter.used} of {meter.allowance} questions used this month.
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
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
