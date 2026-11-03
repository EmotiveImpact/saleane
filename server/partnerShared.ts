import { HttpError } from './http'
import type { Org } from './context'
import type { ApiScope } from '../src/domain/accessKeys'
import type { BusinessState } from '../src/domain/model'

/** V5 and Stage 5: what the reading and writing halves of the access key API share. */

export type KeyRow = {
  id: string
  organisation_id: string
  name: string
  prefix: string
  key_hash: string
  scopes: string
  created_by: string
  created_at: number
  last_used_at: number | null
  revoked_at: number | null
  location_id: string | null
  ends_on: string | null
}

/** The key a request came with, once every check has passed. */
export type KeyAuth = {
  row: KeyRow
  org: Org
  scopes: ApiScope[]
  /** The one location the key is kept to, if any. */
  only: string | null
}

/** A refusal with a short code for the other software, as well as the words. */
export const refuse = (status: number, code: string, message: string): never => {
  throw new HttpError(status, message, code)
}

export const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** A visit as the API reads and writes it: no client names, only the client's id. */
export function appointmentView(s: BusinessState, a: BusinessState['appointments'][number]) {
  return {
    id: a.id,
    clientId: a.clientId,
    status: a.status,
    date: a.date,
    start: hhmm(a.startMinutes),
    durationMinutes: a.bookedDurationMinutes,
    service: a.bookedServiceName ?? s.services.find((x) => x.id === a.serviceId)?.name ?? null,
    serviceId: a.serviceId,
    professional: s.staff.find((p) => p.id === a.staffId)?.name ?? null,
    professionalId: a.staffId,
    locationId: a.locationId,
    source: a.source,
    priceMinor: a.bookedPriceMinor,
  }
}
