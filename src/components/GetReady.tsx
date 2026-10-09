import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, X } from 'lucide-react'
import { useStore } from '../state/context'
import { Button, ErrorMessage } from '../design'
import { can, operations } from '../domain/operations'
import { bookable, readySteps, stepPermission } from '../domain/readiness'
import type { ReadyStep } from '../domain/readiness'
import './getReady.css'

/**
 * What this browser remembers per studio: steps confirmed by hand and whether the list was hidden.
 * Storage that is blocked or unreadable is treated as empty, so the list simply shows again.
 */
const KEY = 'saleane.get-ready.v1'
type Memory = Record<string, { hidden?: boolean; confirmed?: ReadyStep[] }>
function recall(): Memory {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Memory) : {}
  } catch {
    return {}
  }
}
function keep(studioId: string, change: Memory[string]) {
  try {
    const all = recall()
    all[studioId] = { ...all[studioId], ...change }
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Nothing is kept in this browser; the choice still holds until the page is left.
  }
}

type Copy = { title: string; detail: string; link?: [to: string, label: string]; confirm?: string }
function copyFor(id: ReadyStep, uk: boolean): Copy {
  const tax = uk ? 'VAT' : 'sales tax'
  switch (id) {
    case 'hours':
      return {
        title: 'Check your opening hours',
        detail: 'A new studio opens Monday to Saturday, 9:00 to 18:00, and is closed on Sunday.',
        link: ['/settings?section=hours', 'Review hours'],
        confirm: 'These hours are right',
      }
    case 'treatments':
      return {
        title: 'Add your treatments',
        detail: 'The length, price and any deposit of each one.',
        link: ['/settings?section=service', 'Add treatments'],
      }
    case 'team':
      return {
        title: 'Add your team, and who does what',
        detail: 'Each person and the treatments they do.',
        link: ['/settings?section=staff', 'Add your team'],
      }
    case 'rooms':
      return {
        title: 'Add your rooms or chairs',
        detail: 'Every visit takes a room or chair of the right kind.',
        link: ['/settings?section=resource', 'Add rooms or chairs'],
      }
    case 'tax':
      return {
        title: `Set your ${tax}`,
        detail: `Checkout adds no ${tax} until you choose a rate. If you do not charge it, save 0%.`,
        link: ['/settings?section=business', `Set ${tax}`],
      }
    case 'deposits':
      return {
        title: 'Choose your deposit and cancellation rules',
        detail:
          'Deposits are set on each treatment. A fee for a missed visit or a late cancellation is set in Payments.',
        link: ['/settings?section=payments', 'Payment rules'],
        confirm: 'No deposit or fee',
      }
    case 'contact':
      return {
        title: 'Add your phone number and email',
        detail: 'Guests see them on the page for their visit.',
        link: ['/settings?section=business', 'Add contact details'],
      }
    case 'online':
      return {
        title: 'Switch on online booking',
        detail: 'Guests can then book from your booking page, at the times you are open.',
      }
  }
}

/**
 * "Get your studio ready", at the top of Today for the owner and managers of a studio that has not
 * finished setting up. Each step ticks itself once it is set and links to the place in Settings
 * where it is set; the list goes once every step is done, or when it is hidden.
 */
export function GetReady() {
  const { state, role, mode, blocked, commit } = useStore()
  const studio = state.organisation
  const [memory, setMemory] = useState(() => recall()[studio.id] ?? {})
  const [remembered, setRemembered] = useState(studio.id)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  // A different studio opened in this tab brings its own list.
  if (remembered !== studio.id) {
    setRemembered(studio.id)
    setMemory(recall()[studio.id] ?? {})
    setError('')
  }
  if (mode !== 'server' || operations(state).mode !== 'local') return null
  if (role !== 'owner' && role !== 'manager') return null
  const steps = readySteps(state, new Set(memory.confirmed ?? []))
  const finished = steps.filter((step) => step.done).length
  if (memory.hidden || finished === steps.length) return null
  const uk = studio.region === 'UK'
  const remember = (change: Memory[string]) => {
    keep(studio.id, change)
    setMemory((current) => ({ ...current, ...change }))
  }
  async function switchOn() {
    if (pending) return
    setPending(true)
    setError('')
    try {
      // Only the switch changes; the rest of the studio details stay exactly as they are.
      const result = await commit({
        type: 'organisation',
        name: studio.name,
        locationName: studio.locationName,
        address: studio.address,
        timeZone: studio.timeZone,
        bookingEnabled: true,
      })
      if (!result.ok) setError(result.error)
    } catch {
      setError('Online booking could not be switched on. Try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="surface get-ready" aria-labelledby="get-ready-title">
      <div className="get-ready-head">
        <div>
          <p className="eyebrow">
            {finished} of {steps.length} done
          </p>
          <h2 id="get-ready-title">Get your studio ready</h2>
          <p>A few things to set before your first guests book. Each one ticks itself once set.</p>
        </div>
        <Button
          variant="quiet"
          className="get-ready-hide"
          onClick={() => remember({ hidden: true })}
        >
          <X size={16} aria-hidden="true" />
          <span className="get-ready-hide-label">Hide this list</span>
        </Button>
      </div>
      <div className="get-ready-progress" aria-hidden="true">
        <span style={{ width: `${Math.round((finished / steps.length) * 100)}%` }} />
      </div>
      <ol className="get-ready-steps">
        {steps.map((step, index) => {
          const copy = copyFor(step.id, uk)
          const allowed = can(role, stepPermission[step.id]) && !blocked
          const waiting = step.id === 'online' && !bookable(state)
          return (
            <li key={step.id} className={`get-ready-step${step.done ? ' is-done' : ''}`}>
              <span className="get-ready-mark" aria-hidden="true">
                {step.done ? <Check size={15} strokeWidth={2.4} /> : index + 1}
              </span>
              <div className="get-ready-text">
                <strong>{copy.title}</strong>
                {step.done ? (
                  <small>Done</small>
                ) : (
                  <small>
                    {waiting
                      ? 'First add a treatment, someone who does it, and a room or chair for it.'
                      : copy.detail}
                  </small>
                )}
              </div>
              {!step.done && (
                <div className="get-ready-actions">
                  {!can(role, stepPermission[step.id]) ? (
                    <small className="get-ready-owner">The studio owner sets this.</small>
                  ) : step.id === 'online' ? (
                    !waiting && (
                      <Button disabled={!allowed || pending} onClick={() => void switchOn()}>
                        {pending ? 'Switching on…' : 'Switch on online booking'}
                      </Button>
                    )
                  ) : (
                    <>
                      {copy.link && (
                        <Link className="button button-secondary" to={copy.link[0]}>
                          {copy.link[1]} <ArrowRight size={15} aria-hidden="true" />
                        </Link>
                      )}
                      {copy.confirm && (
                        <Button
                          variant="quiet"
                          disabled={!allowed}
                          onClick={() =>
                            remember({ confirmed: [...(memory.confirmed ?? []), step.id] })
                          }
                        >
                          {copy.confirm}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <ErrorMessage error={error} />
    </section>
  )
}
