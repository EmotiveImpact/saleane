import { Minus, Plus, X } from 'lucide-react'
import { useStore } from '../state/context'
import { stock } from '../domain/operations'
import { money } from '../domain/format'
import { products, sellable } from '../domain/retail'
import type { RetailItems, SaleRetail } from '../domain/retailSchema'
import { RETAIL_LINE_LIMIT, RETAIL_QUANTITY_LIMIT } from '../domain/retailSchema'
import './checkout-products.css'

/**
 * V2: products a guest buys with their visit. The desk picks from what is on sale and in stock;
 * the receipt keeps each product's name and price as they were at the moment of sale.
 */
export function CheckoutProducts({
  items,
  retail,
  disabled,
  onChange,
}: {
  items: RetailItems
  retail: SaleRetail | undefined
  disabled: boolean
  onChange: (items: RetailItems) => void
}) {
  const { state } = useStore()
  const org = state.organisation
  const onSale = products(state)
    .filter(sellable)
    .sort((a, b) => a.name.localeCompare(b.name))
  if (!onSale.length) return null
  const addable = onSale.filter(
    (p) => !items.some((item) => item.productId === p.id) && stock(state, p.id) > 0,
  )
  const set = (productId: string, quantity: number) =>
    onChange(
      quantity > 0
        ? items.map((item) => (item.productId === productId ? { ...item, quantity } : item))
        : items.filter((item) => item.productId !== productId),
    )
  return (
    <fieldset className="checkout-products">
      <legend>Products</legend>
      {items.map((item) => {
        const product = onSale.find((p) => p.id === item.productId)
        if (!product) return null
        const left = stock(state, product.id)
        return (
          <div className="checkout-product" key={item.productId}>
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
        <label className="checkout-product-add">
          <span className="sr-only">Add a product</span>
          <select
            value=""
            disabled={disabled}
            onChange={(event) => {
              if (event.target.value)
                onChange([...items, { productId: event.target.value, quantity: 1 }])
            }}
          >
            <option value="">Add a product…</option>
            {addable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {money(p.priceMinor, org, true)}
              </option>
            ))}
          </select>
        </label>
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
