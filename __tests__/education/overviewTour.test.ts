import { he } from '@/lib/i18n/messages/he'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getTour } from '@/lib/education/registry'
import {
  HEADER_EDU,
  NAV_EDU_BY_HREF,
  NAV_RAIL_EDU,
  NOTIFICATIONS_EDU,
  OVERVIEW_NAV_EDU_IDS,
  OVERVIEW_NAV_TARGETS,
  eduSel,
  navEduForHref,
} from '@/lib/education/types'
import { presentSteps, waitForTourTargets } from '@/lib/education/presentSteps'
import { EDUCATION_ACTIONS, hrefForEducationAction, navigationHrefForAction } from '@/lib/education/actions'
import { isTourEligible } from '@/lib/education/eligibility'
import type { EligibilityContext } from '@/lib/education/types'

const el = () => ({}) as Element

const OVERVIEW_TITLES = [
  'היום',
  'לידים',
  'לקוחות',
  'שיחות',
  'עסקאות',
  'ביצועים',
  'משימות',
  'פגישות',
  'הגדרות',
  'הסרגל העליון',
  'העוזר החכם',
  'התראות',
  'זהו, עכשיו אתה בעניינים',
] as const

const OFFICE_HIDDEN = [
  eduSel('nav-today'),
  eduSel('nav-leads'),
  eduSel('nav-clients'),
  eduSel('nav-inbox'),
  eduSel('nav-tasks'),
  eduSel('nav-calendar'),
  eduSel('nav-settings'),
]

function desktopPresent(extraMissing: string[] = []) {
  const missing = new Set(extraMissing)
  return (sel: string) => {
    if (missing.has(sel)) return null
    if (sel === eduSel('leads-table') || sel === eduSel(NAV_RAIL_EDU)) return null
    return el()
  }
}

describe('overview sequence', () => {
  it('walks the interface top to bottom in this exact order', () => {
    const overview = getTour('overview')!
    expect(overview.version).toBe(3)
    expect(overview.steps.map((s) => s.title)).toEqual([...OVERVIEW_TITLES])
    expect(overview.steps.map((s) => s.element)).toEqual([
      eduSel('nav-today'),
      eduSel('nav-leads'),
      eduSel('nav-clients'),
      eduSel('nav-inbox'),
      eduSel('nav-deals'),
      eduSel('nav-performance'),
      eduSel('nav-tasks'),
      eduSel('nav-calendar'),
      eduSel('nav-settings'),
      eduSel(HEADER_EDU),
      eduSel('copilot-trigger'),
      eduSel(NOTIFICATIONS_EDU),
      undefined,
    ])
  })

  it('does not include Pipeline, a generic rail step, or a welcome skip-ahead', () => {
    const overview = getTour('overview')!
    expect(overview.steps.some((s) => s.element === eduSel('leads-table'))).toBe(false)
    expect(overview.steps.some((s) => s.element === eduSel(NAV_RAIL_EDU))).toBe(false)
    expect(overview.steps.some((s) => s.title === 'הפייפליין')).toBe(false)
    expect(overview.steps.some((s) => s.title === 'הניווט הראשי')).toBe(false)
    expect(overview.steps[0]?.title).toBe('היום')
  })

  it('keeps Pipeline on the dedicated leads tour', () => {
    const pipeline = getTour('pipeline')!
    expect(pipeline.steps[0]?.element).toBe(eduSel('leads-table'))
    expect(pipeline.steps[0]?.title).toBe('הרשימה')
    expect(pipeline.steps.map((s) => s.title)).toEqual(['הרשימה', 'סטטוסים', 'פתיחת ליד', 'ליד חדש', 'זה כל הרעיון'])
  })
})

describe('overview navigation anchors', () => {
  it('maps every real sidebar href in getNavLinks order, except owner-only admin', () => {
    expect(OVERVIEW_NAV_EDU_IDS).toEqual([
      'nav-today',
      'nav-leads',
      'nav-clients',
      'nav-inbox',
      'nav-deals',
      'nav-performance',
      'nav-tasks',
      'nav-calendar',
      'nav-settings',
    ])
    expect(OVERVIEW_NAV_TARGETS.map((t) => t.href)).toEqual([
      '/dashboard',
      '/leads',
      '/clients',
      '/inbox',
      '/deals',
      '/sum_sales',
      '/tasks',
      '/calendar',
      '/settings/self_edit',
    ])
    for (const item of OVERVIEW_NAV_TARGETS) {
      expect(navEduForHref(item.href)).toBe(item.id)
      expect(NAV_EDU_BY_HREF[item.href]).toBe(item.id)
    }
    expect(navEduForHref('/admin')).toBeUndefined()
  })

  it('uses the real Hebrew labels from getNavLinks', () => {
    // Nav labels come from the interface-language catalog; Hebrew is the source catalog.
    const nav = readFileSync('lib/navs/Nav.tsx', 'utf8')
    const keys = ['today', 'leads', 'clients', 'inbox', 'deals', 'performance', 'tasks', 'calendar', 'settings'] as const
    const titles = ['היום', 'לידים', 'לקוחות', 'שיחות', 'עסקאות', 'ביצועים', 'משימות', 'פגישות', 'הגדרות']
    keys.forEach((key, i) => {
      expect(nav).toContain(`title: t('shell.nav.${key}')`)
      expect(he.shell.nav[key]).toBe(titles[i])
    })
    expect(nav).toContain("title: t('shell.nav.admin')")
    expect(he.shell.nav.admin).toBe('ניהול מערכת')
    expect(getTour('overview')!.steps.map((s) => s.title).slice(0, 9)).toEqual(titles)
  })

  it('allowlists every overview spotlight target', () => {
    const allowed = new Set([
      ...OVERVIEW_NAV_EDU_IDS.map((id) => eduSel(id)),
      eduSel(HEADER_EDU),
      eduSel('copilot-trigger'),
      eduSel(NOTIFICATIONS_EDU),
    ])
    for (const step of getTour('overview')!.steps) {
      if (!step.element) continue
      expect(allowed.has(step.element), step.element).toBe(true)
    }
  })

  it('gives a normal desktop user all nine navigation items plus header cluster', () => {
    const titles = presentSteps(getTour('overview')!.steps, desktopPresent()).map((s) => s.title)
    expect(titles).toEqual([...OVERVIEW_TITLES])
  })

  it('omits only role-hidden sidebar items for an Office user', () => {
    const titles = presentSteps(getTour('overview')!.steps, desktopPresent(OFFICE_HIDDEN)).map((s) => s.title)
    expect(titles).toEqual(['עסקאות', 'ביצועים', 'הסרגל העליון', 'העוזר החכם', 'התראות', 'זהו, עכשיו אתה בעניינים'])
    expect(titles).not.toContain('היום')
    expect(titles).not.toContain('לידים')
    expect(titles).not.toContain('לקוחות')
    expect(titles).not.toContain('שיחות')
    expect(titles).not.toContain('משימות')
    expect(titles).not.toContain('פגישות')
    expect(titles).not.toContain('הגדרות')
  })

  it('omits notifications when the bell is not mounted', () => {
    const titles = presentSteps(getTour('overview')!.steps, desktopPresent([eduSel(NOTIFICATIONS_EDU)])).map((s) => s.title)
    expect(titles).not.toContain('התראות')
    expect(titles).toContain('העוזר החכם')
    expect(titles).toContain('הסרגל העליון')
  })

  it('omits Copilot when the trigger is not mounted', () => {
    const titles = presentSteps(getTour('overview')!.steps, desktopPresent([eduSel('copilot-trigger')])).map((s) => s.title)
    expect(titles).not.toContain('העוזר החכם')
    expect(titles).toContain('התראות')
  })

  it('anchors the desktop sidebar, header, and bell — not the mobile popover', () => {
    const nav = readFileSync('lib/navs/Nav.tsx', 'utf8')
    expect(nav).toContain('data-edu={NAV_RAIL_EDU}')
    expect(nav).toContain('data-edu={navEduForHref(link.href)}')
    const mobileBlock = nav.split("id='navPop'")[1]?.split('hidden desktop:block')[0] ?? ''
    expect(mobileBlock).not.toContain('data-edu=')

    const topbar = readFileSync('lib/navs/Topbar.tsx', 'utf8')
    expect(topbar).toContain('data-edu={HEADER_EDU}')

    const bell = readFileSync('components/notifications/NotificationBell.tsx', 'utf8')
    expect(bell).toContain('data-edu={NOTIFICATIONS_EDU}')

    const copilot = readFileSync('components/copilot/CopilotTopbarTrigger.tsx', 'utf8')
    expect(copilot).toContain("data-edu='copilot-trigger'")

    const help = readFileSync('components/education/HelpTrigger.tsx', 'utf8')
    expect(help).toContain('data-edu={HELP_TRIGGER_EDU}')
    expect(help).not.toContain(`data-edu={HEADER_EDU}`)
  })
})

describe('overview does not navigate and stays desktop-only', () => {
  it('does not route-change for Help overview or Copilot Show me around', () => {
    expect(hrefForEducationAction('open_overview_tour')).toBeNull()
    expect(navigationHrefForAction('open_overview_tour', '/leads')).toBeNull()
    expect(navigationHrefForAction('open_overview_tour', '/dashboard')).toBeNull()
    expect(navigationHrefForAction('open_overview_tour', '/inbox')).toBeNull()
    expect(EDUCATION_ACTIONS.open_overview_tour.href).toBeNull()

    const help = readFileSync('components/education/HelpMenu.tsx', 'utf8')
    // The button labels come from the catalog (Phase E6); in Hebrew they are the same words.
    const overviewHandler = help.split("lbl={t('education.help.overview')}")[1]?.split("lbl={t('education.help.pipeline')}")[0] ?? ''
    expect(overviewHandler).toContain("startTour('overview'")
    expect(overviewHandler).not.toContain('router.push')
  })

  it('stays ineligible on mobile even when forced', () => {
    const overview = getTour('overview')!
    const desktop: EligibilityContext = {
      surface: 'desktop',
      toursEnabled: true,
      copilotEnabled: true,
      firstLeadActive: false,
      pathname: '/leads',
      force: true,
    }
    expect(isTourEligible(overview, desktop)).toBe(true)
    expect(isTourEligible(overview, { ...desktop, surface: 'mobile' })).toBe(false)
  })
})

describe('overview waits for sidebar targets', () => {
  it('does not treat header or Copilot as ready while nav items are missing', async () => {
    const headerOnly = (sel: string) => {
      if (sel === eduSel(HEADER_EDU) || sel === eduSel('copilot-trigger') || sel === eduSel(NOTIFICATIONS_EDU)) return el()
      return null
    }
    let scheduled = 0
    const queue: Array<() => void> = []
    let t = 0
    const pending = waitForTourTargets(getTour('overview')!.steps, {
      query: headerOnly,
      timeoutMs: 1000,
      now: () => t,
      schedule: (cb) => {
        scheduled += 1
        queue.push(cb)
        return 1
      },
    })
    expect(scheduled).toBe(1)
    t = 1000
    queue.shift()?.()
    await expect(pending).resolves.toBe(false)
  })

  it('starts once a real nav item appears, using the existing readiness poll', async () => {
    let found = false
    let t = 0
    const queue: Array<() => void> = []
    const pending = waitForTourTargets(getTour('overview')!.steps, {
      query: (sel) => (found && sel === eduSel('nav-today') ? el() : null),
      timeoutMs: 1000,
      now: () => t,
      schedule: (cb) => {
        queue.push(cb)
        return queue.length
      },
    })
    expect(queue).toHaveLength(1)
    found = true
    t += 16
    queue.shift()?.()
    await expect(pending).resolves.toBe(true)
  })
})

describe('overview chrome', () => {
  it('keeps the overlay transparent and the tour chrome in Hebrew RTL', () => {
    const css = readFileSync('lib/css/education.css', 'utf8')
    expect(css).toMatch(/\.driver-overlay\s*\{[^}]*background:\s*transparent/)
    expect(css).toMatch(/\.edu-popover\s*\{[^}]*direction:\s*rtl/)
    const runTour = readFileSync('components/education/runTour.ts', 'utf8')
    // The popover's dir is set by the shared decoration (tourPopover.ts).
    expect(readFileSync('components/education/tourPopover.ts', 'utf8')).toMatch(/setAttribute\('dir',\s*'rtl'\)/)
    // The chrome words come from the catalog (Phase E6); in Hebrew they are the same words.
    const chrome = readFileSync('lib/i18n/messages/he/education/chrome.ts', 'utf8')
    expect(runTour).toContain('doneBtnText: chrome.doneBtnText')
    expect(runTour).toContain('nextBtnText: chrome.nextBtnText')
    expect(chrome).toContain("done: 'הבנתי'")
    expect(chrome).toContain("next: 'הבא'")
  })
})
