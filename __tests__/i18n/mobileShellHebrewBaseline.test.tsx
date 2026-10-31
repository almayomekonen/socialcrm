// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import type { ReactNode } from 'react'
import { SHELL_PATHS, SKELETON_PATHS, resetShellEnv, shellEnv } from './mobileShellEnv'

/**
 * HEBREW BASELINE for the phone shell (i18n Phase F1): `MobileWorkspaceShell`
 * on every route its header has a rule for (title, back arrow or none), the tab
 * bar with and without unread badges (the badge folds into the link's name),
 * `MobileHeader`'s variants, `MobileListRow`'s chevron, and every shell-level
 * skeleton (`MobileInnerSkeleton` by path, `MobileChromeSkeleton`, the
 * `(app)` and `/m` loading boundaries). Recorded against the code BEFORE
 * Phase F1; every Hebrew render must match byte-for-byte afterwards. The "עוד"
 * page, the desktop-only handoffs and the label producers:
 * mobileShellHebrewBaselineMore.test.tsx.
 *
 * Rendered with NO i18n provider — exactly what a Hebrew user receives today.
 * Normalized before comparing, and only this: React's invisible `<!-- -->`
 * text separators.
 */

vi.mock('next/navigation', async () => {
  const { shellEnv: env } = await import('./mobileShellEnv')
  return {
    usePathname: () => env.pathname,
    useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {}, replace: () => {} }),
  }
})

const renderToString = (node: ReactNode) => renderRaw(<>{node}</>).replaceAll('<!-- -->', '')

afterEach(resetShellEnv)

async function shellAt(pathname: string, counts: { notificationCount?: number; conversationCount?: number } = {}) {
  shellEnv.pathname = pathname
  const { default: MobileWorkspaceShell } = await import('@/components/mobile/MobileWorkspaceShell')
  return renderToString(
    <MobileWorkspaceShell {...counts}>
      <p>תוכן העמוד</p>
    </MobileWorkspaceShell>,
  )
}

describe('Hebrew baseline — the phone shell (server HTML)', () => {
  test('header title + back arrow (or none) + tab bar on every route rule', async () => {
    const out: Record<string, string> = {}
    for (const path of SHELL_PATHS) out[path] = await shellAt(path)
    expect(out['/dashboard']).toContain('ניווט ראשי')
    expect(out['/clients/5/summary']).toContain('חזרה')
    expect(out).toMatchSnapshot()
  })

  test('tab badges: conversations + notifications, one, many, past 99, zero', async () => {
    const out = {
      both: await shellAt('/dashboard', { notificationCount: 7, conversationCount: 4 }),
      one: await shellAt('/inbox', { notificationCount: 1, conversationCount: 1 }),
      overflow: await shellAt('/notifications', { notificationCount: 150, conversationCount: 1200 }),
      zero: await shellAt('/leads', { notificationCount: 0, conversationCount: 0 }),
    }
    expect(out.both).toContain('שיחות, 4 חדשות')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — shell primitives', () => {
  test('MobileHeader: tab screen, stack screen, explicit back label, subtitle, trailing action', async () => {
    const { default: MobileHeader } = await import('@/components/mobile/MobileHeader')
    const out = {
      tab: renderToString(<MobileHeader title='היום' />),
      stack: renderToString(<MobileHeader title='ליד' onBack />),
      custom: renderToString(<MobileHeader title='ליד' onBack={() => {}} backLabel='חזרה ללידים' subtitle='פתוח' action={<button>פעולה</button>} />),
    }
    expect(out).toMatchSnapshot()
  })

  test('MobileListRow: link row (chevron), button row, display-only row, explicit trailing', async () => {
    const { default: MobileListRow, MobileList } = await import('@/components/mobile/MobileListRow')
    const html = renderToString(
      <MobileList>
        <MobileListRow href={'/settings/self_edit' as never} title='פרופיל אישי' subtitle='שם, תמונה והעדפות' meta='היום' unread />
        <MobileListRow onClick={() => {}} title='כפתור' />
        <MobileListRow title='תצוגה בלבד' subtitle='ללא יעד' />
        <MobileListRow href={'/x' as never} title='עם סיום' trailing={<span>מחובר</span>} />
      </MobileList>,
    )
    expect(html).toMatchSnapshot()
  })
})

describe('Hebrew baseline — shell-level skeletons and loading boundaries', () => {
  test('MobileInnerSkeleton picks the destination shape for every path', async () => {
    const { default: MobileInnerSkeleton } = await import('@/components/mobile/skeletons/MobileInnerSkeleton')
    const out: Record<string, string> = {}
    for (const path of SKELETON_PATHS) out[path || '(none)'] = renderToString(<MobileInnerSkeleton path={path} />)
    expect(out['/m']).toContain('טוען…')
    expect(out).toMatchSnapshot()
  })

  test('MobileChromeSkeleton (cold boot), the (app) segment loading and the /m loading, on a phone', async () => {
    const { default: MobileChromeSkeleton } = await import('@/components/mobile/skeletons/MobileChromeSkeleton')
    const { default: AppLoading } = await import('@/app/(app)/loading')
    const { default: MoreLoading } = await import('@/app/(app)/m/loading')
    const { MobileWorkspaceContext } = await import('@/components/mobile/MobileWorkspaceContext')
    const phone = (node: ReactNode) => renderToString(<MobileWorkspaceContext.Provider value>{node}</MobileWorkspaceContext.Provider>)
    shellEnv.pathname = '/leads'
    const out = {
      chrome: renderToString(<MobileChromeSkeleton />),
      chromeInbox: renderToString(<MobileChromeSkeleton path='/inbox' />),
      appLoadingLeads: phone(<AppLoading />),
      moreLoading: phone(<MoreLoading />),
    }
    expect(out).toMatchSnapshot()
  })
})
