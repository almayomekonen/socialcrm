// @vitest-environment jsdom
//
// Accessibility regression suite for the shared toast (lib/toast.tsx).
//
// Toasts are the app-wide action-feedback channel (success / error / loading).
// WCAG 4.1.3 (Status Messages) requires they be announced to assistive tech
// WITHOUT moving focus. These tests lock in the announcement contract:
//   - a persistent, polite live region exists and lives OUTSIDE the popover
//     (the popover is display:none while closed and would not announce),
//   - every toast (including errors) lands in that region,
//   - identical consecutive messages still re-announce (clear-then-set).
//
// Runs without a database: `npm run test:a11y`.

import { beforeAll, afterEach, test, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, act, cleanup } from '@testing-library/react'
import ToastMsg, { toast } from '@/lib/toast'

beforeAll(() => {
  // JSDOM does not implement the Popover API; stub it so ToastMsg can call it.
  if (!HTMLElement.prototype.showPopover) HTMLElement.prototype.showPopover = function () {}
  if (!HTMLElement.prototype.hidePopover) HTMLElement.prototype.hidePopover = function () {}
})
afterEach(cleanup)

test('renders a persistent polite live region, outside the popover', () => {
  render(<ToastMsg />)
  const region = screen.getByRole('status')
  expect(region.getAttribute('aria-live')).toBe('polite')
  expect(region.getAttribute('aria-atomic')).toBe('true')
  expect(region.className).toContain('sr-only')
  // Must NOT be nested in the popover (display:none while closed → no announce).
  const popover = document.getElementById('popMsg')
  expect(popover?.contains(region)).toBe(false)
})

test('announces a success message into the live region', () => {
  vi.useFakeTimers()
  try {
    render(<ToastMsg />)
    act(() => toast('success', 'בוצע בהצלחה!'))
    // cleared first so the upcoming set is a detectable change
    expect(screen.getByRole('status').textContent).toBe('')
    act(() => vi.advanceTimersByTime(70))
    expect(screen.getByRole('status').textContent).toBe('בוצע בהצלחה!')
  } finally {
    vi.useRealTimers()
  }
})

test('errors are announced by the same polite region', () => {
  vi.useFakeTimers()
  try {
    render(<ToastMsg />)
    act(() => toast('error', 'אירעה שגיאה!'))
    act(() => vi.advanceTimersByTime(70))
    expect(screen.getByRole('status').textContent).toBe('אירעה שגיאה!')
  } finally {
    vi.useRealTimers()
  }
})

test('default message is announced when no text is passed', () => {
  vi.useFakeTimers()
  try {
    render(<ToastMsg />)
    act(() => toast('success'))
    act(() => vi.advanceTimersByTime(70))
    expect(screen.getByRole('status').textContent).toBe('בוצע בהצלחה!')
  } finally {
    vi.useRealTimers()
  }
})

test('identical consecutive messages re-announce (clear-then-set)', () => {
  vi.useFakeTimers()
  try {
    render(<ToastMsg />)
    act(() => toast('success', 'X'))
    act(() => vi.advanceTimersByTime(70))
    expect(screen.getByRole('status').textContent).toBe('X')

    // Same message again must clear then re-set so AT detects a change.
    act(() => toast('success', 'X'))
    expect(screen.getByRole('status').textContent).toBe('')
    act(() => vi.advanceTimersByTime(70))
    expect(screen.getByRole('status').textContent).toBe('X')
  } finally {
    vi.useRealTimers()
  }
})
