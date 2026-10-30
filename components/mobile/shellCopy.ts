import type { MessageKey, Translator } from '@/lib/i18n/translate'
import { LEGACY_DEFAULT_LOCALE } from '@/lib/i18n/config'
import type { DesktopOnlySection } from '@/lib/mobile/desktopOnlyRoutes'
import { DESKTOP_ONLY_SECTIONS } from '@/lib/mobile/desktopOnlyRoutes'
import type { MoreItem, MoreSection } from './moreDestinations'

/**
 * The phone shell's words in the interface language (i18n Phase F1).
 *
 * THE REGISTRIES ARE UNCHANGED. `MOBILE_TABS`, `MORE_ITEMS`,
 * `MORE_SECTION_LABELS` and `DESKTOP_ONLY_SECTIONS` still decide what exists,
 * in what order, for whom, and their Hebrew text (the a11y suite asserts it).
 * This module only words them outside Hebrew, by a stable key — tab href, More
 * row href, section code — and in Hebrew it returns the registry's own string,
 * so a Hebrew user's screen cannot drift from it. `mobileShellCopyPin.test.ts`
 * pins catalog Hebrew = registry Hebrew and that every entry has a key.
 *
 * PURE: no JSX, no hooks, safe on the server and the client.
 */

const isHebrew = (t: Translator) => t.locale === LEGACY_DEFAULT_LOCALE

/** Tab bar label by tab href (`MOBILE_TABS`). */
export const TAB_LABEL_KEYS: Record<string, MessageKey> = {
  '/dashboard': 'shell.nav.today',
  '/leads': 'shell.nav.leads',
  '/inbox': 'shell.nav.inbox',
  '/notifications': 'shell.notifications.label',
  '/m': 'mobileShell.tabs.more',
}

export function tabLabel(tab: { href: string; title: string }, t: Translator): string {
  const key = TAB_LABEL_KEYS[tab.href]
  return isHebrew(t) || !key ? tab.title : t(key)
}

/** A badged tab's accessible name. The count is passed as its digits, so Hebrew prints exactly what it printed. */
export function badgedTabName(label: string, count: number, t: Translator): string {
  return t('mobileShell.tabs.badged', { tab: label, count: String(count) })
}

/** The header's own titles for stack screens that are not a tab. */
export const HEADER_TITLE_KEYS = {
  lead: 'mobileShell.header.lead',
  agent: 'shell.nav.agent',
} as const satisfies Record<string, MessageKey>

export const MORE_SECTION_KEYS: Record<MoreSection, MessageKey> = {
  profile: 'mobileShell.more.section.profile',
  workspace: 'mobileShell.more.section.workspace',
  business: 'mobileShell.more.section.business',
  system: 'mobileShell.more.section.system',
  account: 'mobileShell.more.section.account',
}

export function moreSectionLabel(section: MoreSection, source: string, t: Translator): string {
  return isHebrew(t) ? source : t(MORE_SECTION_KEYS[section])
}

/** Title + subtitle of each More row, by its destination (`MORE_ITEMS[].href`). */
export const MORE_ITEM_KEYS: Record<string, { title: MessageKey; subtitle: MessageKey }> = {
  '/settings/self_edit': { title: 'settingsNav.profile', subtitle: 'mobileShell.more.subtitle.profile' },
  '/settings/update_user_details': { title: 'settingsNav.repDetails', subtitle: 'mobileShell.more.subtitle.repDetails' },
  '/agent': { title: 'shell.workspace.agentTitle', subtitle: 'shell.workspace.agentSubtitle' },
  '/settings/integrations': { title: 'settingsNav.integrations', subtitle: 'mobileShell.more.subtitle.integrations' },
  '/settings/edit_teams': { title: 'settingsNav.teams', subtitle: 'mobileShell.more.subtitle.teams' },
  '/settings/edit_users': { title: 'settingsNav.users', subtitle: 'mobileShell.more.subtitle.users' },
  '/settings/update_agency': { title: 'settingsNav.business', subtitle: 'mobileShell.more.subtitle.business' },
  '/settings/update_payment': { title: 'settingsNav.billing', subtitle: 'mobileShell.more.subtitle.billing' },
  '/settings/auto-response': { title: 'settingsNav.autoResponse', subtitle: 'mobileShell.more.subtitle.autoResponse' },
  '/settings/questionnaire': { title: 'settingsNav.questionnaire', subtitle: 'mobileShell.more.subtitle.questionnaire' },
  '/settings/update_security': { title: 'settingsNav.security', subtitle: 'mobileShell.more.subtitle.security' },
  '/settings/update_default': { title: 'settingsNav.system', subtitle: 'mobileShell.more.subtitle.system' },
  '/support': { title: 'settingsNav.support', subtitle: 'mobileShell.more.subtitle.support' },
}

export function moreItemCopy(item: MoreItem, t: Translator): { title: string; subtitle?: string } {
  const keys = MORE_ITEM_KEYS[item.href]
  if (isHebrew(t) || !keys) return { title: item.title, subtitle: item.subtitle }
  return { title: t(keys.title), subtitle: item.subtitle === undefined ? undefined : t(keys.subtitle) }
}

/** Title + body of each desktop-only handoff (`DESKTOP_ONLY_SECTIONS`). */
export const DESKTOP_ONLY_KEYS: Record<DesktopOnlySection, { title: MessageKey; body: MessageKey }> = {
  tasks: { title: 'shell.nav.tasks', body: 'mobileShell.desktopOnly.body.tasks' },
  calendar: { title: 'shell.nav.calendar', body: 'mobileShell.desktopOnly.body.calendar' },
  deals: { title: 'shell.nav.deals', body: 'mobileShell.desktopOnly.body.deals' },
  clients: { title: 'mobileShell.desktopOnly.title.clients', body: 'mobileShell.desktopOnly.body.clients' },
  sum_sales: { title: 'shell.nav.performance', body: 'mobileShell.desktopOnly.body.sumSales' },
  files: { title: 'tasks.files.title', body: 'mobileShell.desktopOnly.body.files' },
  promotion: { title: 'performance.promotion.title', body: 'mobileShell.desktopOnly.body.promotion' },
  lead_tasks: { title: 'mobileShell.desktopOnly.title.leadTasks', body: 'mobileShell.desktopOnly.body.leadTasks' },
  lead_files: { title: 'mobileShell.desktopOnly.title.leadFiles', body: 'mobileShell.desktopOnly.body.leadFiles' },
  lead_billing: { title: 'mobileShell.desktopOnly.title.leadBilling', body: 'mobileShell.desktopOnly.body.leadBilling' },
  ai_inspector: { title: 'mobileShell.desktopOnly.title.aiInspector', body: 'mobileShell.desktopOnly.body.aiInspector' },
}

export function desktopOnlyCopy(section: DesktopOnlySection, t: Translator) {
  const { icon, title, body } = DESKTOP_ONLY_SECTIONS[section]
  if (isHebrew(t)) return { icon, title, body }
  const keys = DESKTOP_ONLY_KEYS[section]
  return { icon, title: t(keys.title), body: t(keys.body) }
}
