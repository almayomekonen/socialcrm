import { test, expect } from 'vitest'
import { deriveSubject, deriveCategory, SUBJECT_DERIVED_MAX } from '@/lib/support/derive'

// --- deriveSubject: deterministic, bounded, never AI ---

test('the subject is the first line of what the customer wrote', () => {
  expect(deriveSubject('הוואטסאפ לא מתחבר\nניסיתי הכל')).toBe('הוואטסאפ לא מתחבר')
})

test('derivation is deterministic — same input, same output, every time', () => {
  const body = 'משהו נשבר בלידים היום בבוקר ואני לא מצליח להבין מה'
  const runs = new Set([deriveSubject(body), deriveSubject(body), deriveSubject(body)])
  expect(runs.size).toBe(1)
})

test('a long single line is cut at a word boundary, never mid-word', () => {
  const body = 'א'.repeat(30) + ' ' + 'ב'.repeat(30) + ' ' + 'ג'.repeat(120)
  const subject = deriveSubject(body)
  expect(subject.length).toBeLessThanOrEqual(SUBJECT_DERIVED_MAX)
  // Cut on whitespace: the result must not end mid-token.
  expect(body.startsWith(subject.replace(/…$/, ''))).toBe(true)
})

test('the subject is bounded regardless of input size', () => {
  expect(deriveSubject('x'.repeat(10_000)).length).toBeLessThanOrEqual(SUBJECT_DERIVED_MAX)
  expect(deriveSubject('מילה '.repeat(2000)).length).toBeLessThanOrEqual(SUBJECT_DERIVED_MAX)
})

test('an unbroken very long token is hard-cut rather than overflowing', () => {
  const subject = deriveSubject('א'.repeat(500))
  expect(subject.length).toBeLessThanOrEqual(SUBJECT_DERIVED_MAX)
  expect(subject.length).toBeGreaterThan(0)
})

test('whitespace, newlines and control characters collapse cleanly', () => {
  expect(deriveSubject('   הוואטסאפ   לא   מתחבר   ')).toBe('הוואטסאפ לא מתחבר')
  expect(deriveSubject('\n\n\nשלום\n\n')).toBe('שלום')
  expect(deriveSubject('a\tb')).toBe('a b')
})

test('an empty or whitespace-only body yields the neutral fallback, never an empty subject', () => {
  // subject is NOT NULL in the schema; an empty string would satisfy the column
  // but read as a blank row in the owner inbox.
  for (const body of ['', '   ', '\n\n', '\t']) {
    expect(deriveSubject(body)).toBe('פנייה חדשה')
  }
})

test('the derived subject never leaks internal concepts', () => {
  const subject = deriveSubject('agencyId 101 requestId 9 שבור')
  // It is verbatim customer text -- we do not invent, and we do not scrub what
  // they chose to type. What matters is that WE never add such terms.
  expect(subject).not.toContain('undefined')
  expect(subject).not.toContain('null')
})

// --- deriveCategory ---

test('category comes from the resolved context when there is one', () => {
  expect(deriveCategory({ category: 'whatsapp' } as any)).toBe('whatsapp')
  expect(deriveCategory({ category: 'billing' } as any)).toBe('billing')
})

test("category is 'other' when nothing resolved — the customer is never asked", () => {
  expect(deriveCategory(null)).toBe('other')
})

test('an out-of-vocabulary context category degrades to other rather than throwing', () => {
  expect(deriveCategory({ category: 'wallet' } as any)).toBe('other')
})
