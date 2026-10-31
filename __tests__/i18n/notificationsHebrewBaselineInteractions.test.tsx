// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { NOW, resetNotifEnv } from './notificationsEnv'
import { resetNotifSpies } from './notificationsMocks'
import { bellScenario, centerScenario, selectionScenario, toastScenario } from './notificationsScenarios'

/**
 * HEBREW BASELINE for the notification interactions (i18n Phase F3), recorded
 * against the code BEFORE Phase F3: the bell (accessible name, panel, opening a
 * row, Escape and focus return, mark all), the arrival toasts (one new row, a
 * legacy row, several), the center on desktop and on a phone (open a row, load
 * more failing then succeeding, mark all), the phone selection (long press, the
 * bar, mark read failing — rollback + toast — then succeeding, cancel). Each
 * record holds what the user saw AND every request / navigation / toast; the
 * behaviour tests replay the same scenarios in en / ar and compare the calls.
 */

vi.mock('next/navigation', async () => (await import('./notificationsMocks')).navigationModule())
vi.mock('@/lib/toast', async () => (await import('./notificationsMocks')).toastModule())
vi.mock('@/modules/inbox/client/useAdaptivePoll', async () => (await import('./notificationsMocks')).pollModule())

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetNotifEnv()
  resetNotifSpies()
})

describe('Hebrew baseline — notification interactions', () => {
  test('the bell and its panel', async () => {
    const out = await bellScenario(null)
    expect(out.seen.bellName).toBe('התראות, 5 חדשות')
    expect(out).toMatchSnapshot()
  })

  test('arrival toasts', async () => {
    const out = await toastScenario(null)
    expect(out.seen.single).toBe('ליד חדש — יוסי לוי')
    expect(out.seen.several).toBe('3 התראות חדשות')
    expect(out).toMatchSnapshot()
  })

  test('the center, desktop rows', async () => {
    const out = await centerScenario(null, 'desktop')
    expect(out.seen.failed).toBe('לא הצלחנו לטעון — נסה שוב')
    expect(out).toMatchSnapshot()
  })

  test('the center, phone rows', async () => {
    const out = await centerScenario(null, 'mobile')
    expect(out.seen.markAllText).toBe('סימון הכל כנקרא')
    expect(out).toMatchSnapshot()
  })

  test('phone selection and mark read', async () => {
    const out = await selectionScenario(null)
    expect(out.calls.toast[0]).toEqual(['error', 'לא הצלחנו לסמן כנקרא. נסה שוב.', undefined, 'undefined'])
    expect(out).toMatchSnapshot()
  })
})
