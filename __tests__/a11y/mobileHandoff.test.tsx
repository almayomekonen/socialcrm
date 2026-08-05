// @vitest-environment jsdom
//
// Accessibility regression suite for the mobile handoff screen — the entire
// SocialCRM experience on a phone.
//
// This screen is the only thing a phone user ever sees, so its accessibility is
// not a detail of the experience, it IS the experience. The assertions query the
// COMPUTED accessibility tree (getByRole uses dom-accessibility-api, the same
// accessible-name algorithm a screen reader applies), so a regression here is a
// real regression for assistive tech.
//
// Guarantees locked in (do not weaken without an accessibility review):
//   1. The page is a `main` landmark — NOT role='dialog'. A full page is not a
//      dialog, and announcing one traps and misleads screen-reader users.
//   2. Exactly one h1, carrying the headline.
//   3. The decorative illustration is hidden from assistive tech, so the reading
//      order is headline → explanation → action with nothing in between.
//   4. The primary action is a real button with an accessible name.
//   5. The copy outcome is announced through a live region, not conveyed by a
//      transient visual label alone.
//   6. The screen is never a dead end: an action is always present.
//
// Runs without a database: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, afterEach, beforeEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }))

import MobileHandoff from '@/components/activation/mobile/MobileHandoff'
import { MOBILE_HANDOFF_COPY as COPY, DESKTOP_URL_LABEL } from '@/lib/activation/mobileHandoffCopy'
import { copyToClipboard } from '@/lib/clipboard'

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe('mobile handoff accessibility guarantees', () => {
  test('1. renders a main landmark, never a dialog', () => {
    const { container } = render(<MobileHandoff />)
    expect(screen.getByRole('main')).toBeTruthy()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  test('2. exactly one h1, carrying the headline', () => {
    const { container } = render(<MobileHandoff />)
    const h1s = container.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0].textContent).toBe(COPY.heading)
  })

  test('3. the illustration is hidden from assistive tech', () => {
    const { container } = render(<MobileHandoff />)
    const hidden = container.querySelector('[aria-hidden="true"]')
    expect(hidden).toBeTruthy()
    // Nothing decorative may expose an accessible name.
    expect(screen.queryByRole('img')).toBeNull()
  })

  test('4. the primary action is a button with an accessible name', () => {
    render(<MobileHandoff />)
    expect(screen.getByRole('button', { name: COPY.copyLabel })).toBeTruthy()
  })

  test('5. the copy outcome is announced in a live region', async () => {
    render(<MobileHandoff />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe('')

    fireEvent.click(screen.getByRole('button', { name: COPY.copyLabel }))

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(COPY.copiedLabel))
  })

  test('6. never a dead end — the destination is always readable, even if every action fails', () => {
    render(<MobileHandoff />)
    // The URL is present as selectable text regardless of clipboard/share support.
    expect(screen.getByText(DESKTOP_URL_LABEL)).toBeTruthy()
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
  })

  test('7. copy failure is surfaced, never silent', async () => {
    vi.mocked(copyToClipboard).mockResolvedValueOnce(false)
    render(<MobileHandoff />)

    fireEvent.click(screen.getByRole('button', { name: COPY.copyLabel }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(COPY.copyFailedLabel))
  })
})
