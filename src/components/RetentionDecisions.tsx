import { useState } from 'react'
import { useStore } from '../state/context'
import { can } from '../domain/operations'
import { fullDateLabel } from '../domain/format'
import { DEFAULT_EXTENSION_UNIT } from '../domain/dataRetention'
import type { ExtensionUnit } from '../domain/dataRetention'
import {
  deletionMeaning,
  dueRecords,
  keepUntil,
  keptRecords,
  retentionCount,
  retentionKinds,
} from '../domain/retentionDue'
import type { DueGroup, DueRecord } from '../domain/retentionDue'
import { KEEP_MAX } from '../domain/retentionSchema'
import type { RetentionKind } from '../domain/retentionSchema'
import {
  Button,
  ChoiceTiles,
  Empty,
  ErrorMessage,
  Modal,
  SegmentedControl,
  Checkbox,
} from '../design'
import './retentionDecisions.css'

/** Rows shown in a group before "See all". */
const SHOWN = 5
type Choice = 'keep' | 'delete'
type Asking = { kind: RetentionKind; records: DueRecord[] }

/**
 * Stage 6: records at the end of their keeping period, in Settings, Data & privacy. An owner or
 * manager either approves deleting them or keeps them longer; the server checks the role and that
 * each record is still due. Everyone else sees only how many are waiting.
 */
export function RetentionDecisions() {
  const { state, role, today, commit, blocked, saving } = useStore()
  const allowed = can(role, 'retention')
  const groups = dueRecords(state, today)
  const kept = keptRecords(state, today)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [open, setOpen] = useState<Partial<Record<RetentionKind, boolean>>>({})
  const [done, setDone] = useState('')
  const waiting = groups.reduce((sum, g) => sum + g.records.length, 0)
  const day = (date: string) => fullDateLabel(date, state.organisation.locale)

  return (
    <section className="surface ops-panel retention-due" aria-labelledby="retention-due-heading">
      <header>
        <div>
          <h2 id="retention-due-heading">Waiting for your decision</h2>
          <p>
            Records that have reached the end of their keeping period. Nothing is deleted until an
            owner or manager decides.
          </p>
        </div>
      </header>
      <p className="ops-save-note retention-done" role="status">
        {done}
      </p>
      {!allowed ? (
        <p className="ops-help">
          {waiting
            ? `${waiting} ${waiting === 1 ? 'record is' : 'records are'} waiting for an owner or manager to decide.`
            : 'Nothing is waiting. An owner or manager decides about records when their keeping period ends.'}
        </p>
      ) : !groups.length ? (
        <Empty title="Nothing is waiting">
          Records come here when their keeping period ends, and stay until you decide.
        </Empty>
      ) : (
        groups.map((group) => (
          <Group
            key={group.kind}
            group={group}
            all={!!open[group.kind]}
            onAll={() => setOpen((was) => ({ ...was, [group.kind]: true }))}
            onDecide={(records) => {
              setDone('')
              setAsking({ kind: group.kind, records })
            }}
            day={day}
          />
        ))
      )}
      {allowed && kept.length > 0 && (
        <details className="retention-kept">
          <summary>Kept longer ({kept.length})</summary>
          <div className="ops-ledger">
            {kept.map((k) => (
              <div className="ops-record" key={`${k.kind}:${k.recordId}`}>
                <div className="ops-record-copy">
                  <strong>{k.title}</strong>
                  <small>
                    {retentionKinds[k.kind].label}. Comes back {day(k.until)}. {k.reason}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
      {asking && (
        <Decide
          asking={asking}
          today={today}
          day={day}
          busy={blocked || saving}
          onClose={() => setAsking(null)}
          onDone={(words) => {
            setAsking(null)
            setDone(words)
          }}
          commit={commit}
        />
      )}
    </section>
  )
}

function Group({
  group,
  all,
  onAll,
  onDecide,
  day,
}: {
  group: DueGroup
  all: boolean
  onAll: () => void
  onDecide: (records: DueRecord[]) => void
  day: (date: string) => string
}) {
  const count = group.records.length
  const shown = all ? group.records : group.records.slice(0, SHOWN)
  return (
    <section className="retention-group" aria-labelledby={`retention-${group.kind}`}>
      <div className="retention-group-head">
        <div>
          <h3 id={`retention-${group.kind}`}>
            {group.label} <span className="ops-count">{count}</span>
          </h3>
          <p>{group.period}</p>
        </div>
        {count > 1 && (
          <Button variant="secondary" onClick={() => onDecide(group.records)}>
            Decide for all {count}
          </Button>
        )}
      </div>
      <div className="ops-ledger">
        {shown.map((record) => (
          <div className="ops-record" key={record.id}>
            <div className="ops-record-copy">
              <strong>{record.title}</strong>
              <small>
                {record.why}{' '}
                {record.keptUntil
                  ? `Kept until ${day(record.keptUntil)}.`
                  : `Due since ${day(record.dueOn)}.`}
              </small>
            </div>
            <div className="ops-record-controls">
              <Button
                variant="quiet"
                aria-label={`Decide about ${record.title}`}
                onClick={() => onDecide([record])}
              >
                Decide
              </Button>
            </div>
          </div>
        ))}
      </div>
      {shown.length < count && (
        <Button variant="quiet" className="retention-more" onClick={onAll}>
          See all {count}
        </Button>
      )}
    </section>
  )
}

function Decide({
  asking,
  today,
  day,
  busy,
  onClose,
  onDone,
  commit,
}: {
  asking: Asking
  today: string
  day: (date: string) => string
  busy: boolean
  onClose: () => void
  onDone: (words: string) => void
  commit: ReturnType<typeof useStore>['commit']
}) {
  const { state } = useStore()
  const { kind, records } = asking
  const ids = records.map((r) => r.id)
  const one = records.length === 1
  const [choice, setChoice] = useState<Choice>('keep')
  const [amount, setAmount] = useState('1')
  const [unit, setUnit] = useState<ExtensionUnit>(DEFAULT_EXTENSION_UNIT)
  const [reason, setReason] = useState('')
  const [sure, setSure] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const count = retentionCount(kind, records.length)
  const most = KEEP_MAX[unit]
  const whole = Number(amount)
  const amountOk = Number.isInteger(whole) && whole >= 1 && whole <= most
  const until = amountOk ? keepUntil(today, whole, unit) : null
  const meaning = deletionMeaning(state, kind, ids)
  const names = records.slice(0, 5).map((r) => r.title)
  const more = records.length - names.length

  async function save() {
    if (pending || busy) return
    setError('')
    if (choice === 'keep') {
      if (!amountOk) return setError(`Keep them for 1 to ${most} ${unit}.`)
      if (reason.trim().length < 3) return setError('Say why they are being kept longer.')
    } else if (!sure) return setError('Tick the box to say you understand deleting is final.')
    setPending(true)
    try {
      const result = await commit(
        choice === 'keep'
          ? { type: 'retention-keep', kind, ids, amount: whole, unit, reason: reason.trim() }
          : { type: 'retention-delete', kind, ids },
      )
      if (!result.ok) setError(result.error)
      else
        onDone(
          choice === 'keep'
            ? `Kept ${count} until ${day(until!)}. They come back here then.`
            : `Deleted ${count}. Who changed what notes who decided and when, without the details.`,
        )
    } catch {
      setError('This could not be saved. Nothing has changed. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={one ? `Decide about ${records[0].title}` : `Decide about ${count}`}
      description={`${retentionKinds[kind].period} Choose whether to keep ${one ? 'it' : 'them'} longer or delete ${one ? 'it' : 'them'}.`}
    >
      <div className="retention-decide">
        {!one && (
          <p className="retention-names">
            {names.join(', ')}
            {more > 0 ? `, and ${more} more` : ''}.
          </p>
        )}
        <div className="retention-choice">
          <ChoiceTiles
            label="What happens next"
            value={choice}
            onChange={(next) => {
              setChoice(next)
              setError('')
            }}
            options={[
              { value: 'keep', label: 'Keep longer' },
              { value: 'delete', label: 'Approve deletion' },
            ]}
          />
        </div>
        {choice === 'keep' ? (
          <div className="retention-keep">
            <div className="retention-for">
              <label className="ops-field">
                Keep for
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={most}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <SegmentedControl
                label="Months or years"
                appearance="pill"
                value={unit}
                onChange={setUnit}
                options={[
                  { value: 'years', label: 'Years' },
                  { value: 'months', label: 'Months' },
                ]}
              />
            </div>
            <label className="ops-field">
              Why keep {one ? 'it' : 'them'}
              <textarea
                rows={2}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="For example, a complaint is still open."
              />
            </label>
            <p className="ops-help">
              {until
                ? `Kept until ${day(until)}. ${one ? 'It comes' : 'They come'} back here then for a decision.`
                : `Keep for 1 to ${most} ${unit}.`}
            </p>
          </div>
        ) : (
          <div className="retention-delete">
            <dl>
              <div>
                <dt>What is deleted</dt>
                <dd>{meaning.goes}</dd>
              </div>
              <div>
                <dt>What stays</dt>
                <dd>{meaning.stays}</dd>
              </div>
            </dl>
            <label className="checkbox-label retention-sure">
              <Checkbox checked={sure} onChange={(e) => setSure(e.target.checked)} />I understand
              this is final. Deleted details cannot be brought back.
            </label>
          </div>
        )}
        <ErrorMessage error={error} />
        <div className="retention-actions">
          <Button disabled={pending || busy} onClick={() => void save()}>
            {pending
              ? 'Saving…'
              : choice === 'keep'
                ? until
                  ? `Keep until ${day(until)}`
                  : 'Keep longer'
                : 'Delete for good'}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
