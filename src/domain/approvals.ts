import type { z } from 'zod'
import type { BusinessState } from './model'
import { places } from './locations'
import { operations } from './operations'
import { regions } from './group'
import { DEFAULT_REGIONAL_LIMIT, REQUEST_LIMIT } from './approvalsSchema'
import type { ApprovalRequest, Route, approvalCommandSchemas } from './approvalsSchema'

export type ApprovalCommand = z.infer<(typeof approvalCommandSchemas)[number]>

export const requests = (s: BusinessState): ApprovalRequest[] => operations(s).requests ?? []
export const regionalLimit = (s: BusinessState) =>
  operations(s).approvals?.regionalLimitMinor ?? DEFAULT_REGIONAL_LIMIT

/**
 * Where a request goes: its region's manager, or the owner when over their limit, in no region,
 * or raised by that region's own manager (nobody signs off their own request).
 */
export function routeFor(
  s: BusinessState,
  locationId: string,
  amountMinor: number | undefined,
  managedRegions: readonly string[] = [],
  raiserRegion?: string,
): { routedTo: Route; passedUp?: NonNullable<ApprovalRequest['passedUp']> } {
  const region = regions(s).find((r) => r.locationIds.includes(locationId))
  if (!region) return { routedTo: { level: 'owner' }, passedUp: 'no-region' }
  if (!managedRegions.includes(region.id))
    return { routedTo: { level: 'owner' }, passedUp: 'no-manager' }
  if ((amountMinor ?? 0) > regionalLimit(s))
    return { routedTo: { level: 'owner' }, passedUp: 'over-limit' }
  // A regional manager never signs off their own request.
  if (raiserRegion === region.id) return { routedTo: { level: 'owner' }, passedUp: 'own-request' }
  return { routedTo: { level: 'regional', regionId: region.id } }
}

export function runApprovalCommand(
  next: BusinessState,
  command: ApprovalCommand,
  now: string,
  makeId: () => string,
) {
  const o = next.operations!
  if (command.type === 'approval-limit') {
    o.approvals = { regionalLimitMinor: command.regionalLimitMinor }
    return 'approvals'
  }
  if (command.type === 'request-raise') {
    const input = command.input
    if (!places(next).some((p) => p.id === input.locationId))
      throw new Error('That location is not open in this business.')
    const list = (o.requests ??= [])
    if (list.length >= REQUEST_LIMIT) throw new Error('Too many requests to keep.')
    const request: ApprovalRequest = {
      id: makeId(),
      locationId: input.locationId,
      kind: input.kind,
      title: input.title,
      ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...routeFor(
        next,
        input.locationId,
        input.amountMinor,
        command.managedRegions,
        command.raiserRegion,
      ),
      raisedAt: now,
      ...(command.raisedById ? { raisedById: command.raisedById } : {}),
    }
    list.push(request)
    return request.id
  }
  const request = (o.requests ?? []).find((r) => r.id === command.requestId)
  if (!request) throw new Error('That request is not in this business.')
  if (request.decision) throw new Error('That request has already been decided.')
  request.decision = {
    outcome: command.outcome,
    ...(command.note ? { note: command.note } : {}),
    at: now,
  }
  return request.id
}

/** Ledger check: every request names a location in this business. */
export function approvalsProblem(s: BusinessState) {
  const known = new Set(places(s, true).map((p) => p.id))
  if (requests(s).some((r) => !known.has(r.locationId)))
    return 'A request names a location that is not in this business.'
  return null
}

export function stampRequestActors(before: BusinessState, after: BusinessState, actor: string) {
  const old = new Map(requests(before).map((r) => [r.id, r]))
  for (const request of requests(after)) {
    const previous = old.get(request.id)
    if (!previous) request.raisedBy = actor
    if (request.decision && !previous?.decision) request.decision.by = actor
  }
}

/** Requests stay with the people who raise and decide them; the desk does not receive them. */
export function withoutRequests(s: BusinessState): BusinessState {
  const o = s.operations
  if (!o?.requests && !o?.approvals) return s
  const { requests: _requests, approvals: _limits, ...operations } = o
  void [_requests, _limits]
  return { ...s, operations }
}

/**
 * Who a request waits on, in words. A request sent to a regional manager falls to the owner when
 * its location has since closed or left that region, since that manager can no longer see it.
 */
export function waitingOn(s: BusinessState, request: ApprovalRequest) {
  if (request.routedTo.level === 'owner') return 'the owner'
  const regionId = request.routedTo.regionId
  const region = regions(s).find((r) => r.id === regionId)
  const open = places(s).some((p) => p.id === request.locationId)
  if (!region || !open || !region.locationIds.includes(request.locationId))
    return 'the owner, because its location has left the region it was sent to'
  return `${region.name}’s regional manager`
}
