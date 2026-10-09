import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { GuestPayment } from './GuestPayment'
import type { GuestPayment as Payment, GuestView } from '../domain/guest'

const organisation: GuestView['organisation'] = {
  name: 'Reference Studio',
  locationName: 'London',
  locale: 'en-GB',
  timeZone: 'Europe/London',
  currency: 'GBP',
  region: 'UK',
  address: '12 Example Mews, London',
}
const payment = (change: Partial<Payment> = {}): Payment => ({
  testMode: false,
  depositDueMinor: 2500,
  saveCardOffered: false,
  savedCard: null,
  policy: 'Your card is saved for visits at Reference Studio.',
  pending: false,
  ...change,
})
const token = 'a'.repeat(43)

test('asks for a real deposit as money that comes off the bill', () => {
  render(<GuestPayment token={token} payment={payment()} organisation={organisation} />)
  expect(screen.getByRole('button', { name: 'Pay £25.00 deposit' })).toBeInTheDocument()
  expect(screen.getByText(/It comes off your bill on the day/)).toBeInTheDocument()
  expect(screen.queryByText(/test/i)).not.toBeInTheDocument()
})

test('in test mode, every step says it is a test and no money is taken', () => {
  const { rerender } = render(
    <GuestPayment
      token={token}
      payment={payment({ testMode: true, saveCardOffered: true })}
      organisation={organisation}
    />,
  )
  expect(screen.getByText(/no card is asked for and no money moves/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Make a £25.00 test payment' })).toBeInTheDocument()
  expect(screen.queryByText(/comes off your bill/)).not.toBeInTheDocument()

  rerender(
    <GuestPayment
      token={token}
      payment={payment({ testMode: true, pending: true })}
      organisation={organisation}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent(
    'We’re confirming your test payment. This page will show it once it lands. No money is taken.',
  )

  rerender(
    <GuestPayment
      token={token}
      payment={payment({
        testMode: true,
        depositDueMinor: 0,
        savedCard: { brand: 'Visa', last4: '4242' },
      })}
      organisation={organisation}
    />,
  )
  expect(
    screen.getByText(
      'Visa test card ending 4242 is saved for your visits. No money can be taken from it.',
    ),
  ).toBeInTheDocument()

  rerender(
    <GuestPayment
      token={token}
      payment={payment({ testMode: true, depositDueMinor: 0, saveCardOffered: true })}
      organisation={organisation}
    />,
  )
  expect(screen.getByRole('button', { name: 'Save a test card' })).toBeInTheDocument()
})
