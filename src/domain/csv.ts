/**
 * One spreadsheet cell. Text starting with = + - or @ would run as a formula in a spreadsheet, so
 * it is kept as text; plain numbers such as -3.00 are left alone. Commas, quotes and line breaks
 * are quoted.
 */
export function csvCell(raw: string | number) {
  const text = String(raw)
  const plainNumber = /^-?\d+(\.\d+)?$/.test(text)
  const value = !plainNumber && /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function csvRows(rows: (string | number)[][]) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
}

/** Minor units as a plain decimal for a spreadsheet, such as 12.50 or -3.00. */
export function csvAmount(minor: number) {
  return (minor / 100).toFixed(2)
}
