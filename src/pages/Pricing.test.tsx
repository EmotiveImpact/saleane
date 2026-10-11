import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { Pricing } from './Pricing'
import { ADD_ONS, ALLOWANCES, PRICE, priceLabel } from '../domain/pricing'

// PILOT-04 and NEXT-02: one published price for each location, shown for the UK and the US.
test('formats the price in each currency without pence', () => {
  expect(priceLabel('UK')).toBe('£59')
  expect(priceLabel('US')).toBe('$69')
  expect(priceLabel('UK', 'plusMinor')).toBe('£39')
  expect(priceLabel('UK', 'phoneMinor')).toBe('£79')
  expect(priceLabel('UK', 'personMinor')).toBe('£9')
  expect(priceLabel('US', 'personMinor')).toBe('$12')
  for (const price of Object.values(PRICE))
    for (const amount of [price.monthlyMinor, price.personMinor, price.plusMinor, price.phoneMinor])
      expect(amount % 100).toBe(0)
})

test('shows one price for each location and switches country', async () => {
  render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('One price for each location')
  await userEvent.click(screen.getByRole('radio', { name: 'United Kingdom' }))
  const offer = within(screen.getByRole('region', { name: 'The price' }))
  expect(offer.getByText('£59')).toBeInTheDocument()
  // The owner's decision (10 October 2026): what SALEANE earns from card payments is said openly.
  expect(screen.getByRole('region', { name: 'Costs outside SALEANE' })).toHaveTextContent(
    'Once SALEANE joins Stripe’s partner programme, Stripe will share part of its own fee with SALEANE.',
  )
  expect(offer.getByText('per location, month to month').parentElement).toHaveTextContent(
    'a month, plus VAT',
  )
  expect(offer.getByText(/14 days free, no card needed/)).toBeInTheDocument()
  // Five people taking bookings come with each location; anyone who gives no treatments is free.
  expect(offer.getByText(/Includes 5 people taking bookings/)).toHaveTextContent(
    'Includes 5 people taking bookings. Each person beyond that is £9 a month, plus VAT.',
  )
  expect(
    offer.getByText(/5 people taking bookings, and free for anyone who gives no treatments/),
  ).toBeInTheDocument()
  expect(
    screen.getByText(/anyone who gives no treatments, such as reception or a manager, is free/),
  ).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'No commission on your clients' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'No locked tiers' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'No fee to leave' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: 'United States' }))
  expect(offer.getByText('$69')).toBeInTheDocument()
  expect(offer.getByText(/Includes 5 people taking bookings/)).toHaveTextContent(
    'Each person beyond that is $12 a month, plus any sales tax.',
  )
})

test('lists the two add-ons with their prices, and the AI each location includes', async () => {
  render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  )
  await userEvent.click(screen.getByRole('radio', { name: 'United Kingdom' }))
  const addOns = within(screen.getByRole('region', { name: 'Add-ons' })).getAllByRole('listitem')
  expect(addOns).toHaveLength(ADD_ONS.length)
  expect(addOns[0]).toHaveTextContent('Plus')
  expect(addOns[0]).toHaveTextContent('£39 a month for each location, plus VAT')
  expect(addOns[0]).toHaveTextContent(`${ALLOWANCES.plus.monthly.typed} typed questions`)
  expect(addOns[1]).toHaveTextContent('Phone receptionist')
  expect(addOns[1]).toHaveTextContent('£79 a month for each location')
  expect(addOns[1]).toHaveTextContent('300 minutes of calls a month')
  expect(addOns[1]).toHaveTextContent('Arrives when phone calls are connected')
  // The price includes exactly the AI the app allows a location.
  const offer = within(screen.getByRole('region', { name: 'The price' }))
  expect(offer.getByText(/300 typed questions a month/)).toBeInTheDocument()
  expect(offer.getByText(/30 minutes a month/)).toBeInTheDocument()
  expect(offer.getByText(/200 guest chats a month/)).toBeInTheDocument()
  expect(ALLOWANCES.included.monthly).toEqual({ typed: 300, talkSeconds: 1800, guestChats: 200 })
})

test('says which included features wait for a card or text account or voice, and keeps visitors on the page', () => {
  render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  )
  const included = within(screen.getByRole('region', { name: 'The price' })).getAllByRole(
    'listitem',
  )
  const line = (text: string) => included.find((item) => item.textContent?.startsWith(text))!
  expect(line('Reminders by text')).toHaveTextContent('Arrives when you connect your text account')
  expect(line('Saved cards, card readers')).toHaveTextContent(
    'Arrives when you connect your card account',
  )
  expect(line('Talking to Ask SALEANE')).toHaveTextContent(
    'Arrives when talking to Ask SALEANE is switched on',
  )
  expect(line('Booking confirmations and reminders by email')).not.toHaveTextContent('Arrives')
  // Only the lines that need a connection carry the note.
  expect(included.filter((item) => item.textContent?.includes('Arrives'))).toHaveLength(3)
  // The logo stays on the price page instead of opening the fictional demo.
  expect(screen.getAllByRole('link', { name: 'SALEANE' })[0]).toHaveAttribute('href', '/pricing')
})
