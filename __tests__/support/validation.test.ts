import { test, expect } from 'vitest'
import { validateNewRequest, validateReplyBody } from '@/lib/support/validation'

const ok = { subject: 'WhatsApp לא מתחבר', category: 'whatsapp', body: 'ניסיתי לחבר מחדש ולא עבד' }

test('a well-formed request passes and is trimmed', () => {
  const res = validateNewRequest({ ...ok, subject: '  נושא תקין  ', hasContext: false })
  expect(res.ok).toBe(true)
  if (res.ok) expect(res.value.subject).toBe('נושא תקין')
})

test('an empty or overlong subject is rejected', () => {
  for (const subject of ['', '   ', 'x'.repeat(201)]) {
    const res = validateNewRequest({ ...ok, subject, hasContext: false })
    expect(res).toEqual({ ok: false, reason: 'invalid_subject' })
  }
})

test('an unknown category is rejected', () => {
  const res = validateNewRequest({ ...ok, category: 'wallet', hasContext: false })
  expect(res).toEqual({ ok: false, reason: 'invalid_category' })
})

// --- the action-layer half of the three-layer body contract ---

test('body is required at 10 chars when there is NO resolved context', () => {
  const res = validateNewRequest({ ...ok, body: 'קצר', hasContext: false })
  expect(res).toEqual({ ok: false, reason: 'invalid_body' })
})

test('an entirely empty body is rejected when there is NO resolved context', () => {
  const res = validateNewRequest({ ...ok, body: '', hasContext: false })
  expect(res).toEqual({ ok: false, reason: 'invalid_body' })
})

test('whitespace cannot fake a body when there is NO resolved context', () => {
  const res = validateNewRequest({ ...ok, body: '          ', hasContext: false })
  expect(res).toEqual({ ok: false, reason: 'invalid_body' })
})

test('body is OPTIONAL when a context resolved — the system already said what happened', () => {
  const res = validateNewRequest({ ...ok, body: '', hasContext: true })
  expect(res.ok).toBe(true)
  if (res.ok) expect(res.value.body).toBe('')
})

test('a whitespace-only body with context normalises to empty, not to whitespace', () => {
  const res = validateNewRequest({ ...ok, body: '   \n  ', hasContext: true })
  expect(res.ok).toBe(true)
  if (res.ok) expect(res.value.body).toBe('')
})

test('a short body IS allowed when context resolved', () => {
  const res = validateNewRequest({ ...ok, body: 'היום', hasContext: true })
  expect(res.ok).toBe(true)
  if (res.ok) expect(res.value.body).toBe('היום')
})

test('an overlong body is rejected in both modes', () => {
  for (const hasContext of [true, false]) {
    const res = validateNewRequest({ ...ok, body: 'x'.repeat(5001), hasContext })
    expect(res).toEqual({ ok: false, reason: 'invalid_body' })
  }
})

test('a reply must always have content, in either mode', () => {
  expect(validateReplyBody('   ')).toEqual({ ok: false, reason: 'invalid_body' })
  expect(validateReplyBody('')).toEqual({ ok: false, reason: 'invalid_body' })
  expect(validateReplyBody('תודה')).toEqual({ ok: true, value: 'תודה' })
})
