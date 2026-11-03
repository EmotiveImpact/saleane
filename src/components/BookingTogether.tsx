import { UserPlus, Users } from 'lucide-react'
import type { BusinessState } from '../domain/model'
import { money, timeLabel } from '../domain/format'
import { serviceAt } from '../domain/locations'
import { TOGETHER_MOST } from '../domain/together'
import { Button, Select } from '../design'
import { ClientPicker } from './ClientPicker'
import type { PartyGuest, PartyRow } from './party'
import './together.css'

export function TogetherSection({
  state,
  guests,
  rows,
  firstName,
  firstStart,
  firstServiceId,
  chosen,
  locationId,
  busy,
  onChange,
}: {
  state: BusinessState
  guests: PartyGuest[]
  rows: PartyRow[]
  /** How the first person is called, such as "Grace". */
  firstName: string
  firstStart: number | null
  firstServiceId: string
  /** Clients already in the booking, so none is chosen twice. */
  chosen: string[]
  locationId?: string
  busy: boolean
  onChange: (guests: PartyGuest[]) => void
}) {
  const locale = state.organisation.locale
  const services = state.services.filter((item) => !item.archived)
  const update = (key: number, change: Partial<PartyGuest>) =>
    onChange(guests.map((guest) => (guest.key === key ? { ...guest, ...change } : guest)))
  const add = () =>
    onChange([
      ...guests,
      {
        key: Math.max(0, ...guests.map((guest) => guest.key)) + 1,
        clientId: '',
        someoneNew: false,
        name: '',
        email: '',
        phone: '',
        serviceId: firstServiceId,
        staffId: 'any',
        pick: null,
      },
    ])
  return (
    <fieldset className="booking-together">
      <legend>
        <Users size={17} aria-hidden="true" /> Others coming
      </legend>
      {!guests.length && (
        <p className="subtle">
          Booking a couple side by side, or a party? Add each person. Everyone comes on the same
          day.
        </p>
      )}
      {guests.length > 0 && (
        <ol className="together-people" aria-label="Others coming">
          {guests.map((guest, index) => {
            const row = rows[index] ?? { times: [], start: null, why: 'waiting' }
            const person = `Person ${index + 2}`
            const eligible = state.staff.filter(
              (p) => !p.archived && p.serviceIds.includes(guest.serviceId),
            )
            const who = state.staff.find((p) => p.id === row.staffId)?.name.split(' ')[0]
            const room = state.resources.find((r) => r.id === row.resourceId)?.name
            const service = services.find((item) => item.id === guest.serviceId)
            const at = firstStart === null ? '' : timeLabel(firstStart, locale)
            const when = {
              same: `At ${at}, the same time as ${firstName}.`,
              moved: `${at} is not free for this, so the nearest free time.`,
              chosen: 'At the time you chose.',
              full: row.times.length
                ? `Nothing free near ${at} that day. Choose a time, or try another professional or treatment.`
                : 'Nothing free that day for this. Try another professional or treatment.',
              waiting:
                firstStart === null
                  ? `Choose a time for ${firstName} first; the others follow it.`
                  : 'Give the person above a time first.',
            }[row.why]
            const where =
              row.start !== null && who && room
                ? ` With ${who} in ${room}${row.sharingWith ? `, beside ${row.sharingWith}` : ''}.`
                : ''
            return (
              <li key={guest.key}>
                <div className="together-person-head">
                  <strong>{person}</strong>
                  <Button
                    variant="quiet"
                    disabled={busy}
                    aria-label={`Remove ${person}`}
                    onClick={() => onChange(guests.filter((other) => other.key !== guest.key))}
                  >
                    Remove
                  </Button>
                </div>
                {guest.someoneNew ? (
                  <fieldset className="booking-new-client">
                    <legend>Someone new</legend>
                    <div className="form-grid">
                      <label className="form-grid-wide">
                        Name
                        <input
                          value={guest.name}
                          autoComplete="off"
                          maxLength={100}
                          disabled={busy}
                          onChange={(e) => update(guest.key, { name: e.target.value })}
                        />
                      </label>
                      <label>
                        Email
                        <input
                          type="email"
                          value={guest.email}
                          autoComplete="off"
                          disabled={busy}
                          onChange={(e) => update(guest.key, { email: e.target.value })}
                        />
                      </label>
                      <label>
                        Phone
                        <input
                          type="tel"
                          value={guest.phone}
                          autoComplete="off"
                          disabled={busy}
                          onChange={(e) => update(guest.key, { phone: e.target.value })}
                        />
                      </label>
                    </div>
                    <small>
                      Their own email and phone, so their confirmation and reminders reach them.
                    </small>
                    <Button
                      variant="quiet"
                      disabled={busy}
                      onClick={() => update(guest.key, { someoneNew: false })}
                    >
                      Choose an existing client instead
                    </Button>
                  </fieldset>
                ) : (
                  <>
                    <ClientPicker
                      clientId={guest.clientId}
                      locked={busy}
                      label={person}
                      hideLabel
                      exclude={chosen.filter((id) => id !== guest.clientId)}
                      onChange={(id) => update(guest.key, { clientId: id })}
                    />
                    {!guest.clientId && (
                      <Button
                        variant="quiet"
                        disabled={busy}
                        onClick={() => update(guest.key, { someoneNew: true })}
                      >
                        <UserPlus size={16} aria-hidden="true" /> They are new: add their details
                      </Button>
                    )}
                  </>
                )}
                <div className="form-grid">
                  <label className="form-grid-wide">
                    Treatment
                    <Select
                      aria-label={`Treatment for ${person}`}
                      value={guest.serviceId}
                      disabled={busy}
                      onChange={(e) =>
                        update(guest.key, { serviceId: e.target.value, staffId: 'any', pick: null })
                      }
                    >
                      {services.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.durationMinutes} min ·{' '}
                          {money(serviceAt(item, locationId).priceMinor, state.organisation)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    Professional
                    <Select
                      aria-label={`Professional for ${person}`}
                      value={guest.staffId}
                      disabled={busy}
                      onChange={(e) => update(guest.key, { staffId: e.target.value, pick: null })}
                    >
                      <option value="any">Anyone free</option>
                      {eligible.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    Time
                    <Select
                      aria-label={`Time for ${person}`}
                      value={row.start ?? ''}
                      disabled={busy || !row.times.length}
                      onChange={(e) => update(guest.key, { pick: Number(e.target.value) })}
                    >
                      {row.start === null && <option value="">No time yet</option>}
                      {row.times.map((time) => (
                        <option key={time} value={time}>
                          {timeLabel(time, locale)}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
                <small className="together-note">
                  {service ? `${service.durationMinutes} minutes. ` : ''}
                  {when}
                  {where}
                </small>
              </li>
            )
          })}
        </ol>
      )}
      {guests.length < TOGETHER_MOST - 1 ? (
        <Button variant="secondary" disabled={busy} onClick={add}>
          <UserPlus size={16} aria-hidden="true" /> Add someone
        </Button>
      ) : (
        <p className="subtle">
          {TOGETHER_MOST} people is the most for one booking. Book any others on their own.
        </p>
      )}
    </fieldset>
  )
}
