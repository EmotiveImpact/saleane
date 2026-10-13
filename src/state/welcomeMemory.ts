import type { WelcomeMemory, WelcomeScene } from '../domain/welcomeScene'

/**
 * What this browser remembers about the welcome as SALEANE opens: which moments have played for
 * each person in each studio, when the app was last in view, and whether they want the welcome at
 * all. Nothing here leaves the device, and when the browser will not store it the welcome simply
 * treats the next open as new.
 */

/** Whether a browser is here to play it (the test runner has no `matchMedia`). */
export const welcomeCanPlay = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'

const key = (userId: string | undefined, studioId: string) =>
  `saleane-welcome:${userId ?? 'demo'}:${studioId}`
const offKey = (userId?: string) => `saleane-welcome-off:${userId ?? 'demo'}`
/** This visit's memory, so the same welcome never plays twice when the browser will not store. */
const kept = new Map<string, WelcomeMemory>()
const off = new Map<string, boolean>()

export function readWelcomeMemory(userId: string | undefined, studioId: string): WelcomeMemory {
  const k = key(userId, studioId)
  const here = kept.get(k)
  if (here) return here
  try {
    const raw = localStorage.getItem(k)
    const value: unknown = raw ? JSON.parse(raw) : {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const v = value as Record<string, unknown>
    const text = (name: string) =>
      typeof v[name] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v[name]) ? v[name] : undefined
    const count = (name: string) =>
      typeof v[name] === 'number' && Number.isFinite(v[name]) ? v[name] : undefined
    return {
      opened: v.opened === true || undefined,
      lastSeen: count('lastSeen'),
      morning: text('morning'),
      evening: text('evening'),
      birthday: count('birthday'),
    }
  } catch {
    return {}
  }
}

export function saveWelcomeMemory(
  userId: string | undefined,
  studioId: string,
  memory: WelcomeMemory,
) {
  const k = key(userId, studioId)
  kept.set(k, memory)
  try {
    localStorage.setItem(k, JSON.stringify(memory))
  } catch {
    /* Remembered for this visit only. */
  }
}

/** Notes that SALEANE is open and in view, so "welcome back" counts from now. */
export function markSeen(userId: string | undefined, studioId: string, now = Date.now()) {
  const memory = readWelcomeMemory(userId, studioId)
  saveWelcomeMemory(userId, studioId, { ...memory, lastSeen: now })
}

/** Whether this person has turned the welcome off in this browser. */
export function welcomeOff(userId?: string) {
  const k = offKey(userId)
  if (off.has(k)) return off.get(k)!
  try {
    return localStorage.getItem(k) === 'off'
  } catch {
    return false
  }
}

export function setWelcomeOff(userId: string | undefined, value: boolean) {
  const k = offKey(userId)
  off.set(k, value)
  try {
    if (value) localStorage.setItem(k, 'off')
    else localStorage.removeItem(k)
  } catch {
    /* The choice still applies for this visit. */
  }
}

const watchEvent = 'saleane:welcome-watch'

/** Plays a welcome now, as a preview from settings. Nothing is remembered from a preview. */
export function watchWelcome(scene: WelcomeScene) {
  window.dispatchEvent(new CustomEvent(watchEvent, { detail: scene }))
}

export function onWatchWelcome(play: (scene: WelcomeScene) => void) {
  const listen = (e: Event) => play((e as CustomEvent<WelcomeScene>).detail)
  window.addEventListener(watchEvent, listen)
  return () => window.removeEventListener(watchEvent, listen)
}
