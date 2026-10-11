/**
 * V5 and Stage 5: what an access key may do. The owner ticks each one when the key is made; a key
 * made before Stage 5 keeps exactly the scopes it had. Reading scopes only read. Writing scopes let
 * other software book, move and cancel visits, add and change clients, or send in a chain's till
 * sales, each through the same checks as the desk.
 */

export const readScopes = [
  'appointments:read',
  'clients:read',
  'services:read',
  'takings:read',
] as const
export const writeScopes = ['appointments:write', 'clients:write', 'sales:write'] as const
export const apiScopes = [...readScopes, ...writeScopes] as const
export type ApiScope = (typeof apiScopes)[number]

/**
 * What a key for one location may have: its own visits to read and change, the menu and team, and
 * its own till's sales. Clients and takings belong to the whole studio.
 */
export const LOCATION_SCOPES: readonly ApiScope[] = [
  'appointments:read',
  'services:read',
  'appointments:write',
  'sales:write',
]

/** Each scope in a few words, then what it allows in a plain sentence, for the key screen. */
export const scopeWords: Record<ApiScope, { label: string; detail: string }> = {
  'appointments:read': {
    label: 'Read visits',
    detail: 'Dates, times, treatments and who does them. No client names.',
  },
  'clients:read': {
    label: 'Read clients',
    detail: 'Names, email, phone and whether they agreed to email news.',
  },
  'services:read': {
    label: 'Read treatments and the team',
    detail: 'The menu with prices and lengths, and who does each treatment.',
  },
  'takings:read': {
    label: 'Read takings by day',
    detail: 'Totals for each day, with no names or receipts.',
  },
  'appointments:write': {
    label: 'Add and change visits',
    detail:
      'Book, move and cancel visits, with the same checks as the desk: hours, rooms, patch tests and the booked price. Guests get the studio’s usual messages.',
  },
  'clients:write': {
    label: 'Add and change clients',
    detail:
      'Add clients and change their details. Email news is only ever recorded when the software says who agreed, when and how.',
  },
  'sales:write': {
    label: 'Send in till sales',
    detail:
      'Sales and refunds from another till, recorded as money taken outside SALEANE. They count in takings and Money, and products sold come off the shelf.',
  },
}

export const isWriteScope = (scope: ApiScope) => (writeScopes as readonly string[]).includes(scope)

/** What a key does, in the key list: what it reads, then what it changes. */
export function keySummary(scopes: readonly ApiScope[]) {
  const words = (list: ApiScope[]) =>
    list.map((scope) => scopeWords[scope].label.toLowerCase()).join('; ')
  const reads = scopes.filter((scope) => !isWriteScope(scope))
  const writes = scopes.filter(isWriteScope)
  return [
    reads.length ? `May ${words(reads)}` : '',
    writes.length ? `${reads.length ? 'and ' : 'May '}${words(writes)}` : '',
  ]
    .filter(Boolean)
    .join(', ')
}
