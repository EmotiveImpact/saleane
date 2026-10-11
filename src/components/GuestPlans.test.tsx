import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GuestPlans } from './GuestPlans'
import type { GuestView } from '../domain/guest'
import type { GuestPlan } from '../domain/guestPlans'

const view = (
  plans: GuestPlan[] | undefined,
  locale: GuestView['organisation']['locale'] = 'en-GB',
): GuestView => ({
  organisation: {
    name: 'Reference Studio',
    locationName: 'London',
    locale,
    timeZone: locale === 'en-US' ? 'America/New_York' : 'Europe/London',
    currency: locale === 'en-US' ? 'USD' : 'GBP',
    region: locale === 'en-US' ? 'US' : 'UK',
    address: '',
  },
  visit: {
    serviceName: 'Skin Renewal Facial',
    professional: 'Maya',
    date: '2026-10-20',
    startMinutes: 600,
    durationMinutes: 60,
    status: 'confirmed',
    calendarUid: 'visit-0123456789abcdef@saleane',
  },
  arrival: { studioNote: '', serviceNote: '' },
  deposit: { paidMinor: 0, simulated: false },
  cancellation: { available: true, cutoffAt: '2026-10-19T09:00:00.000Z', outcome: 'none' },
  ...(plans ? { plans } : {}),
})
const pack = (change: Partial<GuestPlan> = {}): GuestPlan => ({
  kind: 'package',
  name: 'Six facials',
  state: 'active',
  visits: 6,
  visitsLeft: 3,
  endsOn: '2027-03-14',
  ...change,
})
const club = (change: Partial<GuestPlan> = {}): GuestPlan => ({
  kind: 'membership',
  name: 'Facial club',
  state: 'active',
  visits: 1,
  visitsLeft: 1,
  discountPercent: 10,
  nextMonthOn: '2026-11-06',
  ...change,
})

describe('a guest’s packages and memberships on their visit page', () => {
  it('shows nothing when the guest holds no plan', () => {
    const { container } = render(<GuestPlans view={view(undefined)} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a package with visits left, its last day and that the studio can take this visit off it', () => {
    render(<GuestPlans view={view([pack({ thisVisit: { outcome: 'covers' } })])} />)
    const section = screen.getByRole('region', { name: 'Your package Six facials' })
    expect(section).toHaveTextContent('3 of 6 visits left, until 14 March 2027.')
    expect(section).toHaveTextContent(
      'This visit can come off your package. The studio will take it off at checkout.',
    )
    // It never claims the visit is paid for.
    expect(section).not.toHaveTextContent(/paid|free|£/i)
  })

  it('shows a membership with this month’s visits, its discount and when the next month starts', () => {
    render(
      <GuestPlans view={view([club({ visitsLeft: 0, thisVisit: { outcome: 'discount' } })])} />,
    )
    const section = screen.getByRole('region', { name: 'Your membership Facial club' })
    expect(section).toHaveTextContent(
      'No visits left this month. Your member discount is 10%. Your next month starts on 6 November.',
    )
    expect(section).toHaveTextContent(
      'Your 10% member discount applies to this treatment. The studio will take it off at checkout.',
    )
  })

  it('says kindly that an unpaid month is not paid yet, and what that means for this visit', () => {
    render(
      <GuestPlans
        view={view([
          {
            kind: 'membership',
            name: 'Facial club',
            state: 'unpaid',
            discountPercent: 10,
            thisVisit: { outcome: 'covers_once_paid', monthOn: '2026-10-06' },
          },
        ])}
      />,
    )
    const section = screen.getByRole('region', { name: 'Your membership Facial club' })
    expect(section).toHaveTextContent(
      'This month is not paid yet. When you are ready, please speak to the studio.',
    )
    expect(section).toHaveTextContent(
      'Once your membership is paid up, this visit can come off it.',
    )
    expect(section).not.toHaveTextContent(/visits left|next month/)
  })

  it('says which saved card pays a membership each month, and that a month is due from it', () => {
    const { unmount } = render(
      <GuestPlans view={view([club({ paidByCard: { brand: 'Visa', last4: '4242' } })])} />,
    )
    expect(screen.getByRole('region', { name: 'Your membership Facial club' })).toHaveTextContent(
      'Each month is paid from your Visa card ending 4242, with a reminder three days before.',
    )
    unmount()
    render(
      <GuestPlans
        view={view([
          {
            kind: 'membership',
            name: 'Facial club',
            state: 'unpaid',
            discountPercent: 10,
            paidByCard: { brand: 'Visa', last4: '0002' },
          },
        ])}
      />,
    )
    const section = screen.getByRole('region', { name: 'Your membership Facial club' })
    expect(section).toHaveTextContent(
      'This month is not paid yet. It is due from your Visa card ending 0002. To use another card or pay another way, please speak to the studio.',
    )
    expect(section).not.toHaveTextContent(/paid from your|When you are ready/)
  })

  it('calls it a test card in test mode, as the saved card above it does', () => {
    const testing = {
      ...view([club({ paidByCard: { brand: 'Visa', last4: '4242' } })]),
      payment: {
        testMode: true,
        depositDueMinor: 0,
        saveCardOffered: true,
        savedCard: { brand: 'Visa', last4: '4242' },
        policy: 'Your card is saved for visits at Reference Studio.',
        pending: false,
      },
    }
    render(<GuestPlans view={testing} />)
    expect(screen.getByRole('region')).toHaveTextContent(
      'Each month is paid from your Visa test card ending 4242, with a reminder three days before. While the studio is in test mode, no money moves.',
    )
  })

  it('explains a later unpaid month, a deposit and a package that ends first', () => {
    render(
      <GuestPlans
        view={view([
          pack({ thisVisit: { outcome: 'deposit' } }),
          club({ thisVisit: { outcome: 'discount_once_paid', monthOn: '2026-11-06' } }),
          pack({
            name: 'Brow course',
            endsOn: '2026-10-15',
            thisVisit: { outcome: 'ends_before' },
          }),
        ])}
      />,
    )
    expect(screen.getAllByRole('region')).toHaveLength(3)
    expect(
      screen.getByText(
        'This visit has a deposit. If you would rather it came off your package, please ask the studio.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This visit falls in your membership month from 6 November, which is not paid yet. Once it is, your 10% member discount applies to this treatment.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('This visit is after your package ends, so it cannot come off it.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Your package Brow course' })).toHaveTextContent(
      'until 15 October.',
    )
  })

  it('asks the guest to speak to the studio before paying a deposit the plan could save', () => {
    const due = {
      ...view([pack({ thisVisit: { outcome: 'covers' } })]),
      payment: {
        testMode: true,
        depositDueMinor: 2500,
        saveCardOffered: false,
        savedCard: null,
        policy: 'Your card is saved for visits at Reference Studio.',
        pending: false,
      },
    }
    render(<GuestPlans view={due} />)
    expect(screen.getByRole('region')).toHaveTextContent(
      'This visit can come off your package. A visit with a deposit cannot, so please ask the studio before you pay the deposit.',
    )
    expect(screen.getByRole('region')).not.toHaveTextContent('at checkout')
  })

  it('writes dates in the studio’s own language', () => {
    render(<GuestPlans view={view([club({ thisVisit: { outcome: 'covers' } })], 'en-US')} />)
    expect(screen.getByRole('region')).toHaveTextContent('Your next month starts on November 6.')
  })

  it('uses no em dashes', () => {
    const { container } = render(
      <GuestPlans
        view={view([
          pack({ thisVisit: { outcome: 'covers' } }),
          club({ thisVisit: { outcome: 'covers_once_paid', monthOn: '2026-11-06' } }),
        ])}
      />,
    )
    // En and em dashes, written by their codes.
    const dashes = String.fromCharCode(0x2013) + String.fromCharCode(0x2014)
    for (const dash of dashes) expect(container.textContent).not.toContain(dash)
  })
})
