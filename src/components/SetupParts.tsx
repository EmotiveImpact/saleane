import { Plus, X } from 'lucide-react'
import type { Service } from '../domain/model'
import type { operations } from '../domain/operations'
import {
  WEEKDAYS as weekdays,
  WEEK_ORDER as weekOrder,
  newRowKey as newKey,
  nextRoomName,
} from '../domain/setupScreens'
import { Button, TimeField, Select } from '../design'
import './setupParts.css'

/**
 * Pieces "Set up your studio" and "Add a location" share: opening hours a day to a line, the
 * rooms and chairs as cards, and the small Remove button on each card.
 */
type WeekHours = ReturnType<typeof operations>['hours']
type Place = Service['resourceType']
export type RoomCard = { key: string; id?: string; name: string; type: Place }

const clock = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
const minutesOf = (value: string) => {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}
export function HoursList({
  value,
  onChange,
  locale,
}: {
  value: WeekHours
  onChange: (value: WeekHours) => void
  locale: string
}) {
  const update = (day: number, patch: Partial<WeekHours[number]>) =>
    onChange(value.map((item) => (item.day === day ? { ...item, ...patch } : item)))
  const monday = value.find((d) => d.day === 1)
  return (
    <>
      <div className="setup-hours">
        {weekOrder.map((weekday) => {
          const day = value.find((item) => item.day === weekday)
          if (!day) return null
          return (
            <div className="setup-day" key={weekday}>
              <label className="setup-day-name">
                <input
                  type="checkbox"
                  checked={!day.closed}
                  onChange={(e) => update(weekday, { closed: !e.target.checked })}
                />
                {weekdays[weekday]}
              </label>
              {day.closed ? (
                <span className="setup-day-closed">Closed</span>
              ) : (
                <div className="setup-day-times">
                  <TimeField
                    locale={locale}
                    aria-label={`${weekdays[weekday]} opens`}
                    value={clock(day.open)}
                    onChange={(time) => update(weekday, { open: minutesOf(time) })}
                  />
                  <span aria-hidden="true">to</span>
                  <TimeField
                    locale={locale}
                    aria-label={`${weekdays[weekday]} closes`}
                    value={clock(day.close)}
                    from="00:15"
                    onChange={(time) => update(weekday, { close: minutesOf(time) })}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
      {monday && !monday.closed && (
        <Button
          variant="secondary"
          className="setup-quiet-action"
          onClick={() =>
            onChange(
              value.map((day) =>
                day.closed ? day : { ...day, open: monday.open, close: monday.close },
              ),
            )
          }
        >
          Use Monday’s hours on every open day
        </Button>
      )}
    </>
  )
}

export function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" className="setup-remove" aria-label={`Remove ${name}`} onClick={onClick}>
      <X size={16} />
    </button>
  )
}

const listOf = (names: string[]) =>
  new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(
    names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names,
  )

/**
 * The rooms and chairs, each a card with its name and kind, and buttons to add more. `at` names
 * new ones after a location, such as "Islington room 2".
 */
export function RoomCards({
  rows,
  onChange,
  onRemove,
  services,
  at,
}: {
  rows: RoomCard[]
  onChange: (rows: RoomCard[]) => void
  onRemove?: (row: RoomCard) => void
  services: Service[]
  at?: string
}) {
  const update = (key: string, patch: Partial<RoomCard>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  const add = (type: Place) =>
    onChange([...rows, { key: newKey(), name: nextRoomName(rows, type, at), type }])
  const uses = (type: Place) => services.filter((x) => x.resourceType === type).map((x) => x.name)
  return (
    <>
      {!!rows.length && (
        <ul className="setup-rows" aria-label="Rooms and chairs">
          {rows.map((row) => (
            <li className="setup-row" key={row.key}>
              <div className="setup-row-grid setup-room">
                <label>
                  Name
                  <input
                    value={row.name}
                    maxLength={100}
                    aria-invalid={row.name.trim().length < 2 || undefined}
                    onChange={(e) => update(row.key, { name: e.target.value })}
                  />
                </label>
                <label>
                  Kind
                  <Select
                    value={row.type}
                    onChange={(e) => update(row.key, { type: e.target.value as Place })}
                  >
                    <option value="treatment">Treatment room</option>
                    <option value="chair">Styling chair</option>
                  </Select>
                </label>
                <RemoveButton
                  name={row.name || 'this room'}
                  onClick={() => {
                    onChange(rows.filter((x) => x.key !== row.key))
                    onRemove?.(row)
                  }}
                />
              </div>
              {!!uses(row.type).length && (
                <small className="setup-row-note">For {listOf(uses(row.type))}</small>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="setup-actions">
        <Button variant="secondary" onClick={() => add('treatment')}>
          <Plus size={16} />
          Add a treatment room
        </Button>
        <Button variant="secondary" onClick={() => add('chair')}>
          <Plus size={16} />
          Add a styling chair
        </Button>
      </div>
    </>
  )
}
