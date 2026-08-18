import MobileSectionHandoff from './MobileSectionHandoff'
import { DESKTOP_ONLY_SECTIONS, type DesktopOnlySection } from '@/lib/mobile/desktopOnlyRoutes'

/**
 * What a phone sees on a section that lives on the computer.
 *
 * A REAL MOBILE SCREEN, not the desktop page in a smaller box. It renders
 * through `MobileSectionHandoff` — the mobile workspace's existing handoff
 * primitive, already used by `MobileTodayEmpty` — so it inherits the workspace's
 * spacing, icon treatment, typography and touch targets rather than inventing a
 * second look for the same job (ux-guidelines.md §12, architecture-rules.md §10).
 *
 * THE DESKTOP UI IS NOT RENDERED UNDERNEATH IT. Each route returns this INSTEAD
 * of its page body, before its queries run, so the phone's HTML contains no
 * table, no grid and no filter bar to hide — and the server does no work
 * building them. Nothing here is CSS-conditional; a desktop request never
 * reaches this component at all (architecture-rules.md §9).
 *
 * Server Component, and temporary by construction: a section deletes its entry
 * from `lib/mobile/desktopOnlyRoutes.ts` and its gate from its page the day it
 * gains a real phone screen.
 */
export default function MobileDesktopOnly({ section }: { section: DesktopOnlySection }) {
  const { icon, title, body } = DESKTOP_ONLY_SECTIONS[section]

  /**
   * `desktopHandoff` rather than an in-app `action` link, deliberately. These
   * sections have no reduced mobile equivalent to send the user to, so a link
   * elsewhere would be a consolation prize dressed as a next step. The honest
   * next step is the other device, and getting this address onto it is a real,
   * working action — one primary, doing exactly what its label says
   * (ux-guidelines.md §3, §5).
   */
  return <MobileSectionHandoff icon={icon} title={title} body={body} desktopHandoff />
}
