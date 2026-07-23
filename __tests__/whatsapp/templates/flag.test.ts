import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// `server-only` throws outside an RSC bundle; neutralize it for this Node test.
vi.mock('server-only', () => ({}))

const { isTemplatesEnabledForAgency } = await import('@/lib/whatsapp/templates/flag')

const ENV = 'WHATSAPP_TEMPLATES_AGENCY_ALLOWLIST'
let original: string | undefined

beforeEach(() => {
  original = process.env[ENV]
})
afterEach(() => {
  if (original === undefined) delete process.env[ENV]
  else process.env[ENV] = original
})

describe('isTemplatesEnabledForAgency', () => {
  it('OFF by default (empty / unset allowlist)', () => {
    delete process.env[ENV]
    expect(isTemplatesEnabledForAgency(103)).toBe(false)
    process.env[ENV] = ''
    expect(isTemplatesEnabledForAgency(103)).toBe(false)
    process.env[ENV] = '   '
    expect(isTemplatesEnabledForAgency(103)).toBe(false)
  })

  it('opts in a listed agency only', () => {
    process.env[ENV] = '103, 69'
    expect(isTemplatesEnabledForAgency(103)).toBe(true)
    expect(isTemplatesEnabledForAgency(69)).toBe(true)
    expect(isTemplatesEnabledForAgency(42)).toBe(false)
  })

  it('`all` enables every agency', () => {
    process.env[ENV] = 'all'
    expect(isTemplatesEnabledForAgency(1)).toBe(true)
    process.env[ENV] = 'ALL'
    expect(isTemplatesEnabledForAgency(999)).toBe(true)
  })

  it('never enables for a missing / non-numeric agency id', () => {
    process.env[ENV] = 'all'
    expect(isTemplatesEnabledForAgency(null)).toBe(false)
    expect(isTemplatesEnabledForAgency(undefined)).toBe(false)
  })

  it('ignores malformed entries', () => {
    process.env[ENV] = '103, abc, ,69'
    expect(isTemplatesEnabledForAgency(103)).toBe(true)
    expect(isTemplatesEnabledForAgency(69)).toBe(true)
    expect(isTemplatesEnabledForAgency(NaN)).toBe(false)
  })
})
