import type { BusinessState } from '../src/domain/model'
import type { Role } from '../src/domain/operations'
import { fail } from './http'

/** Who is reading: the role and linked professional come from the server membership, never the client. */
export type Reader = { role: Role; staffId: string | null }

/**
 * The single place a signed-in workspace record leaves the server. Owner, manager and reception
 * read the whole studio. Practitioners have no projection yet, so they are refused here as well
 * as at sign-in; LOCAL-01 adds their assigned-visit view in this function, not in the browser.
 */
export function workspaceView(reader: Reader, state: BusinessState): BusinessState {
  if (reader.role === 'practitioner')
    fail(403, 'Practitioner access is not enabled in this local candidate.')
  return state
}
