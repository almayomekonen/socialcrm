import { describe, it, expect } from 'vitest'
import {
  firstNameOf,
  resolveFieldValue,
  resolveTemplateParams,
  renderResolvedBody,
  TEMPLATE_VALUE_FALLBACK,
} from '@/lib/whatsapp/templates/variables'
import { buildComponents } from '@/lib/whatsapp/templates/components'
import type { TemplateVariable } from '@/lib/whatsapp/templates/types'

/**
 * Pure send-time resolution (RFC §10). Two invariants are load-bearing:
 * param ORDER must match `buildComponents`, and NO param is ever empty.
 */

const LEAD = { token: 'שם הליד', sample: 'דוד' } as TemplateVariable
const BIZ = { token: 'שם העסק', sample: 'העסק שלי' } as TemplateVariable

describe('firstNameOf', () => {
  it('takes the first whitespace-delimited part', () => {
    expect(firstNameOf('דוד כהן')).toBe('דוד')
    expect(firstNameOf('  Yossi   Levi ')).toBe('Yossi')
  })
  it('returns empty for empty / whitespace / null', () => {
    expect(firstNameOf('')).toBe('')
    expect(firstNameOf('   ')).toBe('')
    expect(firstNameOf(null)).toBe('')
    expect(firstNameOf(undefined)).toBe('')
  })
})

describe('resolveFieldValue — guaranteed non-empty', () => {
  it('resolves the lead first name and business name', () => {
    const ctx = { leadFullName: 'דוד כהן', businessName: 'סושיאל בע"מ' }
    expect(resolveFieldValue('leadFirstName', ctx)).toBe('דוד')
    expect(resolveFieldValue('businessName', ctx)).toBe('סושיאל בע"מ')
  })
  it('falls back when the lead has no name', () => {
    const ctx = { leadFullName: '', businessName: 'עסק' }
    expect(resolveFieldValue('leadFirstName', ctx)).toBe(TEMPLATE_VALUE_FALLBACK.leadFirstName)
  })
  it('falls back when the business name is missing', () => {
    const ctx = { leadFullName: 'דוד', businessName: null }
    expect(resolveFieldValue('businessName', ctx)).toBe(TEMPLATE_VALUE_FALLBACK.businessName)
  })
  it('an unknown field still yields a non-empty value', () => {
    expect(resolveFieldValue('nope', { leadFullName: null, businessName: null })).not.toBe('')
  })
})

describe('resolveTemplateParams — order matches buildComponents', () => {
  it('orders params by first appearance in the body (biz before lead here)', () => {
    const body = 'שלום, מדברים מ־שם העסק. שם הליד, יש עדכון.'
    const vars = [LEAD, BIZ] // declared lead-first, but biz appears first in the body
    const ctx = { leadFullName: 'דוד כהן', businessName: 'סושיאל' }
    // buildComponents produces {{1}} for biz, {{2}} for lead
    const comps = buildComponents(body, vars)
    expect(comps[0].text).toContain('מ־{{1}}')
    expect(comps[0].text).toContain('{{2}}, יש עדכון')
    // params must line up: [biz, lead]
    expect(resolveTemplateParams(body, vars, ctx)).toEqual(['סושיאל', 'דוד'])
  })

  it('includes only variables present in the body', () => {
    const body = 'היי שם הליד' // biz token not used
    const params = resolveTemplateParams(body, [LEAD, BIZ], { leadFullName: 'רון', businessName: 'עסק' })
    expect(params).toEqual(['רון'])
  })

  it('never emits an empty parameter (missing lead name → fallback)', () => {
    const body = 'היי שם הליד'
    const params = resolveTemplateParams(body, [LEAD], { leadFullName: '  ', businessName: 'עסק' })
    expect(params).toEqual([TEMPLATE_VALUE_FALLBACK.leadFirstName])
    expect(params.every((p) => p.trim().length > 0)).toBe(true)
  })

  it('param arity equals the {{n}} count buildComponents emits', () => {
    const body = 'שם הליד, מ־שם העסק'
    const vars = [LEAD, BIZ]
    const comps = buildComponents(body, vars)
    const placeholders = (comps[0].text?.match(/\{\{\d+\}\}/g) ?? []).length
    expect(resolveTemplateParams(body, vars, { leadFullName: 'ד', businessName: 'ע' })).toHaveLength(placeholders)
  })

  it('no variables → no params', () => {
    expect(resolveTemplateParams('טקסט בלי משתנים', [], { leadFullName: 'x', businessName: 'y' })).toEqual([])
  })
})

describe('renderResolvedBody — human-readable persisted text', () => {
  it('substitutes every token with its resolved value', () => {
    const body = 'היי שם הליד, כאן שם העסק.'
    const out = renderResolvedBody(body, [LEAD, BIZ], { leadFullName: 'דוד כהן', businessName: 'סושיאל' })
    expect(out).toBe('היי דוד, כאן סושיאל.')
  })
  it('uses fallbacks so the persisted text is never left with a raw token', () => {
    const body = 'היי שם הליד'
    const out = renderResolvedBody(body, [LEAD], { leadFullName: '', businessName: null })
    expect(out).toBe(`היי ${TEMPLATE_VALUE_FALLBACK.leadFirstName}`)
    expect(out).not.toContain('שם הליד')
  })
})
