import { parseState } from '../domain/model'
import type { BusinessState, Region } from '../domain/model'
import { seed } from '../domain/seed'
import { execute } from '../domain/commands'
import type { Command, CommandResult } from '../domain/commands'

export const storageKey = (region: Region) => `saleane.demo.v1.${region}`
export type LoadedWorkspace = { state: BusinessState; warning: string; blocked: boolean }

export function loadBrowserWorkspace(region: Region): LoadedWorkspace {
  try {
    return loadWorkspace(window.localStorage, region)
  } catch {
    return {
      state: seed(region),
      warning:
        'Browser storage is unavailable. Changes are paused. Enable local storage and reload to save demo changes.',
      blocked: true,
    }
  }
}

export function loadWorkspace(storage: Storage, region: Region): LoadedWorkspace {
  try {
    const raw = storage.getItem(storageKey(region))
    if (!raw) return { state: seed(region), warning: '', blocked: false }
    return { state: parseState(JSON.parse(raw), region), warning: '', blocked: false }
  } catch {
    // Keep the original bytes intact: a damaged or unsupported snapshot must never be silently replaced.
    return {
      state: seed(region),
      warning:
        'Saved demo data could not be read. Changes are paused to preserve it. Export the saved data or reset this demo workspace.',
      blocked: true,
    }
  }
}
export function commitWorkspace(
  storage: Storage,
  region: Region,
  state: BusinessState,
  command: Command,
): CommandResult {
  try {
    const raw = storage.getItem(storageKey(region))
    if (raw && parseState(JSON.parse(raw), region).revision !== state.revision)
      return { ok: false, error: 'This workspace changed in another tab. Reload before saving.' }
    const result = execute(state, command)
    if (!result.ok) return result
    if (result.state !== state) storage.setItem(storageKey(region), JSON.stringify(result.state))
    return result
  } catch {
    return {
      ok: false,
      error:
        'This browser could not save the change. Free browser storage or enable local storage, then try again.',
    }
  }
}

export function resetWorkspace(
  storage: Storage,
  region: Region,
  current: BusinessState,
): BusinessState {
  const raw = storage.getItem(storageKey(region))
  let persistedRevision = 0
  if (raw) {
    try {
      const revision: unknown = JSON.parse(raw).revision
      persistedRevision =
        typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
          ? revision
          : Date.now()
    } catch {
      persistedRevision = Date.now()
    }
  }
  const revision = Math.max(current.revision, persistedRevision) + 1
  if (!Number.isSafeInteger(revision)) throw new Error('Demo revision limit reached.')
  const next = { ...seed(region), revision }
  storage.setItem(storageKey(region), JSON.stringify(next))
  return next
}
