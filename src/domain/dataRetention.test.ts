import { describe, expect, it } from 'vitest'
import { canApproveDeletion, extendRetention, RETENTION_REGISTER } from './dataRetention'

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

  it('keeps a record longer by years by default, or by months', () => {
    expect(extendRetention('2028-10-07', 1)).toBe('2029-10-07')
    expect(extendRetention('2028-10-07', 3, 'months')).toBe('2029-01-07')
    expect(extendRetention('2027-01-31', 1, 'months')).toBe('2027-02-28')
    expect(extendRetention('2028-02-29', 1)).toBe('2029-02-28')
    expect(() => extendRetention('2028-10-07', 0)).toThrow()
  })
})
