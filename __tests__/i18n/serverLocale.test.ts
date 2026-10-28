import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const getUiLocalePrefs = vi.fn(async () => ({ userLocale: 'en', agencyLocale: null }))
const getUser = vi.fn()
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: (...a: any[]) => (getUiLocalePrefs as any)(...a) }))
vi.mock('@/db/auth', () => ({ getUser: () => getUser() }))

const { getUiLocaleState, getServerT } = await import('@/lib/i18n/server')

const saved = { ...process.env }
beforeEach(() => {
  getUiLocalePrefs.mockClear()
  getUser.mockClear()
})
afterEach(() => {
  process.env = { ...saved }
})

describe('getUiLocaleState — cost and isolation outside the rollout', () => {
  test('flag absent: Hebrew, no session read, no query', async () => {
    delete process.env.UI_LOCALE_ENABLED
    expect(await getUiLocaleState({ id: 1, agencyId: 103 })).toMatchObject({ locale: 'he', enabled: false })
    expect(getUiLocalePrefs).not.toHaveBeenCalled()
    expect(getUser).not.toHaveBeenCalled()
  })

  test('flag on, agency not allowlisted: Hebrew, no query even with stored preferences', async () => {
    process.env.UI_LOCALE_ENABLED = '1'
    process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
    expect(await getUiLocaleState({ id: 2, agencyId: 108 })).toMatchObject({ locale: 'he', enabled: false })
    expect(getUiLocalePrefs).not.toHaveBeenCalled()
  })

  test('no session: Hebrew, no query', async () => {
    process.env.UI_LOCALE_ENABLED = '1'
    process.env.UI_LOCALE_AGENCY_ALLOWLIST = 'all'
    expect(await getUiLocaleState(null)).toMatchObject({ locale: 'he' })
    expect(getUiLocalePrefs).not.toHaveBeenCalled()
  })

  test('pilot agency: reads that user in that agency only', async () => {
    process.env.UI_LOCALE_ENABLED = '1'
    process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
    expect(await getUiLocaleState({ id: 7, agencyId: 103 })).toMatchObject({ locale: 'en', source: 'user', enabled: true })
    expect(getUiLocalePrefs).toHaveBeenCalledWith(7, 103)
    expect((await getServerT({ id: 7, agencyId: 103 }))('shell.nav.leads')).toBe('Leads')
    expect(getUser).not.toHaveBeenCalled()
  })

  test('a failed read degrades to Hebrew instead of breaking the workspace', async () => {
    process.env.UI_LOCALE_ENABLED = '1'
    process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
    getUiLocalePrefs.mockRejectedValueOnce(new Error('column "uiLocale" does not exist'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await getUiLocaleState({ id: 99, agencyId: 103 })).toMatchObject({ locale: 'he', enabled: false })
    spy.mockRestore()
  })
})
