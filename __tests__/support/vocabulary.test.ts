import { test, expect } from 'vitest'
import {
  SUPPORT_CATEGORIES,
  SUPPORT_STATUSES,
  GUIDE_CATEGORIES,
  isSupportCategory,
  isSupportKind,
} from '@/lib/support/vocabulary'

test('categories are the nine agreed values', () => {
  expect([...SUPPORT_CATEGORIES]).toEqual([
    'leads',
    'whatsapp',
    'meta',
    'automations',
    'ai',
    'billing',
    'account',
    'integrations',
    'other',
  ])
})

test('guide categories are the eight customer-facing ones — "other" is form-only', () => {
  expect(GUIDE_CATEGORIES).not.toContain('other')
  expect(GUIDE_CATEGORIES).toHaveLength(8)
  for (const c of GUIDE_CATEGORIES) expect(SUPPORT_CATEGORIES).toContain(c)
})

test('statuses are the four agreed values in lifecycle order', () => {
  expect([...SUPPORT_STATUSES]).toEqual(['open', 'in_progress', 'waiting_for_customer', 'resolved'])
})

test('isSupportCategory rejects anything outside the union', () => {
  expect(isSupportCategory('whatsapp')).toBe(true)
  expect(isSupportCategory('WHATSAPP')).toBe(false)
  expect(isSupportCategory('')).toBe(false)
  expect(isSupportCategory(null)).toBe(false)
  expect(isSupportCategory('__proto__')).toBe(false)
})

test('isSupportKind falls back cleanly for an unknown value', () => {
  expect(isSupportKind('problem')).toBe(true)
  expect(isSupportKind('question')).toBe(true)
  expect(isSupportKind('urgent')).toBe(false)
})
