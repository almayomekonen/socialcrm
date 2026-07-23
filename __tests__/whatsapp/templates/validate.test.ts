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

describe('validateTemplateInput — raw {{...}} placeholders in the body (INVALID_FORMAT guard)', () => {
  // Our variables are inserted as picker chips (שם הליד), never as braces, so any
  // {{...}} typed by hand bypasses the picker and would reach Meta example-less.
  it('rejects a manual {{lead_name}}', () => {
    const r = validateTemplateInput({ ...valid, bodyText: 'היי {{lead_name}}, מה קורה?', variables: [] })
    expect(r.ok).toBe(false)
    expect(errorsOf(r)).toContain(TEMPLATE_VALIDATION_COPY.manualPlaceholder)
  })

  it('rejects a manual {{business_name}}', () => {
    const r = validateTemplateInput({ ...valid, bodyText: 'בברכה, {{business_name}}', variables: [] })
    expect(r.ok).toBe(false)
    expect(errorsOf(r)).toContain(TEMPLATE_VALIDATION_COPY.manualPlaceholder)
  })

  it('rejects mixed manual + picker (a chip AND a raw {{...}})', () => {
    // Body uses the real picker chip שם הליד but also a hand-typed {{business_name}}.
    const r = validateTemplateInput({
      ...valid,
      bodyText: 'היי שם הליד, מ־{{business_name}}',
      variables: [{ token: 'שם הליד', sample: 'דוד' }],
    })
    expect(r.ok).toBe(false)
    expect(errorsOf(r)).toContain(TEMPLATE_VALIDATION_COPY.manualPlaceholder)
  })

  it('rejects an unknown raw placeholder ({{foo}})', () => {
    const r = validateTemplateInput({ ...valid, bodyText: 'שלום {{foo}}', variables: [] })
    expect(r.ok).toBe(false)
    expect(errorsOf(r)).toContain(TEMPLATE_VALIDATION_COPY.manualPlaceholder)
  })

  it('accepts a valid picker-only template (chips, no braces)', () => {
    const r = validateTemplateInput({
      ...valid,
      bodyText: 'היי שם הליד, מדברים מ־שם העסק.',
      variables: [
        { token: 'שם הליד', sample: 'דוד' },
        { token: 'שם העסק', sample: 'העסק' },
      ],
    })
    expect(r).toEqual({ ok: true })
  })

  it('accepts a plain body with no variables at all', () => {
    expect(validateTemplateInput({ ...valid, bodyText: 'תודה שפנית אלינו!', variables: [] })).toEqual({ ok: true })
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
