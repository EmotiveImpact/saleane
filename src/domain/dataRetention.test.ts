import { describe, expect, it } from 'vitest'
import { canApproveDeletion, RETENTION_REGISTER } from './dataRetention'

describe('retention register', () => {
  it('lets only an owner or manager approve a deletion', () => {
    expect(canApproveDeletion('owner')).toBe(true)
    expect(canApproveDeletion('manager')).toBe(true)
    expect(canApproveDeletion('reception')).toBe(false)
    expect(canApproveDeletion('practitioner')).toBe(false)
  })

  it('keeps money records for the statutory period in each market', () => {
    const money = RETENTION_REGISTER.find((r) => r.record.startsWith('Receipts'))
    expect(money?.period).toBe('6 years in the UK, 7 years in the US')
  })
})
