import { describe, expect, it } from 'vitest'
import {
  barcodeKey,
  barcodeProblem,
  checkBarcode,
  checkDigit,
  normaliseBarcode,
  productWithBarcode,
  sameBarcode,
} from './barcode'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { createWorkspace } from './workspace'
import { SAMPLE_BARCODES, seed } from './seed'

// Stage 2: barcodes on products, checked, kept in one normal form and on one product only.
describe('barcode checks', () => {
  it('works out GS1 check digits for EAN-13, EAN-8 and UPC-A', () => {
    expect(checkDigit('501234567890')).toBe(0)
    expect(checkDigit('400638133393')).toBe(1)
    expect(checkDigit('03600029145')).toBe(2)
    expect(checkDigit('9638507')).toBe(4)
  })

  it('accepts each kind with the right check digit', () => {
    expect(checkBarcode('5012345678900')).toEqual({
      ok: true,
      code: '5012345678900',
      kind: 'ean13',
    })
    expect(checkBarcode('96385074')).toEqual({ ok: true, code: '96385074', kind: 'ean8' })
    expect(checkBarcode('036000291452')).toEqual({ ok: true, code: '036000291452', kind: 'upca' })
    expect(checkBarcode('sal0001')).toEqual({
      ok: true,
      code: 'SAL0001',
      kind: 'code',
    })
    expect(checkBarcode('A1B2')).toMatchObject({ ok: true, kind: 'code' })
    expect(checkBarcode('X'.repeat(40))).toMatchObject({ ok: true, kind: 'code' })
    for (const code of SAMPLE_BARCODES) expect(checkBarcode(code).ok).toBe(true)
  })

  it('says plainly when a check digit is wrong, and what it should be', () => {
    const ean = checkBarcode('5012345678901')
    expect(ean).toMatchObject({ ok: false, checkDigit: true })
    expect(ean.ok ? '' : ean.error).toBe(
      'EAN-13 barcodes end in a check digit. For this one it should be 0, not 1. Check the number on the product.',
    )
    expect(checkBarcode('96385075')).toMatchObject({
      ok: false,
      error: expect.stringContaining(
        'EAN-8 barcodes end in a check digit. For this one it should be 4',
      ),
    })
    expect(checkBarcode('036000291453')).toMatchObject({
      ok: false,
      error: expect.stringContaining(
        'UPC-A barcodes end in a check digit. For this one it should be 2',
      ),
    })
  })

  it('refuses codes that are too short, too long or not letters and digits', () => {
    expect(checkBarcode('123')).toMatchObject({
      ok: false,
      error: 'A barcode needs at least 4 letters or digits.',
    })
    expect(checkBarcode('X'.repeat(41))).toMatchObject({
      ok: false,
      error: 'A barcode can have up to 40 letters or digits.',
    })
    expect(checkBarcode('SAL-0001')).toMatchObject({
      ok: false,
      error: 'A barcode can only use letters and digits.',
    })
    expect(checkBarcode('<svg>')).toMatchObject({ ok: false })
  })

  it('normalises: trims, drops the spaces people type between groups, and capitalises', () => {
    expect(normaliseBarcode('  5 012345 678900\n')).toBe('5012345678900')
    expect(normaliseBarcode('\tab12cd ')).toBe('AB12CD')
    expect(checkBarcode(' 5 012345 678900 ')).toMatchObject({ ok: true, code: '5012345678900' })
  })

  it('treats a 12-digit UPC-A and its 13-digit EAN form with a leading 0 as one barcode', () => {
    expect(barcodeKey('036000291452')).toBe('0036000291452')
    expect(barcodeKey('0036000291452')).toBe('0036000291452')
    expect(sameBarcode('036000291452', '0036000291452')).toBe(true)
    expect(sameBarcode('036000291452', '036000291452 ')).toBe(true)
    expect(sameBarcode('5012345678900', '0036000291452')).toBe(false)
    const shelf = [
      { id: 'a', name: 'Serum', barcode: '036000291452' },
      { id: 'b', name: 'Balm', barcode: 'SAL0001' },
      { id: 'c', name: 'Oil' },
    ]
    expect(productWithBarcode(shelf, '0036000291452')?.id).toBe('a')
    expect(productWithBarcode(shelf, 'sal0001')?.id).toBe('b')
    expect(productWithBarcode(shelf, '0036000291452', 'a')).toBeUndefined()
    expect(productWithBarcode(shelf, '')).toBeUndefined()
  })

  it('finds stored barcodes that are invalid, not normal or shared', () => {
    expect(barcodeProblem([{ id: 'a', barcode: '5012345678900' }, { id: 'b' }])).toBeNull()
    expect(barcodeProblem([{ id: 'a', barcode: '5012345678901' }])).toBe(
      'A product has an invalid barcode.',
    )
    expect(barcodeProblem([{ id: 'a', barcode: 'sal0001' }])).toBe(
      'A product has an invalid barcode.',
    )
    expect(
      barcodeProblem([
        { id: 'a', barcode: '036000291452' },
        { id: 'b', barcode: '0036000291452' },
      ]),
    ).toBe('Two products share a barcode.')
  })
})

describe('the product command', () => {
  const now = '2026-10-06T08:00:00.000Z'
  let sequence = 0
  const run = (s: BusinessState, command: Command) =>
    execute(s, command, now, () => `barcode-${++sequence}`)
  const product = (name: string, barcode?: string) => ({
    name,
    sku: '',
    priceMinor: 2400,
    reorderAt: 2,
    archived: false,
    ...(barcode === undefined ? {} : { barcode }),
  })
  function studio() {
    const first = run(createWorkspace({ name: 'Barcode studio', region: 'UK' }), {
      type: 'product',
      input: product('Hydrating Serum', ' 5 012345 678900 '),
    })
    if (!first.ok) throw new Error(first.error)
    return first.state
  }

  it('keeps the barcode in its normal form', () => {
    expect(studio().operations!.products[0].barcode).toBe('5012345678900')
  })

  it('refuses a barcode another product has, naming that product', () => {
    const result = run(studio(), { type: 'product', input: product('Body Oil', '5012345678900') })
    expect(result).toMatchObject({
      ok: false,
      error:
        'Hydrating Serum already has barcode 5012345678900. Each barcode belongs to one product.',
    })
  })

  it('treats the UPC-A and EAN-13 forms of a code as the same barcode', () => {
    const first = run(studio(), { type: 'product', input: product('Balm', '036000291452') })
    if (!first.ok) throw new Error(first.error)
    const second = run(first.state, { type: 'product', input: product('Mask', '0036000291452') })
    expect(second).toMatchObject({
      ok: false,
      error: expect.stringContaining('Balm already has barcode 036000291452.'),
    })
  })

  it('names an archived product that still holds the code', () => {
    const s = studio()
    const serum = s.operations!.products[0]
    const archived = run(s, {
      type: 'product',
      id: serum.id,
      input: { ...product('Hydrating Serum', serum.barcode), archived: true },
    })
    if (!archived.ok) throw new Error(archived.error)
    expect(
      run(archived.state, { type: 'product', input: product('Body Oil', '5012345678900') }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('(no longer stocked)') })
  })

  it('lets a product keep, change or clear its own barcode', () => {
    const s = studio()
    const id = s.operations!.products[0].id
    const kept = run(s, {
      type: 'product',
      id,
      input: product('Hydrating Serum, 30ml', '5012345678900'),
    })
    expect(kept.ok).toBe(true)
    const cleared = run(s, { type: 'product', id, input: product('Hydrating Serum', '') })
    if (!cleared.ok) throw new Error(cleared.error)
    expect(cleared.state.operations!.products[0]).not.toHaveProperty('barcode')
  })

  it('refuses a wrong check digit with the plain reason', () => {
    expect(
      run(studio(), { type: 'product', input: product('Body Oil', '4006381333932') }),
    ).toMatchObject({
      ok: false,
      error:
        'EAN-13 barcodes end in a check digit. For this one it should be 1, not 2. Check the number on the product.',
    })
  })

  it('refuses a studio record where two products share a barcode', () => {
    const s = studio()
    const copy = structuredClone(s)
    copy.operations!.products.push({ ...copy.operations!.products[0], id: 'product-copy' })
    expect(() => parseState(copy, 'UK')).toThrow('Two products share a barcode.')
  })

  it('gives every sample product its own barcode', () => {
    const codes = seed('UK').operations!.products.map((p) => p.barcode)
    expect(codes).toEqual(SAMPLE_BARCODES)
  })
})
