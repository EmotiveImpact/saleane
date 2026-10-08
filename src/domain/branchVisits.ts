import type { z } from 'zod'
import type { BusinessState } from './model'
import { addDays } from './format'
import { places } from './locations'
import { operations } from './operations'
import { BRANCH_VISIT_LIMIT, CHECKLIST_LIMIT } from './branchVisitSchema'
import type { BranchVisit, Checklist, branchVisitCommandSchemas } from './branchVisitSchema'

/**
 * V5: branch visit checklists. A visit keeps the wording each line had on the day and is never
 * rewritten; the only later change is marking a line answered "no" as put right. Checklists are
 * put away rather than deleted, so every past visit still names the checklist it used.
 */

export type BranchVisitCommand = z.infer<(typeof branchVisitCommandSchemas)[number]>

export const checklists = (s: BusinessState): Checklist[] => operations(s).checklists ?? []
export const branchVisits = (s: BusinessState): BranchVisit[] => operations(s).branchVisits ?? []

/** A sensible first checklist the owner can change before saving. */
export const STARTER_CHECKLIST = {
  name: 'Branch visit',
  items: [
    'Front of house is clean, tidy and welcoming',
    'Today’s visits are on time or guests were told',
    'Stations and tools are clean and ready',
    'Retail shelves are full, priced and dusted',
    'Till count matches what SALEANE expects',
    'Fire exits are clear and the first aid kit is stocked',
    'Team know this week’s specials and targets',
    'Any guest comments from the last week have been answered',
  ],
}

/** How far back a visit can be recorded, for one written up a few days late. */
export const VISIT_BACKDATE_DAYS = 31

export function runBranchVisitCommand(
  next: BusinessState,
  command: BranchVisitCommand,
  now: string,
  today: string,
  makeId: () => string,
) {
  const o = next.operations!
  if (command.type === 'checklist-save') {
    const list = (o.checklists ??= [])
    const old = command.id ? list.find((c) => c.id === command.id) : undefined
    if (command.id && !old) throw new Error('That checklist is not in this business.')
    if (!old && list.length >= CHECKLIST_LIMIT) throw new Error('Too many checklists to keep.')
    const name = command.input.name.toLowerCase()
    if (list.some((c) => c.id !== command.id && !c.archived && c.name.toLowerCase() === name))
      throw new Error('Another checklist already has that name.')
    const texts = command.input.items.map((i) => i.text.toLowerCase())
    if (new Set(texts).size !== texts.length)
      throw new Error('Each line on a checklist is different.')
    const ownIds = new Set(old?.items.map((i) => i.id))
    if (command.input.items.some((i) => i.id && !ownIds.has(i.id)))
      throw new Error('A line on this checklist is not in it.')
    const record: Checklist = {
      id: old?.id ?? makeId(),
      name: command.input.name,
      items: command.input.items.map((i) => ({ id: i.id ?? makeId(), text: i.text })),
      archived: old?.archived ?? false,
    }
    if (old) Object.assign(old, record)
    else list.push(record)
    return record.id
  }
  if (command.type === 'checklist-archive') {
    const found = (o.checklists ?? []).find((c) => c.id === command.checklistId)
    if (!found) throw new Error('That checklist is not in this business.')
    if (
      !command.archived &&
      (o.checklists ?? []).some(
        (c) =>
          c.id !== found.id && !c.archived && c.name.toLowerCase() === found.name.toLowerCase(),
      )
    )
      throw new Error('Another checklist already has that name.')
    found.archived = command.archived
    return found.id
  }
  if (command.type === 'branch-visit') {
    const input = command.input
    if (!places(next).some((p) => p.id === input.locationId))
      throw new Error('That location is not open in this business.')
    const checklist = (o.checklists ?? []).find((c) => c.id === input.checklistId)
    if (!checklist || checklist.archived) throw new Error('That checklist is not in use.')
    if (input.date > today) throw new Error('A visit can only be recorded once it has happened.')
    if (input.date < addDays(today, -VISIT_BACKDATE_DAYS))
      throw new Error(`Record a visit within ${VISIT_BACKDATE_DAYS} days of it.`)
    const given = new Map(input.answers.map((a) => [a.itemId, a]))
    if (given.size !== input.answers.length) throw new Error('Each line has one answer.')
    if (
      given.size !== checklist.items.length ||
      checklist.items.some((item) => !given.has(item.id))
    )
      throw new Error('Answer every line on the checklist.')
    const list = (o.branchVisits ??= [])
    if (list.length >= BRANCH_VISIT_LIMIT) throw new Error('Too many visits to keep.')
    const visit: BranchVisit = {
      id: makeId(),
      locationId: input.locationId,
      checklistId: checklist.id,
      checklistName: checklist.name,
      date: input.date,
      answers: checklist.items.map((item) => {
        const a = given.get(item.id)!
        return {
          itemId: item.id,
          text: item.text,
          answer: a.answer,
          ...(a.note ? { note: a.note } : {}),
        }
      }),
      ...(input.note ? { note: input.note } : {}),
      recordedAt: now,
    }
    list.push(visit)
    return visit.id
  }
  const visit = (o.branchVisits ?? []).find((v) => v.id === command.visitId)
  if (!visit) throw new Error('That visit is not in this business.')
  const line = visit.answers.find((a) => a.itemId === command.itemId)
  if (!line || line.answer !== 'no') throw new Error('Only a line answered no can be put right.')
  if (line.fixed) throw new Error('That has already been put right.')
  line.fixed = { on: today, at: now }
  return visit.id
}

/** A command that would change nothing: a fix already recorded is not recorded twice. */
export function branchVisitUnchanged(s: BusinessState, command: BranchVisitCommand) {
  if (command.type !== 'checklist-archive') return null
  const found = checklists(s).find((c) => c.id === command.checklistId)
  return found && found.archived === command.archived ? found.id : null
}

/** Ledger check: every visit names a real location and checklist, and only "no" lines are fixed. */
export function branchVisitsProblem(s: BusinessState) {
  const known = new Set(places(s, true).map((p) => p.id))
  const lists = new Set(checklists(s).map((c) => c.id))
  for (const v of branchVisits(s)) {
    if (!known.has(v.locationId))
      return 'A branch visit names a location that is not in this business.'
    if (!lists.has(v.checklistId)) return 'A branch visit names a checklist that is not kept.'
    if (v.answers.some((a) => a.fixed && a.answer !== 'no'))
      return 'Only a line answered no can be put right.'
  }
  return null
}

export function stampBranchVisitActors(before: BusinessState, after: BusinessState, actor: string) {
  const old = new Map(branchVisits(before).map((v) => [v.id, v]))
  for (const visit of branchVisits(after)) {
    const previous = old.get(visit.id)
    if (!previous) visit.actor = actor
    for (const line of visit.answers)
      if (line.fixed && !previous?.answers.find((a) => a.itemId === line.itemId)?.fixed)
        line.fixed.actor = actor
  }
}

/** Branch visits are for the owner and managers; the desk does not receive them. */
export function withoutBranchVisits(s: BusinessState): BusinessState {
  const o = s.operations
  if (!o?.branchVisits && !o?.checklists) return s
  const { branchVisits: _visits, checklists: _lists, ...operations } = o
  void [_visits, _lists]
  return { ...s, operations }
}

export function visitScore(v: BranchVisit) {
  const count = (answer: string) => v.answers.filter((a) => a.answer === answer).length
  return {
    yes: count('yes'),
    no: count('no'),
    na: count('na'),
    open: v.answers.filter((a) => a.answer === 'no' && !a.fixed).length,
  }
}

/** Lines answered no and not yet put right, newest visit first. */
export function toPutRight(s: BusinessState) {
  const names = new Map(places(s, true).map((p) => [p.id, p.name]))
  return [...branchVisits(s)]
    .sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt))
    .flatMap((visit) =>
      visit.answers
        .filter((a) => a.answer === 'no' && !a.fixed)
        .map((line) => ({
          visit,
          line,
          place: names.get(visit.locationId) ?? 'A closed location',
        })),
    )
}

/** Each open location's most recent visit, or null when it has never had one. */
export function lastVisits(s: BusinessState) {
  return places(s).map((p) => {
    const latest = branchVisits(s)
      .filter((v) => v.locationId === p.id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt))[0]
    return { place: p, visit: latest ?? null }
  })
}
