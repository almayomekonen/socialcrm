import { test, expect } from 'vitest'
import {
  SUPPORT_REQUESTS_PER_HOUR,
  rateLimitWindowStart,
  isOverRequestLimit,
} from '@/lib/support/rateLimit'

test('the cap is a basic abuse guard, not a tenant rate limiter', () => {
  expect(SUPPORT_REQUESTS_PER_HOUR).toBe(10)
})

test('the window is the trailing hour', () => {
  const now = new Date('2026-08-10T09:30:00Z')
  expect(rateLimitWindowStart(now).toISOString()).toBe('2026-08-10T08:30:00.000Z')
})

test('the limit blocks only at or above the cap', () => {
  expect(isOverRequestLimit(0)).toBe(false)
  expect(isOverRequestLimit(9)).toBe(false)
  expect(isOverRequestLimit(10)).toBe(true)
  expect(isOverRequestLimit(99)).toBe(true)
})
