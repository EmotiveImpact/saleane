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
import { branchOpen, branchView } from '../src/domain/branch'
import { withoutNews } from '../src/domain/news'
import type { AreaView } from '../src/domain/area'

/** Who is reading: the role and linked professional come from the server membership, never the client. */
export type Reader = {
  role: Role
  staffId: string | null
  areaId?: string | null
  locationId?: string | null
}

export type WorkspaceRecord =
  | { view: 'studio'; state: BusinessState }
  | { view: 'practitioner'; practitioner: PractitionerView }
  | { view: 'area'; area: AreaView }

/**
 * The single place a signed-in workspace record leaves the server. Owner, manager and reception
 * read the whole studio. A practitioner reads only their assigned visits and the minimum client
 * details for them (see src/domain/practitioner.ts); the full record is never sent to them.
 * V5: a regional manager reads only their area's figures and branch visits (src/domain/area.ts).
 * A general manager reads the studio record less pay rates and other locations' private records.
 * Any other role is refused, so a role added later reads nothing until it is given a view here.
 */
export function workspaceView(
  reader: Reader,
  state: BusinessState,
  today: string,
  now = Date.now(),
): WorkspaceRecord {
  // Guests' individual ratings and comments (V1.5), the team's commission rates (V2), branch
  // visit notes and requests for sign-off (V5) and messages to clients (Stage 4) are for owners
  // and managers only.
  if (reader.role === 'reception')
    return {
      view: 'studio',
      state: withoutNews(
        withoutRequests(withoutBranchVisits(withoutPayRates(withoutFeedback(state)))),
      ),
    }
  if (reader.role === 'owner' || reader.role === 'manager') return { view: 'studio', state }
  // V5: a general manager runs one location (src/domain/branch.ts).
  if (reader.role === 'general') {
    if (!reader.locationId || !branchOpen(state, reader.locationId))
      return fail(403, 'Your location has closed. Ask the owner to update your access.')
    return { view: 'studio', state: branchView(state, reader.locationId) }
  }
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
    return {
      view: 'practitioner',
      practitioner: practitionerView(state, reader.staffId!, today, now),
    }
  } catch {
    return fail(403, 'Your professional profile is no longer active. Ask the owner to update it.')
  }
}
