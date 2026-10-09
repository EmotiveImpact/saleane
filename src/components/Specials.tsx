import { useState } from 'react'
import { CalendarHeart, Check } from 'lucide-react'
import { useStore } from '../state/context'
import { dateLabel } from '../domain/format'
import {
  currentSpecials,
  resultSentence,
  roomSentence,
  suggestionInput,
  suggestSpecials,
} from '../domain/specials'
import type { SpecialResult, SpecialSuggestion } from '../domain/specials'
import { Button, Modal } from '../design'
import './specials.css'

/**
 * V3, the assistant manager on Today: specials worth considering from the time of year, holidays,
 * the weather and local events, and how planned ones are going. Owners and managers only.
 * Today shows one; the rest open in a dialog. Planning records the special; nothing is sent and
 * no price changes.
 */
export function Specials() {
  const { state, today, role, commit } = useStore()
  const [hidden, setHidden] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  if (role !== 'owner' && role !== 'manager') return null
  const locale = state.organisation.locale
  const day = (date: string) => dateLabel(date, locale, true)
  const span = (from: string, to: string) =>
    from === to ? day(from) : `${day(from)} to ${day(to)}`
  const ideas = suggestSpecials(state, today, { limit: 5 }).filter(
    (g) => !hidden.includes(g.signal.id),
  )
  const planned = currentSpecials(state, today)
  if (!ideas.length && !planned.length) return null
  const total = ideas.length + planned.length

  async function run(key: string, command: Parameters<typeof commit>[0]) {
    setBusy(key)
    setError('')
    const result = await commit(command)
    setBusy('')
    if (!result.ok) setError(result.error)
  }
  const plan = (g: SpecialSuggestion) =>
    run(g.signal.id, { type: 'special-plan', input: suggestionInput(g) })

  /** One idea: in full in the dialog, shorter on Today. */
  const idea = (g: SpecialSuggestion, full: boolean) => (
    <li key={g.signal.id}>
      <span>
        <strong>{g.title}</strong>
        <small>
          {span(g.startDate, g.endDate)}
          {full ? '' : ` · ${g.signal.source}`}
        </small>
      </span>
      <p>{g.reason}</p>
      {full && <p className="specials-effect">{roomSentence(g)}</p>}
      <p className="specials-idea">
        <span>Idea</span> {g.offer}
      </p>
      {(full || g.signal.caution) && (
        <small>
          {full ? g.signal.source : ''}
          {full && g.signal.caution ? '. ' : ''}
          {g.signal.caution ?? ''}
        </small>
      )}
      <div className="specials-actions">
        <Button disabled={busy === g.signal.id} onClick={() => void plan(g)}>
          <Check size={15} aria-hidden="true" /> Plan this special
        </Button>
        <Button variant="quiet" onClick={() => setHidden((list) => [...list, g.signal.id])}>
          Not now
        </Button>
      </div>
    </li>
  )
  const plannedRow = (r: SpecialResult) => (
    <li key={r.special.id}>
      <span>
        <strong>{r.special.title}</strong>
        <small>
          {span(r.special.startDate, r.special.stoppedOn ?? r.special.endDate)}
          {r.special.stoppedOn ? ' · stopped' : ''}
        </small>
      </span>
      <p>{resultSentence(r, day)}</p>
      {r.state !== 'finished' && !r.special.stoppedOn && (
        <Button
          variant="quiet"
          disabled={busy === r.special.id}
          onClick={() => void run(r.special.id, { type: 'special-stop', specialId: r.special.id })}
        >
          Stop this special
        </Button>
      )}
    </li>
  )
  const nothingSent = (
    <small className="specials-note">
      Planning a special only records it. Nothing is sent and no prices change; you tell clients
      from the Inbox and give any discount at checkout.
    </small>
  )

  return (
    <section className="specials-panel" aria-labelledby="specials-title">
      <div className="specials-symbol">
        <CalendarHeart size={20} aria-hidden="true" />
        <span>Assistant manager</span>
      </div>
      <h2 id="specials-title">Specials to consider</h2>
      {ideas.length > 0 && planned.length > 0 && (
        <p className="specials-intro">
          {planned.length === 1
            ? `One special planned: ${planned[0].special.title}.`
            : `${planned.length} specials planned.`}
        </p>
      )}
      <ul className="specials-one">
        {ideas.length ? idea(ideas[0], false) : plannedRow(planned[0])}
      </ul>
      {error && !open && (
        <p role="alert" className="specials-error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="specials-see-all"
        aria-haspopup="dialog"
        onClick={() => {
          setError('')
          setOpen(true)
        }}
      >
        {total > 1 ? 'See all specials' : 'See the details'}
      </button>
      {nothingSent}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Specials"
        description="Ideas from the time of year, holidays, the weather and what is on nearby, and how your planned specials are going."
        wide
      >
        <div className="specials-all">
          {planned.length > 0 && (
            <div className="specials-planned">
              <h3>Your specials</h3>
              <ul>{planned.map(plannedRow)}</ul>
              <small className="specials-note">
                Results compare the special’s days with the same length of time before it. SALEANE
                cannot tell which guests came because of the special.
              </small>
            </div>
          )}
          {ideas.length > 0 && (
            <>
              <h3 className="specials-all-heading">Ideas to consider</h3>
              <ul className="specials-ideas">{ideas.map((g) => idea(g, true))}</ul>
            </>
          )}
          {error && (
            <p role="alert" className="specials-error">
              {error}
            </p>
          )}
          {nothingSent}
        </div>
      </Modal>
    </section>
  )
}
