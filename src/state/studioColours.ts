import { useEffect } from 'react'

import { bases, firstColours, secondColours } from '../domain/brandRulesSchema'
import type { StudioBase, StudioLook } from '../domain/brandRulesSchema'

/**
 * A studio's own first and second colours, and the base every page sits on. Everything else in
 * the palette is derived from these in tokens.css, so changing them re-tints buttons, selections,
 * the now line and tags together. The base swaps the neutrals: warm ivory, or clean white.
 *
 * V5: the choice is kept with the studio, so every location, device and guest sees it. A choice
 * an earlier version kept in this browser still applies until the studio has one of its own.
 */
export { bases, firstColours, secondColours }
export type { StudioBase }

export type StudioColours = { first: string; second: string; base?: StudioBase }
export const defaultColours: StudioColours = {
  first: firstColours[0].value,
  second: secondColours[0].value,
}

const key = (organisationId: string) => `saleane-colours:${organisationId}`
const hex = /^#[0-9a-f]{6}$/i
const event = 'saleane:colours'
const isBase = (value: unknown): value is StudioBase => bases.some((b) => b.value === value)

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
    ) {
      const base = 'base' in saved && isBase(saved.base) ? saved.base : undefined
      return { first: saved.first, second: saved.second, ...(base ? { base } : {}) }
    }
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

/** Puts a base on the whole page. Warm ivory is the stylesheet's own, so it needs no mark. */
export function applyBase(base?: StudioBase) {
  const root = document.documentElement
  if (base === 'white') root.dataset.base = 'white'
  else delete root.dataset.base
}

export function applyColours(colours: StudioColours) {
  const root = document.documentElement.style
  root.setProperty('--brand', colours.first)
  root.setProperty('--rose', colours.second)
  applyBase(colours.base)
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
  const base = look?.base
  useEffect(() => {
    if (!enabled) return
    applyColours(first && second ? { first, second, base } : readColours(organisationId))
    const follow = (e: Event) => {
      const detail = (e as CustomEvent<{ organisationId: string; colours: StudioColours }>).detail
      if (detail.organisationId === organisationId) applyColours(detail.colours)
    }
    window.addEventListener(event, follow)
    return () => window.removeEventListener(event, follow)
  }, [organisationId, first, second, base, enabled])
}

/** V5: a guest booking page shows the studio's colours and base, or the house look. */
export function useGuestColours(look?: StudioLook) {
  const first = look?.first
  const second = look?.second
  const base = look?.base
  useEffect(() => {
    applyColours({
      first: first ?? defaultColours.first,
      second: second ?? defaultColours.second,
      base,
    })
  }, [first, second, base])
}
