import { useEffect } from 'react'

import { firstColours, secondColours } from '../domain/brandRulesSchema'
import type { StudioLook } from '../domain/brandRulesSchema'

/**
 * A studio's own first and second colours. Everything else in the palette is
 * derived from these two in tokens.css, so changing them re-tints buttons,
 * selections, the now line and tags together.
 *
 * V5: the choice is kept with the studio, so every location, device and guest sees it. A choice
 * an earlier version kept in this browser still applies until the studio has one of its own.
 */
export { firstColours, secondColours }

export type StudioColours = { first: string; second: string }
export const defaultColours: StudioColours = {
  first: firstColours[0].value,
  second: secondColours[0].value,
}

const key = (organisationId: string) => `saleane-colours:${organisationId}`
const hex = /^#[0-9a-f]{6}$/i
const event = 'saleane:colours'

export function readColours(organisationId: string): StudioColours {
  try {
    const saved = JSON.parse(localStorage.getItem(key(organisationId)) ?? 'null') as unknown
    if (
      saved &&
      typeof saved === 'object' &&
      'first' in saved &&
      'second' in saved &&
      typeof saved.first === 'string' &&
      typeof saved.second === 'string' &&
      hex.test(saved.first) &&
      hex.test(saved.second)
    )
      return { first: saved.first, second: saved.second }
  } catch {
    /* Storage can be unavailable; the house colours still apply. */
  }
  return defaultColours
}

export function saveColours(organisationId: string, colours: StudioColours) {
  try {
    localStorage.setItem(key(organisationId), JSON.stringify(colours))
  } catch {
    /* The choice still applies for this visit. */
  }
  window.dispatchEvent(new CustomEvent(event, { detail: { organisationId, colours } }))
}

function apply(colours: StudioColours) {
  const root = document.documentElement.style
  root.setProperty('--brand', colours.first)
  root.setProperty('--rose', colours.second)
}

/** The colours to show: the studio's own, or an earlier choice kept in this browser. */
export const coloursFor = (organisationId: string, look?: StudioLook): StudioColours =>
  look ?? readColours(organisationId)

/**
 * Applies the studio's colours to the page and follows later changes. Off on pages that apply
 * another studio's colours, such as a guest booking page.
 */
export function useStudioColours(organisationId: string, look?: StudioLook, enabled = true) {
  const first = look?.first
  const second = look?.second
  useEffect(() => {
    if (!enabled) return
    apply(first && second ? { first, second } : readColours(organisationId))
    const follow = (e: Event) => {
      const detail = (e as CustomEvent<{ organisationId: string; colours: StudioColours }>).detail
      if (detail.organisationId === organisationId) apply(detail.colours)
    }
    window.addEventListener(event, follow)
    return () => window.removeEventListener(event, follow)
  }, [organisationId, first, second, enabled])
}

/** V5: a guest booking page shows the studio's colours, or the house colours. */
export function useGuestColours(look?: StudioLook) {
  const first = look?.first
  const second = look?.second
  useEffect(() => {
    apply({ first: first ?? defaultColours.first, second: second ?? defaultColours.second })
  }, [first, second])
}
