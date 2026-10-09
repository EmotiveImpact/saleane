import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ClipboardCheck, Send, Sun } from 'lucide-react'
import { useStore } from '../state/context'
import { api, ApiError } from '../state/api'
import type { AreaWorkspace, RemoteWorkspace } from '../state/api'
import { readPendingKeys, requestFingerprint, writePendingKeys } from '../state/journal'
import { areaViewSchema } from '../domain/area'
import type { AreaView } from '../domain/area'
import type { Command } from '../domain/commands'
import { dateLabel, money } from '../domain/format'
import { GROUP_WINDOW_DAYS, monthEstimate } from '../domain/group'
import { venueMinutes } from '../domain/pocket'
import { Button, ErrorMessage, PageHeader } from '../design'
import { PutRightList, VisitForm, VisitHistory } from './BranchVisits'
import { DecideForm, DecidedRequests, RequestForm, WaitingRequests } from './Requests'
import type { ApprovalRequest } from '../domain/approvalsSchema'
import '../practitioner.css'
import '../components/management.css'
import '../components/plans.css'
import '../components/group.css'
import '../components/branchVisits.css'

function greeting(minutes: number) {
  if (minutes < 12 * 60) return 'Good morning'
  if (minutes < 17 * 60) return 'Good afternoon'
  return 'Good evening'
}
const PENDING_AREA_KEY = 'saleane.pending-area.v1'
const pct = (n: number) => `${Math.round(n * 100)}%`
const changeLabel = (growth: number | null) =>
  growth === null
    ? 'Nothing to compare'
    : Math.round(growth * 100) === 0
      ? 'Level'
      : `${growth > 0 ? 'Up' : 'Down'} ${pct(Math.abs(growth))}`

/**
 * V5: a regional manager's area. The server sends only their region's figures and branch visits;
 * this screen never holds the studio record. They can record a branch visit and mark a line put
 * right, and raise and decide requests for a sign-off, at their own locations only.
 */
export function AreaHome() {
  const { orgId = '' } = useParams()
  const store = useStore()
  const navigate = useNavigate()
  const [record, setRecord] = useState<AreaView | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<'visit' | 'request' | null>(null)
  const [deciding, setDeciding] = useState<ApprovalRequest | null>(null)
  const [saving, setSaving] = useState(false)
  // The greeting follows the studio's clock when the page opened.
  const [openedAt] = useState(() => Date.now())
  const [journal] = useState(() => readPendingKeys(PENDING_AREA_KEY))
  const pending = useRef(journal.keys)
  const path = `/api/workspaces/${encodeURIComponent(orgId)}`

  async function load() {
    const next = await api<AreaWorkspace | RemoteWorkspace>(path)
    if (next.view === 'studio') {
      await store.openWorkspace(orgId)
      navigate('/today', { replace: true })
      return null
    }
    const view = areaViewSchema.parse(next.area)
    setRecord(view)
    return view
  }
  useEffect(() => {
    let active = true
    ;(async () => {
      const session = store.session ?? (await store.refreshSession())
      if (!session) {
        navigate('/account', { replace: true })
        return
      }
      await load()
    })().catch((e) => {
      if (active) setError(e instanceof Error ? e.message : 'Your area could not be loaded.')
    })
    return () => {
      active = false
    }
    // The area loads once per studio; saves refresh it from their own responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])
  useEffect(() => {
    if (record) document.documentElement.lang = record.organisation.locale
  }, [record])

  /** One saved change with a request key kept until the server answers, as on the desk. */
  async function save(command: Command): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!record || !store.session || saving) return { ok: false, error: 'Please wait a moment.' }
    if (store.connection !== 'online')
      return {
        ok: false,
        error: 'Offline. Changes are paused until SALEANE reconnects and checks your access.',
      }
    if (journal.error) return { ok: false, error: journal.error }
    setSaving(true)
    let forget = () => {}
    try {
      const fingerprint = await requestFingerprint(orgId, store.session.user.id, command)
      let key = pending.current.get(fingerprint)
      if (!key) {
        key = crypto.randomUUID()
        pending.current = writePendingKeys(pending.current, fingerprint, key, PENDING_AREA_KEY)
      }
      forget = () => {
        try {
          pending.current = writePendingKeys(
            pending.current,
            fingerprint,
            undefined,
            PENDING_AREA_KEY,
          )
        } catch {
          // A key left behind only replays this same receipt.
        }
      }
      const result = await api<AreaWorkspace | RemoteWorkspace>(`${path}/commands`, {
        method: 'POST',
        key,
        body: { revision: record.revision, command },
      })
      forget()
      // The owner may have changed this person's access while the page was open.
      if (result.view === 'studio') {
        await store.openWorkspace(orgId)
        navigate('/today', { replace: true })
        return { ok: true }
      }
      setRecord(areaViewSchema.parse(result.area))
      return { ok: true }
    } catch (e) {
      if (e instanceof ApiError && e.status > 0 && e.status < 500) forget()
      if (e instanceof ApiError && e.status === 409) {
        await load().catch(() => null)
        return { ok: false, error: 'Your area changed meanwhile. The latest is shown; try again.' }
      }
      return { ok: false, error: e instanceof Error ? e.message : 'This could not be saved.' }
    } finally {
      setSaving(false)
    }
  }

  if (!record)
    return (
      <main className="candidate-loading">
        <span className="wordmark">SALEANE</span>
        <h1>Opening your area…</h1>
        {error ? (
          <>
            <ErrorMessage error={error} />
            <Link className="text-link" to="/account">
              Back to your account
            </Link>
          </>
        ) : (
          <p role="status">Gathering your region’s locations.</p>
        )}
      </main>
    )

  const org = record.organisation
  const day = (date: string) => dateLabel(date, org.locale)
  const names = new Map(record.places.map((p) => [p.id, p.name]))
  const monthName = new Intl.DateTimeFormat(org.locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${record.window.month}-15T12:00:00Z`),
  )
  const open = record.visits
    .flatMap((visit) =>
      visit.answers
        .filter((a) => a.answer === 'no' && !a.fixed)
        .map((line) => ({ visit, line, place: names.get(visit.locationId) ?? 'A location' })),
    )
    .sort((a, b) => b.visit.date.localeCompare(a.visit.date))
  const mine = (r: ApprovalRequest) =>
    r.routedTo.level === 'regional' && r.routedTo.regionId === record.area.id
  const waitingRequests = record.requests
    .filter((r) => !r.decision)
    .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt))
  const monthLine = (m: AreaView['total']['month']) =>
    `${money(m.takenMinor, org)} taken${m.targetMinor ? ` of ${money(m.targetMinor, org)}` : ''}`

  return (
    <div className="practitioner-layout area-layout">
      <header className="practitioner-header">
        <Link to="/account" className="wordmark">
          SALEANE
        </Link>
        <span>
          <strong>{org.name}</strong>
          <small>Regional manager · {record.area.name}</small>
        </span>
      </header>
      <main id="main-content" className="area-main">
        <PageHeader
          variant="editorial"
          eyebrow={
            <>
              <Sun size={16} />
              {day(record.today)}
            </>
          }
          title={`${greeting(venueMinutes(org.timeZone, openedAt))}, ${record.area.name}.`}
          actions={
            <>
              {record.checklists.length > 0 && (
                <Button
                  onClick={() => {
                    setNotice('')
                    setForm('visit')
                  }}
                >
                  <ClipboardCheck size={17} aria-hidden="true" />
                  Start a branch visit
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => {
                  setNotice('')
                  setForm('request')
                }}
              >
                <Send size={17} aria-hidden="true" />
                Ask for a sign-off
              </Button>
            </>
          }
        />
        {notice && (
          <p className="success-strip" role="status">
            {notice}
          </p>
        )}
        <ErrorMessage error={error} />
        <section className="surface group-panel" aria-labelledby="area-summary-title">
          <h2 id="area-summary-title">Your area today</h2>
          <div className="group-summary">
            {record.summary.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <ul className="group-places">
            {record.places.map((p) => (
              <li key={p.id}>
                <div className="group-place-name">
                  <strong>{p.name}</strong>
                  {p.tag && (
                    <span className="group-tag">
                      {p.tag === 'best' ? 'Doing best' : 'Needs a look'}
                    </span>
                  )}
                </div>
                <dl>
                  <div>
                    <dt>Booked today</dt>
                    <dd>{p.bookedToday}</dd>
                  </div>
                  <div>
                    <dt>Last {GROUP_WINDOW_DAYS} days</dt>
                    <dd>{money(p.figures.takingsMinor, org)}</dd>
                  </div>
                  <div>
                    <dt>Change</dt>
                    <dd>{changeLabel(p.figures.growth)}</dd>
                  </div>
                  <div>
                    <dt>Rebooked</dt>
                    <dd>
                      {p.figures.rebookRate === null ? 'No visits yet' : pct(p.figures.rebookRate)}
                    </dd>
                  </div>
                  <div>
                    <dt>{monthName}</dt>
                    <dd>
                      {monthLine(p.figures.month)}
                      {p.figures.month.targetMinor ? (
                        <small>
                          {' '}
                          ({pct(p.figures.month.takenMinor / p.figures.month.targetMinor)})
                        </small>
                      ) : (
                        <small> · no target</small>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Month-end estimate</dt>
                    <dd>{monthEstimate(p.figures.month, org)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
        <section className="surface ops-panel" aria-labelledby="area-put-right">
          <header>
            <div>
              <h2 id="area-put-right">To put right</h2>
              <p>
                Lines answered no on a branch visit in your area, until someone marks them done.
              </p>
            </div>
          </header>
          <PutRightList
            items={open}
            day={day}
            canFix
            pending={saving}
            onFix={(visit, line) => {
              setNotice('')
              setError('')
              void save({ type: 'branch-visit-fix', visitId: visit.id, itemId: line.itemId }).then(
                (result) =>
                  result.ok
                    ? setNotice(`Marked as put right: ${line.text}`)
                    : setError(result.error),
              )
            }}
          />
        </section>
        <section className="surface ops-panel" aria-labelledby="area-requests">
          <header>
            <div>
              <h2 id="area-requests">Requests</h2>
              <p>
                You can approve up to {money(record.regionalLimitMinor, org)} at your locations.
                Anything more passes up to the owner.
              </p>
            </div>
          </header>
          <WaitingRequests
            items={waitingRequests}
            org={org}
            names={names}
            day={day}
            waiting={(r) => (mine(r) ? 'you' : 'the owner')}
            canDecide={mine}
            onDecide={(r) => {
              setNotice('')
              setDeciding(r)
            }}
          />
          <h3 className="group-form-title">Decided</h3>
          <DecidedRequests items={record.requests} org={org} names={names} day={day} />
        </section>
        <section className="surface ops-panel" aria-labelledby="area-history">
          <header>
            <div>
              <h2 id="area-history">Branch visits</h2>
              <p>Each kept exactly as it was answered on the day.</p>
            </div>
          </header>
          <VisitHistory visits={record.visits} names={names} day={day} />
        </section>
        <p className="ops-help area-scope">
          You see your region’s locations only: their figures, what is booked today, their branch
          visits and their requests. Clients, diaries, prices and settings stay with the studio
          team.
        </p>
      </main>
      {form === 'request' && (
        <RequestForm
          sites={record.places}
          org={org}
          limitMinor={record.regionalLimitMinor}
          commit={save}
          onClose={() => setForm(null)}
          onSaved={(message) => {
            setNotice(message)
            setForm(null)
          }}
        />
      )}
      {deciding && (
        <DecideForm
          request={deciding}
          org={org}
          place={names.get(deciding.locationId) ?? 'A location'}
          commit={save}
          onClose={() => setDeciding(null)}
          onSaved={(message) => {
            setNotice(message)
            setDeciding(null)
          }}
        />
      )}
      {form === 'visit' && (
        <VisitForm
          sites={record.places}
          lists={record.checklists}
          today={record.today}
          commit={save}
          onClose={() => setForm(null)}
          onSaved={(message) => {
            setNotice(message)
            setForm(null)
          }}
        />
      )}
    </div>
  )
}
