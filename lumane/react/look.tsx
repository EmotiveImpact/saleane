import type { CSSProperties, HTMLAttributes } from 'react'

/**
 * LUMANE's default look, set by four choices. An app that has its own design dresses the parts
 * itself instead; one that wants no look at all uses `'plain'`.
 */
export type Look = {
  /** The main colour, as a hex code such as "#2F6F62". */
  colour: string
  /** The font, as CSS writes it, such as "'Figtree', system-ui, sans-serif". */
  font: string
  corners: 'square' | 'soft' | 'round'
  scheme: 'light' | 'dark'
}

export const DEFAULT_LOOK: Look = {
  colour: '#2F6F62',
  font: "'Figtree Variable', 'Figtree', system-ui, sans-serif",
  corners: 'soft',
  scheme: 'light',
}

const SCHEMES = {
  light: { bg: '#ffffff', surface: '#f6f7f6', ink: '#1e2422', muted: '#5e6866', line: '#e2e6e4' },
  dark: { bg: '#1c1d1f', surface: '#141516', ink: '#ecebe8', muted: '#a3a19c', line: '#3a3c40' },
} as const
const CORNERS = { square: 4, soft: 14, round: 24 } as const
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

type Rgb = [number, number, number]
function rgb(hex: string): Rgb {
  const v = hex.slice(1)
  const full = v.length === 3 ? [...v].map((c) => c + c).join('') : v
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb
}
const toHex = (c: Rgb) => '#' + c.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')
/** `a` laid over `b` at `weight`, as one colour. */
const mix = (a: string, b: string, weight: number) => {
  const x = rgb(a)
  const y = rgb(b)
  return toHex(x.map((n, i) => n * weight + y[i] * (1 - weight)) as Rgb)
}
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((n) => {
    const c = n / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** How far apart two colours are for reading, from 1 to 21; 4.5 or more is comfortable. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The look with every choice filled in, falling back to the default for anything left out. */
export function fullLook(look: Partial<Look> = {}): Look {
  const colour = look.colour && HEX.test(look.colour) ? look.colour : DEFAULT_LOOK.colour
  return { ...DEFAULT_LOOK, ...look, colour }
}

/** Anything about a look that would make Ask hard to read, in plain sentences. */
export function lookProblems(look: Partial<Look>): string[] {
  const problems: string[] = []
  if (look.colour !== undefined && !HEX.test(look.colour))
    problems.push('The colour needs to be a hex code, such as #2F6F62.')
  const full = fullLook(look)
  const colours = palette(full)
  if (contrast(colours.onAccent, full.colour) < 4.5)
    problems.push('Writing on this colour would be hard to read. Choose a deeper or a paler one.')
  if (!full.font.trim()) problems.push('The look needs a font.')
  return problems
}

/** The colours the look uses, worked out from its main colour and light or dark. */
export function palette(look: Look) {
  const base = SCHEMES[look.scheme]
  const accent = look.colour
  // White or near-black, whichever reads better on the main colour.
  const onAccent =
    contrast('#ffffff', accent) >= contrast('#111111', accent) ? '#ffffff' : '#111111'
  const soft = mix(accent, base.bg, look.scheme === 'dark' ? 0.22 : 0.1)
  // The main colour as writing, on the page and on a waiting change's tint: moved towards the
  // ink until it reads clearly on both.
  const reads = (ink: string) => Math.min(contrast(ink, base.bg), contrast(ink, soft)) >= 4.5
  let accentInk = accent
  for (let w = 0.9; !reads(accentInk) && w > 0; w -= 0.1) accentInk = mix(accent, base.ink, w)
  return { ...base, accent, onAccent, accentInk, soft }
}

/** The look as CSS variables, for the default look's stylesheet (`look.css`) to read. */
export function lookStyle(look: Partial<Look> = {}): CSSProperties {
  const full = fullLook(look)
  const c = palette(full)
  const radius = CORNERS[full.corners] ?? CORNERS.soft
  return {
    '--lumane-accent': c.accent,
    '--lumane-on-accent': c.onAccent,
    '--lumane-accent-ink': c.accentInk,
    '--lumane-soft': c.soft,
    '--lumane-bg': c.bg,
    '--lumane-surface': c.surface,
    '--lumane-ink': c.ink,
    '--lumane-muted': c.muted,
    '--lumane-line': c.line,
    '--lumane-font': full.font,
    '--lumane-radius': `${radius}px`,
    '--lumane-radius-small': `${Math.min(radius, 12)}px`,
    '--lumane-radius-control': full.corners === 'round' ? '999px' : `${Math.min(radius, 12)}px`,
  } as CSSProperties
}

/**
 * Where the default look applies: everything inside is dressed by `look.css`. With `'plain'`
 * nothing is dressed, and the app's own styles are all there is.
 */
export function LookScope({
  look,
  style,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { look?: Partial<Look> | 'plain' }) {
  if (look === 'plain')
    return (
      <section {...props} style={style}>
        {children}
      </section>
    )
  const full = fullLook(look)
  return (
    <section {...props} data-lumane-look={full.scheme} style={{ ...lookStyle(full), ...style }}>
      {children}
    </section>
  )
}
