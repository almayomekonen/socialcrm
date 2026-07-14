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
  /** App icon key from '@/lib/Icon'. */
  icon: IconNames
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
    statusPath: '/api/auth/google-drive/status',
    connectPath: '/api/auth/google-drive',
    disconnectPath: '/api/auth/google-drive/disconnect',
    connectLabel: 'חבר את Google Drive',
    disconnectedToast: 'Google Drive נותק',
  },
]
