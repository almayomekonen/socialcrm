import { test, expect } from 'vitest'
import { parseContextRef, formatContextRef } from '@/lib/support/supportContext'

test('a well-formed ref round-trips', () => {
  const ref = formatContextRef('integration', 'whatsapp', '41')
  expect(ref).toBe('integration:whatsapp:41')
  expect(parseContextRef(ref)).toEqual({ kind: 'integration', subject: 'whatsapp', id: '41' })
})

test('an unknown kind is rejected', () => {
  expect(parseContextRef('wallet:stripe:1')).toBeNull()
})

test('malformed refs are rejected rather than partially parsed', () => {
  for (const bad of ['', 'integration', 'integration:', 'integration:whatsapp', ':::', 'a:b:c:d']) {
    expect(parseContextRef(bad)).toBeNull()
  }
})

test('null and non-string input are rejected', () => {
  expect(parseContextRef(null)).toBeNull()
  // @ts-expect-error deliberately wrong type
  expect(parseContextRef(42)).toBeNull()
})

test('injection-shaped segments are rejected, not escaped', () => {
  for (const bad of [
    'integration:whatsapp:41 OR 1=1',
    'integration:what%20sapp:41',
    'integration:whatsapp:../../etc',
    "integration:whatsapp:41';DROP TABLE users;--",
    'integration:whatsapp:41;41',
  ]) {
    expect(parseContextRef(bad)).toBeNull()
  }
})

test('an oversized ref is rejected before parsing', () => {
  expect(parseContextRef('integration:whatsapp:' + '9'.repeat(500))).toBeNull()
})

test('a ref naming another agency is still only a REFERENCE, never a payload', () => {
  // Parsing succeeds — it is well-formed. Whether id 999 belongs to the caller's
  // agency is decided by the resolver against the SESSION's tenant, never here.
  // This test exists to pin that separation: parsing must not be mistaken for
  // authorization.
  expect(parseContextRef('integration:whatsapp:999')).toEqual({
    kind: 'integration',
    subject: 'whatsapp',
    id: '999',
  })
})
