import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { Pricing } from './Pricing'
import { ADD_ONS, ALLOWANCES, MARKETING_EMAILS, PRICE, priceLabel } from '../domain/pricing'

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
  // The owner's model (10 October 2026): every feature included, amounts limited, never features.
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Everything included, with room to grow.',
  )
  expect(screen.getByText(/We limit amounts, never features\./)).toBeInTheDocument()
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
  expect(screen.getByRole('heading', { name: 'No commission on your clients' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Amounts, never features' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'No fee to leave' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: 'United States' }))
  expect(offer.getByText('$69')).toBeInTheDocument()
  const people = within(screen.getByRole('region', { name: 'Room to grow' }))
    .getAllByRole('listitem')
    .find((item) => item.textContent?.startsWith('More people'))!
  expect(people).toHaveTextContent('$12 a month for each person, plus any sales tax')
})

test('shows what each location starts with each month, from the same amounts the app allows', () => {
  render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  )
  const heading = screen.getByRole('heading', { name: 'Each month, to start with' })
  const amounts = within(heading.nextElementSibling as HTMLElement)
  const rows = amounts
    .getAllByRole('term')
    .map((term) => `${term.textContent} ${term.nextSibling?.textContent}`)
  expect(rows).toEqual([
    '5 people taking bookings',
    '300 Ask SALEANE questions',
    '30 minutes talking to Ask SALEANE',
    '200 guest chats with the AI receptionist',
    '2,000 marketing emails',
  ])
  expect(ALLOWANCES.included.monthly).toEqual({
    typed: 300,
    talkSeconds: 1800,
    guestChats: 200,
    phoneSeconds: 0,
  })
  expect(MARKETING_EMAILS).toEqual({ included: 2000, plus: 10000 })
})

test('lists how a location grows, with prices, and nothing that unlocks a feature', async () => {
  render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  )
  await userEvent.click(screen.getByRole('radio', { name: 'United Kingdom' }))
  const grow = screen.getByRole('region', { name: 'Room to grow' })
  expect(grow).toHaveTextContent('Nothing you already use is ever held back.')
  const cards = within(grow).getAllByRole('listitem')
  expect(cards).toHaveLength(ADD_ONS.length)
  expect(cards[0]).toHaveTextContent('Plus')
  expect(cards[0]).toHaveTextContent('£39 a month for each location, plus VAT')
  expect(cards[0]).toHaveTextContent(
    '800 questions, 150 minutes of talking, 500 guest chats and 10,000 marketing emails a month',
  )
  expect(cards[1]).toHaveTextContent('More people')
  expect(cards[1]).toHaveTextContent('£9 a month for each person, plus VAT')
  expect(cards[1]).toHaveTextContent(
    'Anyone who gives no treatments, such as reception or a manager, is free.',
  )
  expect(cards[2]).toHaveTextContent('Phone receptionist')
  expect(cards[2]).toHaveTextContent('£79 a month for each location')
  expect(cards[2]).toHaveTextContent('300 minutes of calls a month')
  expect(cards[2]).toHaveTextContent('Arrives when phone calls are connected')
})

test('says which included features wait for a card or text account or voice, and keeps visitors on the page', () => {
  render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  )
  const included = within(
    screen.getByRole('list', { name: 'Every feature, from day one' }),
  ).getAllByRole('listitem')
  const line = (text: string) => included.find((item) => item.textContent?.startsWith(text))!
  expect(line('Reminders by text')).toHaveTextContent('Arrives when you connect your text account')
  expect(line('Saved cards, card readers')).toHaveTextContent(
    'Arrives when you connect your card account',
  )
  expect(line('Talking to Ask SALEANE')).toHaveTextContent(
    'Arrives when talking to Ask SALEANE is switched on',
  )
  expect(line('Booking confirmations, reminders and aftercare by email')).toHaveTextContent(
    'as many as you need',
  )
  expect(line('Marketing')).not.toHaveTextContent('Arrives')
  // Only the lines that need a connection carry the note.
  expect(included.filter((item) => item.textContent?.includes('Arrives'))).toHaveLength(3)
  // Visit emails are never counted towards the month.
  expect(screen.getByRole('region', { name: 'Costs outside SALEANE' })).toHaveTextContent(
    'Emails about visits are never counted.',
  )
  // The logo stays on the price page instead of opening the fictional demo.
  expect(screen.getAllByRole('link', { name: 'SALEANE' })[0]).toHaveAttribute('href', '/pricing')
})
