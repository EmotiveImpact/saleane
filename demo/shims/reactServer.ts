// A browser stand-in for react-dom/server's renderToStaticMarkup, used only to draw email previews.
// The real one carries React's streaming runtime, whose inline page markup the artifact host reads
// as a page of its own and refuses. Emails are plain tables, inline styles and text, so this small
// renderer draws them the same way (src/email/demoRenderer.test.tsx compares the two).
import { Fragment, isValidElement } from 'react'
import type { ReactNode } from 'react'

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])
const NAMES: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  httpEquiv: 'http-equiv',
  acceptCharset: 'accept-charset',
}
// Style values React leaves without "px" when given a number.
const UNITLESS = new Set([
  'flex',
  'flexGrow',
  'flexShrink',
  'fontWeight',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'widows',
  'zIndex',
  'zoom',
])
const SKIP = new Set([
  'children',
  'key',
  'ref',
  'dangerouslySetInnerHTML',
  'suppressHydrationWarning',
])

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]!,
  )

function style(value: Record<string, unknown>) {
  return Object.entries(value)
    .filter(([, v]) => v != null && v !== '' && typeof v !== 'boolean')
    .map(([key, v]) => {
      const name = key.startsWith('--') ? key : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
      const text = typeof v === 'number' && v !== 0 && !UNITLESS.has(key) ? `${v}px` : String(v)
      return `${name}:${text.trim()}`
    })
    .join(';')
}

function attributes(props: Record<string, unknown>) {
  let out = ''
  for (const [key, value] of Object.entries(props)) {
    if (SKIP.has(key) || value == null || typeof value === 'function' || value === false) continue
    if (key === 'style') {
      const css = style(value as Record<string, unknown>)
      if (css) out += ` style="${escape(css)}"`
      continue
    }
    const name = NAMES[key] ?? key
    out += value === true ? ` ${name}=""` : ` ${name}="${escape(String(value))}"`
  }
  return out
}

function render(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint')
    return escape(String(node))
  if (Array.isArray(node)) return node.map(render).join('')
  if (!isValidElement(node))
    throw new Error('The demo email renderer met something it cannot draw.')
  const { type } = node
  const props = node.props as Record<string, unknown> & { children?: ReactNode }
  if (type === Fragment) return render(props.children)
  if (typeof type === 'function') return render((type as (p: unknown) => ReactNode)(props))
  if (typeof type !== 'string')
    throw new Error('The demo email renderer draws plain elements only.')
  if (VOID.has(type)) return `<${type}${attributes(props)}/>`
  const open = `<${type}${attributes(props)}>`
  const inner = (props.dangerouslySetInnerHTML as { __html?: string } | undefined)?.__html
  return `${open}${inner ?? render(props.children)}</${type}>`
}

export const renderToStaticMarkup = (node: ReactNode) => render(node)
