import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { flushSync } from 'react-dom'

/**
 * Stage 2: scanning with an ordinary USB or Bluetooth barcode scanner. A scanner is a keyboard
 * that types the code very fast and then presses Enter. People never type four or more characters
 * and Enter with every key a few tens of milliseconds apart, so a burst like that is a scan and
 * anything slower is ordinary typing, left alone.
 */
export const SCAN_GAP_MS = 50
export const SCAN_MIN_LENGTH = 4
const SCAN_MAX_LENGTH = 100

export type ScanKey = {
  key: string
  /** When the key went down, in milliseconds (the event's own time stamp). */
  time: number
  /** A key held down repeats; a scanner never does. */
  repeat?: boolean
  /** Control, Alt or Meta held: a shortcut, not a scan. */
  modified?: boolean
  /** Part of a word being composed with an input method. */
  composing?: boolean
}
export type ScanStep =
  | { kind: 'none' }
  /** A character joined the burst; `start` when it began a new one. */
  | { kind: 'char'; start: boolean }
  | { kind: 'scan'; code: string }

/** Watches keys one at a time and says when a burst has ended in Enter. */
export function createScanDetector({ gap = SCAN_GAP_MS, minLength = SCAN_MIN_LENGTH } = {}) {
  let buffer = ''
  let last = -Infinity
  const reset = () => {
    buffer = ''
    last = -Infinity
  }
  return {
    reset,
    key(event: ScanKey): ScanStep {
      // A scanner presses Shift for capital letters; that is part of the burst, not a break in it.
      if (event.key === 'Shift' || event.key === 'CapsLock') return { kind: 'none' }
      if (event.repeat || event.modified || event.composing) {
        reset()
        return { kind: 'none' }
      }
      const quick = event.time - last <= gap
      if (event.key === 'Enter') {
        const code = buffer
        reset()
        return quick && code.length >= minLength ? { kind: 'scan', code } : { kind: 'none' }
      }
      if (event.key.length !== 1) {
        reset()
        return { kind: 'none' }
      }
      const start = !quick || !buffer || buffer.length >= SCAN_MAX_LENGTH
      buffer = start ? event.key : buffer + event.key
      last = event.time
      return { kind: 'char', start }
    },
  }
}

type Taker = { handle: (code: string) => void; element: () => Element | null }
type Snapshot = {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  value: string
  start: number | null
  end: number | null
}

const takers: Taker[] = []
const detector = createScanDetector()
let snapshot: Snapshot | null = null

/** A field where a scanner is meant to type: its own Enter handles the code. */
const scanField = (target: Element) => !!target.closest('[data-scan-field]')
const field = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement
    ? target
    : null
/** A taker on a page under an open dialog is hidden from assistive technology; it waits. */
const usable = (element: Element | null) =>
  !!element && element.isConnected && !element.closest('[aria-hidden="true"], [inert]')

/** Puts a field back as it was before the scanner typed into it, telling React too. */
function restore(saved: Snapshot) {
  const { element } = saved
  if (!element.isConnected || element.value === saved.value) return
  const prototype = Object.getPrototypeOf(element) as object
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, saved.value)
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
  )
  try {
    if (saved.start !== null && 'setSelectionRange' in element)
      element.setSelectionRange(saved.start, saved.end)
  } catch {
    // Number fields have no caret to put back.
  }
}

function onKeyDown(event: KeyboardEvent) {
  const target = event.target instanceof Element ? event.target : null
  if (target && scanField(target)) {
    detector.reset()
    return
  }
  const step = detector.key({
    key: event.key,
    time: event.timeStamp,
    repeat: event.repeat,
    modified: event.ctrlKey || event.altKey || event.metaKey,
    composing: event.isComposing,
  })
  if (step.kind === 'char' && step.start) {
    // Remember the field as it was before this burst, in case it turns out to be a scan.
    const typed = field(target)
    let start: number | null = null,
      end: number | null = null
    try {
      if (typed && !(typed instanceof HTMLSelectElement)) {
        start = typed.selectionStart
        end = typed.selectionEnd
      }
    } catch {
      // Number fields have no caret.
    }
    snapshot = typed ? { element: typed, value: typed.value, start, end } : null
  }
  if (step.kind !== 'scan') return
  const taker = [...takers].reverse().find((t) => usable(t.element()))
  if (!taker) return
  // The scanner's Enter must not press a button or send a form.
  event.preventDefault()
  event.stopPropagation()
  const saved = snapshot && snapshot.element === target ? snapshot : null
  snapshot = null
  // The field is put back and the screen redrawn first, so the scan sees the field as it was.
  if (saved) flushSync(() => restore(saved))
  taker.handle(step.code)
}

/**
 * Hands scans to `handle` while this component is on screen. The newest one on screen wins, and
 * one under an open dialog waits, so a scan goes where the person is working. Typing into a field
 * marked `data-scan-field` is left to that field.
 */
export function useBarcodeScan(
  handle: (code: string) => void,
  element: RefObject<Element | null>,
  enabled = true,
) {
  const latest = useRef(handle)
  useEffect(() => {
    latest.current = handle
  })
  useEffect(() => {
    if (!enabled) return
    const taker: Taker = {
      handle: (code) => latest.current(code),
      element: () => element.current,
    }
    takers.push(taker)
    if (takers.length === 1) window.addEventListener('keydown', onKeyDown, true)
    return () => {
      takers.splice(takers.indexOf(taker), 1)
      if (!takers.length) {
        window.removeEventListener('keydown', onKeyDown, true)
        detector.reset()
        snapshot = null
      }
    }
  }, [element, enabled])
}
