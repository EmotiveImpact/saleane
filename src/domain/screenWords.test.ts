import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Stage 6: the words a person reads say "studio", "visit", "treatment" and "SALEANE", never the
 * names the code uses inside. This reads every screen and every server reply in the source and
 * looks at the text in quotes and between tags, leaving code names, paths and comments alone.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** A template's text without what it fills in, which is code: `${visit.appointmentId}`. */
function withoutFillIns(text: string) {
  let out = ''
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '$' && text[i + 1] === '{') {
      depth++
      i++
    } else if (depth && text[i] === '{') depth++
    else if (depth && text[i] === '}') depth--
    else if (!depth) out += text[i]
  }
  return out
}

/** The text in quotes, backticks and between tags on each line, with comments left out. */
function wordsOn(line: string) {
  const trimmed = line.trim()
  if (/^(\/\/|\*|\/\*)/.test(trimmed)) return []
  const code = withoutFillIns(line.replace(/\s\/\/\s.*$/, ''))
  return [
    ...[...code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]),
    ...[...code.matchAll(/>([^<>{}=;()]*[a-z][^<>{}=;()]*)</g)].map((m) => m[1]),
    // A line of words inside a JSX element, alone on its line.
    ...(/^[A-Z][a-z]+( [A-Za-z’',.]+){2,}[.,]?$/.test(trimmed) ? [trimmed] : []),
  ]
}

/** A sentence a person could read: words with a space between, not a path, key or SQL name. */
const sentence = (text: string) => / [a-z]/i.test(text)

const rules: { name: string; pattern: RegExp; skip?: RegExp }[] = [
  // The product's name is always in capitals on screen; code names (AskSaleane) and the headers
  // other software reads (Saleane-Signature) keep theirs.
  { name: 'SALEANE in capitals', pattern: /(?<![A-Za-z-])Saleane(?![A-Za-z-])/ },
  {
    name: 'studio, not workspace',
    pattern: /(?<![./'_-])\bworkspaces?\b(?![./_-])/i,
  },
  { name: 'no tenant', pattern: /\btenants?\b/i },
  { name: 'visit, not appointment', pattern: /\bappointments?\b/i },
  { name: 'treatments, not services', pattern: /^\s*Services?\s*$/ },
]

/**
 * Words kept on purpose. Each says why: a name another company gives a thing, words a person may
 * type to search, or text only an AI or the SALEANE team reads.
 */
const kept: [file: string, contains: string][] = [
  // Google calls the field "appointment link" in a Business Profile.
  ['src/components/ShareBookingPage.tsx', 'add this as your appointment link'],
  // Words a person may type in Help search, so the guide still turns up.
  ['src/domain/helpArticles.ts', 'appointment'],
  // The backup tool's own checks, read by whoever runs it, not by a studio.
  ['server/backup.ts', 'tenant links'],
  // Ask SALEANE's instructions to the AI name the value the code expects.
  ['src/assistant/saleane.ts', "'appointment' for messages about a booked visit"],
]

/** The rules a line breaks, for the words a person could read on it. */
function findings(path: string, line: string) {
  const found: string[] = []
  for (const text of wordsOn(line)) {
    for (const rule of rules) {
      const isLabel = rule.name.startsWith('treatments')
      if (!isLabel && !sentence(text)) continue
      if (!rule.pattern.test(text)) continue
      if (kept.some(([f, c]) => f === path && text.includes(c))) continue
      found.push(`${rule.name}: ${text.trim()}`)
    }
  }
  return found
}

describe('the words on screen', () => {
  it('notices the words it looks for, and leaves code names alone', () => {
    const line = (text: string) => findings('src/pages/Example.tsx', text)
    expect(line("fail(403, 'Refresh the workspace before saving.')")).toHaveLength(1)
    expect(line("  noEmailReminders: 'no appointment emails',")).toHaveLength(1)
    expect(line("  batch: ['visits', 'Approved several changes from Ask Saleane'],")).toHaveLength(
      1,
    )
    expect(line('                  <th scope="col">Services</th>')).toHaveLength(1)
    expect(line("throw new Error('Database contains broken tenant links.')")).toHaveLength(1)
    expect(line('  `/api/workspaces/${orgId}/outbox`,')).toEqual([])
    expect(line("    remember('saleane.workspace', id)")).toEqual([])
    expect(line("  'workspace.created': ['settings', 'Created the studio'],")).toEqual([])
    expect(line("  'Saleane-Signature': signature(secret, timestamp, payload),")).toEqual([])
    expect(line('  `Move ${m.appointment.startMinutes} to ${name}, same time.`,')).toEqual([])
    expect(line(' * Ask Saleane, the studio assistant, in a comment.')).toEqual([])
  })

  it('never shows the names the code uses inside', () => {
    const root = process.cwd()
    const offenders: string[] = []
    for (const file of [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'server'))]) {
      const path = relative(root, file)
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const found of findings(path, line)) offenders.push(`${path}:${i + 1} ${found}`)
        })
    }
    expect(offenders).toEqual([])
  })
})
