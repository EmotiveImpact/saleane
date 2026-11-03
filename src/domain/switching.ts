import type { Command, ContactInput } from './commandSchema'
import type { Appointment, BusinessState, Client, RelationshipEvent } from './model'
import { availableAllocation } from './allocation'
import { staffLocationOn } from './locations'
import { businessDate, operations } from './operations'
import type { ImportBatch } from './operations'
import { dateLabel, money, timeLabel } from './format'
import { carryGiftCards, giftStanding } from './giftCards'
import { carryPackages, planStanding } from './plans'

/**
 * PILOT-03: moving a studio from its previous booking system. Services, upcoming visits and
 * balances arrive through reviewed imports; each import is logged with its totals so the owner can
 * check them against the old system's own report. Nothing is merged, overwritten or removed.
 */
type SwitchingCommand = Extract<
  Command,
  {
    type:
      | 'import-services'
      | 'import-appointments'
      | 'import-balances'
      | 'import-gift-cards'
      | 'import-packages'
      | 'balance-settle'
  }
>
type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void
export type ImportedVisit = Extract<
  Command,
  { type: 'import-appointments' }
>['appointments'][number]

/** Imported visits may sit on the old system's five-minute grid. */
export const IMPORT_STEP_MINUTES = 5

/** How a deposit paid before switching is referenced, so it reads plainly in Money. */
export function carriedReference(source: string, reference?: string) {
  return `Paid to ${source.slice(0, 80)} before switching${reference ? ` · ${reference}` : ''}`
}

/**
 * Why a carried-over visit cannot be placed, or the room or chair it takes. `work` must already
 * hold the visits accepted earlier in the same import so they cannot double-book each other.
 */
export function placeImportedVisit(
  work: BusinessState,
  row: Pick<ImportedVisit, 'serviceId' | 'staffId' | 'date' | 'startMinutes'>,
  now: string,
): { resourceId: string } | { problem: string } {
  const service = work.services.find((item) => item.id === row.serviceId)
  const staff = work.staff.find((item) => item.id === row.staffId)
  if (!service || service.archived) return { problem: 'The treatment is not offered here.' }
  if (!staff || staff.archived) return { problem: 'The professional is not on the team here.' }
  if (!staff.serviceIds.includes(service.id))
    return { problem: `${staff.name} is not set up to give ${service.name}.` }
  const resourceId = availableAllocation(
    work,
    service.id,
    staff.id,
    row.date,
    row.startMinutes,
    service.durationMinutes,
    service.bufferMinutes,
    service.resourceType,
    undefined,
    now,
    undefined,
    IMPORT_STEP_MINUTES,
  )
  if (resourceId) return { resourceId }
  return {
    problem:
      'This time does not fit: it is past, outside opening hours or the professional’s hours, during time away, or clashes with another visit.',
  }
}

/** A stand-in visit used while checking an import, so later rows see earlier ones. */
export function heldVisit(
  work: BusinessState,
  row: Pick<ImportedVisit, 'serviceId' | 'staffId' | 'date' | 'startMinutes'>,
  resourceId: string,
  id: string,
): Appointment {
  const service = work.services.find((item) => item.id === row.serviceId)!
  return {
    id,
    organisationId: work.organisation.id,
    locationId: staffLocationOn(work, row.staffId, row.date),
    clientId: '',
    serviceId: service.id,
    staffId: row.staffId,
    resourceId,
    date: row.date,
    startMinutes: row.startMinutes,
    status: 'confirmed',
    source: 'import',
    createdAt: new Date(0).toISOString(),
    bookedPriceMinor: 0,
    bookedDepositMinor: 0,
    bookedDurationMinutes: service.durationMinutes,
    bookedBufferMinutes: service.bufferMinutes,
  }
}

/**
 * The clients an imported row's email points to. One client with that email is that client, even
 * if the old system spells the name differently; the name only chooses between several clients
 * who share an email.
 */
export function clientsByEmail(clients: Client[], email: string, name = '') {
  const target = email.trim().toLowerCase()
  // A client moved in without an email is never found by a blank one.
  if (!target) return []
  const byEmail = clients.filter((c) => c.email.toLowerCase() === target)
  if (byEmail.length <= 1 || !name.trim()) return byEmail
  return byEmail.filter((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())
}

/** True when this client already has a visit at this time, so an import would repeat it. */
export function alreadyBooked(s: BusinessState, clientId: string, date: string, start: number) {
  return s.appointments.some(
    (a) =>
      a.clientId === clientId &&
      a.date === date &&
      a.startMinutes === start &&
      a.status !== 'cancelled',
  )
}

const IMPORT_KIND = {
  'import-services': 'services',
  'import-appointments': 'appointments',
  'import-balances': 'balances',
  'import-gift-cards': 'giftCards',
  'import-packages': 'packages',
} as const satisfies Record<
  Exclude<SwitchingCommand['type'], 'balance-settle'>,
  ImportBatch['kind']
>

export function runSwitchingCommand(
  next: BusinessState,
  command: SwitchingCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
  createClient: (contact: ContactInput) => Client,
) {
  next.operations = structuredClone(operations(next))
  const o = next.operations
  const org = next.organisation
  if (command.type === 'balance-settle') {
    const balance = (o.balances ?? []).find((b) => b.id === command.balanceId)
    if (!balance) throw new Error('Balance does not belong to this studio.')
    if (balance.settled) return balance.id
    balance.settled = { at: now, actor: 'Local operator', note: command.note }
    addEvent({
      clientId: balance.clientId,
      type: 'profile',
      title:
        balance.kind === 'credit' ? 'Carried-over credit closed' : 'Carried-over balance closed',
      detail: `${money(balance.amountMinor, org, true)}: ${command.note}. No payment was taken or returned by SALEANE.`,
    })
    return balance.id
  }
  const batch: ImportBatch = {
    id: makeId(),
    kind: IMPORT_KIND[command.type],
    source: command.source,
    createdAt: now,
    actor: 'Local operator',
    recordIds: [],
    totalMinor: 0,
  }
  if (command.type === 'import-gift-cards') {
    carryGiftCards(next, command, batch, now, makeId, addEvent)
  } else if (command.type === 'import-packages') {
    carryPackages(next, command, batch, now, makeId, addEvent)
  } else if (command.type === 'import-services') {
    const names = new Set(
      next.services.filter((s) => !s.archived).map((s) => s.name.trim().toLowerCase()),
    )
    for (const { staffIds, ...input } of command.services) {
      const name = input.name.trim()
      if (names.has(name.toLowerCase()))
        throw new Error(`A treatment called ${name} already exists. Review duplicates first.`)
      names.add(name.toLowerCase())
      if (input.depositMinor > input.priceMinor)
        throw new Error('The deposit cannot be more than the treatment price.')
      if (input.durationMinutes + input.bufferMinutes > 1440)
        throw new Error('A treatment must fit within one day.')
      if (!next.resources.some((r) => !r.archived && r.type === input.resourceType))
        throw new Error(
          `Add a ${input.resourceType === 'chair' ? 'chair' : 'treatment room'} before importing treatments that need one.`,
        )
      const service = { ...input, name, id: makeId(), organisationId: org.id }
      next.services.push(service)
      for (const staffId of new Set(staffIds)) {
        const person = next.staff.find((p) => p.id === staffId)
        if (!person) throw new Error('Professional does not belong to this studio.')
        person.serviceIds.push(service.id)
      }
      batch.recordIds.push(service.id)
      batch.totalMinor += service.priceMinor
    }
  } else if (command.type === 'import-appointments') {
    let deposits = 0
    for (const row of command.appointments) {
      if (row.depositPaidMinor > row.priceMinor)
        throw new Error('A deposit paid cannot be more than the visit price.')
      let client = row.clientId ? next.clients.find((c) => c.id === row.clientId) : undefined
      if (row.clientId && !client) throw new Error('Client does not belong to this studio.')
      // Several visits for one new guest share the client added by the first of them.
      const contact = row.contact
      if (!client && contact) {
        const found = clientsByEmail(next.clients, contact.email, contact.name)
        if (found.length === 1) client = found[0]
      }
      if (!client && row.contact) {
        if (row.contact.marketingConsent)
          throw new Error('Clients arrive with marketing off. Record consent individually.')
        client = createClient(row.contact)
        addEvent({
          clientId: client.id,
          type: 'profile',
          title: 'Client carried over',
          detail: `Source: ${command.source}. Added with an upcoming visit. Marketing remains off.`,
        })
      }
      if (!client) throw new Error('Each visit needs a client.')
      if (alreadyBooked(next, client.id, row.date, row.startMinutes))
        throw new Error(
          `${client.name} already has a visit at that time. Review duplicates before importing.`,
        )
      const placed = placeImportedVisit(next, row, now)
      if ('problem' in placed) throw new Error(placed.problem)
      const service = next.services.find((item) => item.id === row.serviceId)!
      const appointment: Appointment = {
        id: makeId(),
        organisationId: org.id,
        // V2: the visit is where the professional works that day, as its room is.
        locationId: staffLocationOn(next, row.staffId, row.date),
        clientId: client.id,
        serviceId: service.id,
        staffId: row.staffId,
        resourceId: placed.resourceId,
        date: row.date,
        startMinutes: row.startMinutes,
        status: 'confirmed',
        source: 'import',
        createdAt: now,
        // The guest keeps the terms they booked under: the old price, and only the deposit paid.
        bookedPriceMinor: row.priceMinor,
        bookedDepositMinor: row.depositPaidMinor,
        bookedDurationMinutes: service.durationMinutes,
        bookedBufferMinutes: service.bufferMinutes,
        bookedResourceType: service.resourceType,
        bookedServiceName: service.name,
        // The quoted price is what the guest expects to pay in full, so any tax is inside it.
        bookedTax: o.tax ? { ...o.tax, inclusive: true } : null,
      }
      next.appointments.push(appointment)
      if (row.depositPaidMinor > 0)
        next.payments.push({
          id: makeId(),
          organisationId: org.id,
          appointmentId: appointment.id,
          kind: 'deposit',
          amountMinor: row.depositPaidMinor,
          currency: org.currency,
          recordedAt: now,
          method: 'previous_system',
          reference: carriedReference(command.source, row.reference),
        })
      addEvent({
        clientId: client.id,
        appointmentId: appointment.id,
        type: 'booked',
        title: 'Upcoming visit carried over',
        detail: `${service.name} · ${dateLabel(row.date, org.locale)} at ${timeLabel(row.startMinutes, org.locale)}. Booked in ${command.source} at ${money(row.priceMinor, org, true)}${row.reference ? ` (reference ${row.reference})` : ''}. ${row.depositPaidMinor ? `Deposit of ${money(row.depositPaidMinor, org, true)} was paid to ${command.source}; SALEANE took no payment.` : 'No deposit was paid.'} No confirmation sent; reminders follow the studio’s settings.`,
      })
      batch.recordIds.push(appointment.id)
      batch.totalMinor += row.priceMinor
      deposits += row.depositPaidMinor
    }
    batch.depositsMinor = deposits
  } else {
    o.balances ??= []
    for (const row of command.balances) {
      const client = next.clients.find((c) => c.id === row.clientId)
      if (!client) throw new Error('Client does not belong to this studio.')
      if (o.balances.some((b) => b.clientId === client.id && !b.settled))
        throw new Error(`${client.name} already has an open carried-over balance.`)
      const balance = {
        id: makeId(),
        clientId: client.id,
        importId: batch.id,
        kind: row.kind,
        amountMinor: row.amountMinor,
        note: row.note,
        createdAt: now,
        actor: 'Local operator',
      }
      o.balances.push(balance)
      addEvent({
        clientId: client.id,
        type: 'profile',
        title: row.kind === 'credit' ? 'Credit carried over' : 'Balance owed carried over',
        detail: `${money(row.amountMinor, org, true)} ${row.kind === 'credit' ? 'in credit' : 'owed to the studio'} in ${command.source}${row.note ? `: ${row.note}` : ''}. Recorded for the desk; SALEANE moved no money.`,
      })
      batch.recordIds.push(balance.id)
      batch.totalMinor += row.amountMinor
    }
  }
  o.imports = [...(o.imports ?? []), batch]
  return batch.id
}

/** The old system a carried-over gift card or package came from, as its import names it. */
export function carriedSource(s: BusinessState, importId: string) {
  return (
    (operations(s).imports ?? []).find((batch) => batch.id === importId)?.source ?? 'the old system'
  )
}

/** What each logged import still stands at, for checking against the old system. */
export function importStanding(s: BusinessState, batch: ImportBatch) {
  if (batch.kind === 'appointments') {
    const visits = s.appointments.filter((a) => batch.recordIds.includes(a.id))
    return {
      upcoming: visits.filter((a) => a.status === 'confirmed').length,
      changed: visits.filter((a) => a.status !== 'confirmed').length,
    }
  }
  if (batch.kind === 'balances') {
    const rows = (operations(s).balances ?? []).filter((b) => b.importId === batch.id)
    return {
      upcoming: rows.filter((b) => !b.settled).length,
      changed: rows.filter((b) => b.settled).length,
    }
  }
  // Moving in, stage 3: cards and packages still to spend, and those used, ended or cancelled.
  const today = businessDate(s)
  if (batch.kind === 'giftCards') {
    const cards = (s.giftCards ?? []).filter((c) => c.carried?.importId === batch.id)
    const open = cards.filter((c) => giftStanding(c, today).state === 'active').length
    return { upcoming: open, changed: cards.length - open }
  }
  if (batch.kind === 'packages') {
    const plans = (s.holdings ?? []).filter((h) => h.carried?.importId === batch.id)
    const open = plans.filter((h) => planStanding(h, today).state === 'active').length
    return { upcoming: open, changed: plans.length - open }
  }
  return { upcoming: batch.recordIds.length, changed: 0 }
}
