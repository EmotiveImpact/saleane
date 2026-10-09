import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { StudioContact } from './StudioContact'

const studio = {
  name: 'Reference Studio',
  locationName: 'London',
  address: '12 Example Mews, London',
  region: 'UK' as const,
}

test('shows where the studio is, with directions, a number to call and an address to email', () => {
  render(
    <StudioContact
      studio={{ ...studio, phone: '020 7946 0123', email: 'hello@reference.example' }}
    />,
  )
  expect(screen.getByRole('heading', { name: 'Your studio' })).toBeInTheDocument()
  expect(screen.getByText('Reference Studio · London')).toBeInTheDocument()
  expect(screen.getByText('12 Example Mews, London')).toBeInTheDocument()
  const directions = screen.getByRole('link', { name: /Directions/ })
  expect(directions).toHaveAttribute(
    'href',
    'https://www.google.com/maps/search/?api=1&query=12%20Example%20Mews%2C%20London',
  )
  expect(directions).toHaveAttribute('target', '_blank')
  expect(directions).toHaveAccessibleName('Directions (opens in a new tab)')
  expect(screen.getByRole('link', { name: 'Call 020 7946 0123' })).toHaveAttribute(
    'href',
    'tel:+442079460123',
  )
  expect(screen.getByRole('link', { name: 'Email hello@reference.example' })).toHaveAttribute(
    'href',
    'mailto:hello@reference.example',
  )
  expect(screen.queryByText(/reply to your confirmation email/)).not.toBeInTheDocument()
})

test('points to the confirmation email when the studio left no phone or email', () => {
  render(<StudioContact studio={{ ...studio, locationName: 'Reference Studio', address: '' }} />)
  expect(screen.getByText('Reference Studio')).toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  expect(screen.getByText('To get in touch, reply to your confirmation email.')).toBeInTheDocument()
})
