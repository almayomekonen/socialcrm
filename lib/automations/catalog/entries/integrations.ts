import type { IntegrationDefinition } from '../types'

/**
 * Registered integrations (frozen spec §3.1).
 *
 * An Integration row is presentation plus an auth strategy from the closed set
 * — nothing executable. The code that talks to the provider lives in its
 * connector; this is only what the Builder needs in order to explain a
 * requirement to the user without knowing what the provider is.
 *
 * B7 registered the first one. C1 added the second — one row, append-only,
 * exactly as predicted.
 */
export const INTEGRATION_ENTRIES: readonly IntegrationDefinition[] = [
  {
    key: 'calendly',
    title: 'Calendly',
    icon: 'calendar',
    auth: 'oauth2',
    capabilities: ['calendar_connected'],
  },
  {
    key: 'contact_form_7',
    title: 'Contact Form 7',
    icon: 'file-lines',
    // No OAuth: a WordPress site posts to a per-connection webhook URL and
    // signs with a per-connection secret. `api_key` is the closed-set strategy
    // that describes exactly that.
    auth: 'api_key',
    capabilities: ['wordpress_form_connected'],
  },
]
