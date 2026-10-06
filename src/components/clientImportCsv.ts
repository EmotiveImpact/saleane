import { importContactSchema } from '../domain/commandSchema'
import type { ContactInput } from '../domain/commands'

export const CLIENT_IMPORT_MAX_BYTES = 48 * 1024
export const CLIENT_IMPORT_MAX_ROWS = 500
export const CLIENT_IMPORT_MAX_PAYLOAD_BYTES = 60 * 1024
export type ImportRow = {
  record: number
  name: string
  email: string
  phone: string
  status: 'ready' | 'duplicate' | 'invalid'
  detail: string
  contact?: ContactInput
}
export type ClientImportPreview = { rows: ImportRow[]; ignoredColumns: string[] }

/** Bounded RFC-style CSV. Quoted commas, doubled quotes and line breaks stay text. */
export function readCsv(source: string): string[][] {
  if (new TextEncoder().encode(source).byteLength > CLIENT_IMPORT_MAX_BYTES)
    throw new Error('This file exceeds 48 KiB. Split it into smaller CSV files.')
  const input = source.replace(/^\uFEFF/, '')
  if (
    [...input].some((character) => {
      const n = character.charCodeAt(0)
      return n === 0 || (n < 32 && ![9, 10, 13].includes(n))
    })
  )
    throw new Error('This file contains unsupported control characters. Use a UTF-8 CSV file.')
  if (input.includes('\uFFFD'))
    throw new Error('The text could not be read as UTF-8. Save the CSV with UTF-8 encoding.')
  const records: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false,
    closedQuote = false
  function endField() {
    row.push(field)
    field = ''
    closedQuote = false
  }
  function endRow() {
    endField()
    if (row.some((value) => value.trim() !== '')) records.push(row)
    row = []
    if (records.length > CLIENT_IMPORT_MAX_ROWS + 1)
      throw new Error(
        'Import at most 500 client rows at a time. Split this file and review each part.',
      )
  }
  for (let i = 0; i < input.length; i++) {
    const character = input[i]
    if (quoted) {
      if (character === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          closedQuote = true
        }
      } else field += character
      continue
    }
    if (character === ',') {
      endField()
      continue
    }
    if (character === '\n' || character === '\r') {
      endRow()
      if (character === '\r' && input[i + 1] === '\n') i++
      continue
    }
    if (closedQuote)
      throw new Error(
        'Unexpected text after a closing quote. Check the CSV quoting before importing.',
      )
    if (character === '"') {
      if (field.length)
        throw new Error(
          'A quote appeared inside an unquoted field. Use doubled quotes inside a quoted field.',
        )
      quoted = true
    } else field += character
  }
  if (quoted) throw new Error('A quoted field was not closed. Check the CSV before importing.')
  if (field.length || row.length || closedQuote) endRow()
  return records
}

export function previewClientCsv(
  source: string,
  existing: { name: string; email: string }[],
): ClientImportPreview {
  const records = readCsv(source)
  if (records.length < 2) throw new Error('Include a header and at least one client row.')
  const headers = records[0].map((value) => value.trim().toLowerCase())
  if (new Set(headers).size !== headers.length)
    throw new Error('Each column heading must be unique.')
  const required = ['name', 'email', 'phone']
  if (required.some((header) => !headers.includes(header)))
    throw new Error('Required column headings: name, email, phone.')
  const known = new Set(
    existing.map(
      (client) => `${client.name.trim().toLowerCase()}\u0000${client.email.trim().toLowerCase()}`,
    ),
  )
  const accepted = new Set<string>()
  const rows = records.slice(1).map((values, index): ImportRow => {
    const name = (values[headers.indexOf('name')] ?? '').trim()
    const email = (values[headers.indexOf('email')] ?? '').trim().toLowerCase()
    const phone = (values[headers.indexOf('phone')] ?? '').trim()
    const base = { record: index + 2, name, email, phone }
    if (values.length !== headers.length)
      return {
        ...base,
        status: 'invalid',
        detail: `Expected ${headers.length} columns; found ${values.length}.`,
      }
    const result = importContactSchema.safeParse({ name, email, phone, marketingConsent: false })
    if (!result.success)
      return {
        ...base,
        status: 'invalid',
        detail: result.error.issues
          .map((issue) => `${String(issue.path[0] ?? 'Row')}: ${issue.message}`)
          .join(' '),
      }
    const key = `${name.toLowerCase()}\u0000${email}`
    if (known.has(key))
      return {
        ...base,
        status: 'duplicate',
        detail: 'Exact name and email already exist. Existing record stays unchanged.',
      }
    if (accepted.has(key))
      return {
        ...base,
        status: 'duplicate',
        detail: 'Repeated name and email within this file. Only the first valid row is offered.',
      }
    accepted.add(key)
    return {
      ...base,
      status: 'ready',
      detail: 'New client. Marketing permission stays off.',
      contact: result.data,
    }
  })
  return { rows, ignoredColumns: headers.filter((header) => !required.includes(header)) }
}
