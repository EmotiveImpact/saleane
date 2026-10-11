import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ArrowUpRight } from 'lucide-react'
import { useStore } from '../state/context'
import { dateLabel, timeLabel } from '../domain/format'
import { Avatar, Empty, Modal } from '../design'

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const { state, today } = useStore()
  const [query, setQuery] = useState('')
  const words = query.trim().toLowerCase()
  const digits = words.replace(/\s/g, '')
  const clients = state.clients
    .filter(
      (c) =>
        !c.erasedAt &&
        (`${c.name} ${c.email}`.toLowerCase().includes(words) ||
          (digits.length > 2 && c.phone.replace(/\s/g, '').includes(digits))),
    )
    .slice(0, 6)
  // Show each person's next visit, so a search answers "when are they in?" without a click.
  const nextVisit = (clientId: string) =>
    state.appointments
      .filter(
        (a) =>
          a.clientId === clientId &&
          a.date >= today &&
          (a.status === 'confirmed' || a.status === 'arrived'),
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)[0]
  return (
    <Modal
      open
      onClose={onClose}
      title="Search clients"
      description="Find anyone by name, email or phone."
    >
      <label className="search-field command-search">
        <Search size={20} />
        <span className="sr-only">Search clients</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="A name, email or phone…"
        />
      </label>
      <div className="search-results">
        {clients.map((client) => (
          <Link onClick={onClose} key={client.id} to={`/clients/${client.id}`}>
            <Avatar small identity={client.id} name={client.name} />
            <span>
              <strong>{client.name}</strong>
              <small>
                {(() => {
                  const next = nextVisit(client.id)
                  return next
                    ? `Next visit ${dateLabel(next.date, state.organisation.locale)} at ${timeLabel(next.startMinutes, state.organisation.locale)}`
                    : client.email
                })()}
              </small>
            </span>
            <ArrowUpRight size={17} />
          </Link>
        ))}
      </div>
      {!clients.length && (
        <Empty title="No one matches">Try a different name, email or phone.</Empty>
      )}
    </Modal>
  )
}
