import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { MarketingHome } from './MarketingHome'

test('public front door presents SALEANE and links to the real app', () => {
  render(
    <MemoryRouter>
      <MarketingHome />
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Beautiful work deserves a calmer business.',
  )
  expect(screen.getByRole('link', { name: 'Explore a sample studio' })).toHaveAttribute(
    'href',
    '/today',
  )
  expect(screen.getByRole('link', { name: /Explore the plan/ })).toHaveAttribute('href', '/pricing')
  expect(screen.getAllByRole('link', { name: /Open your studio/ }).length).toBeGreaterThan(0)
  expect(screen.getByText(/Live services are not yet configured/)).toBeInTheDocument()
})

test('the UK and US published prices are switched without changing the plan', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <MarketingHome />
    </MemoryRouter>,
  )
  const group = screen.getByRole('group', { name: 'Choose pricing region' })
  expect(screen.getByText('£49')).toBeInTheDocument()
  await user.click(within(group).getByRole('button', { name: 'United States' }))
  expect(screen.getByText('$59')).toBeInTheDocument()
  expect(screen.getByText('plus applicable sales tax')).toBeInTheDocument()
  await user.click(within(group).getByRole('button', { name: 'United Kingdom' }))
  expect(screen.getByText('£49')).toBeInTheDocument()
})

test('interface and photograph selectors change their previews', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <MarketingHome />
    </MemoryRouter>,
  )
  const controls = screen.getByRole('group', { name: 'Choose interface preview' })
  await user.click(within(controls).getByRole('button', { name: 'Your guests' }))
  expect(screen.getByRole('heading', { name: 'A booking that feels easy.' })).toBeInTheDocument()
  expect(within(controls).getByRole('button', { name: 'Your guests' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await user.click(screen.getByRole('button', { name: /Show photograph 2/ }))
  expect(screen.getByRole('button', { name: /Show photograph 2/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
