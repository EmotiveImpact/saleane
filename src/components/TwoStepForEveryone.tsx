import { useState } from 'react'
import { useStore } from '../state/context'
import { Button, ErrorMessage } from '../design'
import { listNames, twoStepForEveryone } from '../domain/twoStepRule'

/**
 * Stage 6: the owner's switch, "Ask everyone to use two-step sign-in", on Settings, Team. It says
 * who has it on and who has not yet, from the team list (never anyone's key or codes). The owner
 * must use it themselves before switching it on; the server checks that too.
 */
export function TwoStepForEveryone({
  members,
}: {
  /** The team as the server lists it, or undefined while it loads. */
  members?: readonly { name: string; twoStep?: boolean }[]
}) {
  const { state, session, commit, saving } = useStore()
  const on = twoStepForEveryone(state)
  const mine = !!session?.user.twoStep
  const studio = state.organisation.name
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const notYet = (members ?? []).filter((m) => !m.twoStep).map((m) => m.name)
  async function change(forEveryone: boolean) {
    setError('')
    setNote('')
    const result = await commit({ type: 'two-step-rule', forEveryone })
    if (!result.ok) setError(result.error)
    else
      setNote(
        forEveryone
          ? 'Everyone without two-step sign-in will be asked to set it up the next time they open the studio.'
          : 'Two-step sign-in is now each person’s own choice again.',
      )
  }
  return (
    <section className="access-everyone" aria-labelledby="access-everyone-title">
      <h3 id="access-everyone-title" className="access-subtitle">
        Ask everyone to use two-step sign-in
        <span className={`access-two-step-state${on ? ' is-on' : ''}`}>{on ? 'On' : 'Off'}</span>
      </h3>
      <p className="ops-help">
        When this is on, anyone in {studio} who has not set up two-step sign-in is asked to do it
        straight after signing in, and cannot open the studio until they have. People you invite are
        asked as they join. Your booking page, guests’ visit links and partner keys work as before.
      </p>
      {members && (
        <p className="access-everyone-count">
          {notYet.length === 0
            ? `Everyone in ${studio} has two-step sign-in on.`
            : `${members.length - notYet.length} of ${members.length} ${members.length === 1 ? 'person has' : 'people have'} it on. Not yet: ${listNames(notYet)}.`}
        </p>
      )}
      {!on && !mine && (
        <p className="ops-help">Turn on two-step sign-in for yourself first, just above.</p>
      )}
      <div className="ops-actions">
        <Button
          variant="secondary"
          disabled={saving || (!on && !mine)}
          onClick={() => void change(!on)}
        >
          {on ? 'Stop asking everyone' : 'Ask everyone to use it'}
        </Button>
      </div>
      <p className="ops-save-note" role="status">
        {note}
      </p>
      <ErrorMessage error={error} />
    </section>
  )
}
