import { useEffect, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Minus, Plus, X } from 'lucide-react'
import { useStore } from '../state/context'
import { stock } from '../domain/operations'
import { money } from '../domain/format'
import { priceRetail, products, sellable } from '../domain/retail'
import type { Product } from '../domain/retail'
import type { RetailItems, SaleRetail } from '../domain/retailSchema'
import { RETAIL_LINE_LIMIT, RETAIL_QUANTITY_LIMIT } from '../domain/retailSchema'
import { ProductTile } from './ProductTile'
import { ScanField } from './ScanField'
import type { ScanOutcome } from './ScanField'
import './checkout-products.css'

/**
 * V2: products a guest buys with their visit. The desk picks from what is on sale and in stock;
 * the receipt keeps each product's name and price as they were at the moment of sale.
 * Stage 2: or scans them: a scan adds the product, or one more of it, after the same checks the
 * till makes when the sale is recorded, at the location whose shelf it comes off.
 */
export function CheckoutProducts({
  items,
  retail,
  disabled,
  onChange,
  locationId,
}: {
  items: RetailItems
  retail: SaleRetail | undefined
  disabled: boolean
  onChange: (items: RetailItems) => void
  /** The location whose shelf the products come off; absent means the main location. */
  locationId?: string
}) {
  const { state } = useStore()
  const org = state.organisation
  const [choosing, setChoosing] = useState(false)
  const [query, setQuery] = useState('')
  const list = useRef<HTMLFieldSetElement | null>(null)
  // A product just added takes the focus, as the list it was chosen from has closed.
  const justAdded = useRef('')
  const [additions, setAdditions] = useState(0)
  useEffect(() => {
    if (!justAdded.current) return
    const row = list.current?.querySelector(`[data-product="${justAdded.current}"]`)
    const target =
      row?.querySelector<HTMLButtonElement>('[data-more]:not(:disabled)') ??
      row?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    target?.focus()
  }, [additions])
  const onSale = products(state)
    .filter(sellable)
    .sort((a, b) => a.name.localeCompare(b.name))
  if (!onSale.length) return null
  const addable = onSale.filter(
    (p) => !items.some((item) => item.productId === p.id) && stock(state, p.id) > 0,
  )
  const words = query.trim().toLocaleLowerCase()
  const offered = words
    ? addable.filter((p) => p.name.toLocaleLowerCase().includes(words))
    : addable
  const set = (productId: string, quantity: number) =>
    onChange(
      quantity > 0
        ? items.map((item) => (item.productId === productId ? { ...item, quantity } : item))
        : items.filter((item) => item.productId !== productId),
    )
  function add(productId: string) {
    onChange([...items, { productId, quantity: 1 }])
    justAdded.current = productId
    setAdditions((n) => n + 1)
    setChoosing(false)
    setQuery('')
  }
  /** A scanned product: added, or one more, if the till would accept it. */
  function scanned(product: Product): ScanOutcome {
    const existing = items.find((item) => item.productId === product.id)
    if (!existing && items.length >= RETAIL_LINE_LIMIT)
      return { problem: `A receipt holds up to ${RETAIL_LINE_LIMIT} different products.` }
    if (existing && existing.quantity >= RETAIL_QUANTITY_LIMIT)
      return { problem: `A receipt holds up to ${RETAIL_QUANTITY_LIMIT} of one product.` }
    const quantity = (existing?.quantity ?? 0) + 1
    const next = existing
      ? items.map((item) => (item.productId === product.id ? { ...item, quantity } : item))
      : [...items, { productId: product.id, quantity }]
    try {
      priceRetail(state, next, locationId)
    } catch (problem) {
      return { problem: problem instanceof Error ? problem.message : 'Check the products.' }
    }
    onChange(next)
    setChoosing(false)
    return {
      done:
        quantity > 1
          ? `One more ${product.name}: ${quantity} on this receipt.`
          : `Added ${product.name}.`,
    }
  }
  return (
    <fieldset className="checkout-products" ref={list}>
      <legend>Products</legend>
      <ScanField onProduct={scanned} disabled={disabled} />
      {items.map((item) => {
        const product = onSale.find((p) => p.id === item.productId)
        if (!product) return null
        const left = stock(state, product.id)
        return (
          <div className="checkout-product" key={item.productId} data-product={product.id}>
            <ProductTile
              id={product.id}
              name={product.name}
              imageId={product.imageId}
              size="small"
            />
            <span className="checkout-product-name">
              {product.name}
              <small>
                {money(product.priceMinor, org, true)} each · {left} in stock
              </small>
            </span>
            <span className="checkout-product-quantity">
              <button
                type="button"
                aria-label={`One fewer ${product.name}`}
                disabled={disabled}
                onClick={() => set(product.id, item.quantity - 1)}
              >
                <Minus size={14} aria-hidden="true" />
              </button>
              <span aria-live="polite">{item.quantity}</span>
              <button
                type="button"
                data-more
                aria-label={`One more ${product.name}`}
                disabled={disabled || item.quantity >= Math.min(left, RETAIL_QUANTITY_LIMIT)}
                onClick={() => set(product.id, item.quantity + 1)}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            </span>
            <strong>{money(product.priceMinor * item.quantity, org, true)}</strong>
            <button
              type="button"
              className="checkout-product-remove"
              aria-label={`Remove ${product.name}`}
              disabled={disabled}
              onClick={() => set(product.id, 0)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )
      })}
      {addable.length > 0 && items.length < RETAIL_LINE_LIMIT && (
        <Popover.Root
          open={choosing}
          onOpenChange={(open) => {
            setChoosing(open)
            setQuery('')
            if (open) justAdded.current = ''
          }}
        >
          <Popover.Trigger asChild>
            <button type="button" className="checkout-product-add" disabled={disabled}>
              <Plus size={16} aria-hidden="true" />
              Add a product
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="product-picker"
              side="bottom"
              align="start"
              sideOffset={6}
              collisionPadding={8}
              aria-label="Add a product"
              onCloseAutoFocus={(event) => {
                // The product just added has the focus; it stays there rather than on this list's button.
                if (justAdded.current) event.preventDefault()
              }}
            >
              {addable.length > 6 && (
                <label className="product-picker-search">
                  <span className="sr-only">Find a product</span>
                  <input
                    type="search"
                    value={query}
                    placeholder="Find a product"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              )}
              <ul className="product-picker-list">
                {offered.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      className="product-picker-item"
                      onClick={() => add(product.id)}
                    >
                      <ProductTile id={product.id} name={product.name} imageId={product.imageId} />
                      <span className="product-picker-name">
                        {product.name}
                        <small>{stock(state, product.id)} in stock</small>
                      </span>
                      <strong>{money(product.priceMinor, org, true)}</strong>
                    </button>
                  </li>
                ))}
              </ul>
              {!offered.length && <p className="product-picker-none">No product by that name.</p>}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      {retail && retail.taxMinor > 0 && (
        <div className="receipt-line">
          <span>
            {retail.taxLabel || 'Tax'} on products {retail.taxInclusive ? '(included)' : ''}
          </span>
          <span>{money(retail.taxMinor, org, true)}</span>
        </div>
      )}
    </fieldset>
  )
}

/** The products on a finished receipt. */
export function ReceiptProducts({ retail }: { retail: SaleRetail }) {
  const { state } = useStore()
  const org = state.organisation
  return (
    <>
      {retail.lines.map((line) => (
        <div className="receipt-line" key={line.productId}>
          <span>
            {line.quantity > 1 ? `${line.quantity} × ` : ''}
            {line.name}
          </span>
          <span>{money(line.quantity * line.unitMinor, org, true)}</span>
        </div>
      ))}
      {retail.taxMinor > 0 && (
        <div className="receipt-line">
          <span>
            {retail.taxLabel || 'Tax'} on products {retail.taxInclusive ? '(included)' : ''}
          </span>
          <span>{money(retail.taxMinor, org, true)}</span>
        </div>
      )}
    </>
  )
}
