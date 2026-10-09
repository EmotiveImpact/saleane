import { MapPin } from 'lucide-react'

export type LocationOption = {
  id: string
  name: string
  address: string
  arrivalNote?: string
  /** How guests reach this location; absent means the studio's own phone and email. */
  phone?: string
  email?: string
}

/** V2: the guest's choice of location, shown only when the studio has more than one. */
export function LocationChoice({
  locations,
  value,
  onChange,
}: {
  locations: LocationOption[]
  value: string
  onChange: (id: string) => void
}) {
  if (locations.length < 2) return null
  return (
    <fieldset className="location-choices">
      <legend>Where would you like to come?</legend>
      <div>
        {locations.map((place) => (
          <button
            type="button"
            key={place.id}
            aria-pressed={place.id === value}
            className={`location-choice ${place.id === value ? 'selected' : ''}`}
            onClick={() => onChange(place.id)}
          >
            <MapPin size={18} aria-hidden="true" />
            <span>
              <strong>{place.name}</strong>
              {place.address && <small>{place.address}</small>}
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}
