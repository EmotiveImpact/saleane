import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { PackageOpen, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { can, operations } from '../domain/operations'
import type { Command } from '../domain/commands'
import { dateLabel, money } from '../domain/format'
import { minorInput, parseMinor } from '../domain/money'
import { report } from '../domain/selectors'
import { sellable, stockSummary } from '../domain/retail'
import type { Product } from '../domain/retail'
import { CounterSales } from '../components/CounterSales'
import { SupplierOrders } from '../components/SupplierOrders'
import { suppliers } from '../domain/purchasing'
import { Button, Empty, ErrorMessage, Modal, PageHeader, SegmentedControl } from '../design'
import '../components/management.css'
import '../stock.css'

/**
 * V2: the studio's shelf. Products sold at the till and products used in treatments, what is left
 * of each, what needs reordering, and every delivery, use, sale and count that changed it.
 * Owners and managers record deliveries and counts; everyone at the desk can see what is in stock.
 */
type Filter = 'all' | 'sale' | 'treatments' | 'low'
type MovementKind = 'received' | 'consumed' | 'count'
type ProductForm = {
  name: string
  sku: string
  price: string
  cost: string
  reorderAt: number
  forSale: boolean
  archived: boolean
  supplierId: string
  reorderQuantity: string
}

const MOVEMENT_COPY: Record<MovementKind, { title: string; field: string; note: string }> = {
  received: { title: 'Record a delivery', field: 'How many arrived', note: 'Delivery' },
  consumed: {
    title: 'Record use in treatments',
    field: 'How many were used',
    note: 'Used in treatments',
  },
  count: {
    title: 'Correct the count',
    field: 'How many are on the shelf now',
    note: 'Shelf count',
  },
}
const REASON_LABEL = {
  received: 'Delivery',
  consumed: 'Used in treatment',
  retail: 'Sold',
  adjustment: 'Count corrected',
  returned: 'Brought back',
} as const

function useRun() {
  const { commit } = useStore()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function run(command: Command) {
    if (pending) return false
    setPending(true)
    setError('')
    try {
      const result = await commit(command)
      if (!result.ok) setError(result.error)
      return result.ok
    } catch {
      setError('This could not be saved. Your entries are still here; try again.')
      return false
    } finally {
      setPending(false)
    }
  }
  return { run, pending, error, setError }
}

export function Stock() {
  const { state, role, blocked } = useStore()
  const org = state.organisation
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<{ id?: string; form: ProductForm } | null>(null)
  const [moving, setMoving] = useState<{ product: Product; kind: MovementKind } | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const { run, pending, error, setError } = useRun()
  const canStock = !blocked && can(role, 'stock')
  const canEdit = !blocked && can(role, 'product')
  // Costs and stock value are for owners and managers, like the rest of the business figures.
  const seesCost = can(role, 'product')
  const rows = stockSummary(state)
  const active = rows.filter((row) => !row.product.archived)
  const low = active.filter((row) => row.low)
  const sold = report(state, 30)
  const value = active.reduce((sum, row) => sum + Math.max(0, row.valueMinor ?? 0), 0)
  const shown = rows
    .filter((row) =>
      filter === 'sale'
        ? sellable(row.product)
        : filter === 'treatments'
          ? !row.product.archived && row.product.forSale === false
          : filter === 'low'
            ? row.low
            : true,
    )
    .sort(
      (a, b) =>
        Number(a.product.archived ?? false) - Number(b.product.archived ?? false) ||
        a.product.name.localeCompare(b.product.name),
    )
  const productName = (id: string) => rows.find((r) => r.product.id === id)?.product.name ?? ''
  const history = [...operations(state).movements]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12)

  function openProduct(product?: Product) {
    setEditing({
      id: product?.id,
      form: product
        ? {
            name: product.name,
            sku: product.sku,
            price: minorInput(product.priceMinor),
            cost: product.costMinor === undefined ? '' : minorInput(product.costMinor),
            reorderAt: product.reorderAt,
            forSale: product.forSale !== false,
            archived: product.archived,
            supplierId: product.supplierId ?? '',
            reorderQuantity:
              product.reorderQuantity === undefined ? '' : String(product.reorderQuantity),
          }
        : {
            name: '',
            sku: '',
            price: '',
            cost: '',
            reorderAt: 2,
            forSale: true,
            archived: false,
            supplierId: '',
            reorderQuantity: '',
          },
    })
    setError('')
  }
  function change(patch: Partial<ProductForm>) {
    setEditing((current) => current && { ...current, form: { ...current.form, ...patch } })
  }
  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    const form = editing.form
    const priceMinor = form.forSale ? parseMinor(form.price) : parseMinor(form.price, 0)
    const costMinor = parseMinor(form.cost, -1)
    if (!Number.isFinite(priceMinor) || (form.forSale && priceMinor <= 0)) {
      setError('Enter the price guests pay, with up to two decimal places.')
      return
    }
    if (!Number.isFinite(costMinor)) {
      setError('Enter what you pay the supplier, with up to two decimal places, or leave it empty.')
      return
    }
    const reorderQuantity = form.reorderQuantity.trim() ? Number(form.reorderQuantity) : undefined
    if (
      reorderQuantity !== undefined &&
      (!Number.isInteger(reorderQuantity) || reorderQuantity < 1)
    ) {
      setError('Enter how many you usually order as a whole number, or leave it empty.')
      return
    }
    const input = {
      name: form.name.trim(),
      sku: form.sku.trim(),
      priceMinor,
      reorderAt: form.reorderAt,
      archived: form.archived,
      forSale: form.forSale,
      ...(costMinor >= 0 ? { costMinor } : {}),
      ...(form.supplierId ? { supplierId: form.supplierId } : {}),
      ...(reorderQuantity !== undefined ? { reorderQuantity } : {}),
    }
    if (await run({ type: 'product', ...(editing.id ? { id: editing.id } : {}), input }))
      setEditing(null)
  }
  function openMovement(product: Product, kind: MovementKind) {
    setMoving({ product, kind })
    setAmount('')
    setNote(MOVEMENT_COPY[kind].note)
    setError('')
  }
  async function saveMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!moving) return
    const count = Number(amount)
    if (!amount.trim() || !Number.isInteger(count) || count < 0) {
      setError('Enter a whole number.')
      return
    }
    const onHand = rows.find((r) => r.product.id === moving.product.id)?.onHand ?? 0
    const quantity =
      moving.kind === 'received' ? count : moving.kind === 'consumed' ? -count : count - onHand
    if (quantity === 0) {
      setError(
        moving.kind === 'count'
          ? 'The count already matches. Nothing needs changing.'
          : 'Enter a number above zero.',
      )
      return
    }
    if (
      await run({
        type: 'stock',
        productId: moving.product.id,
        quantity,
        reason: moving.kind === 'count' ? 'adjustment' : moving.kind,
        note: note.trim(),
      })
    )
      setMoving(null)
  }

  const form = editing?.form
  const onHandNow = moving ? (rows.find((r) => r.product.id === moving.product.id)?.onHand ?? 0) : 0
  return (
    <div className="stock-page">
      <PageHeader
        variant="compact"
        title="What is on the shelf."
        description="Products you sell at the till and the ones you use in treatments. Selling a product at checkout takes it out of stock for you."
        actions={
          canEdit ? (
            <Button onClick={() => openProduct()}>
              <Plus size={16} aria-hidden="true" /> Add a product
            </Button>
          ) : undefined
        }
      />
      <dl className="stock-totals">
        <div>
          <dt>Products for sale</dt>
          <dd>{active.filter((row) => sellable(row.product)).length}</dd>
        </div>
        <div>
          <dt>Running low</dt>
          <dd>{low.length}</dd>
        </div>
        <div>
          <dt>Sold in the last 30 days</dt>
          <dd>
            {money(sold.retail, org)}
            <small>Before tax, with visits</small>
          </dd>
        </div>
        {seesCost && (
          <div>
            <dt>Stock value at cost</dt>
            <dd>
              {money(value, org)}
              <small>Products with a cost price</small>
            </dd>
          </div>
        )}
      </dl>
      {low.length > 0 && (
        <section className="stock-reorder" aria-labelledby="reorder-heading">
          <h2 id="reorder-heading">Time to reorder</h2>
          <p>{low.map((row) => `${row.product.name} (${row.onHand} left)`).join(', ')}.</p>
        </section>
      )}
      <CounterSales />
      <section className="surface ops-panel" aria-labelledby="products-heading">
        <header>
          <div>
            <h2 id="products-heading">Products</h2>
            <p>
              {canStock
                ? 'Record deliveries as they arrive and correct the count after a shelf check. Every change is kept.'
                : 'What is in stock now. An owner or manager records deliveries and counts.'}
            </p>
          </div>
          <PackageOpen size={21} aria-hidden="true" />
        </header>
        <SegmentedControl
          label="Show"
          className="ops-switch"
          value={filter}
          onChange={(value) => setFilter(value)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'sale', label: 'For sale' },
            { value: 'treatments', label: 'In treatments' },
            { value: 'low', label: `Low (${low.length})` },
          ]}
        />
        {shown.length ? (
          <div className="ops-ledger">
            {shown.map(({ product, onHand, low: isLow, valueMinor }) => (
              <div className="ops-record stock-record" key={product.id}>
                <div className="ops-record-copy">
                  <strong>{product.name}</strong>
                  <small>
                    {product.forSale === false
                      ? 'Used in treatments'
                      : `Sold at ${money(product.priceMinor, org, true)}`}
                    {product.sku ? ` · ${product.sku}` : ''}
                    {` · reorder at ${product.reorderAt}`}
                    {seesCost && valueMinor !== undefined
                      ? ` · ${money(valueMinor, org, true)} at cost`
                      : ''}
                  </small>
                </div>
                {product.archived ? (
                  <span className="ops-tag">No longer stocked</span>
                ) : (
                  isLow && <span className="ops-tag stock-low">Running low</span>
                )}
                <span className="stock-count" aria-label={`${onHand} in stock`}>
                  {onHand}
                  <small>in stock</small>
                </span>
                {(canStock || canEdit) && (
                  <div className="stock-actions">
                    {canStock && !product.archived && (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => openMovement(product, 'received')}
                        >
                          Delivery
                        </Button>
                        <Button variant="quiet" onClick={() => openMovement(product, 'consumed')}>
                          Used
                        </Button>
                        <Button variant="quiet" onClick={() => openMovement(product, 'count')}>
                          Count
                        </Button>
                      </>
                    )}
                    {canEdit && (
                      <Button
                        variant="quiet"
                        aria-label={`Edit ${product.name}`}
                        onClick={() => openProduct(product)}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : rows.length ? (
          <p className="ops-help">Nothing matches. Choose All to see every product.</p>
        ) : (
          <Empty title="Your shelf starts here.">
            Add the products you sell and the ones you use in treatments. Then record the delivery
            so the count is right.
          </Empty>
        )}
      </section>
      <SupplierOrders />
      {history.length > 0 && (
        <section className="surface ops-panel" aria-labelledby="history-heading">
          <header>
            <div>
              <h2 id="history-heading">Recent changes</h2>
              <p>The latest deliveries, uses, sales and counts. Nothing here is ever deleted.</p>
            </div>
          </header>
          <ul className="stock-history">
            {history.map((movement) => (
              <li key={movement.id}>
                <span className="stock-history-copy">
                  <strong>
                    {REASON_LABEL[movement.reason]}: {productName(movement.productId)}
                  </strong>
                  <small>
                    {dateLabel(movement.createdAt.slice(0, 10), org.locale)} · {movement.actor}
                    {movement.note ? ` · ${movement.note}` : ''}
                    {movement.appointmentId &&
                    state.appointments.some((a) => a.id === movement.appointmentId) ? (
                      <>
                        {' · '}
                        <Link
                          to={`/clients/${state.appointments.find((a) => a.id === movement.appointmentId)!.clientId}`}
                        >
                          {state.clients.find(
                            (c) =>
                              c.id ===
                              state.appointments.find((a) => a.id === movement.appointmentId)!
                                .clientId,
                          )?.name ?? 'Client'}
                        </Link>
                      </>
                    ) : null}
                  </small>
                </span>
                <span className="stock-change">
                  {movement.quantity > 0 ? `+${movement.quantity}` : `−${-movement.quantity}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {editing && form && (
        <Modal
          open
          onClose={() => {
            if (!pending) setEditing(null)
          }}
          title={editing.id ? `Edit ${form.name || 'product'}` : 'Add a product'}
          description="Prices include tax the same way your services do. A price change applies to future sales only."
        >
          <form onSubmit={saveProduct} className="plan-form">
            <div className="ops-fields">
              <label className="ops-wide">
                Name
                <input
                  value={form.name}
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="Hydrating Serum"
                  onChange={(e) => change({ name: e.target.value })}
                />
              </label>
              <label className="ops-check ops-wide">
                <input
                  type="checkbox"
                  checked={form.forSale}
                  onChange={(e) => change({ forSale: e.target.checked })}
                />
                Sold at the till (leave unticked for products only used in treatments)
              </label>
              {form.forSale && (
                <label>
                  Price ({org.currency})
                  <input
                    inputMode="decimal"
                    value={form.price}
                    required
                    onChange={(e) => change({ price: e.target.value })}
                  />
                </label>
              )}
              <label>
                What you pay for one ({org.currency})
                <input
                  inputMode="decimal"
                  value={form.cost}
                  onChange={(e) => change({ cost: e.target.value })}
                />
                <small>Optional. Used for stock value; guests never see it.</small>
              </label>
              <label>
                Reorder when down to
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={form.reorderAt}
                  onChange={(e) => change({ reorderAt: Number(e.target.value) })}
                />
              </label>
              <label>
                Usually order
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={form.reorderQuantity}
                  onChange={(e) => change({ reorderQuantity: e.target.value })}
                />
                <small>Optional. Suggested on new orders.</small>
              </label>
              <label>
                Supplier
                <select
                  value={form.supplierId}
                  onChange={(e) => change({ supplierId: e.target.value })}
                >
                  <option value="">None yet</option>
                  {suppliers(state)
                    .filter((x) => !x.archived || x.id === form.supplierId)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Code or SKU
                <input
                  value={form.sku}
                  maxLength={50}
                  onChange={(e) => change({ sku: e.target.value })}
                />
                <small>Optional.</small>
              </label>
              {editing.id && (
                <label className="ops-check ops-wide">
                  <input
                    type="checkbox"
                    checked={form.archived}
                    onChange={(e) => change({ archived: e.target.checked })}
                  />
                  No longer stocked (its history stays)
                </label>
              )}
            </div>
            <ErrorMessage error={error} />
            <div className="ops-actions">
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {moving && (
        <Modal
          open
          onClose={() => {
            if (!pending) setMoving(null)
          }}
          title={MOVEMENT_COPY[moving.kind].title}
          description={`${moving.product.name}. ${onHandNow} in stock now.`}
        >
          <form onSubmit={saveMovement} className="plan-form">
            <div className="ops-fields">
              <label>
                {MOVEMENT_COPY[moving.kind].field}
                <input
                  type="number"
                  min={0}
                  max={100000}
                  autoFocus
                  value={amount}
                  required
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Note
                <input
                  value={note}
                  required
                  minLength={2}
                  maxLength={300}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </div>
            {moving.kind === 'count' &&
              amount.trim() !== '' &&
              Number.isInteger(Number(amount)) && (
                <p className="ops-help">
                  {Number(amount) === onHandNow
                    ? 'This matches the records.'
                    : `This records ${Math.abs(Number(amount) - onHandNow)} ${
                        Number(amount) > onHandNow ? 'more' : 'fewer'
                      } than the records show.`}
                </p>
              )}
            <ErrorMessage error={error} />
            <div className="ops-actions">
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => setMoving(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
