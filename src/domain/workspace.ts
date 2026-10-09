import { z } from 'zod'
import { parseState } from './model'
import type { Region } from './model'
import { defaultOperations } from './operations'
import type { Operations } from './operations'

/**
 * A new studio starts open Monday to Saturday, 9 to 6, and closed on Sunday. Online booking stays
 * off until the owner switches it on, once there is a treatment and someone to do it, so guests
 * are never sent looking through empty days. Older studios and the samples keep their own settings.
 */
export function newStudioOperations(): Operations {
  const operations = defaultOperations('local')
  return {
    ...operations,
    bookingEnabled: false,
    hours: operations.hours.map((day) => ({ ...day, closed: day.day === 0 })),
  }
}
export function createWorkspace(input: {
  name: string
  region: Region
  timeZone?: string
  locationName?: string
  address?: string
}) {
  const name = z.string().trim().min(2).max(100).parse(input.name)
  const region = z.enum(['UK', 'US']).parse(input.region)
  return parseState(
    {
      schemaVersion: 1,
      revision: 0,
      organisation: {
        id: crypto.randomUUID(),
        name,
        region,
        currency: region === 'UK' ? 'GBP' : 'USD',
        locale: region === 'UK' ? 'en-GB' : 'en-US',
        timeZone: input.timeZone ?? (region === 'UK' ? 'Europe/London' : 'America/New_York'),
        locationId: crypto.randomUUID(),
        locationName: input.locationName ?? name,
        address: input.address ?? '',
      },
      clients: [],
      services: [],
      staff: [],
      resources: [],
      appointments: [],
      sales: [],
      payments: [],
      events: [],
      relationships: [],
      operations: newStudioOperations(),
    },
    region,
  )
}
export const emptyWorkspace = createWorkspace
