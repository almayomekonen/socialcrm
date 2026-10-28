import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const session = { current: { id: 7, agencyId: 103, role: 'AGNT' } as any }
const setUserUiLocale = vi.fn(async () => 1)
const setAgencyUiLocale = vi.fn(async () => 1)

const refresh = vi.fn()
vi.mock('next/cache', () => ({ refresh: () => refresh() }))
vi.mock('@/lib/requireUser', () => ({ requireAgencyUser: async () => session.current }))
vi.mock('@/db/uiLocale', () => ({
  setUserUiLocale: (...a: any[]) => (setUserUiLocale as any)(...a),
  setAgencyUiLocale: (...a: any[]) => (setAgencyUiLocale as any)(...a),
}))

const { setMyUiLocale, setAgencyDefaultUiLocale } = await import('@/actions/uiLocale')

const saved = { ...process.env }
beforeEach(() => {
  process.env.UI_LOCALE_ENABLED = '1'
  process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
  session.current = { id: 7, agencyId: 103, role: 'AGNT' }
  setUserUiLocale.mockClear()
  setAgencyUiLocale.mockClear()
})
afterEach(() => {
  process.env = { ...saved }
})

describe('setMyUiLocale', () => {
  test('writes the caller own row, ids from the session, then refreshes only the caller', async () => {
    refresh.mockClear()
    await setMyUiLocale('en')
    expect(setUserUiLocale).toHaveBeenCalledWith(7, 103, 'en')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  test('empty clears the personal choice', async () => {
    await setMyUiLocale('')
    expect(setUserUiLocale).toHaveBeenCalledWith(7, 103, null)
  })

  test('a payload cannot carry another user or agency', async () => {
    await setMyUiLocale({ toString: () => 'en', userId: 1, agencyId: 1 } as any).catch(() => {})
    expect(setUserUiLocale).not.toHaveBeenCalled()
  })

  test('unsupported locales are refused server-side', async () => {
    for (const bad of ['fr', 'EN', 'he-IL', 1, undefined]) {
      await expect(setMyUiLocale(bad)).rejects.toThrow('unsupported_locale')
    }
    expect(setUserUiLocale).not.toHaveBeenCalled()
  })

  test('refused outside the rollout', async () => {
    session.current = { id: 8, agencyId: 108, role: 'ADMIN' }
    await expect(setMyUiLocale('en')).rejects.toThrow('ui_locale_disabled')
    expect(setUserUiLocale).not.toHaveBeenCalled()
  })
})

describe('setAgencyDefaultUiLocale', () => {
  test('non-admins cannot change the agency default', async () => {
    for (const role of ['AGNT', 'MNGR', 'OFFICE', 'EXT']) {
      session.current = { id: 7, agencyId: 103, role }
      await expect(setAgencyDefaultUiLocale('en')).rejects.toThrow('forbidden')
    }
    expect(setAgencyUiLocale).not.toHaveBeenCalled()
  })

  test('an admin changes only their own agency', async () => {
    session.current = { id: 1, agencyId: 103, role: 'ADMIN' }
    await setAgencyDefaultUiLocale('ar')
    expect(setAgencyUiLocale).toHaveBeenCalledWith(103, 'ar')
  })

  test('an admin outside the rollout is refused', async () => {
    session.current = { id: 1, agencyId: 108, role: 'ADMIN' }
    await expect(setAgencyDefaultUiLocale('ar')).rejects.toThrow('ui_locale_disabled')
  })

  test('never writes a personal preference', async () => {
    session.current = { id: 1, agencyId: 103, role: 'ADMIN' }
    await setAgencyDefaultUiLocale('en')
    expect(setUserUiLocale).not.toHaveBeenCalled()
  })
})
