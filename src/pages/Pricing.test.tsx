import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { Pricing } from './Pricing'
import { PRICE, priceLabel } from '../domain/pricing'

// PILOT-04: one published price per studio, shown for the UK and the US.
test('formats the price in each currency without pence', () => {
  expect(priceLabel('UK')).toBe('£49')
  expect(priceLabel('US')).toBe('$59')
  expect(PRICE.UK.monthlyMinor % 100).toBe(0)
})

test('shows one price, everything included, and switches country', async () => {
  render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('One price')
  await userEvent.click(screen.getByRole('radio', { name: 'United Kingdom' }))
  expect(screen.getByText('£49')).toBeInTheDocument()
  expect(screen.getByText(/plus VAT/)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'No commission on your clients' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'No locked tiers' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'No fee to leave' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: 'United States' }))
  expect(screen.getByText('$59')).toBeInTheDocument()
  expect(screen.getByText(/plus any sales tax/)).toBeInTheDocument()
})
