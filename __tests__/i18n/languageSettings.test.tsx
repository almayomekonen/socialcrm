// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n/I18nProvider'
import type { LocaleSource } from '@/lib/i18n/resolve'

vi.mock('@/actions/uiLocale', () => ({ setMyUiLocale: vi.fn(), setAgencyDefaultUiLocale: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

const { default: LanguageSettings } = await import('@/components/settings/language/LanguageSettings')

afterEach(cleanup)

const base: { locale: 'en'; source: LocaleSource; userLocale: string | null; agencyLocale: string | null; canManageAgency: boolean } = {
  locale: 'en',
  source: 'user',
  userLocale: 'en',
  agencyLocale: null,
  canManageAgency: true,
}

function renderIn(locale: 'he' | 'en' | 'ar', props: Partial<typeof base> = {}) {
  return render(
    <I18nProvider locale={locale}>
      <LanguageSettings {...base} {...props} locale={locale} />
    </I18nProvider>,
  )
}

describe('language settings', () => {
  test('selector is labelled and lists native names', () => {
    renderIn('en')
    const select = screen.getByLabelText('Your interface language') as HTMLSelectElement
    const names = [...select.options].map((o) => o.textContent)
    expect(names).toEqual(['Business default (עברית)', 'עברית', 'English', 'العربية'])
    expect(select.value).toBe('en')
  })

  test('shows the effective language and where it comes from', () => {
    renderIn('en', { source: 'agency', userLocale: null, agencyLocale: 'en' })
    expect(screen.getByText('Showing now: English, the business default')).toBeTruthy()
    expect((screen.getByLabelText('Your interface language') as HTMLSelectElement).value).toBe('')
  })

  test('agency section is absent for non-admins', () => {
    renderIn('en', { canManageAgency: false })
    expect(screen.queryByLabelText('Default language')).toBeNull()
  })

  test('changing the agency default previews the effect before saving', () => {
    renderIn('en')
    expect(screen.queryByText(/After saving/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Default language'), { target: { value: 'ar' } })
    expect(screen.getByText('After saving, reps without a personal language will see the interface in العربية (instead of עברית).')).toBeTruthy()
  })

  test('the page is its own language region (inside Hebrew settings content)', () => {
    const { container } = renderIn('en')
    expect(container.firstElementChild?.getAttribute('lang')).toBe('en')
    expect(container.firstElementChild?.getAttribute('dir')).toBe('ltr')
  })

  test('Arabic renders RTL and fully in Arabic', () => {
    const { container } = renderIn('ar')
    expect(screen.getByRole('heading', { level: 1, name: 'لغة الواجهة' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'حفظ اللغة' })).toBeTruthy()
    expect(container.firstElementChild?.getAttribute('dir')).toBe('rtl')
  })

  test('Hebrew page adds no lang/dir', () => {
    const { container } = renderIn('he')
    expect(screen.getByRole('heading', { level: 1, name: 'שפת הממשק' })).toBeTruthy()
    expect(container.querySelector('[lang],[dir]')).toBeNull()
  })
})
