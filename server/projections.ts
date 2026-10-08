import type { BusinessState } from '../src/domain/model'
import type { Role } from '../src/domain/operations'
import { practitionerView } from '../src/domain/practitioner'
import type { PractitionerView } from '../src/domain/practitioner'
import { fail } from './http'
import { withoutFeedback } from '../src/domain/feedback'
import { withoutPayRates } from '../src/domain/pay'
import { withoutBranchVisits } from '../src/domain/branchVisits'
import { areaView } from '../src/domain/area'
import { withoutRequests } from '../src/domain/approvals'
import type { AreaView } from '../src/domain/area'

/** Who is reading: the role and linked professional come from the server membership, never the client. */
export type Reader = { role: Role; staffId: string | null; areaId?: string | null }

export type WorkspaceRecord =
  | { view: 'studio'; state: BusinessState }
  | { view: 'practitioner'; practitioner: PractitionerView }
  | { view: 'area'; area: AreaView }

/**
 * The single place a signed-in workspace record leaves the server. Owner, manager and reception
 * read the whole studio. A practitioner reads only their assigned visits and the minimum client
 * details for them (see src/domain/practitioner.ts); the full record is never sent to them.
 * V5: a regional manager reads only their area's figures and branch visits (src/domain/area.ts).
 * Any other role is refused, so a role added later reads nothing until it is given a view here.
 */
export function workspaceView(
  reader: Reader,
  state: BusinessState,
  today: string,
): WorkspaceRecord {
  // Guests' individual ratings and comments (V1.5), the team's commission rates (V2) and branch
  // visit notes and requests for sign-off (V5) are for owners and managers only.
  if (reader.role === 'reception')
    return {
      view: 'studio',
      state: withoutRequests(withoutBranchVisits(withoutPayRates(withoutFeedback(state)))),
    }
  if (reader.role === 'owner' || reader.role === 'manager') return { view: 'studio', state }
  if (reader.role === 'regional') {
    if (!reader.areaId) return fail(403, 'Your access is not linked to a region.')
    try {
      return { view: 'area', area: areaView(state, reader.areaId, today) }
    } catch {
      return fail(403, 'Your region has no open locations. Ask the owner to update your access.')
    }
  }
  if (reader.role !== 'practitioner') return fail(403, 'Your role cannot read this studio.')
  if (!reader.staffId) fail(403, 'Your access is not linked to a professional.')
  try {
    return { view: 'practitioner', practitioner: practitionerView(state, reader.staffId!, today) }
  } catch {
    return fail(403, 'Your professional profile is no longer active. Ask the owner to update it.')
  }
}
