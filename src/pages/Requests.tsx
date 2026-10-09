import { useState } from 'react'
import type { FormEvent } from 'react'
import { Send } from 'lucide-react'
import { useStore } from '../state/context'
import { Button, Empty, ErrorMessage, Modal, PageHeader } from '../design'
import { dateLabel, money } from '../domain/format'
import { places } from '../domain/locations'
import { can } from '../domain/operations'
import { regions } from '../domain/group'
import { regionalLimit, requests, waitingOn } from '../domain/approvals'
import type { ApprovalRequest } from '../domain/approvalsSchema'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import '../components/management.css'
import '../components/plans.css'
import '../components/branchVisits.css'

type Commit = (command: Command) => Promise<{ ok: true } | { ok: false; error: string }>
type Org = Pick<BusinessState['organisation'], 'locale' | 'currency'>
/** Decided requests are shown thirty at a time; every one stays reachable. */
const HISTORY_PAGE = 30

const PASSED_UP: Record<NonNullable<ApprovalRequest['passedUp']>, string> = {
  'over-limit': 'it costs more than a regional manager may approve',
  'no-region': 'its location is in no region',
  'no-manager': 'its region has no regional manager',
}

/** "New basin · £200 · Islington · raised 6 Oct by Rae". */
function requestMeta(
  r: ApprovalRequest,
  org: Org,
  names: Map<string, string>,
  day: (d: string) => string,
) {
  return [
    r.amountMinor !== undefined && money(r.amountMinor, org),
    names.get(r.locationId) ?? 'A closed location',
    `raised ${day(r.raisedAt.slice(0, 10))}${r.raisedBy ? ` by ${r.raisedBy}` : ''}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Requests still waiting, with who each waits on, and buttons for whoever may decide it. */
export function WaitingRequests({
  items,
  org,
  names,
  day,
  waiting,
  canDecide,
  onDecide,
  regional = true,
}: {
  items: ApprovalRequest[]
  org: Org
  names: Map<string, string>
  day: (d: string) => string
  waiting: (r: ApprovalRequest) => string
  canDecide: (r: ApprovalRequest) => boolean
  onDecide: (r: ApprovalRequest) => void
  /** False while the studio has no regions: every request goes to the owner, so no reason is given. */
  regional?: boolean
}) {
  if (!items.length) return <p className="ops-help">Nothing is waiting for a sign-off.</p>
  return (
    <ul className="visits-list">
      {items.map((r) => (
        <li key={r.id}>
          <div>
            <strong>{r.title}</strong>
            <span className="visits-meta">{requestMeta(r, org, names, day)}</span>
            {r.note && <p>{r.note}</p>}
            <span className="visits-meta">
              Waiting on {waiting(r)}
              {regional && r.passedUp ? `, because ${PASSED_UP[r.passedUp]}.` : '.'}
            </span>
          </div>
          {canDecide(r) && (
            <Button variant="secondary" onClick={() => onDecide(r)}>
              Decide
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Decided requests, newest first, each with what was said. */
export function DecidedRequests({
  items,
  org,
  names,
  day,
}: {
  items: ApprovalRequest[]
  org: Org
  names: Map<string, string>
  day: (d: string) => string
}) {
  const [shown, setShown] = useState(HISTORY_PAGE)
  const decided = items
    .filter((r) => r.decision)
    .sort((a, b) => b.decision!.at.localeCompare(a.decision!.at))
  if (!decided.length) return <p className="ops-help">No requests decided yet.</p>
  return (
    <>
      <ul className="visits-list">
        {decided.slice(0, shown).map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.title}</strong>
              <span className="visits-meta">{requestMeta(r, org, names, day)}</span>
              <span className="visits-meta">
                <span className={`visits-answer visits-answer-${r.decision!.outcome}`}>
                  {r.decision!.outcome === 'approved' ? 'Approved' : 'Declined'}
                </span>{' '}
                {day(r.decision!.at.slice(0, 10))}
                {r.decision!.by ? ` by ${r.decision!.by}` : ''}
              </span>
              {r.decision!.note && <p>{r.decision!.note}</p>}
            </div>
          </li>
        ))}
      </ul>
      {decided.length > shown && (
        <div className="ops-actions">
          <Button variant="secondary" onClick={() => setShown((n) => n + HISTORY_PAGE)}>
            Show {Math.min(HISTORY_PAGE, decided.length - shown)} more
          </Button>
          <span className="ops-help">
            Showing {shown} of {decided.length} requests
          </span>
        </div>
      )}
    </>
  )
}

function useSave(commit: Commit, onSaved: (message: string) => void) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function run(command: Command, message: string) {
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) setError(result.error)
      else onSaved(message)
    } catch {
      setError('This could not be saved. What you typed is still here; try again.')
    } finally {
      setPending(false)
    }
  }
  return { pending, error, setError, run }
}

/** Raising a request. The studio page and a regional manager's area page both use it. */
export function RequestForm({
  sites,
  org,
  limitMinor,
  commit,
  onClose,
  onSaved,
  regional = true,
}: {
  sites: { id: string; name: string }[]
  org: Org
  limitMinor: number
  commit: Commit
  onClose: () => void
  onSaved: (message: string) => void
  /** False while the studio has no regions, when every request goes straight to the owner. */
  regional?: boolean
}) {
  const [locationId, setLocationId] = useState(sites[0]?.id ?? '')
  const [kind, setKind] = useState<'spend' | 'other'>('spend')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const { pending, error, setError, run } = useSave(commit, onSaved)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    let amountMinor: number | undefined
    if (kind === 'spend') {
      const typed = amount.trim().replace(/,/g, '')
      amountMinor = Math.round(Number(typed) * 100)
      if (!typed || !Number.isFinite(amountMinor) || amountMinor < 1)
        return setError('Enter how much it will cost, such as 250.')
    }
    void run(
      {
        type: 'request-raise',
        input: {
          locationId,
          kind,
          title: title.trim(),
          ...(amountMinor !== undefined ? { amountMinor } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      },
      `${title.trim()} sent for a sign-off.`,
    )
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Ask for a sign-off"
      description={
        regional
          ? `It goes to the location’s regional manager when it has one. Anything over ${money(limitMinor, org)}, or with no regional manager, goes to the owner.`
          : 'It goes to the owner, who approves or declines it here.'
      }
    >
      <form className="plan-form" onSubmit={submit}>
        <div className="ops-fields">
          <label>
            Location
            <select
              value={locationId}
              disabled={pending}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {sites.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kind
            <select
              value={kind}
              disabled={pending}
              onChange={(e) => setKind(e.target.value as 'spend' | 'other')}
            >
              <option value="spend">Spending</option>
              <option value="other">Something else</option>
            </select>
          </label>
          <label className="ops-wide">
            What is it for?
            <input
              value={title}
              required
              minLength={2}
              maxLength={80}
              placeholder={
                kind === 'spend' ? 'New basin for the wash area' : 'Close early on Friday'
              }
              disabled={pending}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {kind === 'spend' && (
            <label>
              Cost in {org.currency}
              <input
                inputMode="decimal"
                value={amount}
                required
                disabled={pending}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          )}
          <label className="ops-wide">
            Why it is needed (optional)
            <textarea
              rows={3}
              maxLength={500}
              value={note}
              disabled={pending}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || title.trim().length < 2}>
            Send for sign-off
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Approving or declining one request, with an optional word back. */
export function DecideForm({
  request,
  org,
  place,
  commit,
  onClose,
  onSaved,
}: {
  request: ApprovalRequest
  org: Org
  place: string
  commit: Commit
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [note, setNote] = useState('')
  const { pending, error, run } = useSave(commit, onSaved)
  const decide = (outcome: 'approved' | 'declined') =>
    void run(
      {
        type: 'request-decide',
        requestId: request.id,
        outcome,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      `${request.title} ${outcome}.`,
    )
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={request.title}
      description={`${place}${request.amountMinor !== undefined ? ` · ${money(request.amountMinor, org)}` : ''}. A decision cannot be changed afterwards.`}
    >
      <form className="plan-form" onSubmit={(e) => e.preventDefault()}>
        {request.note && <p>{request.note}</p>}
        <label className="ops-field">
          A word back (optional)
          <textarea
            rows={3}
            maxLength={500}
            value={note}
            disabled={pending}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button disabled={pending} onClick={() => decide('approved')}>
            Approve
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => decide('declined')}>
            Decline
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * V5: requests for a sign-off. Managers raise them; each goes to its region's manager, or passes
 * up to the owner when it costs more than they may approve or has no regional manager. The owner
 * can decide any request and sets the regional limit.
 */
export function Requests() {
  const { state, role, blocked, commit, branch } = useStore()
  const org = state.organisation
  const raise = !blocked && can(role, 'request-raise')
  const owner = !blocked && can(role, 'request-decide')
  const [form, setForm] = useState<'raise' | 'limit' | null>(null)
  const [deciding, setDeciding] = useState<ApprovalRequest | null>(null)
  const [notice, setNotice] = useState('')
  const names = new Map(places(state, true).map((p) => [p.id, p.name]))
  const day = (date: string) => dateLabel(date, org.locale)
  const all = requests(state)
  const waiting = all
    .filter((r) => !r.decision)
    .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt))
  const limit = regionalLimit(state)
  // Regional managers and their limit only matter once the studio has grouped its locations.
  const regional = regions(state).length > 0
  const saved = (message: string) => {
    setNotice(message)
    setForm(null)
    setDeciding(null)
  }

  return (
    <div className="visits-page">
      <PageHeader
        eyebrow="Business"
        title="Requests."
        description={
          regional
            ? `Spending and other changes that need a sign-off. Regional managers approve up to ${money(limit, org)}; anything more passes up to the owner.`
            : 'Spending and other changes that need the owner’s sign-off.'
        }
        actions={
          <>
            {raise && (
              <Button
                onClick={() => {
                  setNotice('')
                  setForm('raise')
                }}
              >
                <Send size={17} aria-hidden="true" />
                Ask for a sign-off
              </Button>
            )}
            {owner && regional && (
              <Button
                variant="secondary"
                onClick={() => {
                  setNotice('')
                  setForm('limit')
                }}
              >
                Regional limit
              </Button>
            )}
          </>
        }
      />
      {notice && (
        <p className="success-strip" role="status">
          {notice}
        </p>
      )}
      {all.length === 0 ? (
        <section className="surface" aria-label="No requests yet">
          <Empty title="No requests yet">
            When a manager needs to spend money or change something at a location, such as a new
            basin or closing early on a Friday, they ask here.{' '}
            {regional
              ? 'Their regional manager or the owner approves or declines it'
              : 'The owner approves or declines it'}
            , and every decision is kept.{' '}
            {owner
              ? 'Requests wait here for you to decide.'
              : raise
                ? 'Start with Ask for a sign-off, above.'
                : ''}
          </Empty>
        </section>
      ) : (
        <>
          <section className="surface ops-panel" aria-labelledby="requests-waiting">
            <header>
              <div>
                <h2 id="requests-waiting">Waiting for a sign-off</h2>
                <p>
                  {owner
                    ? regional
                      ? 'As the owner you can decide any of these, including those waiting on a regional manager.'
                      : 'As the owner you decide each of these.'
                    : regional
                      ? 'Who each one is waiting on. Only the owner or the regional manager can decide.'
                      : 'Each one waits on the owner to decide.'}
                </p>
              </div>
            </header>
            <WaitingRequests
              items={waiting}
              org={org}
              names={names}
              day={day}
              waiting={(r) => waitingOn(state, r)}
              canDecide={() => owner}
              onDecide={(r) => {
                setNotice('')
                setDeciding(r)
              }}
              regional={regional}
            />
          </section>
          <section className="surface ops-panel" aria-labelledby="requests-decided">
            <header>
              <div>
                <h2 id="requests-decided">Decided</h2>
                <p>Each decision is kept as it was made.</p>
              </div>
            </header>
            <DecidedRequests items={all} org={org} names={names} day={day} />
          </section>
        </>
      )}
      {form === 'raise' && (
        <RequestForm
          sites={places(state).filter((p) => !branch || p.id === branch)}
          org={org}
          limitMinor={limit}
          commit={commit}
          onClose={() => setForm(null)}
          onSaved={saved}
          regional={regional}
        />
      )}
      {form === 'limit' && regional && (
        <LimitForm
          org={org}
          limitMinor={limit}
          commit={commit}
          onClose={() => setForm(null)}
          onSaved={saved}
        />
      )}
      {deciding && (
        <DecideForm
          request={deciding}
          org={org}
          place={names.get(deciding.locationId) ?? 'A closed location'}
          commit={commit}
          onClose={() => setDeciding(null)}
          onSaved={saved}
        />
      )}
    </div>
  )
}

function LimitForm({
  org,
  limitMinor,
  commit,
  onClose,
  onSaved,
}: {
  org: Org
  limitMinor: number
  commit: Commit
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [amount, setAmount] = useState(String(limitMinor / 100))
  const { pending, error, setError, run } = useSave(commit, onSaved)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const typed = amount.trim().replace(/,/g, '')
    const minor = Math.round(Number(typed) * 100)
    if (!typed || !Number.isFinite(minor) || minor < 0)
      return setError('Enter an amount, such as 500. Use 0 to send every request to you.')
    void run(
      { type: 'approval-limit', regionalLimitMinor: minor },
      `Regional managers can now approve up to ${money(minor, org)}.`,
    )
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Regional limit"
      description="The most a regional manager may approve on their own. Requests already raised keep where they were sent."
    >
      <form className="plan-form" onSubmit={submit}>
        <label className="ops-field">
          Up to, in {org.currency}
          <input
            inputMode="decimal"
            value={amount}
            required
            disabled={pending}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            Save limit
          </Button>
        </div>
      </form>
    </Modal>
  )
}
