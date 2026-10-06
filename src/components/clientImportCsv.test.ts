import { describe, expect, it } from 'vitest'
import { CLIENT_IMPORT_MAX_BYTES, previewClientCsv, readCsv } from './clientImportCsv'

describe('bounded contact CSV parsing', () => {
  it('preserves quoted commas, doubled quotes, BOM and multiline fields as plain text', () => {
    expect(
      readCsv(
        '\uFEFFname,email,phone\r\n"Doe, Jane",jane@example.com,+442071234567\r\n"Sam ""Sun""\nLee",sam@example.com,+12125550123\r\n',
      ),
    ).toEqual([
      ['name', 'email', 'phone'],
      ['Doe, Jane', 'jane@example.com', '+442071234567'],
      ['Sam "Sun"\nLee', 'sam@example.com', '+12125550123'],
    ])
  })
  it('rejects ambiguous quoting and bounded input excess instead of partially importing it', () => {
    expect(() => readCsv('name,email,phone\n"Open,jane@example.com,+442071234567')).toThrow(
      'not closed',
    )
    expect(() => readCsv('name,email,phone\n"Jane"suffix,jane@example.com,+442071234567')).toThrow(
      'closing quote',
    )
    expect(() => readCsv('name,email,phone\nJa"ne,jane@example.com,+442071234567')).toThrow(
      'unquoted',
    )
    expect(() => readCsv('x'.repeat(CLIENT_IMPORT_MAX_BYTES + 1))).toThrow('48 KiB')
    expect(() =>
      readCsv('name,email,phone\n' + 'Jo,j@example.com,+12125550123\n'.repeat(501)),
    ).toThrow('500')
  })
  it('requires unambiguous headers and rejects invalid row shape and contact values', () => {
    expect(() => previewClientCsv('name,email\nJane,jane@example.com', [])).toThrow(
      'Required column',
    )
    expect(() =>
      previewClientCsv('name,email,phone,name\nJane,jane@example.com,+12125550123,Jane', []),
    ).toThrow('unique')
    const preview = previewClientCsv(
      'name,email,phone\n,missing@example.com,+12125550123\nJane,bad,+12125550123\nSam,sam@example.com,+-------\nAlex,alex@example.com,02071234567\nNia,nia@example.com,+442071234567,extra',
      [],
    )
    expect(preview.rows.every((row) => row.status === 'invalid')).toBe(true)
    expect(preview.rows[4].detail).toContain('Expected 3 columns')
  })
  it('skips exact duplicate name/email pairs without merging shared email clients', () => {
    const preview = previewClientCsv(
      'name,email,phone\n  JANE DOE  ,JANE@example.com,+442071234567\nAlex One,shared@example.com,+12125550123\nAlex One,SHARED@example.com,+12125550124\nAlex Two,shared@example.com,+12125550125',
      [{ name: 'Jane Doe', email: 'jane@example.com' }],
    )
    expect(preview.rows.map((row) => row.status)).toEqual([
      'duplicate',
      'ready',
      'duplicate',
      'ready',
    ])
    expect(preview.rows[0].detail).toContain('Existing record stays unchanged')
  })
  it('never imports consent columns or interprets formula-like names and accepts international numbers', () => {
    const preview = previewClientCsv(
      'name,email,phone,marketingConsent\n=1+1,formula@example.com,+44 (20) 7123 4567,true\nUS Guest,us@example.com,+1 212 555 0123,true',
      [],
    )
    expect(preview.ignoredColumns).toEqual(['marketingconsent'])
    expect(preview.rows.map((row) => row.contact?.marketingConsent)).toEqual([false, false])
    expect(preview.rows[0].contact?.name).toBe('=1+1')
    expect(preview.rows.every((row) => row.status === 'ready')).toBe(true)
  })
})
