import type { BusinessState } from '../src/domain/model'
import type { Role } from '../src/domain/operations'
import { practitionerView } from '../src/domain/practitioner'
import type { PractitionerView } from '../src/domain/practitioner'
import { fail } from './http'
import { withoutFeedback } from '../src/domain/feedback'
import { withoutPayRates } from '../src/domain/pay'

/** Who is reading: the role and linked professional come from the server membership, never the client. */
export type Reader = { role: Role; staffId: string | null }

export type WorkspaceRecord =
  | { view: 'studio'; state: BusinessState }
  | { view: 'practitioner'; practitioner: PractitionerView }

/**
 * The single place a signed-in workspace record leaves the server. Owner, manager and reception
 * read the whole studio. A practitioner reads only their assigned visits and the minimum client
 * details for them (see src/domain/practitioner.ts); the full record is never sent to them.
 */
export function workspaceView(
  reader: Reader,
  state: BusinessState,
  today: string,
): WorkspaceRecord {
  // Guests' individual ratings and comments (V1.5) and the team's commission rates (V2) are for
  // owners and managers only.
  if (reader.role === 'reception')
    return { view: 'studio', state: withoutPayRates(withoutFeedback(state)) }
  if (reader.role !== 'practitioner') return { view: 'studio', state }
  if (!reader.staffId) fail(403, 'Your access is not linked to a professional.')
  try {
    return { view: 'practitioner', practitioner: practitionerView(state, reader.staffId!, today) }
  } catch {
    return fail(403, 'Your professional profile is no longer active. Ask the owner to update it.')
  }
}
