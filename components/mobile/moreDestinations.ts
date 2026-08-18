import type { IconNames } from '@/lib/Icon'

/**
 * The mobile "עוד" map — every entry lands DIRECTLY on its destination.
 *
 * THE RULE THIS FILE ENFORCES: a label names a destination, and tapping it
 * arrives there. Not at the top of a settings page with the section somewhere
 * below the fold — the settings nav column is gated out of the mobile workspace
 * (see `SettingsChrome`), so each `href` below opens on its own content.
 *
 * Every route here already exists. Nothing is a placeholder, nothing is a
 * "coming soon" row, and nothing points at a page whose content is a menu.
 * `desktopOnly` entries are honest handoffs, not disabled buttons.
 *
 * PURE DATA: no JSX, no client hooks — importable from server and client alike
 * (the lesson from the STATUS_STYLES RSC crash).
 */

export type MoreSection = 'profile' | 'workspace' | 'business' | 'system' | 'account'

export type MoreItem = {
  /** Label the user reads. It must name the destination, not a category. */
  title: string
  subtitle?: string
  href: string
  icon: IconNames
  section: MoreSection
  /** ADMIN-only destinations are hidden entirely rather than shown and refused. */
  adminOnly?: boolean
  /** Requires the AI-inspector flag in addition to ADMIN. */
  inspectorOnly?: boolean
}

export const MORE_SECTION_LABELS: Record<MoreSection, string> = {
  profile: 'פרופיל',
  workspace: 'סביבת העבודה',
  business: 'העסק',
  system: 'מערכת',
  account: 'חשבון',
}

/** Order sections appear in. Personal first, administrative last. */
export const MORE_SECTION_ORDER: MoreSection[] = ['profile', 'workspace', 'business', 'system', 'account']

export const MORE_ITEMS: MoreItem[] = [
  // ---- PROFILE ----
  { section: 'profile', title: 'פרופיל אישי', subtitle: 'שם, תמונה והעדפות', href: '/settings/self_edit', icon: 'user' },
  { section: 'profile', title: 'פרטי נציג', subtitle: 'פרטי הקשר שלך', href: '/settings/update_user_details', icon: 'user-pen', adminOnly: true },

  // ---- WORKSPACE ----
  { section: 'workspace', title: 'אינטגרציות', subtitle: 'וואטסאפ, פייסבוק ואינסטגרם', href: '/settings/integrations', icon: 'plug' },
  { section: 'workspace', title: 'צוותים', subtitle: 'חלוקת הנציגים לצוותים', href: '/settings/edit_teams', icon: 'users', adminOnly: true },
  { section: 'workspace', title: 'משתמשים', subtitle: 'נציגים והזמנות', href: '/settings/edit_users', icon: 'user-pen', adminOnly: true },

  // ---- BUSINESS ----
  { section: 'business', title: 'פרטי העסק', subtitle: 'שם, לוגו ופרטי קשר', href: '/settings/update_agency', icon: 'diamond', adminOnly: true },
  { section: 'business', title: 'מנוי ותשלום', subtitle: 'תוכנית, חשבוניות ותשלומים', href: '/settings/update_payment', icon: 'credit-card', adminOnly: true },

  // ---- SYSTEM ----
  { section: 'system', title: 'אבטחה', subtitle: 'היסטוריית כניסות והתנתקות', href: '/settings/update_security', icon: 'shield', adminOnly: true },
  { section: 'system', title: 'הגדרות מערכת', subtitle: 'ברירות מחדל', href: '/settings/update_default', icon: 'folders', adminOnly: true },
  /*
   * AI Inspector is deliberately ABSENT from this menu.
   *
   * It is a diagnostic console — two wide tables of AI run records, ADMIN plus a
   * feature flag — and it has no mobile screen. Listing it here would put a row
   * in the hub whose only outcome is "open this on a computer", which is exactly
   * the accidental dead end this file's rule forbids ("nothing is a 'coming
   * soon' row"). The route still answers a typed URL with the standard handoff
   * (`lib/mobile/desktopOnlyRoutes.ts` → `ai_inspector`); it is simply not
   * advertised. `inspectorOnly` stays in the type for the desktop nav's use.
   */

  // ---- ACCOUNT ----
  // Deliberately reachable by EVERY role: a נציג whose WhatsApp just broke is
  // exactly the person who needs support, and routing them via their manager
  // adds a hop at the worst moment.
  { section: 'account', title: 'תמיכה', subtitle: 'פתיחת פנייה ומעקב', href: '/support', icon: 'life-ring' },
]

/**
 * The items this viewer may actually reach.
 *
 * Hidden, not disabled: a row that refuses on tap is worse than no row. This
 * mirrors the desktop settings nav's own role gating — it does NOT create a
 * second authorization rule, and every destination still enforces its own
 * server-side checks regardless of what this returns.
 */
export function visibleMoreItems(opts: { role: string; inspectorEnabled: boolean }): MoreItem[] {
  const isAdmin = opts.role === 'ADMIN'
  return MORE_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false
    if (item.inspectorOnly && !opts.inspectorEnabled) return false
    return true
  })
}

/** Items for one section, in declaration order. */
export function itemsForSection(items: MoreItem[], section: MoreSection): MoreItem[] {
  return items.filter((i) => i.section === section)
}
