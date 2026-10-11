import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown, PackageOpen, Plus } from 'lucide-react'
import { useStore } from '../state/context'
import { can, operations, stock } from '../domain/operations'
import { hasLocations, placeOf, places } from '../domain/locations'
import type { Command } from '../domain/commands'
import { dateLabel, money } from '../domain/format'
import { minorInput, parseMinor } from '../domain/money'
import { report } from '../domain/selectors'
import { sellable, stockSummary } from '../domain/retail'
import type { Product } from '../domain/retail'
import { CounterSales } from '../components/CounterSales'
import { SupplierOrders } from '../components/SupplierOrders'
import { suppliers } from '../domain/purchasing'
import {
  Button,
  Empty,
  ErrorMessage,
  Menu,
  MenuItem,
  Modal,
  PageHeader,
  SegmentedControl,
  Select,
  Checkbox,
  notify,
  photos,
} from '../design'
import { ProductTile } from '../components/ProductTile'
import { ProductPhotoField } from '../components/ProductPhotoField'
import { ScanField } from '../components/ScanField'
import type { ScanOutcome } from '../components/ScanField'
import { CameraScanButton } from '../components/CameraScan'
import { useBarcodeScan } from '../components/barcodeScan'
import { checkBarcode, normaliseBarcode, productWithBarcode } from '../domain/barcode'
import '../components/management.css'
import '../stock.css'

/**
 * V2: the studio's shelf. Products sold at the till and products used in treatments, what is left
 * of each, what needs reordering, and every delivery, use, sale and count that changed it.
 * Owners and managers record deliveries and counts; everyone at the desk can see what is in stock.
 */
type Filter = 'all' | 'sale' | 'treatments' | 'low'
type MovementKind = 'received' | 'consumed' | 'count' | 'move'
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
  /** Stage 2: the printed barcode, and the photo's id ('' for none). */
  barcode: string
  imageId: string
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
  move: {
    title: 'Move to another location',
    field: 'How many to move',
    note: '',
  },
}
const REASON_LABEL = {
  received: 'Delivery',
  consumed: 'Used in treatment',
  retail: 'Sold',
  adjustment: 'Count corrected',
  returned: 'Brought back',
  moved: 'Moved',
} as const

/**
 * A product's actions: the one most often needed (a delivery) stays on the row, and the rest wait
 * in one calm menu, so a long shelf reads as products rather than as rows of buttons.
 */
function ShelfActions({
  product,
  actions,
}: {
  product: Product
  actions: { label: string; run: () => void }[]
}) {
  const [first, ...rest] = actions
  if (!first) return null
  return (
    <div
      className="shelf-actions"
      role="group"
      aria-label={`Stock and details for ${product.name}`}
    >
      <Button
        variant="quiet"
        aria-label={first.label === 'Edit details' ? `Edit ${product.name}` : undefined}
        onClick={first.run}
      >
        {first.label}
      </Button>
      {rest.length > 0 && (
        <Menu
          label={`More for ${product.name}`}
          trigger={
            <Button variant="quiet" className="shelf-more" aria-label={`More for ${product.name}`}>
              More
              <ChevronDown size={14} aria-hidden="true" />
            </Button>
          }
        >
          {rest.map((action) => (
            <MenuItem key={action.label} onSelect={action.run}>
              {action.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  )
}

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

/** A new product's form, with a barcode when one was scanned. */
const blankForm = (barcode = ''): ProductForm => ({
  name: '',
  sku: '',
  price: '',
  cost: '',
  reorderAt: 2,
  forSale: true,
  archived: false,
  supplierId: '',
  reorderQuantity: '',
  barcode,
  imageId: '',
})

export function Stock() {
  const { state, role, blocked, branch, mode } = useStore()
  const org = state.organisation
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<{ id?: string; form: ProductForm } | null>(null)
  // Stage 2: "It is a new product" from a scan at the till arrives here with its barcode, and
  // opens a new product with it, also when this page was already open under the till.
  const [params, setParams] = useSearchParams()
  const arrived = params.get('new-barcode')
  const [arrival, setArrival] = useState<string | null>(null)
  // The product form's less often changed fields, tucked away until wanted or holding news.
  const [showMore, setShowMore] = useState(false)
  if (arrived !== arrival) {
    setArrival(arrived)
    if (arrived && !blocked && can(role, 'product')) {
      setEditing({ form: blankForm(normaliseBarcode(arrived).slice(0, 60)) })
      setShowMore(true)
    }
  }
  useEffect(() => {
    if (arrived) setParams({}, { replace: true })
  }, [arrived, setParams])
  // Stage 2: a product found by its barcode is shown in the list, and uploading a photo holds Save.
  const [found, setFound] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const productForm = useRef<HTMLFormElement | null>(null)
  const [moving, setMoving] = useState<{ product: Product; kind: MovementKind } | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  // V2: with several locations, the shelf is shown for one location or all of them together.
  const multiSite = hasLocations(state)
  const sites = places(state)
  const [where, setWhere] = useState(branch ?? 'all')
  const place = multiSite && where !== 'all' ? where : undefined
  const [at, setAt] = useState(org.locationId)
  const [to, setTo] = useState('')
  const { run, pending, error, setError } = useRun()
  const canStock = !blocked && can(role, 'stock')
  const canEdit = !blocked && can(role, 'product')
  // Costs and stock value are for owners and managers, like the rest of the business figures.
  const seesCost = can(role, 'product')
  const rows = stockSummary(state, place)
  /** "Marylebone 3 · Islington 2", for the all-locations view. */
  const split = (productId: string) =>
    sites.map((site) => `${site.name} ${stock(state, productId, site.id)}`).join(' · ')
  const active = rows.filter((row) => !row.product.archived)
  const low = active.filter((row) => row.low)
  const sold = report(state, 30, place)
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

  function openProduct(product?: Product, barcode = '') {
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
            barcode: product.barcode ?? '',
            imageId: product.imageId ?? '',
          }
        : blankForm(barcode),
    })
    setShowMore(!!barcode)
    setPhotoBusy(false)
    setError('')
  }
  /**
   * Stage 2: a product scanned on this page is shown in the list; someone who may edit products
   * has it opened, as it would open from its Edit button.
   */
  function scanned(product: Product): ScanOutcome {
    const onHand = stock(state, product.id, place)
    setFilter('all')
    setFound(product.id)
    if (canEdit) {
      openProduct(product)
      return { done: `Opened ${product.name}.` }
    }
    // Show it once the list has drawn it, after the filter change.
    setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-shelf-product="${product.id}"]`)
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      row?.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' })
      row?.focus({ preventScroll: true })
    })
    return {
      done: `${product.name}: ${onHand} in stock${place ? ` at ${placeName(place)}` : ''}.`,
    }
  }
  function change(patch: Partial<ProductForm>) {
    setEditing((current) => current && { ...current, form: { ...current.form, ...patch } })
  }
  /** What the product form's tucked-away fields hold, shown on their line while it is closed. */
  function moreSummary(form: ProductForm) {
    const supplier = suppliers(state).find((x) => x.id === form.supplierId)
    return [
      form.barcode.trim() && `Barcode ${normaliseBarcode(form.barcode)}`,
      form.sku.trim() && `Code ${form.sku.trim()}`,
      supplier && `From ${supplier.name}`,
      form.reorderQuantity.trim() && `Usually order ${form.reorderQuantity.trim()}`,
    ]
      .filter(Boolean)
      .join(' · ')
  }
  /** Stage 2: a scan while the product form is open puts the code in its barcode field. */
  function scannedIntoForm(code: string) {
    const typed = normaliseBarcode(code)
    change({ barcode: typed })
    setShowMore(true)
    const holder = productWithBarcode(
      rows.map((r) => r.product),
      typed,
      editing?.id,
    )
    setError(holder ? `${holder.name} already has barcode ${holder.barcode}.` : '')
  }
  useBarcodeScan(scannedIntoForm, productForm, !!editing)
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
      setShowMore(true)
      return
    }
    // Stage 2: the server checks the barcode too; saying so here saves a round trip.
    const barcode = normaliseBarcode(form.barcode)
    if (barcode) {
      const checked = checkBarcode(barcode)
      if (!checked.ok) {
        setError(checked.error)
        setShowMore(true)
        return
      }
      const holder = productWithBarcode(
        rows.map((r) => r.product),
        barcode,
        editing.id,
      )
      if (holder) {
        setError(
          `${holder.name} already has barcode ${holder.barcode}. Each barcode belongs to one product.`,
        )
        setShowMore(true)
        return
      }
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
      ...(barcode ? { barcode } : {}),
      ...(form.imageId ? { imageId: form.imageId } : {}),
    }
    if (await run({ type: 'product', ...(editing.id ? { id: editing.id } : {}), input }))
      setEditing(null)
    // A refusal may be about a tucked-away field, so they are shown with it.
    else if (moreSummary(form)) setShowMore(true)
  }
  function openMovement(product: Product, kind: MovementKind) {
    const from = place ?? org.locationId
    setAt(from)
    setTo(sites.find((site) => site.id !== from)?.id ?? '')
    setMoving({ product, kind })
    setAmount('')
    setNote(MOVEMENT_COPY[kind].note)
    setError('')
  }
  /** Stage 2: in a delivery, a count, a use or a move, each scan of the product adds one. */
  function scannedForMovement(product: Product): ScanOutcome {
    if (!moving) return { problem: 'Choose a product first.' }
    if (product.id !== moving.product.id)
      return { problem: `That is ${product.name}. This is for ${moving.product.name}.` }
    const before = Number(amount)
    const next = (amount.trim() && Number.isInteger(before) && before >= 0 ? before : 0) + 1
    setAmount(String(next))
    setError('')
    return { done: `${next} ${moving.kind === 'count' ? 'counted' : 'so far'}.` }
  }
  async function saveMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!moving) return
    const count = Number(amount)
    if (!amount.trim() || !Number.isInteger(count) || count < 0) {
      setError('Enter a whole number.')
      return
    }
    if (moving.kind === 'move') {
      if (count < 1) {
        setError('Enter a number above zero.')
        return
      }
      if (
        await run({
          type: 'stock-move',
          productId: moving.product.id,
          from: at,
          to,
          quantity: count,
          ...(note.trim() ? { note: note.trim() } : {}),
        })
      ) {
        setMoving(null)
        notify(`Moved ${count} ${moving.product.name} to ${placeName(to)}.`)
      }
      return
    }
    const onHand = stock(state, moving.product.id, at)
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
        ...(at !== org.locationId ? { locationId: at } : {}),
      })
    ) {
      setMoving(null)
      // The dialog closes as it saves, so a notice says what was recorded and what is left.
      const now = onHand + quantity
      notify(
        `${moving.kind === 'received' ? `Delivery of ${count}` : moving.kind === 'consumed' ? `${count} used` : 'Count'} recorded for ${moving.product.name}. ${now} in stock${multiSite ? ` at ${placeName(at)}` : ''}.`,
      )
    }
  }

  const form = editing?.form
  // A studio with nothing on the shelf yet sees one welcoming page, not figures at zero.
  const first = !rows.length && !history.length
  const onHandNow = moving ? stock(state, moving.product.id, at) : 0
  const placeName = (id?: string) => placeOf(state, id)?.name ?? ''
  return (
    <div className="stock-page">
      {first ? (
        <Empty
          photo={photos.stock}
          photoPosition="62% center"
          eyebrow="Business"
          level={1}
          title="Your shelf starts here."
          action={
            canEdit ? (
              <Button onClick={() => openProduct()}>
                <Plus size={16} aria-hidden="true" /> Add your first product
              </Button>
            ) : undefined
          }
        >
          Add the products you sell and the ones you use in treatments. Then record the delivery so
          the count is right.
        </Empty>
      ) : (
        <>
          <PageHeader
            variant="compact"
            eyebrow="Business"
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
            <div className="stock-scan">
              <ScanField
                action="Find"
                onProduct={scanned}
                onNewProduct={canEdit ? (code) => openProduct(undefined, code) : undefined}
                hint={
                  canEdit
                    ? 'Scan anywhere on this page to open a product. Scanning in a delivery or a count adds one.'
                    : 'Scan anywhere on this page to find a product.'
                }
              />
            </div>
            {multiSite && (
              <label className="stock-where">
                Location
                <Select value={where} onChange={(e) => setWhere(e.target.value)}>
                  <option value="all">All locations</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
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
                {shown.map(({ product, onHand, low: isLow, valueMinor }) => {
                  const treatment = product.forSale === false
                  // How full the shelf is against three times the reorder point; the count says it.
                  const fullness = Math.min(1, onHand / Math.max(1, product.reorderAt * 3))
                  return (
                    <div
                      className={`shelf-record ${isLow && !product.archived ? 'is-low' : ''} ${found === product.id ? 'is-found' : ''}`}
                      key={product.id}
                      data-shelf-product={product.id}
                      tabIndex={found === product.id ? -1 : undefined}
                    >
                      <ProductTile id={product.id} name={product.name} imageId={product.imageId} />
                      <div className="shelf-record-copy">
                        <strong>{product.name}</strong>
                        <span className="shelf-record-meta">
                          <span className={`shelf-kind ${treatment ? 'is-treatment' : ''}`}>
                            {treatment ? 'Used in treatments' : 'For sale'}
                          </span>
                          <small>
                            {treatment ? '' : `${money(product.priceMinor, org, true)} · `}
                            {product.sku ? `${product.sku} · ` : ''}
                            {product.barcode ? `barcode ${product.barcode} · ` : ''}
                            {`reorder at ${product.reorderAt}`}
                            {seesCost && valueMinor !== undefined
                              ? ` · ${money(valueMinor, org, true)} at cost`
                              : ''}
                            {multiSite && !place ? ` · ${split(product.id)}` : ''}
                          </small>
                        </span>
                      </div>
                      <div className="shelf-level">
                        <span
                          className="shelf-count"
                          aria-label={`${onHand} in stock${place ? ` at ${placeName(place)}` : ''}`}
                        >
                          {onHand}
                          <small>{place ? `at ${placeName(place)}` : 'in stock'}</small>
                        </span>
                        <span className="shelf-meter" aria-hidden="true">
                          <span style={{ width: `${Math.round(fullness * 100)}%` }} />
                        </span>
                        {product.archived ? (
                          <span className="ops-tag">No longer stocked</span>
                        ) : (
                          isLow && <span className="ops-tag stock-low">Running low</span>
                        )}
                      </div>
                      {(canStock || canEdit) && (
                        <ShelfActions
                          product={product}
                          actions={[
                            ...(canStock && !product.archived
                              ? [
                                  {
                                    label: 'Delivery',
                                    run: () => openMovement(product, 'received'),
                                  },
                                  {
                                    label: 'Used in treatments',
                                    run: () => openMovement(product, 'consumed'),
                                  },
                                  {
                                    label: 'Correct the count',
                                    run: () => openMovement(product, 'count'),
                                  },
                                  ...(multiSite
                                    ? [
                                        {
                                          label: 'Move to another location',
                                          run: () => openMovement(product, 'move'),
                                        },
                                      ]
                                    : []),
                                ]
                              : []),
                            ...(canEdit
                              ? [{ label: 'Edit details', run: () => openProduct(product) }]
                              : []),
                          ]}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            ) : rows.length ? (
              <p className="ops-help">Nothing matches. Choose All to see every product.</p>
            ) : (
              <Empty title="Your shelf starts here.">
                Add the products you sell and the ones you use in treatments. Then record the
                delivery so the count is right.
              </Empty>
            )}
          </section>
          <SupplierOrders />
          {history.length > 0 && (
            <section className="surface ops-panel" aria-labelledby="history-heading">
              <header>
                <div>
                  <h2 id="history-heading">Recent changes</h2>
                  <p>
                    The latest deliveries, uses, sales and counts. Nothing here is ever deleted.
                  </p>
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
                        {multiSite ? ` · ${placeName(movement.locationId)}` : ''}
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
        </>
      )}
      {editing && form && (
        <Modal
          open
          onClose={() => {
            if (!pending) setEditing(null)
          }}
          title={editing.id ? `Edit ${form.name || 'product'}` : 'Add a product'}
          description="Prices include tax the same way your treatments do. A price change applies to future sales only."
        >
          <form onSubmit={saveProduct} className="plan-form" ref={productForm}>
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
              {/* After the name, so the form still opens with the name field ready to type in. */}
              {mode === 'server' && (
                <ProductPhotoField
                  productId={editing.id}
                  name={form.name}
                  imageId={form.imageId}
                  disabled={pending}
                  onChange={(imageId) => change({ imageId })}
                  onBusy={setPhotoBusy}
                />
              )}
              <label className="ops-check ops-wide">
                <Checkbox
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
              {/* Less often changed: tucked away, with what they hold shown on the line. */}
              <details
                className="stock-more ops-wide"
                open={showMore}
                onToggle={(e) => setShowMore(e.currentTarget.open)}
              >
                <summary>
                  <span>
                    Barcode, code and supplier
                    <small>
                      {moreSummary(form) ||
                        'Optional. Scanning the product while this form is open adds its barcode.'}
                    </small>
                  </span>
                </summary>
                <div className="ops-fields">
                  <div className="ops-field stock-barcode">
                    <label htmlFor="product-barcode">Barcode</label>
                    <input
                      id="product-barcode"
                      data-scan-field
                      value={form.barcode}
                      maxLength={60}
                      autoComplete="off"
                      spellCheck={false}
                      inputMode="text"
                      aria-describedby="product-barcode-hint"
                      onChange={(e) => change({ barcode: e.target.value })}
                      onKeyDown={(e) => {
                        // A scanner ends with Enter: keep the code here rather than saving the form.
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        scannedIntoForm(form.barcode)
                      }}
                    />
                    <small id="product-barcode-hint">
                      Optional. Scan the product anywhere in this form, or type the numbers under
                      the bars.
                    </small>
                    <CameraScanButton onCode={scannedIntoForm} disabled={pending} />
                  </div>
                  <label>
                    Code or SKU
                    <input
                      value={form.sku}
                      maxLength={50}
                      onChange={(e) => change({ sku: e.target.value })}
                    />
                    <small>Optional.</small>
                  </label>
                  <label>
                    Supplier
                    <Select
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
                    </Select>
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
                </div>
              </details>
              {editing.id && (
                <label className="ops-check ops-wide">
                  <Checkbox
                    checked={form.archived}
                    onChange={(e) => change({ archived: e.target.checked })}
                  />
                  No longer stocked (its history stays)
                </label>
              )}
            </div>
            <ErrorMessage error={error} />
            <div className="ops-actions">
              <Button type="submit" disabled={pending || photoBusy}>
                {pending ? 'Saving…' : photoBusy ? 'Adding the photo…' : 'Save'}
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
          description={`${moving.product.name}. ${onHandNow} in stock${multiSite ? ` at ${placeName(at)}` : ''} now.`}
        >
          <form onSubmit={saveMovement} className="plan-form">
            <div className="ops-fields">
              {multiSite && (
                <label>
                  {moving.kind === 'move' ? 'From' : 'Location'}
                  <Select
                    value={at}
                    onChange={(e) => {
                      setAt(e.target.value)
                      if (e.target.value === to)
                        setTo(sites.find((site) => site.id !== e.target.value)?.id ?? '')
                    }}
                  >
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name} ({stock(state, moving.product.id, site.id)})
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {moving.kind === 'move' && (
                <label>
                  To
                  <Select value={to} onChange={(e) => setTo(e.target.value)}>
                    {sites
                      .filter((site) => site.id !== at)
                      .map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name}
                        </option>
                      ))}
                  </Select>
                </label>
              )}
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
                  required={moving.kind !== 'move'}
                  minLength={moving.kind === 'move' ? undefined : 2}
                  maxLength={300}
                  placeholder={moving.kind === 'move' ? 'Optional' : undefined}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <div className="ops-wide">
                <ScanField
                  action="Add one"
                  onProduct={scannedForMovement}
                  disabled={pending}
                  hint={`Each scan of ${moving.product.name} adds one.`}
                />
              </div>
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
