/**
 * Mutable fixtures for the phone shell tests (i18n Phase F1): the router path,
 * the session user and the rollout flags the "עוד" page reads, the clipboard
 * outcome, and the stored interface-language preference. Each test file wires
 * its `vi.mock` factories to this object; `resetShellEnv()` restores it.
 */

export const NOW = Date.parse('2026-10-30T09:00:00Z')

export type ShellUser = { id: number; name: string; email: string; role: string; agencyId: number }

export const ADMIN_USER: ShellUser = { id: 7, name: 'דנה כהן', email: 'dana@example.com', role: 'ADMIN', agencyId: 103 }
export const REP_USER: ShellUser = { id: 8, name: 'יוסי לוי', email: 'yossi@example.com', role: 'AGNT', agencyId: 103 }
/** A user with no display name — the page shows the e-mail as the name. */
export const NAMELESS_USER: ShellUser = { id: 9, name: '', email: 'office@example.com', role: 'OFFICE', agencyId: 103 }

const DEFAULTS = {
  pathname: '/dashboard',
  user: ADMIN_USER as ShellUser | null,
  mobile: true,
  inspector: true,
  agent: true,
  questionnaire: true,
  copyOk: true,
  userLocale: null as string | null,
}

export const shellEnv = { ...DEFAULTS }

export function resetShellEnv() {
  Object.assign(shellEnv, DEFAULTS)
}

/** Every route the header has a rule for, plus a stack screen and an unknown route. */
export const SHELL_PATHS = [
  '/dashboard',
  '/leads',
  '/inbox',
  '/inbox/messenger',
  '/notifications',
  '/m',
  '/clients/5/summary',
  '/agent',
  '/settings/integrations',
  '/settings/auto-response',
  '/tasks',
  '/somewhere-else',
] as const

/** Every path the shell-level skeleton picks a shape for. */
export const SKELETON_PATHS = [
  '/clients/5/summary',
  '/leads',
  '/clients',
  '/inbox?conversation=5',
  '/inbox',
  '/notifications',
  '/m',
  '/settings/integrations?section=templates',
  '/settings/integrations',
  '/settings/self_edit',
  '/dashboard',
  '',
] as const
