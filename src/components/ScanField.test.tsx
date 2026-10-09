import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { StoreProvider } from '../state/StoreProvider'
import { App } from '../App'
import { SAMPLE_BARCODES } from '../domain/seed'

// The sample shelf's fictional barcodes: the cleansing balm, the hydrating serum, and the massage
// oil that is only used in treatments.
const [BALM, SERUM] = SAMPLE_BARCODES
const MASSAGE_OIL = SAMPLE_BARCODES[5]

/*
 * A scanner's keys arrive a few milliseconds apart, stamped with the moment each was pressed. A
 * test's keys are stamped when the test gets to them, which on a busy machine can be later than
 * a scanner would ever be, so the clock the keys are stamped with is held here: still during a
 * scan, and moved on by a second whenever a person would pause.
 */
let clock = 1000
const pause = () => {
  clock += 1000
}
beforeEach(() => {
  vi.spyOn(Event.prototype, 'timeStamp', 'get').mockImplementation(() => clock)
})
afterEach(() => {
  vi.restoreAllMocks()
})

function show() {
  render(
    <MemoryRouter initialEntries={['/business/stock']}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
}

async function sellWithoutVisit() {
  // No delay between keys: as fast as a USB or Bluetooth scanner types.
  const user = userEvent.setup({ delay: null })
  show()
  await user.click(
    await screen.findByRole('button', { name: 'Sell without a visit' }, { timeout: 8000 }),
  )
  const dialog = screen.getByRole('dialog', { name: 'Sell without a visit' })
  return { user, dialog }
}
const lines = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll('.checkout-product-name')].map((line) => line.firstChild?.textContent)

// Each test drives the whole app, which can take several seconds on a busy machine.
describe('scanning at a walk-in sale', { timeout: 20000 }, () => {
  it('adds the scanned product, and one more on a second scan', async () => {
    const { user, dialog } = await sellWithoutVisit()
    const field = within(dialog).getByLabelText('Scan or type a barcode')
    // The sale opens ready for the scanner.
    expect(field).toHaveFocus()
    await user.keyboard(`${SERUM}{Enter}`)
    expect(within(dialog).getByRole('status')).toHaveTextContent('Added Hydrating Serum.')
    expect(lines(dialog)).toEqual(['Hydrating Serum'])
    expect(field).toHaveValue('')
    await user.keyboard(`${SERUM}{Enter}`)
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'One more Hydrating Serum: 2 on this receipt.',
    )
    expect(
      dialog.querySelector('[data-product="product-hydrating-serum"] [aria-live]'),
    ).toHaveTextContent('2')
    // The scanner's Enter never recorded the sale on its own.
    expect(screen.getByRole('dialog', { name: 'Sell without a visit' })).toBeInTheDocument()
  })

  it('adds a product scanned while another field has focus, leaving that field as it was', async () => {
    const { user, dialog } = await sellWithoutVisit()
    const soldBy = within(dialog).getByLabelText('Sold by')
    soldBy.focus()
    await user.keyboard(`${BALM}{Enter}`)
    expect(lines(dialog)).toEqual(['Calming Cleansing Balm'])
    expect(soldBy).toHaveValue('')
    await user.click(within(dialog).getByRole('button', { name: 'Record the sale' }))
    expect(screen.queryByRole('dialog', { name: 'Sell without a visit' })).not.toBeInTheDocument()
  })

  it('says plainly when no product has the code, or it is not for sale', async () => {
    const { user, dialog } = await sellWithoutVisit()
    await user.keyboard('5012345678900{Enter}')
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'No product has barcode 5012345678900.',
    )
    // An owner may add the code to a product there and then.
    expect(within(dialog).getByRole('button', { name: 'Add it to a product' })).toBeInTheDocument()
    expect(lines(dialog)).toEqual([])

    const field = within(dialog).getByLabelText('Scan or type a barcode')
    await user.clear(field)
    await user.keyboard('5012345678901{Enter}')
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'No product has barcode 5012345678901. EAN-13 barcodes end in a check digit. For this one it should be 0, not 1.',
    )
    expect(within(dialog).queryByRole('button', { name: 'Add it to a product' })).toBeNull()

    await user.clear(field)
    await user.keyboard(`${MASSAGE_OIL}{Enter}`)
    // The same words the till uses when the sale is recorded.
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Choose products that are on sale here.',
    )
    expect(lines(dialog)).toEqual([])
  })
})

describe('scanning on Stock', { timeout: 20000 }, () => {
  it('opens the scanned product for someone who may edit products', async () => {
    const user = userEvent.setup({ delay: null })
    show()
    await screen.findByRole(
      'group',
      { name: 'Stock and details for Hydrating Serum' },
      { timeout: 8000 },
    )
    await user.keyboard(`${SERUM}{Enter}`)
    const form = screen.getByRole('dialog', { name: 'Edit Hydrating Serum' })
    expect(within(form).getByLabelText('Barcode')).toHaveValue(SERUM)
  })

  it('puts a code scanned in the product form into its barcode field', async () => {
    const user = userEvent.setup({ delay: null })
    show()
    await user.click(
      await screen.findByRole('button', { name: 'Add a product' }, { timeout: 8000 }),
    )
    const form = screen.getByRole('dialog', { name: 'Add a product' })
    const name = within(form).getByLabelText('Name')
    expect(name).toHaveFocus()
    // The barcode waits in a fold with the other less often changed fields.
    const fold = within(form).getByText('Barcode, code and supplier').closest('details')!
    expect(fold).not.toHaveAttribute('open')
    await user.keyboard('Rose Toner')
    pause()
    await user.keyboard('5012345678900{Enter}')
    expect(name).toHaveValue('Rose Toner')
    expect(within(form).getByLabelText('Barcode')).toHaveValue('5012345678900')
    // The scan opens the fold, and its line says what it now holds.
    expect(fold).toHaveAttribute('open')
    expect(fold.querySelector('summary')).toHaveTextContent('Barcode 5012345678900')
    // A code another product holds is named before saving.
    pause()
    await user.keyboard(`${BALM}{Enter}`)
    expect(within(form).getByRole('alert')).toHaveTextContent(
      `Calming Cleansing Balm already has barcode ${BALM}.`,
    )
  })

  it('adds one for each scan in a count, and refuses another product', async () => {
    const user = userEvent.setup({ delay: null })
    show()
    const balm = await screen.findByRole(
      'group',
      { name: 'Stock and details for Calming Cleansing Balm' },
      { timeout: 8000 },
    )
    await user.click(within(balm).getByRole('button', { name: 'Count' }))
    const dialog = screen.getByRole('dialog', { name: 'Correct the count' })
    const count = within(dialog).getByLabelText('How many are on the shelf now')
    // The scanner types into the number field the dialog opened on; the count still goes up by one.
    expect(count).toHaveFocus()
    await user.keyboard(`${BALM}{Enter}`)
    pause()
    await user.keyboard(`${BALM}{Enter}`)
    expect(count).toHaveValue(2)
    expect(within(dialog).getByRole('status')).toHaveTextContent('2 counted.')
    pause()
    await user.keyboard(`${SERUM}{Enter}`)
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'That is Hydrating Serum. This is for Calming Cleansing Balm.',
    )
    expect(count).toHaveValue(2)
    // The scanner's Enter never saved the count on its own.
    expect(screen.getByRole('dialog', { name: 'Correct the count' })).toBeInTheDocument()
  })
})

describe('scanning a supplier order as it is unpacked', { timeout: 20000 }, () => {
  it('counts each scan from zero, and names a product not on the order', async () => {
    const HAIR_MASK = SAMPLE_BARCODES[3]
    const user = userEvent.setup({ delay: null })
    show()
    await user.click(
      await screen.findByRole('button', { name: 'It arrived: order PO-1' }, { timeout: 8000 }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Order PO-1 arrived' })
    const count = within(dialog).getByLabelText(/Restorative Hair Mask/)
    // The count starts at the amount ordered, for anyone who checks the box by eye.
    expect(count).toHaveValue(6)
    expect(within(dialog).getByLabelText('Scan or type a barcode')).toHaveFocus()
    await user.keyboard(`${HAIR_MASK}{Enter}`)
    pause()
    await user.keyboard(`${HAIR_MASK}{Enter}`)
    expect(count).toHaveValue(2)
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      '2 × Restorative Hair Mask arrived.',
    )
    pause()
    await user.keyboard(`${BALM}{Enter}`)
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Calming Cleansing Balm is not on order PO-1. Record it as a delivery of its own on Stock.',
    )
    expect(count).toHaveValue(2)
  })
})
