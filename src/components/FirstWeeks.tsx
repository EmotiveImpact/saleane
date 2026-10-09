import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Copy, X } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { useClock } from '../state/clock'
import { Button } from '../design'
import { can, operations } from '../domain/operations'
import { firstWeeksSteps, inFirstWeeks, weekPermission } from '../domain/firstWeeks'
import type { WeekStep } from '../domain/firstWeeks'
import './getReady.css'

/**
 * What this browser remembers per studio: steps confirmed by hand and whether the list was hidden.
 * Storage that is blocked or unreadable is treated as empty, so the list simply shows again.
 */
const KEY = 'saleane.first-weeks.v1'
type Memory = Record<string, { hidden?: boolean; confirmed?: WeekStep[] }>
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

type Words = { title: string; detail: string; link?: [to: string, label: string]; confirm?: string }
function copyFor(id: WeekStep, connected: { email: boolean; payments: boolean }): Words {
  switch (id) {
    case 'link':
      return {
        title: 'Share your booking page',
        detail:
          'Add the link to your website, Instagram and Google profile. This ticks once a guest books online.',
      }
    case 'clients':
      return {
        title: 'Bring your clients across',
        detail:
          'From your old system or a spreadsheet, so their details are here before they next visit.',
        link: ['/settings?section=switching', 'Bring clients across'],
        confirm: 'I am starting fresh',
      }
    case 'team':
      return {
        title: 'Invite your team to sign in',
        detail: 'Each person gets their own sign-in and sees only what their role needs.',
        link: ['/settings?section=staff', 'Invite your team'],
        confirm: 'I work on my own',
      }
    case 'checkout':
      return {
        title: 'Check out your first visit',
        detail: `When a visit ends, open it in the calendar and take payment at the till.${
          connected.payments
            ? ''
            : ' Card payments stay in test mode until a card provider is connected.'
        }`,
        link: ['/calendar', 'Open the calendar'],
      }
    case 'reminders':
      return {
        title: 'Check your visit reminders',
        detail: `Guests get a confirmation when they book and a reminder the day before.${
          connected.email ? '' : ' Nothing goes out until email is connected.'
        }`,
        link: ['/settings?section=messages', 'Messages to guests'],
        confirm: 'The usual ones are right',
      }
    case 'twoStep':
      return {
        title: 'Turn on two-step sign-in',
        detail:
          'A code from your phone as well as your password, so no one else can open your records.',
        link: ['/settings?section=staff', 'Turn it on'],
      }
  }
}

/**
 * "Your first weeks", at the top of Today once "Get your studio ready" is finished, for the owner
 * and managers of a new studio. Each step ticks itself once done and the list goes when every
 * step is, when it is hidden, or eight weeks after the studio was made (src/domain/firstWeeks.ts).
 */
export function FirstWeeks() {
  const { state, role, mode, blocked, session, slug } = useStore()
  const studio = state.organisation
  const now = useClock()
  const [memory, setMemory] = useState(() => recall()[studio.id] ?? {})
  const [invited, setInvited] = useState(false)
  const [copied, setCopied] = useState(false)
  const owner = role === 'owner'
  useEffect(() => {
    if (mode !== 'server' || !owner) return
    let active = true
    // Anyone besides the owner who can sign in, or has been asked to.
    api<{ members: unknown[]; invitations: unknown[] }>(`/api/workspaces/${studio.id}/team`)
      .then((team) => {
        if (active) setInvited(team.members.length > 1 || team.invitations.length > 0)
      })
      .catch(() => {
        // The step stays to do; inviting is still one tap away.
      })
    return () => {
      active = false
    }
  }, [mode, owner, studio.id])
  if (mode !== 'server' || operations(state).mode !== 'local') return null
  if (!owner && role !== 'manager') return null
  if (memory.hidden || !inFirstWeeks(state, now)) return null
  // Only the owner invites the team, and only they can see who has been asked.
  const steps = firstWeeksSteps(state, {
    confirmed: new Set(memory.confirmed ?? []),
    twoStep: !!session?.user.twoStep,
    invited,
  }).filter((step) => owner || step.id !== 'team')
  const finished = steps.filter((step) => step.done).length
  if (finished === steps.length) return null
  const connected = session?.services ?? { email: false, payments: false }
  const link = `${window.location.origin}/book/${encodeURIComponent(slug)}`
  const remember = (change: Memory[string]) => {
    keep(studio.id, change)
    setMemory((current) => ({ ...current, ...change }))
  }
  return (
    <section className="surface get-ready" aria-labelledby="first-weeks-title">
      <div className="get-ready-head">
        <div>
          <p className="eyebrow">
            {finished} of {steps.length} done
          </p>
          <h2 id="first-weeks-title">Your first weeks</h2>
          <p>A few things that help a new studio settle in. Each one ticks itself once done.</p>
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
          const copy = copyFor(step.id, connected)
          const allowed = can(role, weekPermission[step.id]) && !blocked
          return (
            <li key={step.id} className={`get-ready-step${step.done ? ' is-done' : ''}`}>
              <span className="get-ready-mark" aria-hidden="true">
                {step.done ? <Check size={15} strokeWidth={2.4} /> : index + 1}
              </span>
              <div className="get-ready-text">
                <strong>{copy.title}</strong>
                <small>{step.done ? 'Done' : copy.detail}</small>
              </div>
              {!step.done && (
                <div className="get-ready-actions">
                  {!can(role, weekPermission[step.id]) ? (
                    <small className="get-ready-owner">The studio owner does this.</small>
                  ) : step.id === 'link' ? (
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(link)
                          setCopied(true)
                        } catch {
                          setCopied(false)
                        }
                      }}
                    >
                      <Copy size={15} aria-hidden="true" />
                      {copied ? 'Copied' : 'Copy the link'}
                    </Button>
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
    </section>
  )
}
