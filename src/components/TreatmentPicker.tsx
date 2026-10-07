import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Search } from 'lucide-react'
import { treatmentPhoto } from '../design'

type Treatment = { id: string; name: string; category: string; description?: string }

const blurbs: Record<string, string> = {
  Skin: 'Facials and skin care',
  Hair: 'Cuts, colour and styling',
  Body: 'Massage and body treatments',
  Nails: 'Hands and feet',
}

/**
 * The first booking step: the guest picks a kind of treatment, then the
 * treatment itself, or searches across everything at any point.
 */
export function TreatmentPicker<T extends Treatment>({
  treatments,
  value,
  resume,
  renderChoice,
  footer,
}: {
  treatments: T[]
  value: string
  /** The guest already chose, so reopen on the chosen treatment's kind. */
  resume: boolean
  renderChoice: (treatment: T) => ReactNode
  /** Shown once treatments are on screen, such as the Continue bar. */
  footer: ReactNode
}) {
  const searchId = useId()
  const categories = [...new Set(treatments.map((t) => t.category))]
  const single = categories.length < 2
  const [category, setCategory] = useState<string | null>(() =>
    single ? null : resume ? (treatments.find((t) => t.id === value)?.category ?? null) : null,
  )
  const [query, setQuery] = useState('')
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const searching = words.length > 0
  const listed = searching
    ? treatments.filter((t) => {
        const text = `${t.name} ${t.category} ${t.description ?? ''}`.toLowerCase()
        return words.every((word) => text.includes(word))
      })
    : single
      ? treatments
      : treatments.filter((t) => t.category === category)
  const showList = searching || single || category !== null
  return (
    <div className="treatment-picker">
      <label className="treatment-search" htmlFor={searchId}>
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">Search treatments</span>
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder="Search, for example facial or massage"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {!showList && (
        <div className="treatment-kinds" role="group" aria-label="Kinds of treatment">
          {categories.map((name) => {
            const count = treatments.filter((t) => t.category === name).length
            const photo = treatmentPhoto(name)
            return (
              <button
                type="button"
                key={name}
                className="treatment-kind"
                onClick={() => setCategory(name)}
              >
                <span
                  className="treatment-kind-photo"
                  aria-hidden="true"
                  style={{
                    backgroundImage: `url(${photo.src})`,
                    backgroundPosition: photo.position,
                  }}
                />
                <span className="treatment-kind-text">
                  <strong>{name}</strong>
                  <small>
                    {blurbs[name] ? `${blurbs[name]} · ` : ''}
                    {count} {count === 1 ? 'treatment' : 'treatments'}
                  </small>
                </span>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            )
          })}
        </div>
      )}
      {showList && (
        <>
          {!single && (
            <div className="treatment-list-heading">
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setCategory(null)
                  setQuery('')
                }}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                All kinds of treatment
              </button>
              <span role="status">
                {searching
                  ? `${listed.length} ${listed.length === 1 ? 'match' : 'matches'}`
                  : category}
              </span>
            </div>
          )}
          {listed.length ? (
            <div className="service-choices">{listed.map(renderChoice)}</div>
          ) : (
            <p className="treatment-none">
              Nothing matches “{query.trim()}”. Try another word, or browse the kinds of treatment.
            </p>
          )}
          {footer}
        </>
      )}
    </div>
  )
}
