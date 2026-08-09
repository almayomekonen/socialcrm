import type { IconNames } from '@/lib/Icon'

/**
 * Registry of third-party integrations shown in Settings → Integrations.
 *
 * This is the single source of truth for the integrations directory. Adding a
 * new integration is a data-only change: append one entry here and a card
 * appears — no new UI. The generic <IntegrationCard> renders each entry and
 * drives connect / status / disconnect against the endpoints below, so any
 * integration that follows the standard OAuth shape
 *   GET  statusPath      -> { connected: boolean; email?: string }
 *   GET  connectPath      -> starts the consent flow (browser navigation)
 *   POST disconnectPath   -> clears the connection
 * (Google Calendar, Gmail, Dropbox, OneDrive, …) needs no bespoke component.
 * Integrations that diverge from this shape can extend the descriptor later
 * without changing existing entries.
 */
export type IntegrationDescriptor = {
  /** Stable id; also the React key. */
  id: string
  /** Product name, shown as the card title (kept in the brand's own language). */
  name: string
  /** One-line, user-facing value proposition. */
  description: string
  /** App icon key from '@/lib/Icon'. Used only when `logoSrc` is absent. */
  icon: IconNames
  /**
   * Optional brand tint for the mask icon (see `./brandColors`). Ignored when
   * `logoSrc` is set — a real logo carries its own colours.
   */
  iconClassName?: string
  /**
   * Path to the product's authentic multi-colour logo under
   * `/media/social-icons/`. When present the card renders this image instead
   * of the mask icon.
   *
   * WHY BOTH EXIST: `@/lib/Icon` draws a CSS mask, which is a single-colour
   * silhouette by construction — it can never show Google Drive's blue/green/
   * yellow prism. Brand marks that are multi-colour therefore ship as real
   * SVG files; everything else keeps the cheaper mask.
   */
  logoSrc?: string
  /** GET → { connected: boolean; email?: string }. */
  statusPath: string
  /** Browser-navigation target that starts the OAuth consent flow. */
  connectPath: string
  /** POST → clears the connection. */
  disconnectPath: string
  /** CTA label for the disconnected state. */
  connectLabel: string
  /** Success toast shown after a disconnect. */
  disconnectedToast: string
}

export const INTEGRATIONS: IntegrationDescriptor[] = [
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'חיפוש, צירוף וניתוח של קבצים מ-Drive ישירות בתוך הלידים ובעוזר החכם.',
    icon: 'google-drive',
    logoSrc: '/media/social-icons/google-drive-color.svg',
    statusPath: '/api/auth/google-drive/status',
    connectPath: '/api/auth/google-drive',
    disconnectPath: '/api/auth/google-drive/disconnect',
    connectLabel: 'חבר את Google Drive',
    disconnectedToast: 'Google Drive נותק',
  },
]
