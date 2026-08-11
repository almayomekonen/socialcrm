import { test, expect } from 'vitest'
import { PERSISTED_CONTEXT_KEYS, toPersistedContext } from '@/lib/support/supportContext'
import { containsForbiddenKey } from '@/lib/support/redaction'

const full = {
  kind: 'integration',
  ref: 'integration:whatsapp:41',
  facts: [{ label: 'מצב', value: 'החיבור נותק' }],
  category: 'whatsapp',
  subjectHint: 'WhatsApp לא מתחבר',
  // Six fields a future resolver might add for its own use. None may persist.
  connectionRow: { id: 41, webhookSecret: 'sh-1', accessToken: 'tok-1' },
  rawError: { code: 190, message: 'Session expired' },
  internalNotes: 'retry after reauth',
  resolverVersion: 3,
  debugTimings: { ms: 12 },
  ownerUserId: 77,
} as any

test('only the five public keys survive projection', () => {
  const out = toPersistedContext(full)
  expect(Object.keys(out).sort()).toEqual([...PERSISTED_CONTEXT_KEYS].sort())
})

test('resolver internals and secrets never persist', () => {
  const out = toPersistedContext(full) as Record<string, unknown>
  expect(out.connectionRow).toBeUndefined()
  expect(out.rawError).toBeUndefined()
  expect(out.ownerUserId).toBeUndefined()
  expect(containsForbiddenKey(out)).toBe(false)
  expect(JSON.stringify(out)).not.toContain('sh-1')
  expect(JSON.stringify(out)).not.toContain('tok-1')
})

test('a null context persists as an empty object, matching the column default', () => {
  expect(toPersistedContext(null)).toEqual({})
})

test('the projection is a fresh object, not a reference to the resolver result', () => {
  const out = toPersistedContext(full) as Record<string, unknown>
  expect(out).not.toBe(full)
  ;(out as any).subjectHint = 'mutated'
  expect(full.subjectHint).toBe('WhatsApp לא מתחבר')
})

test('facts are rebuilt field-by-field so a fact cannot smuggle extra keys', () => {
  const sneaky = {
    ...full,
    facts: [{ label: 'מצב', value: 'החיבור נותק', accessToken: 'tok-2', rawId: 41 }],
  } as any
  const out = toPersistedContext(sneaky) as any
  expect(Object.keys(out.facts[0]).sort()).toEqual(['label', 'value'])
  expect(containsForbiddenKey(out)).toBe(false)
  expect(JSON.stringify(out)).not.toContain('tok-2')
})

test('a context with no facts still projects cleanly', () => {
  const out = toPersistedContext({ ...full, facts: undefined } as any) as any
  expect(out.facts).toEqual([])
})
