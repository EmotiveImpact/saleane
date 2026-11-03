import type { Appointment, BusinessState, RelationshipEvent } from './model'
import { CONSULTATION_LIMIT, consultationContentSchema } from './consultationsSchema'
import type { Consultation, ConsultationContent } from './consultationsSchema'
import { healthWordIn } from './forms'
import { businessDate } from './operations'

/**
 * V1.5: consultations, kept on the client. Changing one makes a new version; a visit booked from
 * it carries the version it was booked against, so the plan the guest agreed to stays readable on
 * the visit even after a later change.
 */

type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void

export const consultationsList = (s: BusinessState) => s.consultations ?? []
export const latestVersion = (c: Consultation) => c.versions[c.versions.length - 1]
export const consultationVersion = (c: Consultation, version: number) =>
  c.versions.find((v) => v.version === version)

/** A client's consultations, newest first. */
export const clientConsultations = (s: BusinessState, clientId: string) =>
  consultationsList(s)
    .filter((c) => c.clientId === clientId)
    .sort((a, b) => b.heldOn.localeCompare(a.heldOn))

/** The consultation a visit was booked from, at the version it was booked against. */
export function visitConsultation(s: BusinessState, a: Appointment) {
  if (!a.consultation) return null
  const consultation = consultationsList(s).find((c) => c.id === a.consultation!.id)
  const version = consultation && consultationVersion(consultation, a.consultation.version)
  if (!consultation || !version) return null
  return {
    consultation,
    version,
    /** A later version exists, so what the guest agreed to for this visit has since changed. */
    changedSince: latestVersion(consultation).version > version.version,
  }
}

const sameContent = (a: ConsultationContent, b: ConsultationContent) =>
  JSON.stringify(a) === JSON.stringify(b)
const contentOf = ({ serviceIds, wants, plan, quoteMinor, notes }: ConsultationContent) => ({
  serviceIds,
  wants,
  plan,
  quoteMinor,
  notes,
})

export type ConsultationCommand = {
  type: 'consultation-save'
  id?: string
  clientId: string
  staffId?: string
  heldOn: string
  content: ConsultationContent
}

/** The id a repeated save points at when nothing would change. */
export function unchangedConsultation(s: BusinessState, command: ConsultationCommand) {
  if (!command.id) return null
  const c = consultationsList(s).find((x) => x.id === command.id)
  if (!c || c.clientId !== command.clientId) return null
  const content = consultationContentSchema.safeParse(command.content)
  return content.success && sameContent(contentOf(latestVersion(c)), content.data) ? c.id : null
}

export function runConsultationCommand(
  next: BusinessState,
  command: ConsultationCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  const content = consultationContentSchema.parse(command.content)
  const word = healthWordIn([content.wants, content.plan, content.notes].join('\n'))
  if (word)
    throw new Error(
      `Consultations here are for everyday notes, so they cannot record health details (“${word}”). Patch tests have their own record; health details wait for the separate clinical part of SALEANE.`,
    )
  const client = next.clients.find((c) => c.id === command.clientId)
  if (!client) throw new Error('Client does not belong to this studio.')
  for (const serviceId of content.serviceIds)
    if (!next.services.some((x) => x.id === serviceId))
      throw new Error('Choose treatments from this studio.')
  if (new Set(content.serviceIds).size !== content.serviceIds.length)
    throw new Error('Choose each treatment once.')
  const list = (next.consultations ??= [])
  if (command.id) {
    const c = list.find((x) => x.id === command.id)
    if (!c || c.clientId !== client.id) throw new Error('That consultation is not on this client.')
    const current = latestVersion(c)
    c.versions.push({ ...content, version: current.version + 1, savedAt: now, savedBy: '' })
    addEvent({
      clientId: client.id,
      type: 'consultation',
      title: 'Consultation updated',
      detail: `Version ${current.version + 1}. ${content.plan}`,
    })
    return c.id
  }
  if (command.staffId && !next.staff.some((p) => p.id === command.staffId))
    throw new Error('Choose someone from this studio.')
  if (command.heldOn > businessDate(next, now))
    throw new Error('Record a consultation once it has happened.')
  if (list.length >= CONSULTATION_LIMIT)
    throw new Error(
      'The studio cannot keep more consultations. Write to the SALEANE team from Help, at the top of the screen.',
    )
  const c: Consultation = {
    id: makeId(),
    organisationId: next.organisation.id,
    clientId: client.id,
    ...(command.staffId ? { staffId: command.staffId } : {}),
    heldOn: command.heldOn,
    versions: [{ ...content, version: 1, savedAt: now, savedBy: '' }],
  }
  list.push(c)
  addEvent({
    clientId: client.id,
    type: 'consultation',
    title: 'Consultation recorded',
    detail: content.plan,
  })
  return c.id
}

/** The version a new booking carries, after checking the consultation is this client's. */
export function consultationForBooking(
  s: BusinessState,
  consultationId: string,
  clientId: string,
  serviceId: string,
) {
  const c = consultationsList(s).find((x) => x.id === consultationId)
  if (!c || c.clientId !== clientId) throw new Error('That consultation is not on this client.')
  const current = latestVersion(c)
  // With no treatments chosen, the plan can lead to any of them.
  if (current.serviceIds.length && !current.serviceIds.includes(serviceId))
    throw new Error(
      'This consultation was about other treatments. Choose one of them, or update it first.',
    )
  return { id: c.id, version: current.version }
}

/** Fills in who saved each new version. */
export function stampConsultationActors(
  before: BusinessState,
  after: BusinessState,
  actor: string,
) {
  const seen = new Map(consultationsList(before).map((c) => [c.id, c.versions.length]))
  for (const c of consultationsList(after))
    for (const v of c.versions.slice(seen.get(c.id) ?? 0)) v.savedBy = actor
}

/** parseState checks: versions in order, the right client, visits pointing at real versions. */
export function consultationsProblem(s: BusinessState) {
  const list = consultationsList(s)
  if (list.length > CONSULTATION_LIMIT) return 'Too many consultations.'
  if (new Set(list.map((c) => c.id)).size !== list.length) return 'Duplicate consultation IDs.'
  const clients = new Set(s.clients.map((c) => c.id))
  const byId = new Map(list.map((c) => [c.id, c]))
  for (const c of list) {
    if (c.organisationId !== s.organisation.id) return 'A record from another studio.'
    if (!clients.has(c.clientId)) return 'A consultation does not match its client.'
    if (c.versions.some((v, i) => v.version !== i + 1)) return 'Consultation versions out of order.'
  }
  for (const a of s.appointments) {
    if (!a.consultation) continue
    const c = byId.get(a.consultation.id)
    if (!c || c.clientId !== a.clientId || !consultationVersion(c, a.consultation.version))
      return 'A visit does not match its consultation.'
  }
  return null
}
