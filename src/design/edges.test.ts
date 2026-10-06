import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// SALEANE does not use coloured stripes on the left edge of cards, notes,
// errors or visits. Tone comes from the surface colour instead. The only left
// rules allowed are the 1px structural lines between calendar columns.
const allowed = new Set(['0', 'none', '1px solid var(--line)'])

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return name.endsWith('.css') ? [path] : []
  })
}

describe('design language edges', () => {
  it('has no accent stripes on the left edge', () => {
    const offenders: string[] = []
    for (const file of cssFiles(join(process.cwd(), 'src'))) {
      const css = readFileSync(file, 'utf8')
      for (const match of css.matchAll(
        /border-(?:left|inline-start)(?:-width|-color|-style)?\s*:\s*([^;]+);/g,
      )) {
        if (!allowed.has(match[1].trim())) offenders.push(`${file}: ${match[0]}`)
      }
      for (const match of css.matchAll(/box-shadow\s*:[^;]*inset\s+[1-9][^;]*;/g)) {
        offenders.push(`${file}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
