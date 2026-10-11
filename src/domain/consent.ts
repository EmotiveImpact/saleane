import type { BusinessState, RelationshipEvent } from './model'
import { CONSENT_RECORD_LIMIT, consentWordingSchema } from './consentSchema'
import type { ConsentRecord, ConsentWording } from './consentSchema'
import type { Command } from './commandSchema'

/**
 * V1.5: versioned consent for email news. The studio's wording has numbered versions; each time a
 * guest's permission changes, a record keeps what they saw, where and when. The client's
 * `marketingConsent` stays the quick answer, and the newest record always agrees with it.
 */

type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void

/** SALEANE's standard wording, version 1 until the studio writes its own. */
export const standardWording = (studio: string) =>
  `I’d like occasional email news and offers from ${studio}. I can stop them at any time.`

export function wordingVersions(s: BusinessState): ConsentWording[] {
  return s.consentWording?.length
    ? s.consentWording
    : [{ version: 1, text: standardWording(s.organisation.name) }]
}
export const currentWording = (s: BusinessState) => {
  const all = wordingVersions(s)
  return all[all.length - 1]
}
export const wordingFor = (s: BusinessState, version: number) =>
  wordingVersions(s).find((w) => w.version === version)

export const consentRecords = (s: BusinessState) => s.consentRecords ?? []
/** One guest's changes, newest first. */
export const consentHistory = (s: BusinessState, clientId: string) =>
  consentRecords(s)
    .filter((r) => r.clientId === clientId)
    .reverse()

/** Withdrawal reaches messages already waiting: queued email news for this guest is suppressed. */
export function suppressQueuedNews(s: BusinessState, clientId: string) {
  for (const m of s.operations?.messages ?? [])
    if (m.clientId === clientId && m.purpose === 'marketing' && m.status === 'queued')
      m.status = 'suppressed'
}

type ConsentCommand =
  | { type: 'consent-wording'; text: string }
  | { type: 'guest-consent-stop'; appointmentId: string }

/** The record a repeated request points at when it would change nothing: same words, or already off. */
export function consentUnchanged(s: BusinessState, command: ConsentCommand) {
  if (command.type === 'consent-wording') {
    const current = currentWording(s)
    return command.text.trim() === current.text ? `consent-wording-${current.version}` : null
  }
  const a = s.appointments.find((x) => x.id === command.appointmentId)
  const client = a && s.clients.find((c) => c.id === a.clientId)
  return client && !client.marketingConsent ? client.id : null
}

export function runConsentCommand(
  next: BusinessState,
  command: ConsentCommand,
  now: string,
  addEvent: AddEvent,
) {
  if (command.type === 'consent-wording') {
    const text = command.text.trim()
    const current = currentWording(next)
    const wording = consentWordingSchema.parse({
      version: current.version + 1,
      text,
      publishedAt: now,
      publishedBy: '',
    })
    next.consentWording = [...wordingVersions(next), wording]
    return `consent-wording-${wording.version}`
  }
  const a = next.appointments.find((x) => x.id === command.appointmentId)
  if (!a) throw new Error('This visit is not in the studio record.')
  const client = next.clients.find((c) => c.id === a.clientId)!
  client.marketingConsent = false
  suppressQueuedNews(next, client.id)
  addEvent({
    clientId: client.id,
    appointmentId: a.id,
    type: 'consent',
    title: 'Email marketing withdrawn',
    detail: 'Stopped by the guest from their private visit link. No message sent.',
  })
  return client.id
}

/**
 * Writes a record for every guest whose permission this command changed, so no path (booking,
 * the desk, the guest's own link) can change it without leaving a trace.
 */
export function recordConsentChanges(
  before: BusinessState,
  next: BusinessState,
  command: Command,
  now: string,
  makeId: () => string,
  /** Stage 5: other software, with what it said about who agreed, when and how. */
  software?: { consent?: { at: string; how: string; wordingVersion?: number } },
) {
  const was = new Map(before.clients.map((c) => [c.id, c.marketingConsent]))
  const online = command.type === 'book' && command.input.source === 'online'
  const moving = command.type === 'import-clients'
  const source: ConsentRecord['source'] = software
    ? 'other software'
    : moving
      ? 'previous system'
      : command.type === 'guest-consent-stop'
        ? 'guest link'
        : command.type === 'news-unsubscribe'
          ? 'email link'
          : online
            ? 'booking page'
            : 'desk'
  const current = currentWording(next)
  for (const client of next.clients) {
    const previous = was.get(client.id)
    if (
      previous === client.marketingConsent ||
      (previous === undefined && !client.marketingConsent)
    )
      continue
    let wordingVersion: number | undefined
    let evidence: string | undefined
    // Stage 5: other software never turns news on or off without saying when and how.
    if (software && !software.consent)
      throw new Error(
        'Email news is recorded only when the software says who agreed, when and how.',
      )
    if (moving) {
      // Moving in: only new clients whose old system recorded a clear yes arrive agreed.
      const contact = command.contacts.find(
        (c) =>
          c.name.trim().toLowerCase() === client.name.toLowerCase() &&
          c.email.trim().toLowerCase() === client.email &&
          c.phone.trim() === client.phone,
      )
      evidence = contact?.consentEvidence
      if (!client.marketingConsent || !evidence)
        throw new Error(
          'Marketing permission can only come across with what the old system recorded.',
        )
    } else if (client.marketingConsent) {
      const shown = software
        ? software.consent?.wordingVersion
        : command.type === 'book'
          ? command.input.consentVersion
          : undefined
      if (software && shown === undefined)
        throw new Error(
          'Say which version of the studio’s email news wording the client agreed to.',
        )
      // A guest's own tick must say which words they read; the desk records what the guest told them.
      if ((online && shown === undefined) || (shown !== undefined && shown !== current.version))
        throw new Error(
          'The studio has just changed how it asks about email news. Please read it again.',
        )
      wordingVersion = current.version
      // The standard words are frozen the first time someone agrees to them, so a later change of
      // studio name cannot rewrite what this guest saw.
      if (!next.consentWording?.length) next.consentWording = [current]
    }
    const records = (next.consentRecords ??= [])
    if (records.length >= CONSENT_RECORD_LIMIT)
      throw new Error(
        'The studio cannot record more permission changes. Write to the SALEANE team from Help, at the top of the screen.',
      )
    records.push({
      id: makeId(),
      organisationId: next.organisation.id,
      clientId: client.id,
      channel: 'email',
      purpose: 'marketing',
      given: client.marketingConsent,
      ...(wordingVersion ? { wordingVersion } : {}),
      ...(evidence ? { evidence } : {}),
      source,
      recordedAt: now,
      actor: 'Local operator',
      ...(software?.consent
        ? { saidAt: software.consent.at, how: software.consent.how.slice(0, 200) }
        : {}),
    })
  }
}

/** Fills in who published each new wording and who recorded each change. */
export function stampConsentActors(before: BusinessState, after: BusinessState, actor: string) {
  const versions = before.consentWording?.length ?? 0
  for (const w of (after.consentWording ?? []).slice(versions))
    if (w.publishedAt) w.publishedBy = actor
  const seen = new Set(consentRecords(before).map((r) => r.id))
  for (const r of consentRecords(after)) if (!seen.has(r.id)) r.actor = actor
}

/** parseState checks: wording in order, records that match their guest, newest record agrees. */
export function consentProblem(s: BusinessState) {
  const wording = s.consentWording ?? []
  if (wording.some((w, i) => w.version !== i + 1)) return 'Consent wording out of order.'
  const rows = consentRecords(s)
  if (rows.length > CONSENT_RECORD_LIMIT) return 'Too many consent records.'
  if (new Set(rows.map((r) => r.id)).size !== rows.length) return 'Duplicate consent record IDs.'
  const latestVersion = wording.length || 1
  const clients = new Map(s.clients.map((c) => [c.id, c]))
  const newest = new Map<string, ConsentRecord>()
  for (const r of rows) {
    if (r.organisationId !== s.organisation.id) return 'A record from another studio.'
    if (!clients.has(r.clientId)) return 'A consent record does not match its client.'
    // Permission carried over from the old system has the old system's evidence, not our words.
    const carried = r.source === 'previous system'
    if (carried ? !r.given || !r.evidence || r.wordingVersion : r.evidence)
      return 'A consent record does not match its wording.'
    if (!carried && (r.given !== !!r.wordingVersion || (r.wordingVersion ?? 0) > latestVersion))
      return 'A consent record does not match its wording.'
    newest.set(r.clientId, r)
  }
  for (const [clientId, r] of newest)
    if (clients.get(clientId)!.marketingConsent !== r.given)
      return 'A client’s email permission does not match its latest record.'
  return null
}
