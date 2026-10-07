import { useEffect } from 'react'

/**
 * A studio's own first and second colours. Everything else in the palette is
 * derived from these two in tokens.css, so changing them re-tints buttons,
 * selections, the now line and tags together.
 *
 * For now the choice is kept in this browser, one entry per studio. Once
 * studio settings are stored on the server it moves there so guests see it too.
 */
export const firstColours = [
  { name: 'Sage', value: '#5f8471' },
  { name: 'Heather', value: '#7a6690' },
  { name: 'Slate', value: '#557089' },
  { name: 'Teal', value: '#3f7f80' },
  { name: 'Clay', value: '#a35f4b' },
  { name: 'Rosewood', value: '#a5566d' },
] as const

export const secondColours = [
  { name: 'Soft rose', value: '#c27286' },
  { name: 'Apricot', value: '#c98a5e' },
  { name: 'Lavender', value: '#9a86b8' },
  { name: 'Sky', value: '#6f9cbc' },
  { name: 'Olive', value: '#8c9a5b' },
] as const

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

/** Applies the studio's colours to the page and follows later changes. */
export function useStudioColours(organisationId: string) {
  useEffect(() => {
    apply(readColours(organisationId))
    const follow = (e: Event) => {
      const detail = (e as CustomEvent<{ organisationId: string; colours: StudioColours }>).detail
      if (detail.organisationId === organisationId) apply(detail.colours)
    }
    window.addEventListener(event, follow)
    return () => window.removeEventListener(event, follow)
  }, [organisationId])
}
