import { describe, it, expect } from 'vitest'
import { slugifyTemplateName, buildComponents, hasUnexampledParameters } from '@/lib/whatsapp/templates/components'

describe('slugifyTemplateName', () => {
  it('slugs an ascii title to [a-z0-9_]', () => {
    expect(slugifyTemplateName('Follow Up')).toBe('follow_up')
    expect(slugifyTemplateName('Promo 2026!!')).toBe('promo_2026')
  })
  it('a Hebrew (non-ascii) title falls back to a neutral base (no PII)', () => {
    expect(slugifyTemplateName('תזכורת פולואפ')).toBe('ready_message')
  })
  it('empty / whitespace → neutral base', () => {
    expect(slugifyTemplateName('')).toBe('ready_message')
    expect(slugifyTemplateName('   ')).toBe('ready_message')
  })
  it('uniquifies against existing names with a numeric suffix', () => {
    expect(slugifyTemplateName('Follow Up', ['follow_up'])).toBe('follow_up_2')
    expect(slugifyTemplateName('Follow Up', ['follow_up', 'follow_up_2'])).toBe('follow_up_3')
    expect(slugifyTemplateName('תזכורת', ['ready_message'])).toBe('ready_message_2')
  })
  it('caps length and only emits allowed characters', () => {
    const out = slugifyTemplateName('x'.repeat(200))
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out).toMatch(/^[a-z0-9_]+$/)
  })
})

describe('buildComponents', () => {
  it('a plain body → one BODY component, no example', () => {
    expect(buildComponents('שלום, מה נשמע?', [])).toEqual([{ type: 'BODY', text: 'שלום, מה נשמע?' }])
  })

  it('replaces a friendly token with {{1}} and adds a matching example', () => {
    const out = buildComponents('היי שם הליד, מה קורה?', [{ token: 'שם הליד', sample: 'דוד' }])
    expect(out).toEqual([{ type: 'BODY', text: 'היי {{1}}, מה קורה?', example: { body_text: [['דוד']] } }])
  })

  it('orders placeholders by first appearance in the body', () => {
    const out = buildComponents('מ־שם העסק אל שם הליד', [
      { token: 'שם הליד', sample: 'דוד' },
      { token: 'שם העסק', sample: 'העסק' },
    ])
    // שם העסק appears first → {{1}}, שם הליד second → {{2}}
    expect(out[0].text).toBe('מ־{{1}} אל {{2}}')
    expect(out[0].example).toEqual({ body_text: [['העסק', 'דוד']] })
  })

  it('drops variables not present in the body (so {{n}} count matches example count)', () => {
    const out = buildComponents('היי שם הליד', [
      { token: 'שם הליד', sample: 'דוד' },
      { token: 'שם העסק', sample: 'העסק' }, // not in the body
    ])
    expect(out[0].text).toBe('היי {{1}}')
    expect(out[0].example).toEqual({ body_text: [['דוד']] })
  })

  it('every occurrence of a token maps to the same placeholder', () => {
    const out = buildComponents('שם הליד, שם הליד!', [{ token: 'שם הליד', sample: 'דוד' }])
    expect(out[0].text).toBe('{{1}}, {{1}}!')
    expect(out[0].example).toEqual({ body_text: [['דוד']] })
  })
})

describe('hasUnexampledParameters — assembly guard (never a placeholder without an example)', () => {
  it('true for the exact rejected payload: raw {{...}} passed through with no example', () => {
    // Reproduces the production INVALID_FORMAT row: named placeholders typed by
    // hand, variables=[] → buildComponents leaves them un-converted, no example.
    const out = buildComponents('היי {{lead_name}}, כאן {{business_name}}', [])
    expect(out[0].example).toBeUndefined()
    expect(hasUnexampledParameters(out)).toBe(true)
  })

  it('false for a properly-built component (positional {{n}} each with an example)', () => {
    const out = buildComponents('היי שם הליד מ־שם העסק', [
      { token: 'שם הליד', sample: 'דוד' },
      { token: 'שם העסק', sample: 'העסק' },
    ])
    expect(hasUnexampledParameters(out)).toBe(false)
  })

  it('false for a plain body with no placeholders', () => {
    expect(hasUnexampledParameters(buildComponents('שלום, מה נשמע?', []))).toBe(false)
  })
})
