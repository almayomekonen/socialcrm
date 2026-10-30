/**
 * Phone shell namespace (Phase F1) — the mobile workspace's own chrome (tab
 * bar, header, the "עוד" page, shell skeleton labels via `inbox.page.loading`)
 * and the desktop-only handoff screens. The pages inside the shell keep their
 * own namespaces.
 */
import { tabs, header, more } from './chrome'
import { desktopOnly } from './handoff'

export const mobileShell = { tabs, header, more, desktopOnly } as const
