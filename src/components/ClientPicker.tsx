import { useId, useState } from 'react'
import { Search } from 'lucide-react'
import { useStore } from '../state/context'
import { Button } from '../design'

/** Type a few letters to find a client, rather than scrolling one long list. */
export function ClientPicker({
  clientId,
  locked,
  initialQuery = '',
  label = 'Client',
  hideLabel = false,
  exclude = [],
  onChange,
}: {
  clientId: string
  locked: boolean
  /** Starts the search with this, such as a caller's number. */
  initialQuery?: string
  /** NEXT-08: who is being chosen, such as "Person 2" in a booking for several people. */
  label?: string
  /** NEXT-08: the label is already shown as a heading nearby, so it is kept for screen readers only. */
  hideLabel?: boolean
  /** NEXT-08: clients already chosen elsewhere in the same booking. */
  exclude?: string[]
  onChange: (id: string) => void
}) {
  const { state } = useStore()
  const id = useId()
  const [query, setQuery] = useState(initialQuery)
  const [editing, setEditing] = useState(!clientId)
  const chosen = state.clients.find((c) => c.id === clientId)
  const words = query.trim().toLowerCase()
  const matches = state.clients
    .filter((c) => !exclude.includes(c.id))
    .filter(
      (c) =>
        !words ||
        c.name.toLowerCase().includes(words) ||
        c.email.toLowerCase().includes(words) ||
        c.phone.replace(/\s/g, '').includes(words.replace(/\s/g, '')),
    )
    .slice(0, 6)
  if (chosen && !editing)
    return (
      <div className="client-picker-chosen">
        <span className={hideLabel ? 'sr-only' : 'client-picker-label'}>{label}</span>
        <strong>{chosen.name}</strong>
        <small>{chosen.email}</small>
        {!locked && (
          <Button
            variant="quiet"
            onClick={() => {
              setQuery('')
              setEditing(true)
            }}
          >
            Change
          </Button>
        )}
      </div>
    )
  return (
    <div className="client-picker">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </label>
      <div className="client-picker-field">
        <Search size={16} aria-hidden />
        <input
          id={id}
          type="search"
          autoComplete="off"
          placeholder="Type a name, email or phone"
          value={query}
          disabled={locked}
          aria-controls={`${id}-results`}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) {
              e.preventDefault()
              onChange(matches[0].id)
              setEditing(false)
            }
          }}
        />
      </div>
      <ul className="client-picker-results" id={`${id}-results`} aria-label="Matching clients">
        {matches.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                onChange(c.id)
                setEditing(false)
              }}
            >
              <strong>{c.name}</strong> <small>{c.email}</small>
            </button>
          </li>
        ))}
        {!matches.length && <li className="subtle">No client matches “{query}”.</li>}
      </ul>
    </div>
  )
}
