export const EDU_ATTR = 'data-edu'

export function eduSel(id: string): string {
  return `[${EDU_ATTR}="${id}"]`
}

/** Whole desktop sidebar rail — present in the DOM, not an overview step. */
export const NAV_RAIL_EDU = 'nav'

export const HEADER_EDU = 'header'
export const NOTIFICATIONS_EDU = 'notifications'
/** Existing header Help (?) control — first-time invitation target, not an overview step. */
export const HELP_TRIGGER_EDU = 'help-trigger'
/** Clickable lead name in the Leads table — the existing way to open a lead. */
export const LEAD_OPEN_EDU = 'lead-open'

/**
 * Explicit top-to-bottom overview order. Matches `getNavLinks` in
 * `lib/navs/Nav.tsx`. `/admin` is owner-only and is not part of the tour.
 * Do not reorder by "importance".
 */
export const OVERVIEW_NAV_TARGETS = [
  { href: '/dashboard', id: 'nav-today' },
  { href: '/leads', id: 'nav-leads' },
  { href: '/clients', id: 'nav-clients' },
  { href: '/inbox', id: 'nav-inbox' },
  { href: '/deals', id: 'nav-deals' },
  { href: '/sum_sales', id: 'nav-performance' },
  { href: '/tasks', id: 'nav-tasks' },
  { href: '/calendar', id: 'nav-calendar' },
  { href: '/settings/self_edit', id: 'nav-settings' },
] as const

export type NavEduId = (typeof OVERVIEW_NAV_TARGETS)[number]['id']

export const NAV_EDU_BY_HREF = Object.fromEntries(OVERVIEW_NAV_TARGETS.map((item) => [item.href, item.id])) as {
  [K in (typeof OVERVIEW_NAV_TARGETS)[number]['href']]: Extract<(typeof OVERVIEW_NAV_TARGETS)[number], { href: K }>['id']
}

export const OVERVIEW_NAV_EDU_IDS: readonly NavEduId[] = OVERVIEW_NAV_TARGETS.map((item) => item.id)

export function navEduForHref(href: string): NavEduId | undefined {
  return NAV_EDU_BY_HREF[href as keyof typeof NAV_EDU_BY_HREF]
}

export type TourId = 'overview' | 'pipeline' | 'lead' | 'copilot' | 'whatsapp' | 'facebook'

export type TourStatus = 'completed' | 'dismissed'

export type TourStartSource = 'auto' | 'help' | 'query' | 'copilot'

export type TourRecord = {
  version: number
  status: TourStatus
  at: string
  lastStep?: number
}

export type EducationState = {
  tours: Partial<Record<TourId, TourRecord>>
  /** First-time overview invitation. Independent of tour completion. */
  overviewIntro?: OverviewIntroRecord
}

export const OVERVIEW_INTRO_VERSION = 1

export type OverviewIntroStatus = 'eligible' | 'accepted' | 'declined'

export type OverviewIntroRecord = {
  version: number
  status: OverviewIntroStatus
  at: string
}

export type Surface = 'desktop' | 'mobile'

export type EligibilityContext = {
  surface: Surface
  toursEnabled: boolean
  copilotEnabled: boolean
  firstLeadActive: boolean
  pathname: string
  force?: boolean
  record?: TourRecord
}

export type TourStep = {
  element?: string
  title: string
  description: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}

export type TourDefinition = {
  id: TourId
  version: number
  /** When false, the tour never auto-starts — only Help / ?tour= / Copilot Show me / force. */
  auto: boolean
  requiresCopilot?: boolean
  blockedByFirstLead?: boolean
  steps: TourStep[]
}
