import { test, expect } from 'vitest'
import { buildDiagnostics, sanitiseClientRoute } from '@/lib/support/diagnostics'
import { containsForbiddenKey } from '@/lib/support/redaction'

const base = {
  agencyId: 101,
  userId: 5,
  plan: 'pro',
  trialStatus: 'PAID',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36',
  appVersion: '8f5d8d48',
  clientRoute: '/settings/integrations',
  now: new Date('2026-08-10T09:00:00Z'),
}

test('the snapshot carries the fields support actually needs', () => {
  const d = buildDiagnostics(base)
  expect(d.agencyId).toBe(101)
  expect(d.userId).toBe(5)
  expect(d.browser).toBe('Chrome')
  expect(d.os).toBe('macOS')
  expect(d.plan).toBe('pro')
  expect(d.appVersion).toBe('8f5d8d48')
  expect(d.submittedAt).toBe('2026-08-10T09:00:00.000Z')
})

test('no IP address is captured', () => {
  expect(Object.keys(buildDiagnostics(base))).not.toContain('ip')
})

test('the snapshot never contains a secret-looking key', () => {
  expect(containsForbiddenKey(buildDiagnostics(base))).toBe(false)
})

test('a missing user agent degrades rather than throwing', () => {
  const d = buildDiagnostics({ ...base, userAgent: null, appVersion: null, plan: null, trialStatus: null })
  expect(d.browser.length).toBeGreaterThan(0)
  expect(d.os.length).toBeGreaterThan(0)
  expect(d.appVersion).toBeNull()
  expect(d.plan).toBeNull()
})

test('clientRoute keeps only the pathname', () => {
  expect(sanitiseClientRoute('/leads?filter=new#top')).toBe('/leads')
  expect(sanitiseClientRoute('/support/new?ctx=integration:whatsapp:99')).toBe('/support/new')
})

test('clientRoute is capped and stripped of control characters', () => {
  expect(sanitiseClientRoute('/' + 'a'.repeat(500))).toHaveLength(200)
  expect(sanitiseClientRoute('/leads \u001B[31m')).toBe('/leads')
})

test('a non-path clientRoute degrades to empty rather than being stored raw', () => {
  expect(sanitiseClientRoute('https://evil.example.com/steal')).toBe('')
  expect(sanitiseClientRoute('//evil.example.com')).toBe('')
  expect(sanitiseClientRoute('javascript:alert(1)')).toBe('')
  expect(sanitiseClientRoute(null)).toBe('')
  expect(sanitiseClientRoute('../../etc/passwd')).toBe('')
  expect(sanitiseClientRoute('/leads/../../etc')).toBe('')
})
