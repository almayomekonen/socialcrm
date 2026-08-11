import { test, expect } from 'vitest'
import {
  validateNewRequest,
  validateReplyBody,
  assertDerivedSubject,
  assertDerivedCategory,
} from '@/lib/support/validation'

// --- the ONE field the customer fills ---

test('a body-only submission is valid — no subject, no category asked for', () => {
  const res = validateNewRequest({ body: 'הוואטסאפ לא מתחבר מהבוקר', hasContext: false })
  expect(res.ok).toBe(true)
  if (res.ok) expect(res.value).toEqual({ body: 'הוואטסאפ לא מתחבר מהבוקר' })
})

test('the body is trimmed', () => {
  const res = validateNewRequest({ body: '   הוואטסאפ לא מתחבר   ', hasContext: false })
  if (res.ok) expect(res.value.body).toBe('הוואטסאפ לא מתחבר')
})

// --- the action-layer half of the three-layer body contract ---

test('body is required at 10 chars when there is NO resolved context', () => {
  expect(validateNewRequest({ body: 'קצר', hasContext: false })).toEqual({
    ok: false,
    reason: 'invalid_body',
  })
})

test('an entirely empty body is rejected when there is NO resolved context', () => {
  expect(validateNewRequest({ body: '', hasContext: false })).toEqual({
    ok: false,
    reason: 'invalid_body',
  })
})

test('whitespace cannot fake a body when there is NO resolved context', () => {
  expect(validateNewRequest({ body: '          ', hasContext: false })).toEqual({
    ok: false,
    reason: 'invalid_body',
  })
})

test('body is OPTIONAL when a context resolved — the system already said what happened', () => {
  const res = validateNewRequest({ body: '', hasContext: true })
  expect(res.ok).toBe(true)
  if (res.ok) expect(res.value.body).toBe('')
})

test('a whitespace-only body with context normalises to empty, not to whitespace', () => {
  const res = validateNewRequest({ body: '   \n  ', hasContext: true })
  expect(res.ok).toBe(true)
  if (res.ok) expect(res.value.body).toBe('')
})

test('a short body IS allowed when context resolved', () => {
  const res = validateNewRequest({ body: 'היום', hasContext: true })
  expect(res.ok).toBe(true)
  if (res.ok) expect(res.value.body).toBe('היום')
})

test('an overlong body is rejected in both modes', () => {
  for (const hasContext of [true, false]) {
    expect(validateNewRequest({ body: 'x'.repeat(5001), hasContext })).toEqual({
      ok: false,
      reason: 'invalid_body',
    })
  }
})

// --- guards on the DERIVED values (not customer-facing) ---

test('a derived subject within bounds passes', () => {
  expect(assertDerivedSubject('הוואטסאפ לא מתחבר')).toEqual({
    ok: true,
    value: 'הוואטסאפ לא מתחבר',
  })
})

test('a derivation bug producing an empty or overlong subject fails loudly here', () => {
  // Not reachable from the UI — the customer cannot supply a subject. This
  // catches a broken derivation before the database does.
  expect(assertDerivedSubject('')).toEqual({ ok: false, reason: 'invalid_subject' })
  expect(assertDerivedSubject('   ')).toEqual({ ok: false, reason: 'invalid_subject' })
  expect(assertDerivedSubject('x'.repeat(201))).toEqual({ ok: false, reason: 'invalid_subject' })
})

test('a derived category must be inside the closed vocabulary', () => {
  expect(assertDerivedCategory('whatsapp')).toEqual({ ok: true, value: 'whatsapp' })
  expect(assertDerivedCategory('other')).toEqual({ ok: true, value: 'other' })
  expect(assertDerivedCategory('wallet')).toEqual({ ok: false, reason: 'invalid_category' })
})

// --- replies ---

test('a reply must always have content, in either mode', () => {
  expect(validateReplyBody('   ')).toEqual({ ok: false, reason: 'invalid_body' })
  expect(validateReplyBody('')).toEqual({ ok: false, reason: 'invalid_body' })
  expect(validateReplyBody('תודה')).toEqual({ ok: true, value: 'תודה' })
})
