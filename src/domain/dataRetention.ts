/**
 * LOCAL-03 retention register, decided by the owner on 7 October 2026. These periods say when a
 * record becomes due for deletion. Nothing is ever deleted automatically: a record that reaches
 * the end of its period waits until an owner or manager approves its deletion. No deletion step
 * exists yet; when one is built it must ask one of these roles first.
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
  {
    record: 'Email marketing consent and withdrawals',
    period: 'Until withdrawn, then 2 more years as evidence',
  },
  { record: 'Unsent messages (drafts, queued, suppressed)', period: '90 days' },
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
