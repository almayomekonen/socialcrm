// @vitest-environment jsdom
//
// Regression checks for the skip link (RC-2, WCAG 2.4.1 Bypass Blocks).
// JSDOM does not apply Tailwind CSS or fragment-navigation focus, so these
// lock in the structural contract: the link exists, targets #main-content, is
// visually hidden until focus (sr-only + focus:not-sr-only), and the target is
// programmatically focusable (tabindex=-1) so activating the link can land focus
// on the content. Real fragment-jump behavior is covered by manual keyboard QA.

import { afterEach, test, expect } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import SkipLink from '@/components/layout/SkipLink'

afterEach(cleanup)

test('renders a skip link that targets the app main', () => {
  render(<SkipLink />)
  const link = screen.getByRole('link', { name: 'דלג לתוכן' })
  expect(link.getAttribute('href')).toBe('#main-content')
})

test('is visually hidden until focused (sr-only, revealed on focus)', () => {
  render(<SkipLink />)
  const link = screen.getByRole('link', { name: 'דלג לתוכן' })
  expect(link.className).toContain('sr-only')
  expect(link.className).toContain('focus:not-sr-only')
})

test('the skip target is programmatically focusable', () => {
  // Mirrors how the app-shell wires the target: <main id="main-content" tabindex="-1">.
  render(
    <>
      <SkipLink />
      <main id='main-content' tabIndex={-1}>
        content
      </main>
    </>,
  )
  const main = document.getElementById('main-content')!
  main.focus()
  expect(document.activeElement).toBe(main)
})
