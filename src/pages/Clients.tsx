import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowUpRight, Plus, Search } from 'lucide-react'
import { useStore } from '../state/context'
import { clientStats, dueClients } from '../domain/selectors'
import { dateLabel, money } from '../domain/format'
import { Avatar, Button, Empty, ErrorMessage, Modal } from '../components/ui'

export function Clients() {
  const { state, commit } = useStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [segment, setSegment] = useState('all')
  const [newClient, setNewClient] = useState(false)
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
  function save(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = commit({
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
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="date-caption">The people behind the appointments</p>
          <h1>Relationships, remembered.</h1>
          <p>Know their story. Give the next visit a reason.</p>
        </div>
        <Button onClick={() => setNewClient(true)}>
          <Plus size={17} />
          Add client
        </Button>
      </div>
      <section className="surface">
        <div className="directory-toolbar">
          <div className="segment-tabs" aria-label="Client segments">
            {[
              ['all', `All clients (${state.clients.length})`],
              ['due', `Ready to return (${due.length})`],
              ['consented', 'Email marketing enabled'],
            ].map(([value, label]) => (
              <button
                aria-pressed={segment === value}
                className={segment === value ? 'active' : ''}
                key={value}
                onClick={() => setSegment(value)}
              >
                {label}
              </button>
            ))}
          </div>
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
                <th>Relationship</th>
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
                      <Link className="relationship-link" to={`/clients/${client.id}`}>
                        {due.some((c) => c.id === client.id)
                          ? 'Ready to return'
                          : 'View relationship'}
                        <ArrowUpRight size={15} />
                      </Link>
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
      {newClient && (
        <Modal
          open
          onClose={() => setNewClient(false)}
          title="Begin a relationship"
          description="Create a client record and, if you know it, their connection to the studio."
        >
          <form onSubmit={save}>
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
              Use fictional details only. This demo stores data in your browser.
            </p>
            <ErrorMessage error={error} />
            <div className="dialog-footer">
              <Button type="button" variant="secondary" onClick={() => setNewClient(false)}>
                Cancel
              </Button>
              <Button type="submit">Save client</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
