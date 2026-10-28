import { describe, expect, test } from 'vitest'
import { resolveUiLocale, agencyDefaultLocale } from '@/lib/i18n/resolve'
import { dirFor, isUiLocale, regionAttrs, untranslatedAttrs } from '@/lib/i18n/config'

describe('resolveUiLocale — precedence', () => {
  test('personal choice beats the agency default', () => {
    expect(resolveUiLocale({ enabled: true, userLocale: 'en', agencyLocale: 'ar' })).toEqual({ locale: 'en', source: 'user' })
  })

  test('agency default applies to a user without a personal choice', () => {
    expect(resolveUiLocale({ enabled: true, userLocale: null, agencyLocale: 'ar' })).toEqual({ locale: 'ar', source: 'agency' })
  })

  test('no choice anywhere is Hebrew — what existing customers already see', () => {
    expect(resolveUiLocale({ enabled: true, userLocale: null, agencyLocale: null })).toEqual({ locale: 'he', source: 'default' })
  })

  test('a personal Hebrew choice survives an agency default of English', () => {
    expect(resolveUiLocale({ enabled: true, userLocale: 'he', agencyLocale: 'en' })).toEqual({ locale: 'he', source: 'user' })
  })

  test('outside the rollout every stored value is ignored', () => {
    expect(resolveUiLocale({ enabled: false, userLocale: 'en', agencyLocale: 'ar' })).toEqual({ locale: 'he', source: 'default' })
  })

  test('unsupported or malformed stored values fall through, never throw', () => {
    for (const bad of ['fr', 'EN', 'en-US', '', 42, {}, undefined]) {
      expect(resolveUiLocale({ enabled: true, userLocale: bad, agencyLocale: 'en' })).toEqual({ locale: 'en', source: 'agency' })
      expect(resolveUiLocale({ enabled: true, userLocale: null, agencyLocale: bad })).toEqual({ locale: 'he', source: 'default' })
    }
  })

  test('agencyDefaultLocale is Hebrew unless a supported default is stored', () => {
    expect(agencyDefaultLocale(null)).toBe('he')
    expect(agencyDefaultLocale('xx')).toBe('he')
    expect(agencyDefaultLocale('ar')).toBe('ar')
  })
})

describe('direction', () => {
  test('Hebrew and Arabic are RTL, English is LTR', () => {
    expect(dirFor('he')).toBe('rtl')
    expect(dirFor('ar')).toBe('rtl')
    expect(dirFor('en')).toBe('ltr')
  })

  test('Hebrew emits no attributes, so existing DOM is unchanged', () => {
    expect(regionAttrs('he')).toEqual({})
    expect(untranslatedAttrs('he')).toEqual({})
  })

  test('other locales mark translated regions and re-declare Hebrew for untranslated content', () => {
    expect(regionAttrs('en')).toEqual({ lang: 'en', dir: 'ltr' })
    expect(regionAttrs('ar')).toEqual({ lang: 'ar', dir: 'rtl' })
    expect(untranslatedAttrs('en')).toEqual({ lang: 'he', dir: 'rtl' })
  })

  test('isUiLocale accepts exactly the registry', () => {
    expect(['he', 'en', 'ar'].every(isUiLocale)).toBe(true)
    expect(['fr', 'pt-BR', null].some(isUiLocale)).toBe(false)
  })
})
