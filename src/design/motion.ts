import { useSyncExternalStore } from 'react'
import { animate } from 'motion/react'
import type { Transition } from 'motion/react'

/**
 * SALEANE's one way of moving, in Motion (the library once called Framer Motion). The timings
 * match `--motion-calm`, `--motion-quick` and `--ease-calm` in tokens.css, so what CSS moves and
 * what Motion moves feel the same. Things answer an action: a panel opens or closes, a row leaves a
 * list, an underline follows the chosen tab. Pages loading, scrolling and typing never move.
 * Anyone whose device asks for less motion sees every change at once.
 */
export const EASE_CALM = [0.22, 1, 0.36, 1] as const
/** Leaving is a little quicker than arriving, and eases in, so it never lingers. */
export const EASE_LEAVE = [0.4, 0, 1, 1] as const
export const calm: Transition = { duration: 0.28, ease: EASE_CALM }
export const quick: Transition = { duration: 0.15, ease: 'easeOut' }
export const leave: Transition = { duration: 0.18, ease: EASE_LEAVE }

const QUERY = '(prefers-reduced-motion: no-preference)'
const media = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY)
    : null

/**
 * Whether things may move: the device has not asked for less motion. Where the browser cannot say
 * (the test runner), nothing moves, so what is on screen is always simply there.
 */
export function motionAllowed() {
  return !!media()?.matches
}

function subscribe(change: () => void) {
  const query = media()
  query?.addEventListener?.('change', change)
  return () => query?.removeEventListener?.('change', change)
}

/** `motionAllowed`, kept up to date when someone changes their device's setting. */
export function useMotionAllowed() {
  return useSyncExternalStore(subscribe, motionAllowed, () => false)
}

type Leaving = {
  /** Where it goes as it leaves, in pixels. */
  x?: number
  y?: number
  /** Leave in place, as a dimmed background does. */
  fade?: boolean
}

/**
 * Lets something that has just been taken off the page (a dialog, a side panel, the phone menu,
 * its dimmed background) leave gently instead of vanishing in one frame. React removes the real
 * element at once, so focus, the keyboard and screen readers move on straight away; a still copy
 * that nobody can click or read takes its place for a moment and fades away.
 *
 * Call it while the element is still on the page. It does nothing when motion is not allowed, and
 * nothing if the element turns out to be staying (React's development checks detach and attach
 * the same element).
 */
export function leaveGently(element: HTMLElement | null, how: Leaving = {}) {
  if (!element || !element.isConnected || !motionAllowed()) return
  if (typeof Element.prototype.animate !== 'function') return
  const copy = element.cloneNode(true) as HTMLElement
  // What a person had typed or ticked stays as it was while the copy fades.
  const from = element.querySelectorAll<HTMLInputElement>('input, textarea, select')
  copy.querySelectorAll<HTMLInputElement>('input, textarea, select').forEach((field, i) => {
    field.value = from[i]?.value ?? field.value
    if ('checked' in field) field.checked = from[i]?.checked ?? false
  })
  const scrolled = [...element.querySelectorAll<HTMLElement>('*')]
    .map((node, i) => [i, node.scrollTop] as const)
    .filter(([, top]) => top > 0)
  copy.setAttribute('data-state', 'closed')
  copy.removeAttribute('id')
  copy.removeAttribute('role')
  copy.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
  // A layer of its own the size of the window, so a fixed panel stays exactly where it was.
  const layer = document.createElement('div')
  layer.className = 'leaving-layer'
  layer.setAttribute('aria-hidden', 'true')
  layer.inert = true
  layer.style.zIndex = getComputedStyle(element).zIndex
  layer.append(copy)
  queueMicrotask(() => {
    // Still on the page: it was never closed (React's development checks), so nothing leaves.
    if (element.isConnected) return
    document.body.append(layer)
    const nodes = copy.querySelectorAll<HTMLElement>('*')
    for (const [i, top] of scrolled) if (nodes[i]) nodes[i].scrollTop = top
    const target = how.fade ? { opacity: 0 } : { opacity: 0, x: how.x ?? 0, y: how.y ?? 6 }
    const done = () => layer.remove()
    animate(layer, target, leave).then(done, done)
    // A hidden tab pauses animations; the copy goes regardless.
    setTimeout(done, 1000)
  })
}

/**
 * A view that has just replaced another (the calendar's day, week or month, or the next day) fades
 * up in place, so the change reads as one view becoming the next rather than a flash. Only the
 * fade moves: nothing slides, so nothing inside shifts under the pointer.
 */
export function arriveGently(elements: Iterable<Element>) {
  if (!motionAllowed() || typeof Element.prototype.animate !== 'function') return
  for (const element of elements) {
    // Hidden at once, before the screen is drawn, so the new view never flashes in full first.
    ;(element as HTMLElement).style.opacity = '0'
    animate(element, { opacity: [0, 1] }, quick)
  }
}

/**
 * Something that has just moved (a visit dropped on a new time or person) glides the last part of
 * the way from where it was, instead of jumping. `from` is how far away it was, in pixels.
 */
export function settleFrom(element: Element | null, from: { x: number; y: number }) {
  if (!element || !motionAllowed() || typeof Element.prototype.animate !== 'function') return
  if (!from.x && !from.y) return
  // Put back where it was at once, before the screen is drawn, so the visit never flashes in its
  // new place; Motion then takes it the rest of the way.
  const start = `translate(${from.x}px, ${from.y}px)`
  ;(element as HTMLElement).style.transform = start
  animate(element, { transform: [start, 'translate(0px, 0px)'] }, calm)
}
