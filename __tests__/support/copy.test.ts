import { test, expect } from 'vitest'
import { SUPPORT_CATEGORIES, SUPPORT_STATUSES, SUPPORT_KINDS } from '@/lib/support/vocabulary'
import { STATUS_COPY, CATEGORY_COPY, KIND_COPY, supportErrorMessage } from '@/lib/support/copy'

const EMOJI = /\p{Extended_Pictographic}/u

test('every status has Hebrew copy and a semantic role', () => {
  for (const s of SUPPORT_STATUSES) {
    expect(STATUS_COPY[s].label.length).toBeGreaterThan(0)
    expect(['info', 'success', 'warning', 'error', 'neutral']).toContain(STATUS_COPY[s].role)
  }
})

test('waiting_for_customer reads as an instruction to the reader', () => {
  expect(STATUS_COPY.waiting_for_customer.label).toBe('ממתינה לתשובתך')
})

test('every category has Hebrew copy', () => {
  for (const c of SUPPORT_CATEGORIES) expect(CATEGORY_COPY[c].length).toBeGreaterThan(0)
})

test('every kind has a tile title and description', () => {
  for (const k of SUPPORT_KINDS) {
    expect(KIND_COPY[k].tileTitle.length).toBeGreaterThan(0)
    expect(KIND_COPY[k].tileDescription.length).toBeGreaterThan(0)
  }
  expect(KIND_COPY.problem.tileTitle).toBe('יש לי תקלה')
  expect(KIND_COPY.question.tileTitle).toBe('יש לי שאלה')
})

test('no copy string contains an emoji', () => {
  const all = [
    ...Object.values(STATUS_COPY).map((v) => v.label),
    ...Object.values(CATEGORY_COPY),
    ...Object.values(KIND_COPY).flatMap((v) => [v.tileTitle, v.tileDescription, v.formTitle]),
  ]
  for (const s of all) expect(EMOJI.test(s)).toBe(false)
})

test('an unknown error code degrades to a generic Hebrew message', () => {
  expect(supportErrorMessage('rate_limited')).toContain('פניות')
  // @ts-expect-error deliberately outside the union
  expect(supportErrorMessage('meteor_strike')).toBe('הפעולה נכשלה. נסו שוב.')
})
