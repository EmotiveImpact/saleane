import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, FileUp } from 'lucide-react'
import { businessDate, can, operations } from '../domain/operations'
import { useStore } from '../state/context'
import { directoryRows, queryDirectory } from '../domain/directory'
import type { DirectorySegment, DirectorySort } from '../domain/directory'
import { addDays, money } from '../domain/format'
import {
  Avatar,
  Button,
  Empty,
  ErrorMessage,
  Modal,
  PageHeader,
  SegmentedControl,
  photos,
} from '../design'
import { MovingIn } from '../components/MovingIn'
import { guestPhone, phoneProblem } from '../domain/phone'

export function Clients() {
  const { state, commit, blocked, saving, role } = useStore()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const busy = pending || saving
  const allowed = !blocked && can(role, 'client')
  const [query, setQuery] = useState('')
  const [segment, setSegment] = useState<DirectorySegment>('all')
  const [newClient, setNewClient] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [referrer, setReferrer] = useState('')
  const [sort, setSort] = useState<DirectorySort>('recent')
  const [page, setPage] = useState(1)
  const rows = useMemo(() => directoryRows(state), [state])
  const result = queryDirectory(rows, { segment, query, sort, page })
  const today = businessDate(state)
  const { locale } = state.organisation
  function visitDay(date: string) {
    if (date === today) return 'Today'
    if (date === addDays(today, -1)) return 'Yesterday'
    if (date === addDays(today, 1)) return 'Tomorrow'
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
    }).format(new Date(`${date}T12:00:00Z`))
  }
  function refine(update: () => void) {
    update()
    setPage(1)
  }
  async function save(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy || !allowed) return
    // A local number in the studio's own country works as well as one with its country code.
    const number = guestPhone(state.organisation.region, phone)
    if (!number) {
      setError(phoneProblem(state.organisation.region))
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await commit({
        type: 'client',
        contact: { name, email, phone: number, marketingConsent: consent },
        referredById: referrer || undefined,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNewClient(false)
      navigate(`/clients/${result.recordId}`)
    } catch {
      setError('Could not save the client. Your entries are still here; try again.')
    } finally {
      setPending(false)
    }
  }
  const importAction = can(role, 'import-clients') && (
    <Button variant="secondary" disabled={blocked || busy} onClick={() => setImporting(true)}>
      <FileUp size={17} />
      Import clients
    </Button>
  )
  const addAction = (label: string) => (
    <Button disabled={!allowed || busy} onClick={() => setNewClient(true)}>
      <Plus size={17} />
      {label}
    </Button>
  )
  // A studio with no clients yet sees one welcoming page, not an empty table with filters at zero.
  const first = !rows.length
  return (
    <>
      {!first && (
        <PageHeader
          variant="compact"
          photo={{ src: photos.windowLight }}
          eyebrow="Clients"
          title="Relationships, remembered."
          description="Everyone who comes to the studio, what they love and when they are due back."
          actions={
            <>
              {importAction}
              {addAction('Add client')}
            </>
          }
        />
      )}
      <section className={first ? undefined : 'surface directory'}>
        {first ? (
          <Empty
            photo={photos.reception}
            photoPosition="44% center"
            eyebrow="Clients"
            level={1}
            title="Your clients will gather here."
            action={
              <>
                {addAction('Add your first client')}
                {importAction}
              </>
            }
          >
            Add someone yourself, or bring everyone across from your old system at once.
          </Empty>
        ) : (
          <>
            <div className="directory-toolbar">
              <SegmentedControl
                label="Client segments"
                appearance="chips"
                value={segment}
                onChange={(next) => refine(() => setSegment(next))}
                options={(
                  [
                    ['all', 'All clients'],
                    ['due', 'Ready to return'],
                    ['new', 'New this month'],
                    ['week', 'Booked this week'],
                    ['consented', 'Email marketing on'],
                  ] as const
                ).map(([value, label]) => ({
                  value,
                  label: (
                    <>
                      {label} <span className="chip-count">{result.counts[value]}</span>
                    </>
                  ),
                }))}
              />
              <div className="directory-controls">
                <label className="search-field">
                  <Search size={17} />
                  <span className="sr-only">Search by name, phone or email</span>
                  <input
                    placeholder="Search by name, phone or email"
                    type="search"
                    value={query}
                    onChange={(e) => refine(() => setQuery(e.target.value))}
                  />
                </label>
                <label className="sort-field">
                  <span className="sr-only">Sort clients</span>
                  <select
                    value={sort}
                    onChange={(e) => refine(() => setSort(e.target.value as DirectorySort))}
                  >
                    <option value="recent">Most recent visit</option>
                    <option value="name">Name A to Z</option>
                    <option value="visits">Most visits</option>
                    <option value="spend">Most spent</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="client-table-wrap">
              <table className="client-table">
                <caption className="sr-only">
                  Client directory with last and next visit, completed visits and treatment spend
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col" className="directory-wide">
                      Last visit
                    </th>
                    <th scope="col">Next visit</th>
                    <th scope="col" className="directory-wide numeric">
                      Visits
                    </th>
                    <th scope="col" className="directory-wide numeric">
                      Spent
                    </th>
                    <th scope="col" className="directory-wide">
                      <span className="sr-only">Status</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => {
                    const { client } = row
                    return (
                      <tr key={client.id}>
                        <td>
                          <Link className="client-cell" to={`/clients/${client.id}`}>
                            <Avatar identity={client.id} name={client.name} tone="sand" />
                            <span>
                              <strong>{client.name}</strong>
                              <small>{client.phone}</small>
                            </span>
                          </Link>
                        </td>
                        <td className="directory-wide">
                          {row.firstVisitToday ? (
                            'First visit today'
                          ) : row.lastDate ? (
                            visitDay(row.lastDate)
                          ) : (
                            <span className="subtle">No visits yet</span>
                          )}
                        </td>
                        <td>
                          {row.nextDate ? (
                            visitDay(row.nextDate)
                          ) : (
                            <span className="subtle">Not booked</span>
                          )}
                        </td>
                        <td className="directory-wide numeric">{row.visits}</td>
                        <td className="directory-wide numeric">
                          {money(row.spend, state.organisation)}
                        </td>
                        <td className="directory-wide">
                          {row.due ? (
                            <span className="tag tag-rose">Ready to return</span>
                          ) : row.isNew ? (
                            <span className="tag tag-brand">New</span>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!first && !result.total && (
          <Empty title="No clients match">
            Try a name, email or phone number, or choose another segment.
          </Empty>
        )}
        {result.total > 0 && (
          <nav className="directory-paging" aria-label="Client pages">
            <span role="status">
              Showing {result.from} to {result.to} of {result.total}
            </span>
            {result.pages > 1 && (
              <span className="directory-paging-buttons">
                <Button
                  variant="secondary"
                  disabled={result.page <= 1}
                  onClick={() => setPage(result.page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={result.page >= result.pages}
                  onClick={() => setPage(result.page + 1)}
                >
                  Next
                </Button>
              </span>
            )}
          </nav>
        )}
      </section>
      {importing && <MovingIn onClose={() => setImporting(false)} />}
      {newClient && (
        <Modal
          open
          onClose={() => {
            if (!busy) setNewClient(false)
          }}
          title="Begin a relationship"
          description="Create a client record and, if you know it, their connection to the studio."
        >
          <form onSubmit={save} aria-busy={busy}>
            <div className="form-grid">
              <label>
                Full name
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Email
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Phone
                <input
                  required
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={
                    state.organisation.region === 'UK' ? '07700 900123' : '(212) 555-0123'
                  }
                  autoComplete="off"
                />
              </label>
              <label>
                Introduced by
                <select value={referrer} onChange={(e) => setReferrer(e.target.value)}>
                  <option value="">No referral recorded</option>
                  {state.clients
                    .filter((c) => !c.erasedAt)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label className="checkbox-label consent-label">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              Client has given email marketing consent
            </label>
            <p className="subtle">
              {operations(state).mode === 'sandbox'
                ? 'This is a sample studio, so use made-up details only.'
                : 'Saved to your studio. Permission for marketing is separate from booking.'}
            </p>
            <ErrorMessage error={error} />
            <div className="dialog-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setNewClient(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !allowed}>
                {busy ? 'Saving…' : 'Save client'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
