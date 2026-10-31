/**
 * Notifications namespace (Phase F3) — the bell's panel, the center on desktop
 * and phone, its filters and selection, the arrival toast (`chrome`), and the
 * read-time wording of stored notification text (`content`). The bell's own
 * accessible name stays in `shell.notifications.*` (Phase A).
 */
import { category, panel, center, filters, toast } from './chrome'
import { provider, title, body } from './content'

export const notifications = { category, panel, center, filters, toast, content: { provider, title, body } } as const
