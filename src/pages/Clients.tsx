import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, FileUp } from 'lucide-react'
import { can, operations } from '../domain/operations'
import { useStore } from '../state/context'
import { clientStats, dueClients } from '../domain/selectors'
import { dateLabel, money } from '../domain/format'
import { Avatar, Button, Empty, ErrorMessage, Modal, PageHeader, SegmentedControl } from '../design'
import { ClientImport } from '../components/ClientImport'

export function Clients() {
  const { state, commit, blocked, saving, role } = useStore()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const busy = pending || saving
  const allowed = !blocked && can(role, 'client')
  const [query, setQuery] = useState('')
  const [segment, setSegment] = useState('all')
  const [newClient, setNewClient] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [referrer, setReferrer] = useState('')
  const due = dueClients(state)
  const clients = state.clients.filter(
    (c) =>
      (segment !== 'due' || due.some((d) => d.id === c.id)) &&
      (segment !== 'consented' || c.marketingConsent) &&
      `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(query.toLowerCase()),
  )
  async function save(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy || !allowed) return
    setPending(true)
    setError('')
    try {
      const result = await commit({
        type: 'client',
        contact: { name, email, phone, marketingConsent: consent },
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
  return (
    <>
      <PageHeader
        variant="compact"
        title="Relationships, remembered."
        description="Know their story. Give the next visit a reason."
        actions={
          <>
            {can(role, 'import-clients') && (
              <Button
                variant="secondary"
                disabled={blocked || busy}
                onClick={() => setImporting(true)}
              >
                <FileUp size={17} />
                Import clients
              </Button>
            )}
            <Button disabled={!allowed || busy} onClick={() => setNewClient(true)}>
              <Plus size={17} />
              Add client
            </Button>
          </>
        }
      />
      <section className="surface">
        <div className="directory-toolbar">
          <SegmentedControl
            label="Client segments"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'all', label: `All clients (${state.clients.length})` },
              { value: 'due', label: `Ready to return (${due.length})` },
              { value: 'consented', label: 'Email marketing enabled' },
            ]}
          />
          <label className="search-field">
            <Search size={17} />
            <span className="sr-only">Search clients</span>
            <input
              placeholder="Search clients"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="client-table-wrap">
          <table className="client-table">
            <caption className="sr-only">
              Client directory with visit history, completed service spend and next visit
            </caption>
            <thead>
              <tr>
                <th>Client</th>
                <th>Visits</th>
                <th>Service spend</th>
                <th>Next visit</th>
                <th>
                  <span className="sr-only">Status</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client, index) => {
                const stats = clientStats(state, client.id)
                return (
                  <tr key={client.id}>
                    <td>
                      <Link className="client-cell" to={`/clients/${client.id}`}>
                        <Avatar
                          identity={client.id}
                          name={client.name}
                          tone={['sage', 'blue', 'sand'][index % 3]}
                        />
                        <span>
                          <strong>{client.name}</strong>
                          <small>{client.email}</small>
                          <small className="client-mobile-meta">
                            {money(stats.spend, state.organisation)} ·{' '}
                            {stats.next
                              ? `Next ${dateLabel(stats.next.date, state.organisation.locale, true)}`
                              : 'No next visit'}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>{stats.visits}</td>
                    <td className="numeric">{money(stats.spend, state.organisation)}</td>
                    <td>
                      {stats.next ? (
                        dateLabel(stats.next.date, state.organisation.locale, true)
                      ) : (
                        <span className="subtle">No next visit</span>
                      )}
                    </td>
                    <td>
                      {due.some((c) => c.id === client.id) && (
                        <span className="client-flag">Ready to return</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!clients.length && (
          <Empty title="No clients found">
            Try a name, email or phone number, or choose another segment.
          </Empty>
        )}
      </section>
      {importing && <ClientImport onClose={() => setImporting(false)} />}
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
                Phone with country code
                <input
                  required
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={
                    state.organisation.region === 'UK' ? '+44 7700 900123' : '+1 212 555 0123'
                  }
                  autoComplete="off"
                />
              </label>
              <label>
                Introduced by
                <select value={referrer} onChange={(e) => setReferrer(e.target.value)}>
                  <option value="">No referral recorded</option>
                  {state.clients.map((c) => (
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
                ? 'Use fictional details only. This is a sandbox workspace.'
                : 'The record is saved to your local workspace. Marketing permission is independent of booking.'}
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
