import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ScanBarcode } from 'lucide-react'
import { useStore } from '../state/context'
import { can } from '../domain/operations'
import { checkBarcode, normaliseBarcode, productWithBarcode } from '../domain/barcode'
import { products } from '../domain/retail'
import type { Product } from '../domain/retail'
import { Button } from '../design'
import { useBarcodeScan } from './barcodeScan'
import { CameraScanButton } from './CameraScan'
import './scan.css'

/** What a screen did with a scanned product: a short line to show, as done or as a problem. */
export type ScanOutcome = { done: string } | { problem: string }
type Shown =
  | { tone: 'done' | 'problem'; text: string }
  | { tone: 'unknown'; code: string; detail?: string; attachable: boolean }

/**
 * Stage 2: the one way products are found by barcode, wherever products are picked. A scanner
 * can type into the visible "Scan or type a barcode" field, or anywhere else on the screen (the
 * burst is recognised and the field it landed in is put back as it was); a phone or tablet can
 * use its camera; and a code can be typed by hand. An unknown code is said plainly, and someone
 * who may edit products can add it to a product there and then.
 */
export function ScanField({
  onProduct,
  action = 'Add',
  hint,
  disabled = false,
  onNewProduct,
}: {
  /** What this screen does with the product the code belongs to. */
  onProduct: (product: Product) => ScanOutcome
  /** The button beside the field, such as Add or Find. */
  action?: string
  hint?: string
  disabled?: boolean
  /** Opens a new product with this barcode; without it, a link leads to Stock to add one. */
  onNewProduct?: (code: string) => void
}) {
  const { state, role, blocked, commit } = useStore()
  const root = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState('')
  const [shown, setShown] = useState<Shown | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [attachTo, setAttachTo] = useState('')
  const [attachError, setAttachError] = useState('')
  const [pending, setPending] = useState(false)
  const fieldId = useId()
  const mayEdit = !blocked && can(role, 'product')
  const without = products(state)
    .filter((p) => !p.archived && !p.barcode)
    .sort((a, b) => a.name.localeCompare(b.name))

  function take(raw: string) {
    if (disabled || pending) return
    setAttaching(false)
    setAttachError('')
    const code = normaliseBarcode(raw)
    if (!code) {
      setShown({ tone: 'problem', text: 'Scan a barcode, or type its numbers and press Enter.' })
      return
    }
    const product = productWithBarcode(products(state), code)
    if (!product) {
      const checked = checkBarcode(code)
      setShown({
        tone: 'unknown',
        code,
        detail: !checked.ok && checked.checkDigit ? checked.error : undefined,
        attachable: checked.ok,
      })
      setValue(code)
      return
    }
    const outcome = onProduct(product)
    setShown(
      'done' in outcome
        ? { tone: 'done', text: outcome.done }
        : { tone: 'problem', text: outcome.problem },
    )
    setValue('')
  }
  useBarcodeScan(take, root, !disabled)
  // An unknown code stays in the field to be checked, selected, so the next scan or typing
  // replaces it rather than adding to it.
  useEffect(() => {
    if (shown?.tone === 'unknown' && document.activeElement === input.current)
      input.current?.select()
  }, [shown])

  async function attach(code: string) {
    const product = products(state).find((p) => p.id === attachTo)
    if (!product) {
      setAttachError('Choose the product this barcode is on.')
      return
    }
    setPending(true)
    setAttachError('')
    try {
      const { id, ...input } = product
      const result = await commit({ type: 'product', id, input: { ...input, barcode: code } })
      if (!result.ok) {
        setAttachError(result.error)
        return
      }
      setAttaching(false)
      setValue('')
      const outcome = onProduct({ ...product, barcode: code })
      const saved = `Barcode ${code} is now on ${product.name}.`
      setShown(
        'done' in outcome
          ? { tone: 'done', text: `${saved} ${outcome.done}` }
          : { tone: 'problem', text: `${saved} ${outcome.problem}` },
      )
    } catch {
      setAttachError('This could not be saved. Your choice is still here; try again.')
    } finally {
      setPending(false)
    }
  }

  const unknown = shown?.tone === 'unknown' ? shown : null
  return (
    <div className="scan-field" ref={root}>
      <label htmlFor={fieldId}>Scan or type a barcode</label>
      <div className="scan-field-row">
        <span className="scan-field-input">
          <ScanBarcode size={18} aria-hidden="true" />
          <input
            id={fieldId}
            ref={input}
            data-scan-field
            value={value}
            disabled={disabled}
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={60}
            placeholder="5012345678900"
            aria-describedby={hint ? `${fieldId}-hint` : undefined}
            onChange={(event) => {
              setValue(event.target.value)
              if (!attaching) setShown(null)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              // A scanner presses Enter after the code: find it here, never send the form.
              event.preventDefault()
              take(value)
            }}
          />
        </span>
        <Button
          variant="secondary"
          disabled={disabled || !value.trim()}
          onClick={() => {
            take(value)
            input.current?.focus()
          }}
        >
          {action}
        </Button>
        <CameraScanButton onCode={take} disabled={disabled} />
      </div>
      {hint && (
        <small id={`${fieldId}-hint`} className="scan-field-hint">
          {hint}
        </small>
      )}
      {shown?.tone === 'done' && (
        <p className="scan-note is-done" role="status">
          {shown.text}
        </p>
      )}
      {shown?.tone === 'problem' && (
        <p className="scan-note is-problem" role="alert">
          {shown.text}
        </p>
      )}
      {unknown && (
        <div className="scan-note is-problem">
          <p role="alert">
            {unknown.code.length > 40
              ? 'No product has that barcode.'
              : `No product has barcode ${unknown.code}.`}
            {unknown.detail ? ` ${unknown.detail}` : ''}
          </p>
          {mayEdit && unknown.attachable && !attaching && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setAttaching(true)
                setAttachTo('')
                setAttachError('')
              }}
            >
              Add it to a product
            </button>
          )}
        </div>
      )}
      {unknown && attaching && (
        <div className="scan-attach" role="group" aria-label={`Add barcode ${unknown.code}`}>
          {without.length > 0 ? (
            <label>
              Which product has barcode {unknown.code}?
              <select
                value={attachTo}
                disabled={pending}
                onChange={(event) => {
                  setAttachTo(event.target.value)
                  setAttachError('')
                }}
              >
                <option value="">Choose a product…</option>
                {without.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
              <small>Products that already have a barcode are not listed.</small>
            </label>
          ) : (
            <p className="ops-help">Every product already has a barcode.</p>
          )}
          {attachError && (
            <p className="form-error" role="alert">
              {attachError}
            </p>
          )}
          <div className="scan-attach-actions">
            {without.length > 0 && (
              <Button
                variant="secondary"
                disabled={pending || !attachTo}
                onClick={() => void attach(unknown.code)}
              >
                {pending ? 'Saving…' : 'Save the barcode'}
              </Button>
            )}
            {onNewProduct ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setAttaching(false)
                  onNewProduct(unknown.code)
                }}
              >
                It is a new product
              </Button>
            ) : (
              <Link
                className="text-link"
                to={`/business/stock?new-barcode=${encodeURIComponent(unknown.code)}`}
              >
                It is a new product: add it on Stock
              </Link>
            )}
            <Button variant="quiet" disabled={pending} onClick={() => setAttaching(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
