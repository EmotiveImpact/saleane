import type { Command } from '../domain/commands'
import type { BusinessState, Service } from '../domain/model'
import { parseMinor } from '../domain/money'
import { clientsByEmail } from '../domain/switching'
import { readCsv } from './clientImportCsv'

/**
 * PILOT-03: reading the files a studio exports from its old system. Each row is checked against
 * SALEANE's own records and shown for review; nothing here saves anything. Clients and upcoming
 * visits come across through moving in (MovingIn.tsx), which reads each old system's own files.
 */
export type SwitchKind = 'services' | 'balances'
export type SwitchRow<T> = {
  record: number
  cells: string[]
  status: 'ready' | 'duplicate' | 'problem'
  detail: string
  value?: T
  /** The money this row carries, for the totals the owner checks against the old system. */
  amountMinor: number
  depositMinor: number
}
export type SwitchPreview<T> = { rows: SwitchRow<T>[]; columns: string[]; ignored: string[] }
export type ServiceRow = Extract<Command, { type: 'import-services' }>['services'][number]
export type BalanceRow = Extract<Command, { type: 'import-balances' }>['balances'][number]

export const SWITCH_MAX_ROWS = { services: 200, balances: 500 } as const

/** The headings each file needs, and the ones it may carry. */
export const SWITCH_COLUMNS = {
  services: {
    required: ['name', 'duration', 'price'],
    optional: ['deposit', 'category', 'buffer', 'space', 'description', 'professionals'],
  },
  balances: {
    required: ['email', 'amount'],
    optional: ['name', 'type', 'note'],
  },
} as const

/** Money as old systems export it: "£25", "1,250.00", "$40.5". Negative amounts are refused. */
export function csvMoney(value: string | undefined, empty = Number.NaN) {
  const text = (value ?? '')
    .trim()
    .replace(/^[£$€]/, '')
    .replace(/,/g, '')
  return parseMinor(text, empty)
}

function table(source: string, kind: SwitchKind) {
  const records = readCsv(source)
  if (records.length < 2) throw new Error('Include a heading row and at least one row below it.')
  if (records.length - 1 > SWITCH_MAX_ROWS[kind])
    throw new Error(
      `Import at most ${SWITCH_MAX_ROWS[kind]} rows of this kind at a time. Split the file and review each part.`,
    )
  const headers = records[0].map((value) => value.trim().toLowerCase().replace(/\s+/g, '_'))
  if (new Set(headers).size !== headers.length)
    throw new Error('Each column heading must be unique.')
  const { required, optional } = SWITCH_COLUMNS[kind]
  if (required.some((header) => !headers.includes(header)))
    throw new Error(`Required column headings: ${required.join(', ')}.`)
  const known = new Set<string>([...required, ...optional])
  const at = (values: string[], header: string) =>
    headers.includes(header) ? (values[headers.indexOf(header)] ?? '').trim() : ''
  return {
    rows: records.slice(1).map((values, index) => ({ values, record: index + 2 })),
    headers,
    at,
    ignored: headers.filter((header) => !known.has(header)),
    columns: headers.filter((header) => known.has(header)),
  }
}

function problem<T>(
  record: number,
  cells: string[],
  detail: string,
  status: 'problem' | 'duplicate' = 'problem',
): SwitchRow<T> {
  return { record, cells, status, detail, amountMinor: 0, depositMinor: 0 }
}

const byName = <T extends { name: string; archived?: boolean }>(rows: T[], name: string) =>
  rows.filter((row) => !row.archived && row.name.trim().toLowerCase() === name.toLowerCase())

export function previewServicesCsv(
  source: string,
  state: BusinessState,
): SwitchPreview<ServiceRow> {
  const file = table(source, 'services')
  const taken = new Set(
    state.services.filter((s) => !s.archived).map((s) => s.name.trim().toLowerCase()),
  )
  const rows = file.rows.map(({ values, record }): SwitchRow<ServiceRow> => {
    const cells = file.columns.map((header) => file.at(values, header))
    if (values.length !== file.headers.length)
      return problem(
        record,
        cells,
        `Expected ${file.headers.length} columns; found ${values.length}.`,
      )
    const name = file.at(values, 'name')
    const duration = Number(file.at(values, 'duration'))
    const buffer = file.at(values, 'buffer') ? Number(file.at(values, 'buffer')) : 0
    const price = csvMoney(file.at(values, 'price'))
    const deposit = csvMoney(file.at(values, 'deposit'), 0)
    const categoryText = file.at(values, 'category').toLowerCase()
    const category = (['Skin', 'Body', 'Hair'] as const).find(
      (c) => c.toLowerCase() === categoryText,
    )
    const spaceText = file.at(values, 'space').toLowerCase()
    if (name.length < 2 || name.length > 100)
      return problem(record, cells, 'name: Use 2 to 100 characters.')
    if (!Number.isInteger(duration) || duration < 5 || duration > 720)
      return problem(record, cells, 'duration: Use whole minutes between 5 and 720.')
    if (!Number.isInteger(buffer) || buffer < 0 || buffer > 240)
      return problem(record, cells, 'buffer: Use whole minutes between 0 and 240.')
    if (!Number.isFinite(price))
      return problem(record, cells, 'price: Use an amount such as 65.00.')
    if (!Number.isFinite(deposit))
      return problem(record, cells, 'deposit: Use an amount such as 20.00, or leave it empty.')
    if (deposit > price) return problem(record, cells, 'deposit: It cannot be more than the price.')
    if (categoryText && !category)
      return problem(record, cells, 'category: Use Skin, Body or Hair.')
    if (spaceText && !['treatment', 'treatment room', 'room', 'chair'].includes(spaceText))
      return problem(record, cells, 'space: Use treatment room or chair.')
    const professionals = file
      .at(values, 'professionals')
      .split(/[;|]/)
      .map((item) => item.trim())
      .filter(Boolean)
    const staffIds: string[] = []
    for (const person of professionals) {
      const found = byName(state.staff, person)
      if (found.length !== 1)
        return problem(
          record,
          cells,
          found.length
            ? `professionals: More than one team member is called ${person}.`
            : `professionals: No one on the team is called ${person}. Add them in Team first, or leave them out.`,
        )
      staffIds.push(found[0].id)
    }
    const key = name.toLowerCase()
    if (taken.has(key))
      return problem(
        record,
        cells,
        'A treatment with this name already exists, or appears earlier in this file. The existing one stays unchanged.',
        'duplicate',
      )
    taken.add(key)
    const resolvedCategory: Service['category'] = category ?? 'Skin'
    const resourceType: Service['resourceType'] = spaceText
      ? spaceText === 'chair'
        ? 'chair'
        : 'treatment'
      : resolvedCategory === 'Hair'
        ? 'chair'
        : 'treatment'
    if (!state.resources.some((r) => !r.archived && r.type === resourceType))
      return problem(
        record,
        cells,
        `This treatment needs a ${resourceType === 'chair' ? 'chair' : 'treatment room'}. Add one in Spaces & equipment first.`,
      )
    return {
      record,
      cells,
      status: 'ready',
      detail: `New treatment${category ? '' : ' in Skin (no category given)'}, ${resourceType === 'chair' ? 'uses a chair' : 'uses a treatment room'}${staffIds.length ? `, given by ${professionals.join(', ')}` : ', no one assigned yet'}.`,
      amountMinor: price,
      depositMinor: deposit,
      value: {
        name,
        description: file.at(values, 'description').slice(0, 1000),
        category: resolvedCategory,
        durationMinutes: duration,
        bufferMinutes: buffer,
        priceMinor: price,
        depositMinor: deposit,
        resourceType,
        staffIds,
      },
    }
  })
  return { rows, columns: file.columns, ignored: file.ignored }
}

export function previewBalancesCsv(
  source: string,
  state: BusinessState,
): SwitchPreview<BalanceRow> {
  const file = table(source, 'balances')
  const open = new Set(
    (state.operations?.balances ?? []).filter((b) => !b.settled).map((b) => b.clientId),
  )
  const rows = file.rows.map(({ values, record }): SwitchRow<BalanceRow> => {
    const cells = file.columns.map((header) => file.at(values, header))
    if (values.length !== file.headers.length)
      return problem(
        record,
        cells,
        `Expected ${file.headers.length} columns; found ${values.length}.`,
      )
    const email = file.at(values, 'email').toLowerCase()
    const name = file.at(values, 'name')
    const matches = clientsByEmail(state.clients, email, name)
    if (matches.length !== 1)
      return problem(
        record,
        cells,
        matches.length
          ? 'email: Several clients share this email. Add a name column.'
          : 'email: No client has this email. Import clients first.',
      )
    const typeText = file.at(values, 'type').toLowerCase()
    const kind =
      !typeText || ['credit', 'gift card', 'account credit'].includes(typeText)
        ? 'credit'
        : ['owed', 'owing', 'debt', 'unpaid'].includes(typeText)
          ? 'owed'
          : null
    if (!kind) return problem(record, cells, 'type: Use credit or owed.')
    const amount = csvMoney(file.at(values, 'amount'))
    if (!Number.isFinite(amount) || amount <= 0)
      return problem(record, cells, 'amount: Use an amount above zero, such as 25.00.')
    const note = file.at(values, 'note')
    if (note.length > 200) return problem(record, cells, 'note: Use at most 200 characters.')
    const client = matches[0]
    if (open.has(client.id))
      return problem(
        record,
        cells,
        `${client.name} already has an open carried-over balance. Close it first, or leave this row out.`,
        'duplicate',
      )
    open.add(client.id)
    return {
      record,
      cells,
      status: 'ready',
      detail: `${client.name}: ${kind === 'credit' ? 'credit to use or return' : 'owed to the studio'}.`,
      amountMinor: amount,
      depositMinor: 0,
      value: { clientId: client.id, kind, amountMinor: amount, note },
    }
  })
  return { rows, columns: file.columns, ignored: file.ignored }
}
