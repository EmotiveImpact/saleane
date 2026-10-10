import { useState } from 'react'
import type { FormEvent } from 'react'
import { Send } from 'lucide-react'
import { useStore } from '../state/context'
import { Button, DateField, Empty, ErrorMessage, Modal, PageHeader } from '../design'
import { addDays, dateLabel, money } from '../domain/format'
import { minorInput, parseMinor } from '../domain/money'
import { offeredAt, places, serviceAt } from '../domain/locations'
import { can } from '../domain/operations'
import { regions } from '../domain/group'
import { regionalLimit, requests, waitingOn } from '../domain/approvals'
import { PRICE_AHEAD_DAYS } from '../domain/approvalsSchema'
import type { ApprovalRequest } from '../domain/approvalsSchema'
import {
  afterApproval,
  onApproval,
  refundLimitFor,
  requestContext,
  requestRows,
  requestSummary,
  rotaSignOff,
} from '../domain/signoffs'
import type { RequestContext } from '../domain/signoffs'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'
import '../components/management.css'
import '../components/plans.css'
import '../components/branchVisits.css'
import '../components/signoffs.css'

type Commit = (command: Command) => Promise<{ ok: true } | { ok: false; error: string }>
type Org = Pick<BusinessState['organisation'], 'locale' | 'currency'>
/** How each request is described: its place, the studio's today and an approved refund's standing. */
type Words = (r: ApprovalRequest) => RequestContext
/** Decided requests are shown thirty at a time; every one stays reachable. */
const HISTORY_PAGE = 30

const PASSED_UP: Record<NonNullable<ApprovalRequest['passedUp']>, string> = {
  'over-limit': 'it is more than a regional manager may approve',
  'no-region': 'its location is in no region',
  'no-manager': 'its region has no regional manager',
  'own-request': 'its region’s own regional manager raised it',
}

const firstName = (name: string | undefined) => name?.trim().split(/\s+/)[0]

/** "Islington · asked Tuesday 6 October by Nadia Ross". */
function askedLine(r: ApprovalRequest, ctx: RequestContext) {
  return `${ctx.place} · asked ${dateLabel(r.raisedAt.slice(0, 10), ctx.org.locale)}${r.raisedBy ? ` by ${r.raisedBy}` : ''}`
}

/** Who a waiting request is with, and why it went to them. */
function waitingLine(r: ApprovalRequest, on: string, regional: boolean) {
  return `Waiting on ${on}${regional && r.passedUp ? `, because ${PASSED_UP[r.passedUp]}.` : '.'}`
}

/** What is asked, in a line, and the reason given. */
function Asked({ r, ctx }: { r: ApprovalRequest; ctx: RequestContext }) {
  const summary = requestSummary(r, ctx)
  return (
    <>
      <strong>{r.title}</strong>
      {summary && <span className="signoff-asked">{summary}</span>}
      {r.note && <p>{r.note}</p>}
      <span className="visits-meta">{askedLine(r, ctx)}</span>
    </>
  )
}

/** Requests still waiting, with who each waits on, and buttons for whoever may decide it. */
export function WaitingRequests({
  items,
  words,
  waiting,
  canDecide,
  onDecide,
  regional = true,
}: {
  items: ApprovalRequest[]
  words: Words
  waiting: (r: ApprovalRequest) => string
  canDecide: (r: ApprovalRequest) => boolean
  onDecide: (r: ApprovalRequest) => void
  /** False while the studio has no regions: every request goes to the owner, so no reason is given. */
  regional?: boolean
}) {
  if (!items.length) return <p className="ops-help">Nothing is waiting for a sign-off.</p>
  return (
    <ul className="visits-list">
      {items.map((r) => {
        const ctx = words(r)
        return (
          <li key={r.id}>
            <div>
              <Asked r={r} ctx={ctx} />
              <span className="visits-meta">{waitingLine(r, waiting(r), regional)}</span>
              <span className="signoff-then">
                {onApproval(r, ctx, firstName(r.raisedBy) ?? 'They')}
              </span>
            </div>
            {canDecide(r) && (
              <Button
                variant="secondary"
                aria-label={`Decide: ${r.title}`}
                onClick={() => onDecide(r)}
              >
                Decide
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Decided requests, newest first, each with what was said and what became of it. */
export function DecidedRequests({ items, words }: { items: ApprovalRequest[]; words: Words }) {
  const [shown, setShown] = useState(HISTORY_PAGE)
  const decided = items
    .filter((r) => r.decision)
    .sort((a, b) => b.decision!.at.localeCompare(a.decision!.at))
  if (!decided.length) return <p className="ops-help">No requests decided yet.</p>
  return (
    <>
      <ul className="visits-list">
        {decided.slice(0, shown).map((r) => {
          const ctx = words(r)
          const then = afterApproval(r, ctx)
          return (
            <li key={r.id}>
              <div>
                <Asked r={r} ctx={ctx} />
                <span className="visits-meta">
                  <span className={`visits-answer visits-answer-${r.decision!.outcome}`}>
                    {r.decision!.outcome === 'approved' ? 'Approved' : 'Declined'}
                  </span>{' '}
                  {dateLabel(r.decision!.at.slice(0, 10), ctx.org.locale)}
                  {r.decision!.by ? ` by ${r.decision!.by}` : ''}
                </span>
                {r.decision!.note && <p>{r.decision!.note}</p>}
                {then && <span className="signoff-then">{then}</span>}
              </div>
            </li>
          )
        })}
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

/** A treatment as a new price request offers it: its name and its price at that location now. */
export type PricedTreatment = { id: string; name: string; priceMinor: number }
type Kind = 'spend' | 'other' | 'price'

/**
 * Raising a request. The studio page and a regional manager's area page both use it. A general
 * manager can also ask for a new price, when `treatments` is given; refunds are asked for from
 * the receipt, and rota days from the rota.
 */
export function RequestForm({
  sites,
  org,
  limitMinor,
  commit,
  onClose,
  onSaved,
  regional = true,
  treatments,
  today,
}: {
  sites: { id: string; name: string }[]
  org: Org
  limitMinor: number
  commit: Commit
  onClose: () => void
  onSaved: (message: string) => void
  /** False while the studio has no regions, when every request goes straight to the owner. */
  regional?: boolean
  /** The treatments on the menu at a location, for asking for a new price there. */
  treatments?: (locationId: string) => PricedTreatment[]
  /** The studio's today, the first day a new price can start. */
  today?: string
}) {
  const [locationId, setLocationId] = useState(sites[0]?.id ?? '')
  const [kind, setKind] = useState<Kind>('spend')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [startsOn, setStartsOn] = useState(today ?? '')
  const { pending, error, setError, run } = useSave(commit, onSaved)
  const menu = treatments && today ? treatments(locationId) : []
  const treatment = menu.find((t) => t.id === serviceId) ?? menu[0]
  const pricing = kind === 'price' && !!treatment

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (kind === 'price') {
      if (!treatment) return setError('Choose a treatment.')
      const priceMinor = parseMinor(amount.trim().replace(/,/g, ''))
      if (!Number.isFinite(priceMinor))
        return setError('Enter the new price, such as 105 or 105.50.')
      if (!startsOn) return setError('Choose the day the new price starts.')
      return void run(
        {
          type: 'request-raise',
          input: {
            locationId,
            kind: 'price',
            price: { serviceId: treatment.id, priceMinor, startsOn },
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        },
        `A new price for ${treatment.name} sent for a sign-off. Nothing changes until it is approved.`,
      )
    }
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
      <form className="plan-form signoff-form" onSubmit={submit}>
        <div className="ops-fields">
          <label>
            Location
            <select
              value={locationId}
              disabled={pending}
              onChange={(e) => {
                setLocationId(e.target.value)
                setServiceId('')
              }}
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
              onChange={(e) => {
                setKind(e.target.value as Kind)
                setAmount('')
                setError('')
              }}
            >
              <option value="spend">Spending</option>
              {menu.length > 0 && <option value="price">A new price</option>}
              <option value="other">Something else</option>
            </select>
          </label>
          {pricing ? (
            <>
              <label className="ops-wide">
                Treatment
                <select
                  value={treatment.id}
                  disabled={pending}
                  onChange={(e) => setServiceId(e.target.value)}
                >
                  {menu.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}, {money(t.priceMinor, org, true)} now
                    </option>
                  ))}
                </select>
              </label>
              <label>
                New price in {org.currency}
                <input
                  inputMode="decimal"
                  value={amount}
                  required
                  disabled={pending}
                  placeholder={minorInput(treatment.priceMinor)}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <div className="ops-field">
                <span id="price-starts-label">Starts on</span>
                <DateField
                  id="price-starts"
                  locale={org.locale}
                  today={today!}
                  min={today}
                  max={addDays(today!, PRICE_AHEAD_DAYS)}
                  value={startsOn}
                  disabled={pending}
                  required
                  onChange={setStartsOn}
                  aria-labelledby="price-starts-label price-starts"
                />
              </div>
              <p className="ops-help ops-wide">
                Once approved, the price changes at {sites.find((p) => p.id === locationId)?.name}{' '}
                on that day by itself. Visits already booked keep the price they were booked at.
              </p>
            </>
          ) : (
            <>
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
            </>
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
          <Button
            type="submit"
            disabled={pending || (pricing ? !amount.trim() : title.trim().length < 2)}
          >
            Send for sign-off
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Approving or declining one request, with what it asks and what approving does. */
export function DecideForm({
  request,
  ctx,
  waiting,
  regional = true,
  commit,
  onClose,
  onSaved,
}: {
  request: ApprovalRequest
  ctx: RequestContext
  /** Who it is waiting on, such as "you" or "the owner". */
  waiting: string
  regional?: boolean
  commit: Commit
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [note, setNote] = useState('')
  const { pending, error, run } = useSave(commit, onSaved)
  const rows = requestRows(request, ctx)
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
      description={`${askedLine(request, ctx)}. A decision cannot be changed afterwards.`}
    >
      <form className="plan-form signoff-form" onSubmit={(e) => e.preventDefault()}>
        {rows.length > 0 && (
          <div className="ops-receipt signoff-rows">
            {rows.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        )}
        {request.note && (
          <p>
            <strong>Why: </strong>
            {request.note}
          </p>
        )}
        <p className="ops-help">
          {waitingLine(request, waiting, regional)}{' '}
          {onApproval(request, ctx, firstName(request.raisedBy) ?? 'They')}
        </p>
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

/** The owner's sign-off rules, in a sentence each, for everyone who reads the page. */
function ruleLines(state: BusinessState, regional: boolean) {
  const org = state.organisation
  const limit = (role: 'general' | 'manager') => refundLimitFor(state, role)
  const general = limit('general')
  const manager = limit('manager')
  const rota = rotaSignOff(state)
  return [
    regional &&
      `Regional managers approve up to ${money(regionalLimit(state), org)}; anything more passes up to the owner.`,
    general !== null &&
      `General managers give back up to ${money(general, org, true)} on a receipt without a sign-off.`,
    manager !== null &&
      `Managers give back up to ${money(manager, org, true)} on a receipt without a sign-off.`,
    rota === 'extra' && 'An extra day on a general manager’s rota needs a sign-off.',
    rota === 'all' && 'Every change a general manager makes to the rota needs a sign-off.',
  ].filter((line): line is string => !!line)
}

/**
 * V5: requests for a sign-off. Managers raise them; each goes to its region's manager, or passes
 * up to the owner when it costs more than they may approve or has no regional manager. The owner
 * can decide any request and sets the rules.
 *
 * Stage 4: a refund over a manager's limit, a new price at one location and a day on the rota
 * are requests too. Each shows what is asked, before and after, and what approving does.
 */
export function Requests() {
  const { state, role, blocked, commit, branch, today } = useStore()
  const org = state.organisation
  const raise = !blocked && can(role, 'request-raise')
  const owner = !blocked && can(role, 'request-decide')
  const setsRules = !blocked && can(role, 'approval-limit')
  const [form, setForm] = useState<'raise' | 'rules' | null>(null)
  const [deciding, setDeciding] = useState<ApprovalRequest | null>(null)
  const [notice, setNotice] = useState('')
  const now = new Date().toISOString()
  const words: Words = (r) => requestContext(state, r, now)
  const all = requests(state)
  const waiting = all
    .filter((r) => !r.decision)
    .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt))
  const limit = regionalLimit(state)
  // Regional managers and their limit only matter once the studio has grouped its locations.
  const regional = regions(state).length > 0
  const rules = ruleLines(state, regional)
  // A general manager asks for a new price; owners and managers change prices themselves.
  const treatments = can(role, 'catalogue')
    ? undefined
    : (locationId: string): PricedTreatment[] =>
        state.services
          .filter((x) => !x.archived && offeredAt(x, locationId))
          .map((x) => ({ id: x.id, name: x.name, priceMinor: serviceAt(x, locationId).priceMinor }))
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
            ? 'Spending, refunds, new prices, rota changes and anything else that needs a sign-off, from the regional manager or the owner.'
            : 'Spending, refunds, new prices, rota changes and anything else that needs the owner’s sign-off.'
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
            {setsRules && (
              <Button
                variant="secondary"
                onClick={() => {
                  setNotice('')
                  setForm('rules')
                }}
              >
                Sign-off rules
              </Button>
            )}
          </>
        }
      />
      {rules.length > 0 && (
        <div className="ops-help signoff-rules">
          {rules.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      {notice && (
        <p className="success-strip" role="status">
          {notice}
        </p>
      )}
      {all.length === 0 ? (
        <section className="surface" aria-label="No requests yet">
          <Empty title="No requests yet" level={2}>
            When a manager needs to spend money or change something at a location, such as a new
            basin or a new price, they ask here. A refund over their limit is asked for from its
            receipt.{' '}
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
              words={words}
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
                <p>Each decision is kept as it was made, with what came of it.</p>
              </div>
            </header>
            <DecidedRequests items={all} words={words} />
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
          treatments={treatments}
          today={today}
        />
      )}
      {form === 'rules' && (
        <RulesForm
          state={state}
          regional={regional}
          commit={commit}
          onClose={() => setForm(null)}
          onSaved={saved}
        />
      )}
      {deciding && (
        <DecideForm
          request={deciding}
          ctx={words(deciding)}
          waiting={waitingOn(state, deciding) === 'the owner' ? 'you' : waitingOn(state, deciding)}
          regional={regional}
          commit={commit}
          onClose={() => setDeciding(null)}
          onSaved={saved}
        />
      )}
    </div>
  )
}

/** A limit typed in pounds or dollars, or empty for none. NaN when it cannot be read. */
const typedLimit = (typed: string) => parseMinor(typed.trim().replace(/,/g, ''), -1)

/**
 * The owner's rules: what a general manager may give back on one receipt, which of their rota
 * changes need a sign-off and, with regions, what a regional manager may approve. A limit for
 * managers is rarely wanted, so it sits behind More options.
 */
function RulesForm({
  state,
  regional,
  commit,
  onClose,
  onSaved,
}: {
  state: BusinessState
  regional: boolean
  commit: Commit
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const org = state.organisation
  const shown = (minor: number | null) => (minor === null ? '' : minorInput(minor))
  const [regionalAmount, setRegionalAmount] = useState(String(regionalLimit(state) / 100))
  const [general, setGeneral] = useState(shown(refundLimitFor(state, 'general')))
  const [manager, setManager] = useState(shown(refundLimitFor(state, 'manager')))
  const [rota, setRota] = useState<'off' | 'extra' | 'all'>(rotaSignOff(state) ?? 'off')
  const { pending, error, setError, run } = useSave(commit, onSaved)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const regionalMinor = typedLimit(regionalAmount)
    const generalMinor = typedLimit(general)
    const managerMinor = typedLimit(manager)
    if (regional && (!Number.isFinite(regionalMinor) || regionalMinor < 0))
      return setError(
        'Enter what a regional manager may approve, such as 500. Use 0 to send every request to you.',
      )
    if (!Number.isFinite(generalMinor) || !Number.isFinite(managerMinor))
      return setError('Enter a refund limit such as 50, or leave it empty for no limit.')
    void run(
      {
        type: 'signoff-rules',
        ...(regional ? { regionalLimitMinor: regionalMinor } : {}),
        generalRefundLimitMinor: generalMinor < 0 ? null : generalMinor,
        managerRefundLimitMinor: managerMinor < 0 ? null : managerMinor,
        rotaSignOff: rota,
      },
      'Sign-off rules saved. They apply from now; requests already raised keep where they were sent.',
    )
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Sign-off rules"
      description="What your team can do on their own, and what waits for a sign-off first."
    >
      <form className="plan-form signoff-form" onSubmit={submit}>
        <div className="ops-fields">
          <label>
            General managers give back without a sign-off, up to ({org.currency})
            <input
              inputMode="decimal"
              value={general}
              placeholder="No limit"
              disabled={pending}
              onChange={(e) => setGeneral(e.target.value)}
            />
            <small>On one receipt, counting what has gone back already. Empty for no limit.</small>
          </label>
          <label>
            A general manager’s rota changes
            <select
              value={rota}
              disabled={pending}
              onChange={(e) => setRota(e.target.value as 'off' | 'extra' | 'all')}
            >
              <option value="off">Need no sign-off</option>
              <option value="extra">Extra days need a sign-off</option>
              <option value="all">Every change needs a sign-off</option>
            </select>
            <small>An extra day is a day someone does not usually work.</small>
          </label>
          {regional && (
            <label>
              Regional managers approve up to ({org.currency})
              <input
                inputMode="decimal"
                value={regionalAmount}
                required
                disabled={pending}
                onChange={(e) => setRegionalAmount(e.target.value)}
              />
              <small>Anything more passes up to you.</small>
            </label>
          )}
        </div>
        <details className="signoff-more" open={refundLimitFor(state, 'manager') !== null}>
          <summary>More options</summary>
          <div className="ops-fields">
            <label>
              Managers give back without a sign-off, up to ({org.currency})
              <input
                inputMode="decimal"
                value={manager}
                placeholder="No limit"
                disabled={pending}
                onChange={(e) => setManager(e.target.value)}
              />
              <small>Most studios leave this empty, so managers need no sign-off.</small>
            </label>
          </div>
        </details>
        <p className="ops-help">
          Over the limit, the refund waits as a request for that receipt and amount. Approving it
          moves no money: it can then be given back once, from the receipt.
        </p>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            Save rules
          </Button>
        </div>
      </form>
    </Modal>
  )
}
