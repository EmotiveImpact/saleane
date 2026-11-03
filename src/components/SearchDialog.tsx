import { useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, ArrowUpRight, CornerDownLeft } from 'lucide-react'
import { useStore } from '../state/context'
import { dateLabel, timeLabel } from '../domain/format'
import { Avatar, Empty, Modal } from '../design'

/**
 * Find a client from anywhere. The arrow keys move through the people found, Enter opens the one
 * chosen, and Escape closes it, the way a search list works everywhere else: the field stays a
 * combobox with its list, so screen readers say who is chosen as it moves.
 */
export function SearchDialog({ onClose }: { onClose: () => void }) {
  const { state, today } = useStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState(0)
  const listId = useId()
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
  const active = Math.min(chosen, Math.max(clients.length - 1, 0))
  const optionId = (index: number) => `${listId}-option-${index}`
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
      className="search-dialog"
    >
      <label className="search-field command-search">
        <Search size={20} />
        <span className="sr-only">Search clients</span>
        <input
          type="search"
          role="combobox"
          aria-expanded={clients.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={clients.length ? optionId(active) : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setChosen(0)
          }}
          onKeyDown={(event) => {
            if (!clients.length) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setChosen((active + step + clients.length) % clients.length)
            } else if (event.key === 'Home' && event.ctrlKey) setChosen(0)
            else if (event.key === 'End' && event.ctrlKey) setChosen(clients.length - 1)
            else if (event.key === 'Enter') {
              event.preventDefault()
              onClose()
              navigate(`/clients/${clients[active].id}`)
            }
          }}
          placeholder="A name, email or phone…"
        />
      </label>
      <div className="search-results" id={listId} role="listbox" aria-label="People found">
        {clients.map((client, index) => (
          <Link
            onClick={onClose}
            key={client.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            data-active={index === active || undefined}
            tabIndex={-1}
            to={`/clients/${client.id}`}
            onMouseMove={() => index !== active && setChosen(index)}
          >
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
            {index === active ? (
              <CornerDownLeft size={16} aria-hidden="true" className="search-enter" />
            ) : (
              <ArrowUpRight size={17} aria-hidden="true" />
            )}
          </Link>
        ))}
      </div>
      {!clients.length && (
        <Empty title="No one matches">Try a different name, email or phone.</Empty>
      )}
      {clients.length > 0 && (
        <p className="search-hint" aria-hidden="true">
          <kbd>↑</kbd> <kbd>↓</kbd> to choose, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to close
        </p>
      )}
    </Modal>
  )
}
