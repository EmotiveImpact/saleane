import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ArrowUpRight } from 'lucide-react'
import { useStore } from '../state/context'
import { Avatar, Empty, Modal } from '../design'

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const { state } = useStore()
  const [query, setQuery] = useState('')
  const clients = state.clients
    .filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6)
  return (
    <Modal
      open
      onClose={onClose}
      title="Find a relationship"
      description="Search the people in your workspace."
    >
      <label className="search-field command-search">
        <Search size={20} />
        <span className="sr-only">Search workspace</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="A name or email…"
        />
      </label>
      <div className="search-results">
        {clients.map((client) => (
          <Link onClick={onClose} key={client.id} to={`/clients/${client.id}`}>
            <Avatar small identity={client.id} name={client.name} />
            <span>
              <strong>{client.name}</strong>
              <small>{client.email}</small>
            </span>
            <ArrowUpRight size={17} />
          </Link>
        ))}
      </div>
      {!clients.length && (
        <Empty title="No matching relationships">Try a different name or email.</Empty>
      )}
    </Modal>
  )
}
