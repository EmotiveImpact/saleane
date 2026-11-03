/**
 * LOCAL-03 retention register, decided by the owner on 7 October 2026. These periods say when a
 * record becomes due for deletion. Nothing is ever deleted automatically: a record that reaches
 * the end of its period waits for an owner or manager, who either approves its deletion or keeps
 * it longer by a number of months or years (years by default). Stage 6 built the step
 * (retentionDue.ts, Settings, Data & privacy): it offers exactly these two choices to these roles.
 */
export const DELETION_APPROVERS = ['owner', 'manager'] as const

export const RETENTION_DECIDED_ON = '2026-10-07'

export interface RetentionRule {
  record: string
  period: string
}

export const RETENTION_REGISTER: RetentionRule[] = [
  { record: 'Client contact details', period: '2 years after the last visit' },
  { record: '“Good to remember” and relationship notes', period: '2 years after the last visit' },
  { record: 'Client connections', period: '2 years after the last visit' },
  { record: 'Private guest feedback (ratings and comments)', period: '2 years after it was given' },
  {
    record: 'Email marketing consent and withdrawals',
    period: 'Until withdrawn, then 2 more years as evidence',
  },
  { record: 'Unsent messages (drafts, queued, suppressed)', period: '90 days' },
  { record: 'Waitlist requests', period: '90 days after the requested dates end' },
  {
    record: 'Receipts, payments, deposits, refunds and booked visit terms',
    period: '6 years in the UK, 7 years in the US',
  },
  { record: 'Staff accounts and memberships', period: '6 years after the person leaves' },
  { record: 'Audit log', period: '6 years' },
  { record: 'Backups', period: '35 days' },
]

/** Whether a role may approve deleting records that have reached the end of their period. */
export const canApproveDeletion = (role: string) =>
  (DELETION_APPROVERS as readonly string[]).includes(role)

export type RetentionChoice = 'delete' | 'extend'
export type ExtensionUnit = 'months' | 'years'
export const DEFAULT_EXTENSION_UNIT: ExtensionUnit = 'years'

/**
 * The new due date (YYYY-MM-DD) after keeping a record longer. A month-end date stays within the
 * target month, so 31 January plus one month is 28 or 29 February.
 */
export function extendRetention(
  dueDate: string,
  amount: number,
  unit: ExtensionUnit = DEFAULT_EXTENSION_UNIT,
): string {
  if (!Number.isInteger(amount) || amount < 1) throw new Error('Extend by at least one whole unit.')
  const [year, month, day] = dueDate.split('-').map(Number)
  const months = year * 12 + month - 1 + (unit === 'years' ? amount * 12 : amount)
  const nextYear = Math.floor(months / 12)
  const nextMonth = (months % 12) + 1
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${nextYear}-${pad(nextMonth)}-${pad(Math.min(day, lastDay))}`
}
