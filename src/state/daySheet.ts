import { useMemo, useState } from 'react'
import { daySheet, daySheetSchema } from '../domain/daySheet'
import type { DaySheet } from '../domain/daySheet'
import { useStore } from './context'

/**
 * OFF-01: where this tab keeps its day sheet. Session storage only, so closing the tab or the
 * browser removes it; nothing is written to local storage on a possibly shared device. The record
 * names the account and studio it belongs to and is dropped once it expires.
 */
export const DAY_SHEET_KEY = 'saleane.day-sheet.v1'
export type SavedDaySheet = {
  accountId: string
  workspaceId: string
  /** When this tab last received the sheet from the server (or built it from the demo). */
  savedAt: string
  source: 'server' | 'demo'
  sheet: DaySheet
}

export function clearDaySheet() {
  try {
    sessionStorage.removeItem(DAY_SHEET_KEY)
  } catch {
    /* Nothing more can be removed. */
  }
}
export function storeDaySheet(saved: SavedDaySheet) {
  try {
    sessionStorage.setItem(DAY_SHEET_KEY, JSON.stringify(saved))
  } catch {
    // The copy in memory still serves this tab; an unsaved sheet is simply lost on reload.
  }
}
export const current = (saved: SavedDaySheet | null, now = Date.now()) =>
  !!saved && Date.parse(saved.sheet.expiresAt) > now

/**
 * Reads this tab's saved sheet. A sheet for another account or studio, an expired sheet or a
 * damaged record is removed rather than shown.
 */
export function readDaySheet(
  match: { accountId?: string; workspaceId?: string } = {},
  now = Date.now(),
): SavedDaySheet | null {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(DAY_SHEET_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as SavedDaySheet
    const saved: SavedDaySheet = {
      accountId: String(value.accountId),
      workspaceId: String(value.workspaceId),
      savedAt: new Date(Date.parse(value.savedAt)).toISOString(),
      source: value.source === 'demo' ? 'demo' : 'server',
      sheet: daySheetSchema.parse(value.sheet),
    }
    if (
      saved.sheet.organisation.id !== saved.workspaceId ||
      (match.accountId && match.accountId !== saved.accountId) ||
      (match.workspaceId && match.workspaceId !== saved.workspaceId) ||
      !current(saved, now)
    )
      throw new Error('This day sheet does not belong here.')
    return saved
  } catch {
    clearDaySheet()
    return null
  }
}

/**
 * The sheet this screen shows: the signed-in studio's saved copy, or in the browser demo one built
 * locally from the fictional records (never saved, since the demo is already in this browser).
 */
export function useDaySheet(): SavedDaySheet | null {
  const store = useStore()
  const [now] = useState(() => new Date().toISOString())
  const demo = useMemo(
    () =>
      store.sheetWorkspace
        ? null
        : ({
            accountId: 'demo',
            workspaceId: store.state.organisation.id,
            savedAt: now,
            source: 'demo',
            sheet: daySheet(store.state, { role: 'owner', staffId: null }, now),
          } satisfies SavedDaySheet),
    [store.sheetWorkspace, store.state, now],
  )
  return store.sheetWorkspace ? store.daySheet : demo
}
