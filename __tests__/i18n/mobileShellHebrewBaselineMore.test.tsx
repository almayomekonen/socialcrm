// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ADMIN_USER, NAMELESS_USER, REP_USER, resetShellEnv, shellEnv } from './mobileShellEnv'
import { resolveAsync } from './dashboardHarness'

/**
 * HEBREW BASELINE, part 2 (i18n Phase F1): the phone "עוד" page (`/m`, the REAL
 * server page: admin with every rollout, a rep, a nameless office user, an admin
 * with no rollouts; the desktop redirect; the tab title), every desktop-only
 * handoff (`MobileDesktopOnly`, inside the real shell) and the copy-link
 * action's three states, plus a JSON snapshot of the label producers
 * (`MOBILE_TABS`, `mobileTabsWithBadges`, the More registry, the handoff
 * registry, the handoff copy). Recorded BEFORE Phase F1; Hebrew must match
 * byte-for-byte afterwards. Shell + skeletons: mobileShellHebrewBaseline.test.tsx.
 *
 * No i18n provider. Normalized: React's `<!-- -->` text separators only.
 */

vi.mock('next/navigation', async () => {
  const { shellEnv: env } = await import('./mobileShellEnv')
  return {
    usePathname: () => env.pathname,
    useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {}, replace: () => {} }),
    redirect: (to: string) => {
      throw new Error('REDIRECT ' + to)
    },
  }
})
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./mobileShellEnv')).shellEnv.user }))
vi.mock('@/db/uiLocale', async () => {
  const { shellEnv: env } = await import('./mobileShellEnv')
  return { getUiLocalePrefs: async () => ({ userLocale: env.userLocale, agencyLocale: null }) }
})
vi.mock('@/lib/device', async () => {
  const { shellEnv: env } = await import('./mobileShellEnv')
  return { isMobileRequest: async () => env.mobile, isMobileWorkspaceRequest: async () => env.mobile }
})
vi.mock('@/lib/flags/mobileFlags', () => ({ canEnterMobileWorkspace: () => true }))
vi.mock('@/lib/ai/flags', async () => {
  const { shellEnv: env } = await import('./mobileShellEnv')
  return { isAgentEnabled: () => env.agent, isCopilotInspectorEnabled: () => env.inspector }
})
vi.mock('@/lib/flags/questionnaireBuilderFlags', async () => {
  const { shellEnv: env } = await import('./mobileShellEnv')
  return { canUseQuestionnaireBuilder: () => env.questionnaire }
})
vi.mock('@/actions/auth', () => ({ logout: async () => {} }))
vi.mock('@/lib/clipboard', async () => {
  const { shellEnv: env } = await import('./mobileShellEnv')
  return { copyToClipboard: async () => env.copyOk }
})

const renderToString = (node: ReactNode) => renderRaw(<>{node}</>).replaceAll('<!-- -->', '')

afterEach(() => {
  cleanup()
  resetShellEnv()
})

async function morePage(user: typeof shellEnv.user, flags: Partial<typeof shellEnv> = {}) {
  Object.assign(shellEnv, { user, pathname: '/m' }, flags)
  const { default: Page } = await import('@/app/(app)/m/page')
  return renderToString(await resolveAsync(await Page()))
}

describe('Hebrew baseline — the "עוד" page (/m)', () => {
  test('admin with every rollout, rep, nameless office user, admin with no rollouts', async () => {
    const out = {
      admin: await morePage(ADMIN_USER),
      rep: await morePage(REP_USER),
      nameless: await morePage(NAMELESS_USER),
      adminNoRollouts: await morePage(ADMIN_USER, { agent: false, questionnaire: false, inspector: false }),
    }
    expect(out.admin).toContain('התנתקות')
    expect(out).toMatchSnapshot()
  })

  test('a desktop request is redirected to the settings page; no session goes to /auth', async () => {
    await expect(morePage(ADMIN_USER, { mobile: false })).rejects.toThrow('REDIRECT /settings/self_edit')
    await expect(morePage(null)).rejects.toThrow('REDIRECT /auth')
  })

  test('tab title', async () => {
    const mod = await import('@/app/(app)/m/page')
    const meta = 'generateMetadata' in mod ? await (mod as any).generateMetadata() : (mod as any).metadata
    expect(meta).toEqual({ title: 'עוד' })
  })
})

describe('Hebrew baseline — desktop-only handoffs', () => {
  test('every section inside the real shell', async () => {
    const { DESKTOP_ONLY_ROUTES, DESKTOP_ONLY_SECTIONS } = await import('@/lib/mobile/desktopOnlyRoutes')
    const { default: MobileWorkspaceShell } = await import('@/components/mobile/MobileWorkspaceShell')
    const { default: MobileDesktopOnly } = await import('@/components/mobile/MobileDesktopOnly')
    const out: Record<string, string> = {}
    for (const section of Object.keys(DESKTOP_ONLY_SECTIONS) as (keyof typeof DESKTOP_ONLY_SECTIONS)[]) {
      shellEnv.pathname = DESKTOP_ONLY_ROUTES[section].path.replace('[clientId]', '5')
      out[section] = renderToString(
        <MobileWorkspaceShell>
          <MobileDesktopOnly section={section} />
        </MobileWorkspaceShell>,
      )
    }
    expect(out.tasks).toContain('המסך הזה זמין כרגע מהמחשב.')
    expect(out).toMatchSnapshot()
  })

  test('the copy-link action: idle, copied, failed (button + announced status)', async () => {
    const { default: MobileDesktopOnly } = await import('@/components/mobile/MobileDesktopOnly')
    const states: Record<string, string> = {}
    for (const ok of [true, false]) {
      shellEnv.copyOk = ok
      const { container } = render(<MobileDesktopOnly section='deals' />)
      if (ok) states.idle = container.innerHTML
      await act(async () => {
        fireEvent.click(screen.getByRole('button'))
      })
      states[ok ? 'copied' : 'failed'] = container.innerHTML
      cleanup()
    }
    expect(states.copied).toContain('הקישור הועתק')
    expect(states).toMatchSnapshot()
  })
})

describe('Hebrew baseline — label producers (JSON)', () => {
  test('tabs, badges, More registry, handoff registry, handoff copy', async () => {
    const { MOBILE_TABS, mobileTabsWithBadges } = await import('@/components/mobile/MobileTabBar')
    const more = await import('@/components/mobile/moreDestinations')
    const handoff = await import('@/lib/mobile/desktopOnlyRoutes')
    const { MOBILE_HANDOFF_COPY, DESKTOP_URL_LABEL } = await import('@/lib/activation/mobileHandoffCopy')
    expect({
      tabs: MOBILE_TABS,
      badges: mobileTabsWithBadges({ notifications: 3, conversations: 9 }),
      moreSections: more.MORE_SECTION_LABELS,
      moreOrder: more.MORE_SECTION_ORDER,
      moreItems: more.MORE_ITEMS,
      visibleAdmin: more.visibleMoreItems({ role: 'ADMIN', inspectorEnabled: true, agentEnabled: true, questionnaireBuilderEnabled: true }).map((i) => i.href),
      visibleRep: more.visibleMoreItems({ role: 'AGNT', inspectorEnabled: false }).map((i) => i.href),
      handoffLead: handoff.DESKTOP_ONLY_LEAD,
      handoffSections: handoff.DESKTOP_ONLY_SECTIONS,
      handoffCopy: MOBILE_HANDOFF_COPY,
      desktopUrl: DESKTOP_URL_LABEL,
    }).toMatchSnapshot()
  })
})
