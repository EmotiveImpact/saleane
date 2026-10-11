/**
 * Moving in, stage 1: reading the files a studio downloads from its old system, as they come.
 * CSV (comma, semicolon or tab), tab-separated text and Excel workbooks (.xlsx) are read here into
 * plain rows of text. Nothing is renamed or cleaned yet; recognising the file and its columns
 * happens in recognise.ts and fields.ts.
 */

/** Large enough for a busy studio's whole client list, small enough to read safely in a page. */
export const SHEET_MAX_BYTES = 15 * 1024 * 1024
export const SHEET_MAX_ROWS = 50_000
export const SHEET_MAX_COLUMNS = 200
const CELL_MAX = 5_000

export type Sheet = {
  /** The file's own name, shown back to the owner. */
  fileName: string
  /** Every non-empty row, cells as text exactly as the file had them (trimmed). */
  rows: string[][]
}

export class SheetError extends Error {}

/** Reads one file. `bytes` is the whole file; the format is decided by its content, not its name. */
export async function readSheet(fileName: string, bytes: Uint8Array): Promise<Sheet> {
  if (bytes.byteLength > SHEET_MAX_BYTES)
    throw new SheetError(
      `${fileName} is larger than 15 MB. Download it again in smaller parts, such as one year at a time.`,
    )
  if (!bytes.byteLength) throw new SheetError(`${fileName} is empty.`)
  if (isZip(bytes)) return { fileName, rows: await readXlsx(fileName, bytes) }
  if (isOldExcel(bytes))
    throw new SheetError(
      `${fileName} is an older Excel file. Open it and save it as an Excel workbook (.xlsx) or CSV, then add it again.`,
    )
  const text = decodeText(bytes)
  if (/^\s*</.test(text) && /<table[\s>]/i.test(text.slice(0, 5000)))
    throw new SheetError(
      `${fileName} is a web page saved as a spreadsheet. Open it in Excel and save it as an Excel workbook (.xlsx) or CSV, then add it again.`,
    )
  return { fileName, rows: readDelimited(fileName, text) }
}

function isZip(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}
function isOldExcel(bytes: Uint8Array) {
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
}

/** UTF-8 (with or without a byte-order mark), UTF-16 from Excel's "Unicode text", else Windows-1252. */
export function decodeText(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** The separator a file uses: whichever of comma, semicolon or tab splits its first lines evenly. */
export function guessDelimiter(text: string) {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim())
    .slice(0, 20)
  let best = ','
  let bestScore = -1
  for (const candidate of [',', ';', '\t']) {
    const counts = lines.map((line) => splitLine(line, candidate).length)
    const widest = Math.max(0, ...counts)
    if (widest < 2) continue
    // Most lines should share the widest count; title rows above the headings may not.
    const agreeing = counts.filter((n) => n === widest).length
    const score = agreeing * widest
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

function splitLine(line: string, delimiter: string) {
  const cells: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === delimiter) {
      cells.push(field)
      field = ''
    } else field += c
  }
  cells.push(field)
  return cells
}

/** Quoted fields may hold separators, doubled quotes and line breaks. Blank rows are dropped. */
export function readDelimited(fileName: string, text: string, delimiter = guessDelimiter(text)) {
  if ([...text.slice(0, 200_000)].some((ch) => ch.charCodeAt(0) === 0))
    throw new SheetError(`${fileName} does not look like a spreadsheet or text file.`)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const endField = () => {
    if (field.length > CELL_MAX) field = field.slice(0, CELL_MAX)
    row.push(field.trim())
    field = ''
  }
  const endRow = () => {
    endField()
    if (row.some((cell) => cell !== '')) {
      if (row.length > SHEET_MAX_COLUMNS)
        throw new SheetError(`${fileName} has more than ${SHEET_MAX_COLUMNS} columns.`)
      rows.push(row)
      if (rows.length > SHEET_MAX_ROWS)
        throw new SheetError(
          `${fileName} has more than ${SHEET_MAX_ROWS.toLocaleString('en-GB')} rows. Download it in smaller parts.`,
        )
    }
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
      continue
    }
    if (c === '"' && field.trim() === '') {
      field = ''
      quoted = true
    } else if (c === delimiter) endField()
    else if (c === '\n' || c === '\r') {
      endRow()
      if (c === '\r' && text[i + 1] === '\n') i++
    } else field += c
  }
  if (field !== '' || row.length) endRow()
  return rows
}

// ---------------------------------------------------------------------------------------------
// Excel workbooks. An .xlsx file is a zip of XML parts; only the first worksheet and the shared
// strings are needed. Read with the browser's own decompression, so no extra library is shipped.

type ZipEntry = { name: string; method: number; offset: number; size: number }

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end-of-central-directory record sits in the last 64 KiB.
  let end = -1
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65_558); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  if (end < 0) throw new SheetError('damaged')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== 0x02014b50)
      throw new SheetError('damaged')
    const method = view.getUint16(at + 10, true)
    const size = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    if (local + 30 > bytes.byteLength) throw new SheetError('damaged')
    const dataStart =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    entries.push({ name, method, offset: dataStart, size })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function inflate(data: Uint8Array) {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function entryText(bytes: Uint8Array, entry: ZipEntry) {
  const data = bytes.subarray(entry.offset, entry.offset + entry.size)
  if (entry.method === 0) return new TextDecoder().decode(data)
  if (entry.method === 8) return new TextDecoder().decode(await inflate(data))
  throw new SheetError('damaged')
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}
function xmlText(raw: string) {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#')
      return String.fromCodePoint(
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1)),
      )
    return XML_ENTITIES[code] ?? whole
  })
}
/** The text runs inside one <si> or <is>, joined; phonetic hints (<rPh>) are left out. */
function runs(xml: string) {
  const plain = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  return [...plain.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1])).join('')
}

function columnIndex(ref: string) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? ''
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Number formats that show a date, so an Excel serial number is shown as one. */
function dateStyles(stylesXml: string) {
  const custom = new Map<number, string>()
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g))
    custom.set(Number(m[1]), xmlText(m[2]))
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? ''
  const isDate: boolean[] = []
  for (const m of cellXfs.matchAll(/<xf\b([^>]*)\/?>/g)) {
    const id = Number(/numFmtId="(\d+)"/.exec(m[1])?.[1] ?? 0)
    const code = custom.get(id) ?? ''
    const builtIn = (id >= 14 && id <= 22) || (id >= 45 && id <= 47)
    const looksLikeDate = /[dy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, ''))
    isDate.push(builtIn || looksLikeDate)
  }
  return isDate
}

/** An Excel serial day number as yyyy-mm-dd, with the time when it has one. */
export function excelSerialDate(serial: number) {
  const ms = Math.round((serial - 25569) * 86_400_000)
  const iso = new Date(ms).toISOString()
  return iso.slice(11, 16) === '00:00'
    ? iso.slice(0, 10)
    : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

async function readXlsx(fileName: string, bytes: Uint8Array) {
  const damaged = () =>
    new SheetError(
      `${fileName} could not be opened as an Excel workbook. Download it again, or save it as CSV.`,
    )
  let entries: ZipEntry[]
  try {
    entries = zipEntries(bytes)
  } catch {
    throw damaged()
  }
  const find = (name: string) => entries.find((e) => e.name.replace(/^\//, '') === name)
  try {
    const workbook = find('xl/workbook.xml')
    if (!workbook) throw damaged()
    const workbookXml = await entryText(bytes, workbook)
    const firstSheet = /<sheet\b[^>]*r:id="([^"]+)"/.exec(workbookXml)?.[1]
    let sheetPath = 'xl/worksheets/sheet1.xml'
    const rels = find('xl/_rels/workbook.xml.rels')
    if (firstSheet && rels) {
      const relsXml = await entryText(bytes, rels)
      const target = new RegExp(
        `<Relationship\\b[^>]*Id="${firstSheet}"[^>]*Target="([^"]+)"|<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstSheet}"`,
      ).exec(relsXml)
      const path = target?.[1] ?? target?.[2]
      if (path) sheetPath = path.startsWith('/') ? path.slice(1) : `xl/${path}`
    }
    const sheet = find(sheetPath)
    if (!sheet) throw damaged()
    const shared = find('xl/sharedStrings.xml')
    const strings = shared
      ? [...(await entryText(bytes, shared)).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
          runs(m[1]),
        )
      : []
    const styles = find('xl/styles.xml')
    const dates = styles ? dateStyles(await entryText(bytes, styles)) : []
    const xml = await entryText(bytes, sheet)
    const rows: string[][] = []
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = []
      for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1]
        const body = cell[2] ?? ''
        const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1]
        const index = ref ? columnIndex(ref) : row.length
        if (index >= SHEET_MAX_COLUMNS)
          throw new SheetError(`${fileName} has more than ${SHEET_MAX_COLUMNS} columns.`)
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1]
        const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1)
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
        let value = ''
        if (type === 's') value = strings[Number(raw)] ?? ''
        else if (type === 'inlineStr') value = runs(body)
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE'
        else if (raw !== undefined) {
          const text = xmlText(raw)
          const n = Number(text)
          value =
            type !== 'str' && dates[style] && Number.isFinite(n) && n > 0 && n < 2_958_466
              ? excelSerialDate(n)
              : text
        }
        while (row.length < index) row.push('')
        row[index] = value.trim().slice(0, CELL_MAX)
      }
      if (row.some((v) => v !== '')) {
        rows.push(row)
        if (rows.length > SHEET_MAX_ROWS)
          throw new SheetError(
            `${fileName} has more than ${SHEET_MAX_ROWS.toLocaleString('en-GB')} rows. Download it in smaller parts.`,
          )
      }
    }
    return rows
  } catch (cause) {
    if (cause instanceof SheetError && !/damaged/.test(cause.message)) throw cause
    throw damaged()
  }
}
