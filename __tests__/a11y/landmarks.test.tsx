// @vitest-environment jsdom
//
// Landmark regression checks for the route-group layouts (RC-1).
// Guarantees: each route group owns exactly ONE <main>, and the marketing
// footer is a real `contentinfo` landmark — i.e. it is NOT nested inside <main>
// (a <footer> descended from <main> is not exposed as contentinfo).

import { afterEach, test, expect } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import MarketingLayout from '@/app/(he)/(marketing)/layout'
import AuthLayout from '@/app/(he)/(auth)/layout'

afterEach(cleanup)

test('marketing layout has exactly one <main>', () => {
  const { container } = render(<MarketingLayout><p>content</p></MarketingLayout>)
  expect(container.querySelectorAll('main')).toHaveLength(1)
})

test('marketing footer is a contentinfo landmark outside <main>', () => {
  const { container } = render(<MarketingLayout><p>content</p></MarketingLayout>)
  const main = container.querySelector('main')!
  const footer = screen.getByRole('contentinfo')
  expect(main.contains(footer)).toBe(false)
})

test('auth layout has exactly one <main>', () => {
  const { container } = render(<AuthLayout><p>content</p></AuthLayout>)
  expect(container.querySelectorAll('main')).toHaveLength(1)
})
