import { z } from 'zod'
import { parseState } from './model'
import type { Region } from './model'
import { defaultOperations } from './operations'
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
      operations: defaultOperations('local'),
    },
    region,
  )
}
export const emptyWorkspace = createWorkspace
