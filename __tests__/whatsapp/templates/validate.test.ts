import { describe, it, expect } from 'vitest'
import { validateTemplateInput, type ValidationResult } from '@/lib/whatsapp/templates/validate'
import { TEMPLATE_LIMITS, TEMPLATE_VALIDATION_COPY } from '@/lib/whatsapp/templates/messages'
import type { TemplateInput, TemplatePurpose } from '@/lib/whatsapp/templates/types'

const errorsOf = (r: ValidationResult): string[] => ('errors' in r ? r.errors : [])

const valid: TemplateInput = {
  displayTitle: 'תזכורת פולואפ',
  bodyText: 'היי שם הליד, רצינו להזכיר לגבי הפנייה שלך.',
  purpose: 'UTILITY',
  variables: [{ token: 'שם הליד', sample: 'דוד' }],
}

describe('validateTemplateInput — happy path', () => {
  it('accepts a well-formed input', () => {
    expect(validateTemplateInput(valid)).toEqual({ ok: true })
  })
  it('accepts MARKETING purpose and no variables', () => {
    expect(validateTemplateInput({ ...valid, purpose: 'MARKETING', variables: [] })).toEqual({ ok: true })
  })
})

describe('validateTemplateInput — title', () => {
  it('rejects a missing/blank title', () => {
    expect(errorsOf(validateTemplateInput({ ...valid, displayTitle: '   ' }))).toContain(
      TEMPLATE_VALIDATION_COPY.titleRequired,
    )
  })
  it('rejects an over-long title', () => {
    expect(
      errorsOf(validateTemplateInput({ ...valid, displayTitle: 'x'.repeat(TEMPLATE_LIMITS.titleMax + 1) })),
    ).toContain(TEMPLATE_VALIDATION_COPY.titleTooLong)
  })
})

describe('validateTemplateInput — body', () => {
  it('rejects an empty body', () => {
    expect(errorsOf(validateTemplateInput({ ...valid, bodyText: '' }))).toContain(
      TEMPLATE_VALIDATION_COPY.bodyRequired,
    )
  })
  it('rejects an over-long body', () => {
    expect(
      errorsOf(validateTemplateInput({ ...valid, bodyText: 'x'.repeat(TEMPLATE_LIMITS.bodyMax + 1) })),
    ).toContain(TEMPLATE_VALIDATION_COPY.bodyTooLong)
  })
})

describe('validateTemplateInput — purpose (RFC §8)', () => {
  it('requires a valid purpose', () => {
    const r = validateTemplateInput({ ...valid, purpose: undefined as unknown as TemplatePurpose })
    expect(r.ok).toBe(false)
    expect(errorsOf(r)).toContain(TEMPLATE_VALIDATION_COPY.purposeRequired)
  })
})

describe('validateTemplateInput — closed variable set (RFC §10)', () => {
  it('accepts the allowed tokens', () => {
    expect(
      validateTemplateInput({
        ...valid,
        bodyText: 'היי שם הליד מ־שם העסק',
        variables: [
          { token: 'שם הליד', sample: 'דוד' },
          { token: 'שם העסק', sample: 'העסק' },
        ],
      }),
    ).toEqual({ ok: true })
  })
  it('rejects a variable outside the closed set', () => {
    expect(errorsOf(validateTemplateInput({ ...valid, variables: [{ token: 'מספר טלפון', sample: '050' }] }))).toContain(
      TEMPLATE_VALIDATION_COPY.unknownVariable,
    )
  })
})

describe('validateTemplateInput — accumulates errors', () => {
  it('reports every problem at once', () => {
    const r = validateTemplateInput({
      displayTitle: '',
      bodyText: '',
      purpose: 'NOPE' as unknown as TemplatePurpose,
      variables: [{ token: 'bad', sample: 'x' }],
    })
    expect(errorsOf(r).length).toBe(4)
  })
})
