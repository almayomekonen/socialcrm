import { test, expect } from 'vitest'
import {
  FORBIDDEN_KEY_PATTERN,
  containsForbiddenKey,
  safeErrorMetadata,
  projectAllowed,
} from '@/lib/support/redaction'

test('the pattern catches every secret-ish key name we know of', () => {
  for (const k of [
    'webhookSecret',
    'accessToken',
    'refreshToken',
    'apiKey',
    'API_KEY',
    'clientSecret',
    'password',
    'credentials',
    'sessionVersion',
  ]) {
    expect(FORBIDDEN_KEY_PATTERN.test(k)).toBe(true)
  }
})

test('the pattern does not catch innocent keys', () => {
  for (const k of ['label', 'value', 'agencyId', 'lastEventAt', 'status', 'subject']) {
    expect(FORBIDDEN_KEY_PATTERN.test(k)).toBe(false)
  }
})

test('containsForbiddenKey walks nested objects and arrays', () => {
  expect(containsForbiddenKey({ a: { b: [{ accessToken: 'x' }] } })).toBe(true)
  expect(containsForbiddenKey({ facts: [{ label: 'מצב', value: 'החיבור נותק' }] })).toBe(false)
})

test('containsForbiddenKey terminates on a cyclic object', () => {
  const cyclic: any = { safe: 1 }
  cyclic.self = cyclic
  expect(containsForbiddenKey(cyclic)).toBe(false)
})

test('projectAllowed builds a fresh object and ignores everything else', () => {
  const row = { id: 1, label: 'ok', webhookSecret: 'sh', accessToken: 'tok' }
  const out = projectAllowed(row, ['id', 'label'])
  expect(out).toEqual({ id: 1, label: 'ok' })
  expect(Object.keys(out)).toHaveLength(2)
  expect(containsForbiddenKey(out)).toBe(false)
})

test('projectAllowed omits allowed keys the row does not have', () => {
  expect(projectAllowed({ id: 1 }, ['id', 'missing'])).toEqual({ id: 1 })
})

test('projectAllowed does not pick up inherited properties', () => {
  const base = { inherited: 'nope' }
  const row = Object.create(base)
  row.own = 'yes'
  expect(projectAllowed(row, ['own', 'inherited'])).toEqual({ own: 'yes' })
})

test('safeErrorMetadata caps length and strips secret-looking content', () => {
  expect(safeErrorMetadata(new Error('Invalid `to` field'))).toBe('Invalid `to` field')
  expect(safeErrorMetadata({ message: 'x'.repeat(500) })).toHaveLength(200)
  expect(safeErrorMetadata({ message: 'failed with token=abc123' })).not.toContain('abc123')
  expect(safeErrorMetadata(null)).toBe('unknown_error')
  expect(safeErrorMetadata({})).toBe('unknown_error')
})
