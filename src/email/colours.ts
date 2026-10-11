import { firstColours, secondColours } from '../domain/brandRulesSchema'
import type { StudioLook } from '../domain/brandRulesSchema'

/**
 * NEXT-13: an email's colours, worked out here as plain hex because email apps do not mix colours
 * the way tokens.css does. The same recipe as the app: the studio's first colour, deepened with
 * ink just enough for white words on a button, and its soft tint behind the visit's details.
 */
export const INK = '#2e2b33'
export const MUTED = '#6b6670'
export const PAPER = '#ffffff'
export const PAGE = '#faf8f5'
export const LINE = '#ebe5df'

/** The house look: sage and soft rose. SALEANE's own emails always use it. */
export const houseLook: StudioLook = {
  first: firstColours[0].value,
  second: secondColours[0].value,
}

const channels = (hex: string) =>
  [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]

/** `amount` of `a` mixed into `b`, as in CSS `color-mix(in srgb, a amount, b)`. */
export function mix(a: string, amount: number, b: string) {
  const left = channels(a),
    right = channels(b)
  return `#${left
    .map((value, i) => Math.round(value * amount + right[i] * (1 - amount)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`
}

function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.2 contrast ratio between two colours. */
export function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

/** Deepens a colour with ink until `on` reads on it at AA for ordinary text (4.5:1). */
function deepen(colour: string, on: string) {
  let amount = 0.88
  let result = mix(colour, amount, INK)
  while (contrast(result, on) < 4.5 && amount > 0) {
    amount = Math.max(0, amount - 0.04)
    result = mix(colour, amount, INK)
  }
  return result
}

export type EmailPalette = {
  /** Behind the button's white words, and the colour of a quieter button's words and edge. */
  action: string
  /** Behind the visit's details: the app's --brand-soft. */
  soft: string
  /** The short line under the studio's name. */
  accent: string
}

/** A studio's email colours, from its saved look or the house look. */
export function emailPalette(look: StudioLook = houseLook): EmailPalette {
  const action = deepen(look.first, PAPER)
  return { action, soft: mix(look.first, 0.1, '#fdfcfa'), accent: look.second }
}
