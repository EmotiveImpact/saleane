import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { seed } from '../src/domain/seed'
import { parseState } from '../src/domain/model'
import type { BusinessState } from '../src/domain/model'
import { createWorkspace as createLocalWorkspace } from '../src/domain/workspace'
import { defaultOperations } from '../src/domain/operations'

export const workspaceInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    region: z.enum(['UK', 'US']),
    locationName: z.string().trim().min(2).max(100),
    address: z.string().trim().max(300).optional(),
    timeZone: z
      .enum([
        'Europe/London',
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Phoenix',
        'America/Anchorage',
        'Pacific/Honolulu',
      ])
      .optional(),
    sample: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.timeZone && (input.region === 'UK') !== (input.timeZone === 'Europe/London'))
      context.addIssue({
        code: 'custom',
        path: ['timeZone'],
        message: 'Choose a time zone in your business market.',
      })
  })
export type WorkspaceInput = z.infer<typeof workspaceInput>

export function createWorkspace(input: WorkspaceInput): BusinessState {
  const zone = input.timeZone ?? (input.region === 'UK' ? 'Europe/London' : 'America/New_York')
  if ((input.region === 'UK') !== (zone === 'Europe/London'))
    throw new Error('Choose a time zone in your business market.')
  if (!input.sample) return createLocalWorkspace({ ...input, timeZone: zone })
  // A sample never reuses the browser demo's organisation or location authority.
  const state = seed(input.region)
  const organisationId = randomUUID()
  const locationId = randomUUID()
  state.organisation = {
    ...state.organisation,
    id: organisationId,
    locationId,
    name: input.name,
    locationName: input.locationName,
    address: input.address ?? '',
    timeZone: zone,
  }
  state.operations = defaultOperations('sandbox')
  for (const collection of [
    state.clients,
    state.services,
    state.staff,
    state.resources,
    state.appointments,
    state.sales,
    state.payments,
    state.events,
    state.relationships,
    state.feedback ?? [],
    state.waitlist ?? [],
    state.giftCards ?? [],
    state.patchTests ?? [],
  ]) {
    for (const row of collection) row.organisationId = organisationId
  }
  for (const appointment of state.appointments) appointment.locationId = locationId
  state.revision = 0
  return parseState(state, input.region)
}
