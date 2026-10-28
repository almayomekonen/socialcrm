import { afterEach, describe, expect, test } from 'vitest'
import { canUseUiLocales } from '@/lib/flags/uiLocaleFlags'

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
})

describe('UI_LOCALE rollout gate', () => {
  test('absence blocks: no env means nobody', () => {
    delete process.env.UI_LOCALE_ENABLED
    delete process.env.UI_LOCALE_AGENCY_ALLOWLIST
    expect(canUseUiLocales(103)).toBe(false)
  })

  test('master switch alone exposes nobody', () => {
    process.env.UI_LOCALE_ENABLED = '1'
    delete process.env.UI_LOCALE_AGENCY_ALLOWLIST
    expect(canUseUiLocales(103)).toBe(false)
  })

  test('pilot: agency 103 only', () => {
    process.env.UI_LOCALE_ENABLED = '1'
    process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
    expect(canUseUiLocales(103)).toBe(true)
    expect(canUseUiLocales(108)).toBe(false)
    expect(canUseUiLocales(null)).toBe(false)
  })

  test('allowlist without the master switch exposes nobody', () => {
    delete process.env.UI_LOCALE_ENABLED
    process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
    expect(canUseUiLocales(103)).toBe(false)
  })
})
