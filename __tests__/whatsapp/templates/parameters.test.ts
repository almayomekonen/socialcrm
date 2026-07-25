import { describe, it, expect } from 'vitest'
import {
  bodyParameterIndices,
  bodyParameterCount,
  resolveParameters,
  resolveTemplateSendParameters,
  renderPositionalBody,
  hasPositionalPlaceholder,
  hydrateUserFacingBody,
  chipVariablesIn,
  type ParameterBinding,
} from '@/lib/whatsapp/templates/parameters'

/**
 * The canonical parameter model (source-agnostic). Arity is owned by the body's
 * {{n}}; meaning is owned by explicit bindings; a missing binding is `unmapped`,
 * never a silent wrong count.
 */

const ctx = { leadFullName: 'דוד כהן', businessName: 'סושיאל בע"מ' }

describe('bodyParameterIndices / bodyParameterCount — arity from the body', () => {
  it('no placeholders → 0', () => {
    expect(bodyParameterCount('שלום, מה נשמע?')).toBe(0)
    expect(bodyParameterIndices('')).toEqual([])
  })
  it('counts the highest positional index', () => {
    expect(bodyParameterCount('היי {{1}}, מ־{{2}}')).toBe(2)
    expect(bodyParameterIndices('היי {{1}}, מ־{{2}}')).toEqual([1, 2])
  })
  it('is order-independent and de-duplicates repeats', () => {
    expect(bodyParameterCount('{{2}} ... {{1}} ... {{1}}')).toBe(2)
    expect(bodyParameterIndices('{{2}} {{1}} {{1}}')).toEqual([1, 2])
  })
  it('tolerates inner whitespace', () => {
    expect(bodyParameterCount('היי {{ 1 }}')).toBe(1)
  })
  it('a gap reports the max (missing slot surfaces later as unmapped)', () => {
    expect(bodyParameterCount('{{1}} {{3}}')).toBe(3)
    expect(bodyParameterIndices('{{1}} {{3}}')).toEqual([1, 3])
  })
})

describe('resolveParameters — fully bound (in-app templates keep working)', () => {
  it('resolves exactly `arity` params, in position order, non-empty', () => {
    const bindings: ParameterBinding[] = [
      { position: 1, source: 'leadFirstName' },
      { position: 2, source: 'businessName' },
    ]
    const r = resolveParameters(2, bindings, ctx)
    expect(r).toEqual({ ok: true, params: ['דוד', 'סושיאל בע"מ'] })
  })

  it('resolves by position regardless of binding array order', () => {
    const bindings: ParameterBinding[] = [
      { position: 2, source: 'businessName' },
      { position: 1, source: 'leadFirstName' },
    ]
    const r = resolveParameters(2, bindings, ctx)
    expect(r).toEqual({ ok: true, params: ['דוד', 'סושיאל בע"מ'] })
  })

  it('missing lead name still yields a non-empty param (fallback)', () => {
    const r = resolveParameters(1, [{ position: 1, source: 'leadFirstName' }], { leadFullName: '  ', businessName: 'ע' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.params[0].trim().length).toBeGreaterThan(0)
  })

  it('arity 0 → empty params (no placeholders)', () => {
    expect(resolveParameters(0, [], ctx)).toEqual({ ok: true, params: [] })
  })
})

describe('resolveParameters — unmapped (adopted Meta templates block, never wrong count)', () => {
  it('the exact production case: arity 2, no bindings → unmapped [1,2]', () => {
    // lead_first_contact: body has {{1}}/{{2}} but variables=[] → no bindings.
    const r = resolveParameters(2, [], ctx)
    expect(r).toEqual({ ok: false, reason: 'unmapped', positions: [1, 2] })
  })

  it('a null-source binding is unmapped', () => {
    const r = resolveParameters(1, [{ position: 1, source: null }], ctx)
    expect(r).toEqual({ ok: false, reason: 'unmapped', positions: [1] })
  })

  it('a partially-bound template reports only the missing positions', () => {
    const r = resolveParameters(2, [{ position: 1, source: 'leadFirstName' }], ctx)
    expect(r).toEqual({ ok: false, reason: 'unmapped', positions: [2] })
  })

  it('an unknown/legacy source is treated as unmapped, never silently filled', () => {
    const r = resolveParameters(1, [{ position: 1, source: 'phoneNumber' as never }], ctx)
    expect(r).toEqual({ ok: false, reason: 'unmapped', positions: [1] })
  })

  it('a gap in a non-contiguous body surfaces as unmapped for the missing slot', () => {
    // arity 3 (max index), only positions 1 and 3 bound → position 2 unmapped.
    const bindings: ParameterBinding[] = [
      { position: 1, source: 'leadFirstName' },
      { position: 3, source: 'businessName' },
    ]
    const r = resolveParameters(3, bindings, ctx)
    expect(r).toEqual({ ok: false, reason: 'unmapped', positions: [2] })
  })
})

describe('resolveTemplateSendParameters — source-agnostic bridge', () => {
  it('in-app template (chip variables present) → existing token resolution, unchanged', () => {
    const r = resolveTemplateSendParameters(
      { bodyText: 'היי שם הליד מ־שם העסק', variables: [{ token: 'שם הליד', sample: 'ד' }, { token: 'שם העסק', sample: 'ע' }], bindings: [] },
      ctx,
    )
    expect(r).toEqual({ ok: true, params: ['דוד', 'סושיאל בע"מ'] })
  })

  it('Meta-synced template (positional body + bindings) → resolves by position', () => {
    // The exact lead_first_contact shape: variables=[], body has {{1}}/{{2}}, bindings set.
    const r = resolveTemplateSendParameters(
      {
        bodyText: 'היי {{1}}, תודה שהתעניינת ב{{2}}.',
        variables: [],
        bindings: [{ position: 1, source: 'leadFirstName' }, { position: 2, source: 'businessName' }],
      },
      ctx,
    )
    expect(r).toEqual({ ok: true, params: ['דוד', 'סושיאל בע"מ'] })
  })

  it('Meta-synced template with NO bindings → unmapped (blocked, the #132000 fix)', () => {
    const r = resolveTemplateSendParameters(
      { bodyText: 'היי {{1}}, ב{{2}}', variables: [], bindings: [] },
      ctx,
    )
    expect(r).toEqual({ ok: false, reason: 'unmapped', positions: [1, 2] })
  })

  it('parameterless template (either source) → empty params', () => {
    expect(resolveTemplateSendParameters({ bodyText: 'תודה שפנית!', variables: [], bindings: [] }, ctx)).toEqual({ ok: true, params: [] })
  })
})

describe('renderPositionalBody', () => {
  it('substitutes {{n}} with the resolved params', () => {
    expect(renderPositionalBody('היי {{1}}, ב{{2}}.', ['דוד', 'סושיאל'])).toBe('היי דוד, בסושיאל.')
  })
  it('tolerates inner whitespace and repeats', () => {
    expect(renderPositionalBody('{{ 1 }} {{1}}', ['דוד'])).toBe('דוד דוד')
  })
})

describe('hasPositionalPlaceholder', () => {
  it('detects raw Meta {{n}} placeholders only', () => {
    expect(hasPositionalPlaceholder('היי {{1}}')).toBe(true)
    expect(hasPositionalPlaceholder('מ־{{ 2 }}')).toBe(true)
    expect(hasPositionalPlaceholder('היי שם הליד')).toBe(false) // chip form
    expect(hasPositionalPlaceholder('')).toBe(false)
  })
})

describe('hydrateUserFacingBody — inverse of buildComponents (never leak {{n}})', () => {
  const FULL: ParameterBinding[] = [
    { position: 1, source: 'leadFirstName' },
    { position: 2, source: 'businessName' },
  ]

  it('a chip body (no {{n}}) passes through unchanged', () => {
    const r = hydrateUserFacingBody('היי שם הליד, מ־שם העסק', [])
    expect(r).toEqual({ ok: true, bodyText: 'היי שם הליד, מ־שם העסק' })
  })

  it('reconstructs chips from positional {{n}} + bindings', () => {
    const r = hydrateUserFacingBody('היי {{1}}, תודה שהתעניינת ב{{2}}.', FULL)
    expect(r).toEqual({ ok: true, bodyText: 'היי שם הליד, תודה שהתעניינת בשם העסק.' })
  })

  it('handles the exact production lead_first_contact body', () => {
    const body = 'Helloהיי {{1}},\n\nתודה שהתעניינת ב{{2}}.\n\nקיבלנו את הפרטים שלך.'
    const r = hydrateUserFacingBody(body, FULL)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bodyText).toBe('Helloהיי שם הליד,\n\nתודה שהתעניינת בשם העסק.\n\nקיבלנו את הפרטים שלך.')
      expect(hasPositionalPlaceholder(r.bodyText)).toBe(false) // no {{n}} left for the editor
    }
  })

  it('a placeholder with no binding is UNMAPPED (never guessed)', () => {
    const r = hydrateUserFacingBody('{{1}} {{2}}', [{ position: 1, source: 'leadFirstName' }])
    expect(r).toEqual({ ok: false, reason: 'unmapped', positions: [2] })
  })

  it('a null-source binding is unmapped', () => {
    const r = hydrateUserFacingBody('היי {{1}}', [{ position: 1, source: null }])
    expect(r).toEqual({ ok: false, reason: 'unmapped', positions: [1] })
  })
})

describe('chipVariablesIn', () => {
  it('returns the closed-set chips present in a user-facing body, with samples', () => {
    expect(chipVariablesIn('היי שם הליד מ־שם העסק')).toEqual([
      { token: 'שם הליד', sample: 'דוד' },
      { token: 'שם העסק', sample: 'העסק שלי' },
    ])
  })
  it('empty when no chips present', () => {
    expect(chipVariablesIn('טקסט רגיל')).toEqual([])
  })
})
