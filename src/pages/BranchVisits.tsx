import { useState } from 'react'
import type { FormEvent } from 'react'
import { ClipboardCheck, ListChecks } from 'lucide-react'
import { useStore } from '../state/context'
import { Button, Empty, ErrorMessage, Modal, PageHeader, Select } from '../design'
import { dateLabel } from '../domain/format'
import { places } from '../domain/locations'
import { businessDate, can } from '../domain/operations'
import {
  STARTER_CHECKLIST,
  VISIT_BACKDATE_DAYS,
  branchVisits,
  checklists,
  lastVisits,
  toPutRight,
  visitScore,
} from '../domain/branchVisits'
import { addDays } from '../domain/format'
import type { Answer, BranchVisit, Checklist } from '../domain/branchVisitSchema'
import type { Command } from '../domain/commands'
import '../components/management.css'
import '../components/plans.css'
import '../components/branchVisits.css'
import { StudioDateField } from '../components/StudioDateField'

/** Past visits are shown thirty at a time; every one stays reachable. */
const HISTORY_PAGE = 30
const ANSWER_LABEL: Record<Answer, string> = { yes: 'Yes', no: 'No', na: 'Not checked' }

/** "7 fine, 1 to put right, 1 not checked", leaving out what is zero. */
function scoreLine(v: BranchVisit) {
  const score = visitScore(v)
  const fixed = score.no - score.open
  return [
    `${score.yes} fine`,
    score.open && `${score.open} to put right`,
    fixed && `${fixed} put right since`,
    score.na && `${score.na} not checked`,
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * V5: branch visits. The owner or a manager walks a location with a checklist on their phone,
 * answers each line, and anything answered no stays on a list until it is put right.
 */
export function BranchVisits() {
  const { state, role, blocked, commit, branch } = useStore()
  const org = state.organisation
  const allowed = !blocked && can(role, 'branch-visit')
  const [form, setForm] = useState<'visit' | 'lists' | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState('')
  const open = toPutRight(state)
  const names = new Map(places(state, true).map((p) => [p.id, p.name]))
  const inUse = checklists(state).filter((c) => !c.archived)
  const visits = branchVisits(state)
  const day = (date: string) => dateLabel(date, org.locale)
  const editLists = can(role, 'checklist-save')

  async function fix(visitId: string, itemId: string, text: string) {
    setPending(`${visitId}:${itemId}`)
    setError('')
    setNotice('')
    try {
      const result = await commit({ type: 'branch-visit-fix', visitId, itemId })
      if (!result.ok) setError(result.error)
      else setNotice(`Marked as put right: ${text}`)
    } catch {
      setError('This could not be saved. Try again.')
    } finally {
      setPending('')
    }
  }

  return (
    <div className="visits-page">
      <PageHeader
        eyebrow="Business"
        title="Branch visits."
        description="Walk a location with a checklist and keep what needs putting right in one place."
        actions={
          allowed && (
            <>
              <Button
                onClick={() => {
                  setNotice('')
                  setForm('visit')
                }}
                disabled={!inUse.length}
              >
                <ClipboardCheck size={17} aria-hidden="true" />
                Start a visit
              </Button>
              {editLists && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNotice('')
                    setForm('lists')
                  }}
                >
                  <ListChecks size={17} aria-hidden="true" />
                  Checklists
                </Button>
              )}
            </>
          )
        }
      />
      {allowed && !inUse.length && visits.length > 0 && (
        <p className="ops-help">Make a checklist first, then start a visit with it.</p>
      )}
      {notice && (
        <p className="success-strip" role="status">
          {notice}
        </p>
      )}
      <ErrorMessage error={error} />

      {visits.length === 0 ? (
        <section className="surface" aria-label="No visits yet">
          <Empty title="No visits yet">
            A branch visit is a walk round a location with a checklist on your phone: towels
            stocked, fire exits clear, prices on show. Anything answered no stays on a list here
            until someone puts it right.{' '}
            {!allowed
              ? ''
              : inUse.length
                ? 'Start with Start a visit, above.'
                : editLists
                  ? 'First make a checklist with Checklists, above. A starter list is filled in for you to change.'
                  : 'A checklist is needed first, made by the owner or a manager.'}
          </Empty>
        </section>
      ) : (
        <>
          <section className="surface ops-panel" aria-labelledby="put-right-heading">
            <header>
              <div>
                <h2 id="put-right-heading">To put right</h2>
                <p>Lines answered no on a visit, until someone marks them done.</p>
              </div>
            </header>
            <PutRightList
              items={open.map(({ visit, line, place }) => ({ visit, line, place }))}
              day={day}
              canFix={allowed}
              pending={!!pending}
              onFix={(visit, line) => void fix(visit.id, line.itemId, line.text)}
            />
          </section>

          <section className="surface ops-panel" aria-labelledby="places-heading">
            <header>
              <div>
                <h2 id="places-heading">Each location</h2>
                <p>When each one was last visited, and how it went.</p>
              </div>
            </header>
            <ul className="visits-list">
              {lastVisits(state).map(({ place, visit }) => (
                <li key={place.id}>
                  <div>
                    <strong>{place.name}</strong>
                    <span className="visits-meta">
                      {visit
                        ? `Last visited ${day(visit.date)}: ${scoreLine(visit)}`
                        : 'Not visited yet'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="surface ops-panel" aria-labelledby="history-heading">
            <header>
              <div>
                <h2 id="history-heading">Past visits</h2>
                <p>Each kept exactly as it was answered on the day.</p>
              </div>
            </header>
            <VisitHistory visits={visits} names={names} day={day} />
          </section>
        </>
      )}

      {form === 'visit' && (
        <VisitForm
          sites={places(state).filter((p) => !branch || p.id === branch)}
          lists={inUse}
          today={businessDate(state)}
          commit={commit}
          onClose={() => setForm(null)}
          onSaved={(message) => {
            setNotice(message)
            setForm(null)
          }}
        />
      )}
      {form === 'lists' && (
        <ChecklistEditor
          commit={commit}
          onClose={() => setForm(null)}
          onSaved={(message) => {
            setNotice(message)
            setForm(null)
          }}
        />
      )}
    </div>
  )
}

type OpenLine = { visit: BranchVisit; line: BranchVisit['answers'][number]; place: string }

/** Lines answered no and not yet put right, with a button for those allowed to mark them. */
export function PutRightList({
  items,
  day,
  canFix,
  pending,
  onFix,
}: {
  items: OpenLine[]
  day: (date: string) => string
  canFix: boolean
  pending: boolean
  onFix: (visit: BranchVisit, line: OpenLine['line']) => void
}) {
  if (!items.length)
    return <p className="ops-help">Nothing waiting. Every line answered no has been put right.</p>
  return (
    <ul className="visits-list">
      {items.map(({ visit, line, place }) => (
        <li key={`${visit.id}:${line.itemId}`}>
          <div>
            <strong>{line.text}</strong>
            <span className="visits-meta">
              {place} · {day(visit.date)}
            </span>
            {line.note && <p>{line.note}</p>}
          </div>
          {canFix && (
            <Button variant="secondary" disabled={pending} onClick={() => onFix(visit, line)}>
              Put right
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Past visits, newest first, thirty at a time, each exactly as it was answered. */
export function VisitHistory({
  visits,
  names,
  day,
}: {
  visits: BranchVisit[]
  names: Map<string, string>
  day: (date: string) => string
}) {
  const [shown, setShown] = useState(HISTORY_PAGE)
  const everyVisit = [...visits].sort(
    (a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt),
  )
  if (!everyVisit.length) return <p className="ops-help">No visits recorded yet.</p>
  return (
    <div className="visits-history">
      {everyVisit.slice(0, shown).map((visit) => (
        <details key={visit.id}>
          <summary>
            <strong>
              {names.get(visit.locationId) ?? 'A closed location'} · {day(visit.date)}
            </strong>
            <span className="visits-meta">
              {visit.checklistName}: {scoreLine(visit)}
            </span>
          </summary>
          <ul className="visits-answers">
            {visit.answers.map((a) => (
              <li key={a.itemId}>
                <span className={`visits-answer visits-answer-${a.answer}`}>
                  {ANSWER_LABEL[a.answer]}
                </span>
                <div>
                  {a.text}
                  {a.note && <small>{a.note}</small>}
                  {a.fixed && (
                    <small>
                      Put right {day(a.fixed.on)}
                      {a.fixed.actor ? ` by ${a.fixed.actor}` : ''}
                    </small>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {visit.note && <p className="visits-note">{visit.note}</p>}
          {visit.actor && <p className="ops-help">Recorded by {visit.actor}.</p>}
        </details>
      ))}
      {everyVisit.length > shown && (
        <div className="ops-actions">
          <Button variant="secondary" onClick={() => setShown((n) => n + HISTORY_PAGE)}>
            Show {Math.min(HISTORY_PAGE, everyVisit.length - shown)} more
          </Button>
          <span className="ops-help">
            Showing {shown} of {everyVisit.length} visits
          </span>
        </div>
      )}
    </div>
  )
}

type Commit = (command: Command) => Promise<{ ok: true } | { ok: false; error: string }>

function useSave(commit: Commit, onSaved: (message: string) => void) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function run(command: Command, message: string) {
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) setError(result.error)
      else onSaved(message)
    } catch {
      setError('This could not be saved. Your answers are still here; try again.')
    } finally {
      setPending(false)
    }
  }
  return { pending, error, setError, run }
}

/** Recording one visit. The studio page and a regional manager's area page both use it. */
export function VisitForm({
  sites,
  lists,
  today,
  commit,
  onClose,
  onSaved,
}: {
  sites: { id: string; name: string }[]
  lists: Checklist[]
  today: string
  commit: Commit
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [locationId, setLocationId] = useState(sites[0]?.id ?? '')
  const [checklistId, setChecklistId] = useState(lists[0]?.id ?? '')
  const [date, setDate] = useState(today)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const { pending, error, run } = useSave(commit, onSaved)
  const list = lists.find((c) => c.id === checklistId)
  const answered = list ? list.items.filter((i) => answers[i.id]).length : 0
  const place = sites.find((p) => p.id === locationId)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!list || answered < list.items.length) return
    const issues = list.items.filter((i) => answers[i.id] === 'no').length
    void run(
      {
        type: 'branch-visit',
        input: {
          locationId,
          checklistId: list.id,
          date,
          answers: list.items.map((i) => ({
            itemId: i.id,
            answer: answers[i.id],
            ...(notes[i.id]?.trim() ? { note: notes[i.id].trim() } : {}),
          })),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      },
      `Visit to ${place?.name ?? 'the location'} saved${
        issues ? `, with ${issues} ${issues === 1 ? 'thing' : 'things'} to put right` : ''
      }.`,
    )
  }

  return (
    <Modal
      open
      wide
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Start a visit"
      description="Answer every line. Anything answered no goes on the list to put right."
    >
      <form className="plan-form" onSubmit={submit}>
        <div className="ops-fields">
          <label>
            Location
            <Select
              value={locationId}
              disabled={pending}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {sites.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Checklist
            <Select
              value={checklistId}
              disabled={pending}
              onChange={(e) => {
                setChecklistId(e.target.value)
                setAnswers({})
                setNotes({})
              }}
            >
              {lists.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Date of the visit
            <StudioDateField
              value={date}
              max={today}
              min={addDays(today, -VISIT_BACKDATE_DAYS)}
              required
              disabled={pending}
              onChange={setDate}
            />
          </label>
        </div>
        {list && (
          <ol className="visits-lines">
            {list.items.map((item) => (
              <li key={item.id}>
                <fieldset>
                  <legend>{item.text}</legend>
                  <div className="visits-choices">
                    {(['yes', 'no', 'na'] as const).map((value) => (
                      <label key={value} className="visits-choice">
                        <input
                          type="radio"
                          name={`answer-${item.id}`}
                          value={value}
                          checked={answers[item.id] === value}
                          disabled={pending}
                          onChange={() => setAnswers((a) => ({ ...a, [item.id]: value }))}
                        />
                        {ANSWER_LABEL[value]}
                      </label>
                    ))}
                  </div>
                  <label className="visits-line-note">
                    <span className="sr-only">Note on {item.text}</span>
                    <input
                      value={notes[item.id] ?? ''}
                      maxLength={280}
                      placeholder={
                        answers[item.id] === 'no' ? 'What needs doing?' : 'Note (optional)'
                      }
                      disabled={pending}
                      onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))}
                    />
                  </label>
                </fieldset>
              </li>
            ))}
          </ol>
        )}
        <label className="ops-field">
          Anything else from the visit
          <textarea
            rows={3}
            maxLength={1000}
            value={note}
            disabled={pending}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || !list || answered < (list?.items.length ?? 1)}>
            Save visit
          </Button>
          <span className="ops-help" aria-live="polite">
            {list ? `${answered} of ${list.items.length} answered` : ''}
          </span>
        </div>
      </form>
    </Modal>
  )
}

function ChecklistEditor({
  commit,
  onClose,
  onSaved,
}: {
  commit: Commit
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { state } = useStore()
  const all = checklists(state)
  const [checklistId, setChecklistId] = useState(all.find((c) => !c.archived)?.id ?? 'new')
  const chosen = all.find((c) => c.id === checklistId)
  const draft = (id: string) => {
    const c = all.find((x) => x.id === id)
    return c
      ? { name: c.name, lines: c.items.map((i) => i.text).join('\n') }
      : all.length
        ? { name: '', lines: '' }
        : { name: STARTER_CHECKLIST.name, lines: STARTER_CHECKLIST.items.join('\n') }
  }
  const [name, setName] = useState(() => draft(checklistId).name)
  const [lines, setLines] = useState(() => draft(checklistId).lines)
  const { pending, error, setError, run } = useSave(commit, onSaved)

  function pick(id: string) {
    setChecklistId(id)
    const d = draft(id)
    setName(d.name)
    setLines(d.lines)
    setError('')
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const texts = lines
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (!texts.length) return setError('Add at least one line, one per row.')
    if (texts.some((t) => t.length < 2 || t.length > 140))
      return setError('Keep each line between 2 and 140 characters.')
    // A line keeps its place in history when its wording is unchanged.
    const known = new Map(chosen?.items.map((i) => [i.text.toLowerCase(), i.id]))
    void run(
      {
        type: 'checklist-save',
        ...(chosen ? { id: chosen.id } : {}),
        input: {
          name: name.trim(),
          items: texts.map((text) => {
            const id = known.get(text.toLowerCase())
            return id ? { id, text } : { text }
          }),
        },
      },
      `${name.trim()} saved.`,
    )
  }

  return (
    <Modal
      open
      wide
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Checklists"
      description="Changing a checklist never changes a visit already recorded."
    >
      <form className="plan-form" onSubmit={submit}>
        <div className="ops-fields">
          <label>
            Checklist
            <Select value={checklistId} disabled={pending} onChange={(e) => pick(e.target.value)}>
              {all.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? ' (put away)' : ''}
                </option>
              ))}
              <option value="new">Add a checklist</option>
            </Select>
          </label>
          <label>
            Name
            <input
              value={name}
              required
              minLength={2}
              maxLength={60}
              placeholder="Monthly walk-round"
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="ops-wide">
            Lines to check, one per row
            <textarea
              rows={9}
              value={lines}
              disabled={pending}
              onChange={(e) => setLines(e.target.value)}
            />
          </label>
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || name.trim().length < 2}>
            {chosen ? 'Save checklist' : 'Add checklist'}
          </Button>
          {chosen && (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                void run(
                  { type: 'checklist-archive', checklistId: chosen.id, archived: !chosen.archived },
                  chosen.archived
                    ? `${chosen.name} is back in use.`
                    : `${chosen.name} put away. Past visits with it are kept.`,
                )
              }
            >
              {chosen.archived ? 'Use it again' : 'Put it away'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}
