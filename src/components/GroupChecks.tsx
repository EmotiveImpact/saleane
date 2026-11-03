import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import { useStore } from '../state/context'
import { Button, ErrorMessage, Modal, Checkbox } from '../design'
import { CHECK_WORDS, groupCheckSettings } from '../domain/groupChecks'
import type { GroupAlert, GroupCheckKey } from '../domain/groupChecks'
import { GROUP_CHECK_DEFAULTS } from '../domain/groupSchema'

const KEYS = Object.keys(GROUP_CHECK_DEFAULTS) as GroupCheckKey[]

/** V5: what the automatic checks found, or a calm line when they found nothing. */
export function GroupAlertList({ alerts }: { alerts: GroupAlert[] }) {
  if (!alerts.length)
    return <p className="subtle">The automatic checks found nothing that needs a look today.</p>
  return (
    <ul className="group-alerts">
      {alerts.map((a) => (
        <li key={a.id}>
          <AlertCircle size={17} aria-hidden="true" />
          <div>
            <strong>{a.title}</strong>
            <p>{a.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** V5: the owner turns each automatic check on or off and sets its number. */
export function GroupChecksEditor({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { state, commit } = useStore()
  const current = groupCheckSettings(state)
  const [on, setOn] = useState<Record<GroupCheckKey, boolean>>(
    () =>
      Object.fromEntries(KEYS.map((k) => [k, current[k] !== null])) as Record<
        GroupCheckKey,
        boolean
      >,
  )
  const [values, setValues] = useState<Record<GroupCheckKey, string>>(
    () =>
      Object.fromEntries(
        KEYS.map((k) => [k, String(current[k] ?? GROUP_CHECK_DEFAULTS[k])]),
      ) as Record<GroupCheckKey, string>,
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const checks: Partial<Record<GroupCheckKey, number | null>> = {}
    for (const k of KEYS) {
      if (!on[k]) {
        checks[k] = null
        continue
      }
      const n = Number(values[k])
      if (!Number.isInteger(n)) {
        setError(`Enter a whole number for ${CHECK_WORDS[k].label.toLowerCase()}.`)
        return
      }
      checks[k] = n
    }
    setPending(true)
    setError('')
    try {
      const result = await commit({ type: 'group-checks', checks })
      if (result.ok) onSaved('Automatic checks saved.')
      else setError(result.error)
    } catch {
      setError('This could not be saved. Your choices are still here; try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Automatic checks"
      description="These run by themselves across every location and show here and on each regional manager's page. They change nothing and contact no one."
    >
      <form onSubmit={(e) => void save(e)} className="plan-form">
        <div className="group-checks-fields">
          {KEYS.map((k) => (
            <fieldset key={k} className="group-check">
              <legend>{CHECK_WORDS[k].label}</legend>
              <p className="ops-help">{CHECK_WORDS[k].help}</p>
              <label className="ops-check">
                <Checkbox
                  checked={on[k]}
                  disabled={pending}
                  onChange={(e) => setOn((o) => ({ ...o, [k]: e.target.checked }))}
                />
                On
              </label>
              <label>
                At least ({CHECK_WORDS[k].unit})
                <input
                  inputMode="numeric"
                  value={values[k]}
                  disabled={pending || !on[k]}
                  onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                />
              </label>
            </fieldset>
          ))}
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save checks'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
