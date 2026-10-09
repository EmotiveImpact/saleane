/**
 * Stage 2: barcodes on products. A product may carry the barcode printed on it: an EAN-13,
 * EAN-8 or UPC-A, whose last digit is a check digit worked out from the others, or any other
 * printed code of 4 to 40 letters and digits (Code 128 style, such as a supplier's own label).
 *
 * Every code is kept and compared in one normal form, so a scan, a typed code and the stored
 * code agree: spaces people type between digit groups are dropped and letters are capitals. A
 * 12-digit UPC-A and the same code as a 13-digit EAN with a leading 0 are one barcode.
 */
export const BARCODE_MIN = 4
export const BARCODE_MAX = 40

export type BarcodeKind = 'ean13' | 'ean8' | 'upca' | 'code'
export type BarcodeCheck =
  | { ok: true; code: string; kind: BarcodeKind }
  | { ok: false; code: string; error: string; checkDigit?: true }

const NAMES: Record<Exclude<BarcodeKind, 'code'>, string> = {
  ean13: 'EAN-13',
  ean8: 'EAN-8',
  upca: 'UPC-A',
}

/** Drops spaces (and a scanner's stray tab or line break) and capitalises letters. */
export function normaliseBarcode(raw: string) {
  return raw.replace(/\s+/g, '').toUpperCase()
}

/** The GS1 check digit for the digits before it: weights 3 and 1 from the right. */
export function checkDigit(body: string) {
  let sum = 0
  for (let i = 0; i < body.length; i++)
    sum += (body.charCodeAt(body.length - 1 - i) - 48) * (i % 2 === 0 ? 3 : 1)
  return (10 - (sum % 10)) % 10
}

function kindOf(code: string): BarcodeKind {
  if (/^\d{13}$/.test(code)) return 'ean13'
  if (/^\d{12}$/.test(code)) return 'upca'
  if (/^\d{8}$/.test(code)) return 'ean8'
  return 'code'
}

/** Checks a typed or scanned code and returns it in its normal form, or says plainly what is wrong. */
export function checkBarcode(raw: string): BarcodeCheck {
  const code = normaliseBarcode(raw)
  if (!/^[A-Z0-9]*$/.test(code))
    return { ok: false, code, error: 'A barcode can only use letters and digits.' }
  if (code.length < BARCODE_MIN)
    return { ok: false, code, error: `A barcode needs at least ${BARCODE_MIN} letters or digits.` }
  if (code.length > BARCODE_MAX)
    return { ok: false, code, error: `A barcode can have up to ${BARCODE_MAX} letters or digits.` }
  const kind = kindOf(code)
  if (kind !== 'code') {
    const expected = checkDigit(code.slice(0, -1))
    const actual = Number(code.slice(-1))
    if (expected !== actual)
      return {
        ok: false,
        code,
        checkDigit: true,
        error: `${NAMES[kind]} barcodes end in a check digit. For this one it should be ${expected}, not ${actual}. Check the number on the product.`,
      }
  }
  return { ok: true, code, kind }
}

/** The form two codes are compared in: a UPC-A is its EAN-13 with a leading 0. */
export function barcodeKey(raw: string) {
  const code = normaliseBarcode(raw)
  return /^\d{12}$/.test(code) ? `0${code}` : code
}

/** Whether two codes are the same barcode. */
export const sameBarcode = (a: string, b: string) => barcodeKey(a) === barcodeKey(b)

/** The product with this barcode, if any, leaving out the one being edited. */
export function productWithBarcode<P extends { id: string; barcode?: string }>(
  products: readonly P[],
  raw: string,
  exceptId?: string,
): P | undefined {
  const key = barcodeKey(raw)
  if (!key) return undefined
  return products.find((p) => p.id !== exceptId && !!p.barcode && barcodeKey(p.barcode) === key)
}

/** Checks the stored barcodes: each in its normal form, valid, and on one product only. */
export function barcodeProblem(products: readonly { id: string; barcode?: string }[]) {
  const seen = new Set<string>()
  for (const product of products) {
    if (product.barcode === undefined) continue
    const checked = checkBarcode(product.barcode)
    if (!checked.ok || checked.code !== product.barcode) return 'A product has an invalid barcode.'
    const key = barcodeKey(product.barcode)
    if (seen.has(key)) return 'Two products share a barcode.'
    seen.add(key)
  }
  return null
}
