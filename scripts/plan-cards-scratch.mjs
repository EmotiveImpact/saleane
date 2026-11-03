/* global process, console */
// Stage 1, scratch databases only: moves one membership's dates so that, on today's real clock,
// its next card payment is three days away ("remind") or falls due today ("due"). The server's own
// loop then queues the reminder or takes the payment on its next pass (within 30 seconds, and only
// between 09:00 and 19:00 studio time for a reminder, or from 09:00 for a payment).
//
//   node scripts/plan-cards-scratch.mjs <scratch.sqlite> <membership id or client email> remind|due [YYYY-MM-DD]
//
// Stop the server first and start it again afterwards, so nothing else writes at the same time.
// It refuses any database whose path does not contain "scratch".
import { DatabaseSync } from 'node:sqlite'

const [file, which, mode, today = new Date().toISOString().slice(0, 10)] = process.argv.slice(2)
if (!file || !which || !['remind', 'due'].includes(mode))
  throw new Error(
    'Use: node scripts/plan-cards-scratch.mjs <scratch.sqlite> <membership id or client email> remind|due [date]',
  )
if (!/scratch/i.test(file)) throw new Error('Use a scratch database: its path must say "scratch".')

const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
const addDays = (date, days) => iso(Date.parse(`${date}T12:00:00Z`) + days * 86400000)
/** The same day a month earlier, or that month's last day when it is shorter. */
function monthBefore(date) {
  const [y, m, d] = date.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 2, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return `${iso(first).slice(0, 8)}${String(Math.min(d, last)).padStart(2, '0')}`
}

const db = new DatabaseSync(file)
// The membership by its id, or the one a client (by email) has set to be paid from a saved card.
let row
let holding
for (const org of db.prepare('SELECT id,state FROM organisations').all()) {
  const parsed = JSON.parse(org.state)
  const client = parsed.clients.find((c) => c.email.toLowerCase() === which.toLowerCase())
  const found = (parsed.holdings ?? []).find(
    (h) =>
      h.id === which ||
      (client && h.clientId === client.id && h.status === 'active' && h.cardAgreements?.length),
  )
  if (found) {
    row = { id: org.id, state: parsed }
    holding = found
    break
  }
}
if (!row) throw new Error('No membership with that id, or client email, in this database.')
const state = row.state
if (state.operations?.mode !== 'local') throw new Error('Sample studios never take card payments.')
const agreement = holding.cardAgreements?.at(-1)
if (holding.kind !== 'membership' || holding.status !== 'active' || !agreement || agreement.endedAt)
  throw new Error('Set the membership up to be paid from a saved card first.')
if (holding.payments.length !== 1)
  throw new Error('Use a membership with only its first payment, sold for this rehearsal.')

const holdingId = holding.id
const due = mode === 'remind' ? addDays(today, 3) : today
const before = agreement.startsOn
const started = monthBefore(due)
holding.startedOn = started
holding.paidUntil = due
holding.payments[0].periodStart = started
agreement.startsOn = due
state.revision += 1
db.prepare('UPDATE organisations SET state=?,revision=? WHERE id=?').run(
  JSON.stringify(state),
  state.revision,
  row.id,
)
// The reminder that went out three days before now belongs to the payment due today.
const moved =
  mode === 'due'
    ? db
        .prepare(
          "UPDATE outbox SET slot=?,dedupe_key=replace(dedupe_key,?,?) WHERE kind='plan_reminder' AND slot=?",
        )
        .run(`${holdingId}:${due}`, before, due, `${holdingId}:${before}`).changes
    : 0
// Only a reminder that went out (written down in test mode, or accepted) lets the card be tried.
const waiting =
  mode === 'due'
    ? db
        .prepare(
          "SELECT count(*) AS n FROM outbox WHERE kind='plan_reminder' AND slot=? AND status NOT IN ('test','accepted','delivered')",
        )
        .get(`${holdingId}:${due}`).n
    : 0
console.log(
  `Membership ${holdingId}: first month ${started}, next card payment ${due}.` +
    (mode === 'due' ? ` Reminders moved to it: ${moved}.` : '') +
    (waiting
      ? ` ${waiting} of them had not gone out yet, so the card will not be tried: start the server after "remind" and wait for the reminder first.`
      : ''),
)
