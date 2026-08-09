import { describe, expect, it } from 'vitest'
import {
  MAX_ITEMS,
  MAX_ITEM_TITLE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_VALIDITY_DAYS,
  MIN_VALIDITY_DAYS,
  validateQuoteTemplateDraft,
  validateQuoteTemplateItem,
  withDenseLineNumbers,
  type QuoteTemplateDraft,
} from '@/lib/quotes/templateValidation'

/**
 * The validator mirrors the CHECK constraints in
 * migrations/20260809000002. These tests are what keeps the two honest: a bound
 * changed in one place and not the other shows up here rather than as a raw
 * 23514 in a user's face.
 */

const item = (over = {}) => ({
  title: 'חבילת אתר',
  description: '',
  quantity: 1,
  unitPrice: 4900,
  discount: 0,
  isOptional: false,
  ...over,
})

const draft = (over: Partial<QuoteTemplateDraft> = {}): QuoteTemplateDraft => ({
  name: 'חבילת אתר',
  title: 'הצעת מחיר',
  introText: '',
  termsText: '',
  validityDays: 14,
  items: [item()],
  ...over,
})

describe('template header validation', () => {
  it('accepts a well-formed draft', () => {
    expect(validateQuoteTemplateDraft(draft())).toBeNull()
  })

  it('requires a name, and treats whitespace as absent', () => {
    expect(validateQuoteTemplateDraft(draft({ name: '' }))).toBe('name_required')
    expect(validateQuoteTemplateDraft(draft({ name: '   ' }))).toBe('name_required')
  })

  it('bounds the name and the customer-facing title', () => {
    expect(validateQuoteTemplateDraft(draft({ name: 'x'.repeat(MAX_NAME_LENGTH) }))).toBeNull()
    expect(validateQuoteTemplateDraft(draft({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) }))).toBe('name_too_long')
    expect(validateQuoteTemplateDraft(draft({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }))).toBe('title_too_long')
  })

  it('a customer-facing title is optional', () => {
    expect(validateQuoteTemplateDraft(draft({ title: '' }))).toBeNull()
  })
})

describe('validity window — mirrors CHECK (validityDays BETWEEN 1 AND 90)', () => {
  it('accepts the inclusive bounds', () => {
    expect(validateQuoteTemplateDraft(draft({ validityDays: MIN_VALIDITY_DAYS }))).toBeNull()
    expect(validateQuoteTemplateDraft(draft({ validityDays: MAX_VALIDITY_DAYS }))).toBeNull()
  })

  it('refuses outside them, and refuses non-integers', () => {
    for (const v of [0, -1, MAX_VALIDITY_DAYS + 1, 14.5, NaN, Infinity]) {
      expect(validateQuoteTemplateDraft(draft({ validityDays: v })), `validityDays=${v}`).toBe('validity_invalid')
    }
  })
})

describe('items', () => {
  it('at least one item is required — an empty template is unusable, not empty', () => {
    // getQuoteTemplateSystem returns null for an item-less template, so one
    // saved empty would be listed and yet produce nothing.
    expect(validateQuoteTemplateDraft(draft({ items: [] }))).toBe('items_required')
  })

  it('bounds the number of items', () => {
    expect(validateQuoteTemplateDraft(draft({ items: Array.from({ length: MAX_ITEMS }, () => item()) }))).toBeNull()
    expect(validateQuoteTemplateDraft(draft({ items: Array.from({ length: MAX_ITEMS + 1 }, () => item()) }))).toBe(
      'too_many_items',
    )
  })

  it('every item needs a description of what it is', () => {
    expect(validateQuoteTemplateItem(item({ title: '' }))).toBe('item_title_required')
    expect(validateQuoteTemplateItem(item({ title: '  ' }))).toBe('item_title_required')
    expect(validateQuoteTemplateItem(item({ title: 'x'.repeat(MAX_ITEM_TITLE_LENGTH + 1) }))).toBe('item_title_too_long')
  })

  it('quantity must be positive — mirrors CHECK (quantity > 0)', () => {
    for (const q of [0, -1, NaN, Infinity]) {
      expect(validateQuoteTemplateItem(item({ quantity: q })), `quantity=${q}`).toBe('item_quantity_invalid')
    }
    expect(validateQuoteTemplateItem(item({ quantity: 0.5 }))).toBeNull()
  })

  it('a price of zero is legitimate — an included extra is not an error', () => {
    expect(validateQuoteTemplateItem(item({ unitPrice: 0 }))).toBeNull()
  })

  it('but a negative price or discount is not — mirrors CHECK (>= 0)', () => {
    expect(validateQuoteTemplateItem(item({ unitPrice: -1 }))).toBe('item_price_invalid')
    expect(validateQuoteTemplateItem(item({ discount: -1 }))).toBe('item_discount_invalid')
    expect(validateQuoteTemplateItem(item({ unitPrice: NaN }))).toBe('item_price_invalid')
  })

  it('the draft reports the FIRST bad item, so one message names one fix', () => {
    expect(validateQuoteTemplateDraft(draft({ items: [item(), item({ quantity: 0 }), item({ title: '' })] }))).toBe(
      'item_quantity_invalid',
    )
  })
})

describe('line ordering', () => {
  it('numbers densely from 1, in array order', () => {
    const numbered = withDenseLineNumbers([item({ title: 'א' }), item({ title: 'ב' }), item({ title: 'ג' })])
    expect(numbered.map((i) => i.lineNumber)).toEqual([1, 2, 3])
    expect(numbered.map((i) => i.title)).toEqual(['א', 'ב', 'ג'])
  })

  it('a reorder is an array move — the numbers follow, they are not carried', () => {
    // The editor swaps array entries; if line numbers travelled with the items
    // a reorder would produce a duplicate and hit the unique index.
    const items = [item({ title: 'א' }), item({ title: 'ב' })]
    const swapped = [items[1], items[0]]
    expect(withDenseLineNumbers(swapped).map((i) => [i.lineNumber, i.title])).toEqual([
      [1, 'ב'],
      [2, 'א'],
    ])
  })

  it('never emits a gap or a duplicate, whatever the input length', () => {
    for (const n of [1, 2, 7, MAX_ITEMS]) {
      const numbers = withDenseLineNumbers(Array.from({ length: n }, () => item())).map((i) => i.lineNumber)
      expect(new Set(numbers).size).toBe(n)
      expect(numbers).toEqual(Array.from({ length: n }, (_, i) => i + 1))
    }
  })

  it('does not mutate the input', () => {
    const items = [item()]
    withDenseLineNumbers(items)
    expect('lineNumber' in items[0]).toBe(false)
  })
})
