import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Dates are chosen from SALEANE's own calendar (DateField), written the studio's way. The
// browser's date box shows "11/03/2026" to a UK reader, so no screen uses it.
function screens(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return screens(path)
    return name.endsWith('.tsx') && !name.includes('.test.') ? [path] : []
  })
}

describe('choosing a date', () => {
  it('never uses the browser’s own date box', () => {
    const offenders = screens(join(process.cwd(), 'src')).filter((file) =>
      /type=["']date["']/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
