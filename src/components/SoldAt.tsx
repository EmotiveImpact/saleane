import { useStore } from '../state/context'
import { asksSoldAt, places } from '../domain/locations'
import { Select } from '../design'

/**
 * V2: the location that sold a gift card, package or membership, so it counts in that location's
 * takings. A general manager always sells at their own location, which the server sets.
 */
export function SoldAt({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { state, role } = useStore()
  if (!asksSoldAt(state, role)) return null
  return (
    <label className="ops-field">
      Sold at
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {places(state).map((place) => (
          <option key={place.id} value={place.id}>
            {place.name}
          </option>
        ))}
      </Select>
    </label>
  )
}
