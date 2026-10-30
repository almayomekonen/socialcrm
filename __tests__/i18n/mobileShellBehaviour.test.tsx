// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { REP_USER, resetShellEnv, shellEnv } from './mobileShellEnv'
import { resetShellSpies, shellSpies } from './mobileShellMocks'
import { handoffTree, moreTree, shellTree } from './mobileShellHarness'

/**
 * The phone shell does the same thing in every language (i18n Phase F1): the
 * back control calls the same router method, the tab bar and the "עוד" page
 * link to the same destinations for the same viewer, sign-out is the same
 * server action, the copy action copies the same address, touch-target classes
 * are unchanged, and Hebrew with the provider renders exactly what it rendered
 * without one. The shell has no dialogs or menus of its own (the sheets inside
 * phone screens belong to their packages), so there is no Escape path here.
 */

vi.mock('next/navigation', async () => (await import('./mobileShellMocks')).navigationModule())
vi.mock('@/db/auth', async () => (await import('./mobileShellMocks')).authModule())
vi.mock('@/db/uiLocale', async () => (await import('./mobileShellMocks')).uiLocaleModule())
vi.mock('@/lib/device', async () => (await import('./mobileShellMocks')).deviceModule())
vi.mock('@/lib/flags/mobileFlags', () => ({ canEnterMobileWorkspace: () => true }))
vi.mock('@/lib/ai/flags', async () => (await import('./mobileShellMocks')).aiFlagsModule())
vi.mock('@/lib/flags/questionnaireBuilderFlags', async () => (await import('./mobileShellMocks')).builderFlagsModule())
vi.mock('@/actions/auth', async () => ({ logout: (await import('./mobileShellMocks')).shellSpies.logout }))
vi.mock('@/lib/clipboard', async () => (await import('./mobileShellMocks')).clipboardModule())

const saved = { ...process.env }
beforeEach(() => {
  process.env.UI_LOCALE_ENABLED = '1'
  process.env.UI_LOCALE_AGENCY_ALLOWLIST = '103'
})
afterEach(() => {
  cleanup()
  process.env = { ...saved }
  resetShellEnv()
  resetShellSpies()
})

const LOCALES = ['he', 'en', 'ar'] as const
const hrefs = (root: ParentNode) => [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'))
const classes = (root: ParentNode, selector: string) => [...root.querySelectorAll(selector)].map((el) => el.className)

describe('same actions in every language', () => {
  test('back calls router.back exactly once', async () => {
    for (const locale of LOCALES) {
      render(await shellTree(locale, '/agent'))
      fireEvent.click(screen.getByRole('button'))
      expect(shellSpies.back, locale).toHaveBeenCalledTimes(1)
      shellSpies.back.mockClear()
      cleanup()
    }
  })

  test('tab bar: same destinations, same active tab, same touch-target classes', async () => {
    const seen = new Map<string, unknown>()
    for (const locale of LOCALES) {
      const { container } = render(await shellTree(locale, '/inbox', null, { notificationCount: 2, conversationCount: 5 }))
      const nav = screen.getByRole('navigation')
      const shape = {
        hrefs: hrefs(nav),
        current: nav.querySelector('[aria-current="page"]')!.getAttribute('href'),
        links: classes(nav, 'a'),
        header: classes(container, 'header, header *'),
      }
      if (seen.size) expect(shape, locale).toEqual(seen.get('he'))
      seen.set(locale, shape)
      cleanup()
    }
    expect((seen.get('he') as { links: string[] }).links.every((c) => c.includes('min-h-14'))).toBe(true)
  })

  test('the back control keeps its 44px target in every language', async () => {
    for (const locale of LOCALES) {
      render(await shellTree(locale, '/clients/5/summary'))
      expect(screen.getByRole('button').className, locale).toContain('size-11')
      cleanup()
    }
  })

  test('"More": same rows for the same viewer, same sign-out action, same row classes', async () => {
    for (const user of [shellEnv.user, REP_USER]) {
      const shapes: unknown[] = []
      for (const locale of LOCALES) {
        shellEnv.user = user
        const { container } = render(await moreTree(locale))
        shapes.push({ hrefs: hrefs(container), rows: classes(container, 'a').map((c) => c.replace(' -scale-x-100', '')) })
        const form = container.querySelector('form')!
        expect(form.querySelector('button[type="submit"]'), locale).toBeTruthy()
        await act(async () => fireEvent.submit(form))
        cleanup()
      }
      expect(shapes[1]).toEqual(shapes[0])
      expect(shapes[2]).toEqual(shapes[0])
    }
    expect(shellSpies.logout).toHaveBeenCalledTimes(6)
  })

  test('the copy action copies the same address in every language', async () => {
    for (const locale of LOCALES) {
      render(await handoffTree(locale, 'promotion'))
      await act(async () => fireEvent.click(screen.getByRole('button')))
      cleanup()
    }
    expect(shellSpies.copy.mock.calls).toEqual([['https://getsocialcrm.com'], ['https://getsocialcrm.com'], ['https://getsocialcrm.com']])
  })
})

describe('Hebrew is untouched by the provider', () => {
  test('shell, More page and a handoff render the same HTML with and without it', async () => {
    for (const path of ['/dashboard', '/clients/5/summary', '/m']) {
      expect(renderToString(await shellTree('he', path, null, { conversationCount: 3 })), path).toBe(
        renderToString(await shellTree(null, path, null, { conversationCount: 3 })),
      )
    }
    expect(renderToString(await moreTree('he'))).toBe(renderToString(await moreTree(null)))
    expect(renderToString(await handoffTree('he', 'files'))).toBe(renderToString(await handoffTree(null, 'files')))
  })
})
