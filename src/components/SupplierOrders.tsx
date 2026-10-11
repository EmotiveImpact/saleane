import { useState } from 'react'
import type { FormEvent } from 'react'
import { Copy, Plus, Truck } from 'lucide-react'
import { useStore } from '../state/context'
import { can, operations } from '../domain/operations'
import type { Command } from '../domain/commands'
import { dateLabel } from '../domain/format'
import { orderText, suggestedOrders, suppliers } from '../domain/purchasing'
import type { PurchaseOrder, Supplier } from '../domain/purchasingSchema'
import { ORDER_LINE_LIMIT } from '../domain/purchasingSchema'
import { products } from '../domain/retail'
import type { Product } from '../domain/retail'
import { ScanField } from './ScanField'
import type { ScanOutcome } from './ScanField'
import { hasLocations, placeOf, places } from '../domain/locations'
import { Button, ErrorMessage, Modal, Select } from '../design'

/**
 * V2: reordering from suppliers. Suggested orders for low stock, orders the studio has placed and
 * their deliveries, and the supplier list. SALEANE never sends an order to a supplier.
 */
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

type Line = { productId: string; quantity: number }

export function SupplierOrders() {
  const { state, role, blocked } = useStore()
  const org = state.organisation
  const canOrder = !blocked && can(role, 'purchase-order')
  const [ordering, setOrdering] = useState<{ supplierId: string; lines: Line[] } | null>(null)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const [notice, setNotice] = useState('')
  const { run, error } = useRun()
  const list = suppliers(state)
  const supplierName = (id: string) => list.find((x) => x.id === id)?.name ?? 'Supplier'
  const productName = (id: string) => products(state).find((p) => p.id === id)?.name ?? 'Product'
  const suggestions = suggestedOrders(state)
  const orders = [...(operations(state).purchaseOrders ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
  const open = orders.filter((x) => x.status === 'ordered')
  const closed = orders.filter((x) => x.status !== 'ordered').slice(0, 5)

  async function copy(order: PurchaseOrder) {
    try {
      await navigator.clipboard.writeText(orderText(state, order))
      setNotice(`Order ${order.number} copied. Paste it into an email or read it out.`)
    } catch {
      setNotice('Copying is blocked in this browser. Open the order to read it out instead.')
    }
  }
  async function cancel(order: PurchaseOrder) {
    setNotice('')
    if (await run({ type: 'cancel-order', orderId: order.id }))
      setNotice(`Order ${order.number} cancelled. It stays on record.`)
  }
  const done = (message: string) => {
    setOrdering(null)
    setReceiving(null)
    setEditing(null)
    setNotice(message)
  }

  return (
    <section className="surface ops-panel" aria-labelledby="orders-heading">
      <header>
        <div>
          <h2 id="orders-heading">Orders from suppliers</h2>
          <p>
            Order from your supplier as you usually do, then record it here. When it arrives, say
            what came and it goes on the shelf. SALEANE never sends orders itself.
          </p>
        </div>
        <Truck size={21} aria-hidden="true" />
      </header>
      {notice && (
        <p className="success-strip" role="status">
          {notice}
        </p>
      )}
      <ErrorMessage error={error} />
      {suggestions.length > 0 && (
        <div className="orders-suggested">
          <h3>Suggested</h3>
          {suggestions.map((group) => (
            <div className="ops-record" key={group.supplier?.id ?? 'none'}>
              <div className="ops-record-copy">
                <strong>{group.supplier?.name ?? 'No supplier set'}</strong>
                <small>
                  {group.lines
                    .map((l) => `${l.name}: ${l.onHand} left, order ${l.quantity}`)
                    .join(' · ')}
                </small>
              </div>
              {canOrder && group.supplier && (
                <Button
                  variant="secondary"
                  aria-label={`Prepare order for ${group.supplier.name}`}
                  onClick={() => {
                    setOrdering({
                      supplierId: group.supplier!.id,
                      lines: group.lines.map(({ productId, quantity }) => ({
                        productId,
                        quantity,
                      })),
                    })
                    setNotice('')
                  }}
                >
                  Prepare order
                </Button>
              )}
            </div>
          ))}
          {suggestions.some((g) => !g.supplier) && (
            <p className="subtle">Set a supplier on a product to have it suggested in an order.</p>
          )}
        </div>
      )}
      {open.length > 0 && (
        <div className="ops-ledger">
          {open.map((order) => (
            <div className="ops-record stock-record" key={order.id}>
              <div className="ops-record-copy">
                <strong>
                  {order.number} · {supplierName(order.supplierId)}
                  {hasLocations(state)
                    ? ` · to ${placeOf(state, order.locationId)?.name ?? ''}`
                    : ''}
                </strong>
                <small>
                  {order.lines.map((l) => `${l.quantity} × ${productName(l.productId)}`).join(', ')}{' '}
                  · ordered {dateLabel(order.createdAt.slice(0, 10), org.locale, true)}
                </small>
              </div>
              <span className="ops-tag">On order</span>
              <div className="stock-actions">
                <Button
                  variant="quiet"
                  aria-label={`Copy order ${order.number}`}
                  onClick={() => void copy(order)}
                >
                  <Copy size={14} aria-hidden="true" /> Copy
                </Button>
                {canOrder && (
                  <>
                    <Button
                      variant="secondary"
                      aria-label={`It arrived: order ${order.number}`}
                      onClick={() => {
                        setReceiving(order)
                        setNotice('')
                      }}
                    >
                      It arrived
                    </Button>
                    <Button
                      variant="quiet"
                      aria-label={`Cancel order ${order.number}`}
                      onClick={() => void cancel(order)}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {closed.length > 0 && (
        <ul className="orders-closed" aria-label="Recent orders">
          {closed.map((order) => (
            <li key={order.id}>
              {order.number} · {supplierName(order.supplierId)} ·{' '}
              {order.status === 'received' ? 'Arrived' : 'Cancelled'}{' '}
              {order.closedAt ? dateLabel(order.closedAt.slice(0, 10), org.locale, true) : ''}
            </li>
          ))}
        </ul>
      )}
      {!suggestions.length && !open.length && !closed.length && (
        <p className="subtle">Nothing is running low and nothing is on order.</p>
      )}
      <div className="orders-suppliers">
        <h3>Suppliers</h3>
        {list.length ? (
          <ul>
            {list.map((supplier) => (
              <li key={supplier.id}>
                <span>
                  <strong>{supplier.name}</strong>
                  <small>
                    {[supplier.email, supplier.phone, supplier.archived ? 'No longer used' : '']
                      .filter(Boolean)
                      .join(' · ') || 'No contact details'}
                  </small>
                </span>
                {canOrder && (
                  <Button
                    variant="quiet"
                    aria-label={`Edit ${supplier.name}`}
                    onClick={() => {
                      setEditing(supplier)
                      setNotice('')
                    }}
                  >
                    Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtle">No suppliers yet.</p>
        )}
        {canOrder && (
          <div className="ops-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setEditing('new')
                setNotice('')
              }}
            >
              <Plus size={16} aria-hidden="true" /> Add a supplier
            </Button>
            {list.some((x) => !x.archived) && (
              <Button
                variant="quiet"
                onClick={() => {
                  setOrdering({ supplierId: list.find((x) => !x.archived)!.id, lines: [] })
                  setNotice('')
                }}
              >
                New order
              </Button>
            )}
          </div>
        )}
      </div>
      {ordering && (
        <OrderDialog initial={ordering} onClose={() => setOrdering(null)} onDone={done} />
      )}
      {receiving && (
        <ReceiveDialog order={receiving} onClose={() => setReceiving(null)} onDone={done} />
      )}
      {editing && (
        <SupplierDialog
          supplier={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onDone={done}
        />
      )}
    </section>
  )
}

function OrderDialog({
  initial,
  onClose,
  onDone,
}: {
  initial: { supplierId: string; lines: Line[] }
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state } = useStore()
  const { run, pending, error, setError } = useRun()
  const [supplierId, setSupplierId] = useState(initial.supplierId)
  const [lines, setLines] = useState<Line[]>(initial.lines)
  const [note, setNote] = useState('')
  // V2: where the delivery goes, when the studio has more than one location.
  const multiSite = hasLocations(state)
  const [placeId, setPlaceId] = useState(state.organisation.locationId)
  const [placed, setPlaced] = useState(false)
  const stocked = products(state).filter((p) => !p.archived)
  const name = (id: string) => stocked.find((p) => p.id === id)?.name ?? 'Product'
  const addable = stocked.filter((p) => !lines.some((l) => l.productId === p.id))
  const number = `PO-${(operations(state).purchaseOrders?.length ?? 0) + 1}`

  /** Stage 2: scanning a product puts it on the order, or one more of it. */
  function scanned(product: Product): ScanOutcome {
    if (product.archived) return { problem: 'Choose products that are still stocked.' }
    const line = lines.find((l) => l.productId === product.id)
    if (!line && lines.length >= ORDER_LINE_LIMIT)
      return { problem: `An order holds up to ${ORDER_LINE_LIMIT} products.` }
    const quantity = (line && Number.isInteger(line.quantity) ? line.quantity : 0) + 1
    if (quantity > 10000) return { problem: 'An order holds up to 10000 of one product.' }
    setLines((current) =>
      current.some((l) => l.productId === product.id)
        ? current.map((l) => (l.productId === product.id ? { ...l, quantity } : l))
        : [...current, { productId: product.id, quantity }],
    )
    setError('')
    return {
      done:
        quantity > 1
          ? `${quantity} × ${product.name} on this order.`
          : `Added ${product.name} to the order.`,
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const chosen = lines.filter((l) => l.quantity > 0)
    if (!chosen.length) {
      setError('Add at least one product.')
      return
    }
    if (chosen.some((l) => !Number.isInteger(l.quantity))) {
      setError('Enter whole numbers.')
      return
    }
    if (!placed) {
      setError('Confirm you have placed this order with the supplier.')
      return
    }
    if (
      await run({
        type: 'purchase-order',
        supplierId,
        lines: chosen,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(placeId !== state.organisation.locationId ? { locationId: placeId } : {}),
      })
    )
      onDone(`Order ${number} recorded as placed. Say when it arrives.`)
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={`Order ${number}`}
      description="Place the order with your supplier by email, phone or their website, then record it here. SALEANE does not send it."
    >
      <form onSubmit={save} className="plan-form">
        <div className="ops-fields">
          <label className="ops-wide">
            Supplier
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {suppliers(state)
                .filter((x) => !x.archived)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
          </label>
          {lines.map((line, i) => (
            <label key={line.productId}>
              {name(line.productId)}
              <input
                type="number"
                min={0}
                max={10000}
                value={line.quantity}
                onChange={(e) =>
                  setLines(
                    lines.map((l, j) => (j === i ? { ...l, quantity: Number(e.target.value) } : l)),
                  )
                }
              />
              <small>Set to 0 to leave it out.</small>
            </label>
          ))}
          {addable.length > 0 && (
            <label className="ops-wide">
              Add a product
              <Select
                value=""
                onChange={(e) =>
                  e.target.value && setLines([...lines, { productId: e.target.value, quantity: 1 }])
                }
              >
                <option value="">Choose…</option>
                {addable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <div className="ops-wide">
            <ScanField action="Add" onProduct={scanned} disabled={pending} />
          </div>
          {multiSite && (
            <label className="ops-wide">
              Deliver to
              <Select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
                {places(state).map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <label className="ops-wide">
            Note (optional)
            <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        {lines.some((l) => l.quantity > 0) && (
          <pre className="orders-text" aria-label="The order in words">
            {orderText(state, {
              number,
              supplierId,
              lines: lines.filter((l) => l.quantity > 0),
              note: note.trim() || undefined,
              locationId: placeId,
            })}
          </pre>
        )}
        <label className="ops-check">
          <input type="checkbox" checked={placed} onChange={(e) => setPlaced(e.target.checked)} />I
          have placed this order with the supplier.
        </label>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending || !supplierId}>
            {pending ? 'Saving…' : 'Record the order'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ReceiveDialog({
  order,
  onClose,
  onDone,
}: {
  order: PurchaseOrder
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { state } = useStore()
  const { run, pending, error, setError } = useRun()
  const [arrived, setArrived] = useState<Record<string, string>>(
    Object.fromEntries(order.lines.map((l) => [l.productId, String(l.quantity)])),
  )
  const name = (id: string) => products(state).find((p) => p.id === id)?.name ?? 'Product'
  // Stage 2: unpacking by scanning starts from zero each count still showing the amount ordered
  // (a count changed by hand stays as it is), then each scan adds one.
  const [scanning, setScanning] = useState(false)
  function scanned(product: Product): ScanOutcome {
    if (!order.lines.some((l) => l.productId === product.id))
      return {
        problem: `${product.name} is not on order ${order.number}. Record it as a delivery of its own on Stock.`,
      }
    const start = scanning
      ? arrived
      : Object.fromEntries(
          order.lines.map((l) => {
            const count = arrived[l.productId] ?? ''
            return [l.productId, count === String(l.quantity) ? '0' : count]
          }),
        )
    const before = Number(start[product.id])
    const next = (Number.isInteger(before) && before >= 0 ? before : 0) + 1
    setArrived({ ...start, [product.id]: String(next) })
    setScanning(true)
    setError('')
    return {
      done: `${scanning ? '' : 'Counting by scan: the counts showing the amount ordered now start from zero. '}${next} × ${product.name} arrived.`,
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const received = order.lines.map((l) => ({
      productId: l.productId,
      quantity: Number(arrived[l.productId]),
    }))
    if (received.some((r) => !Number.isInteger(r.quantity) || r.quantity < 0)) {
      setError('Enter how many arrived as whole numbers, or 0.')
      return
    }
    if (await run({ type: 'receive-order', orderId: order.id, received }))
      onDone(
        `Order ${order.number} arrived. ${received.reduce((sum, r) => sum + r.quantity, 0)} items are on the shelf.`,
      )
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={`Order ${order.number} arrived`}
      description="Count what came in the box. Anything short can go on a new order."
    >
      <form onSubmit={save} className="plan-form">
        <div className="ops-fields">
          <div className="ops-wide">
            <ScanField
              action="Add one"
              onProduct={scanned}
              disabled={pending}
              hint="Scanning as you unpack? The first scan starts from zero every count still showing the amount ordered, then each scan adds one."
            />
          </div>
          {order.lines.map((line) => (
            <label key={line.productId}>
              {name(line.productId)}
              <input
                type="number"
                min={0}
                max={10000}
                value={arrived[line.productId]}
                onChange={(e) => setArrived({ ...arrived, [line.productId]: e.target.value })}
              />
              <small>{line.quantity} ordered</small>
            </label>
          ))}
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Put it on the shelf'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function SupplierDialog({
  supplier,
  onClose,
  onDone,
}: {
  supplier?: Supplier
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { run, pending, error } = useRun()
  const [name, setName] = useState(supplier?.name ?? '')
  const [email, setEmail] = useState(supplier?.email ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [note, setNote] = useState(supplier?.note ?? '')
  const [archived, setArchived] = useState(!!supplier?.archived)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = {
      name: name.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(archived ? { archived: true } : {}),
    }
    if (await run({ type: 'supplier', ...(supplier ? { id: supplier.id } : {}), input }))
      onDone(`${input.name} saved.`)
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title={supplier ? `Edit ${supplier.name}` : 'Add a supplier'}
      description="Who you order products from. Their details are for your team; SALEANE does not contact them."
    >
      <form onSubmit={save} className="plan-form">
        <div className="ops-fields">
          <label className="ops-wide">
            Name
            <input
              value={name}
              required
              minLength={2}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Email (optional)
            <input
              type="email"
              value={email}
              maxLength={200}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Phone (optional)
            <input value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="ops-wide">
            Note (optional)
            <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </label>
          {supplier && (
            <label className="ops-check ops-wide">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />
              No longer used
            </label>
          )}
        </div>
        <ErrorMessage error={error} />
        <div className="ops-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save the supplier'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
