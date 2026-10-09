import { useState } from 'react'
import type { FormEvent } from 'react'
import { MapPin } from 'lucide-react'
import { useStore } from '../state/context'
import { can } from '../domain/operations'
import { areaHint, postcodeArea } from '../domain/clientAreas'
import type { Client } from '../domain/model'
import { Button, ErrorMessage } from '../design'

/**
 * V5: the first half of a client's postcode, for seeing where clients come from in groups. A
 * full postcode typed here is cut to its first half before it is saved.
 */
export function ClientArea({ client }: { client: Client }) {
  const { state, commit, blocked, role } = useStore()
  const region = state.organisation.region
  const [value, setValue] = useState(client.postcodeArea ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const allowed = !blocked && can(role, 'client-area')
  const typed = value.trim()
  const area = typed ? postcodeArea(typed, region) : null
  const changed = (area ?? '') !== (client.postcodeArea ?? '') || (!!typed && !area)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!allowed || pending) return
    if (typed && !area) return setError(areaHint(region))
    setPending(true)
    setError('')
    setSaved('')
    try {
      const result = await commit({ type: 'client-area', clientId: client.id, area: area })
      if (result.ok) {
        setValue(area ?? '')
        setSaved(area ? `Saved as ${area}.` : 'Postcode area removed.')
      } else setError(result.error)
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="surface detail-panel" aria-labelledby="client-area-title">
      <h2 id="client-area-title">
        <MapPin size={18} aria-hidden="true" /> {region === 'UK' ? 'Postcode area' : 'ZIP area'}
      </h2>
      <form className="birthday-form" onSubmit={(event) => void save(event)} aria-busy={pending}>
        <label>
          {region === 'UK' ? 'First half of their postcode' : 'ZIP code'}
          <input
            value={value}
            maxLength={12}
            autoComplete="off"
            disabled={!allowed || pending}
            placeholder={region === 'UK' ? 'N1' : '10001'}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <p className="subtle">
          {region === 'UK'
            ? 'Only the first half is kept, never the full postcode.'
            : 'Only the first three digits are kept.'}{' '}
          It shows where clients come from in groups, never one person.
        </p>
        <ErrorMessage error={error} />
        <p className="ops-save-note" role="status">
          {saved}
        </p>
        {allowed && (
          <Button type="submit" variant="secondary" disabled={pending || !changed}>
            {pending ? 'Saving…' : !typed && client.postcodeArea ? 'Remove area' : 'Save area'}
          </Button>
        )}
      </form>
    </section>
  )
}
