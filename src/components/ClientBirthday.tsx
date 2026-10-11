import { useState } from 'react'
import type { FormEvent } from 'react'
import { Cake } from 'lucide-react'
import { useStore } from '../state/context'
import { can } from '../domain/operations'
import { birthdayIsReal } from '../domain/model'
import type { Client } from '../domain/model'
import { Button, ErrorMessage, Select } from '../design'
import '../guest-extras.css'

const two = (n: number) => String(n).padStart(2, '0')

/**
 * V1.5: a client's birthday, month and day only. With their agreement to hear from the studio it
 * brings a birthday email; it is never shown to practitioners.
 */
export function ClientBirthday({ client }: { client: Client }) {
  const { state, commit, blocked, role } = useStore()
  const [month, setMonth] = useState(client.birthday?.slice(0, 2) ?? '')
  const [day, setDay] = useState(client.birthday?.slice(3) ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const allowed = !blocked && can(role, 'client-birthday')
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: two(i + 1),
    label: new Intl.DateTimeFormat(state.organisation.locale, {
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2024, i, 1))),
  }))
  const chosen = month && day ? `${month}-${day}` : ''
  const valid = !chosen || birthdayIsReal(chosen)
  const changed = chosen !== (client.birthday ?? '')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!allowed || pending || !valid || (!!month !== !!day && !!chosen)) return
    setPending(true)
    setError('')
    setSaved('')
    try {
      const result = await commit({
        type: 'client-birthday',
        clientId: client.id,
        birthday: chosen || null,
      })
      if (result.ok) setSaved(chosen ? 'Birthday saved.' : 'Birthday removed.')
      else setError(result.error)
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="surface detail-panel" aria-labelledby="client-birthday-title">
      <h2 id="client-birthday-title">
        <Cake size={18} aria-hidden="true" /> Birthday
      </h2>
      <form className="birthday-form" onSubmit={(event) => void save(event)} aria-busy={pending}>
        <fieldset disabled={!allowed || pending}>
          <legend className="sr-only">Birthday, month and day</legend>
          <label>
            Month
            <Select value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Not shared</option>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Day
            <Select value={day} onChange={(e) => setDay(e.target.value)}>
              <option value="">–</option>
              {Array.from({ length: 31 }, (_, i) => two(i + 1)).map((d) => (
                <option key={d} value={d}>
                  {Number(d)}
                </option>
              ))}
            </Select>
          </label>
        </fieldset>
        <p className="subtle">
          Month and day only, never the year.{' '}
          {client.marketingConsent
            ? 'They agreed to hear from you, so they get a birthday email on the day.'
            : 'They have not agreed to hear from you, so no birthday email goes.'}
        </p>
        <ErrorMessage error={valid ? error : 'That date does not exist. Choose another day.'} />
        <p className="ops-save-note" role="status">
          {saved}
        </p>
        {allowed && (
          <Button
            type="submit"
            variant="secondary"
            disabled={pending || !changed || !valid || !!month !== !!day}
          >
            {pending ? 'Saving…' : !chosen && client.birthday ? 'Remove birthday' : 'Save birthday'}
          </Button>
        )}
      </form>
    </section>
  )
}
