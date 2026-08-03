import type { IntegrationDefinition } from '../types'

/**
 * Registered integrations (frozen spec §3.1).
 *
 * An Integration row is presentation plus an auth strategy from the closed set
 * — nothing executable. The code that talks to the provider lives in its
 * connector; this is only what the Builder needs in order to explain a
 * requirement to the user without knowing what the provider is.
 *
 * B7 registers the first one. Adding the second is another row here.
 */
export const INTEGRATION_ENTRIES: readonly IntegrationDefinition[] = [
  {
    key: 'calendly',
    title: 'Calendly',
    icon: 'calendar',
    auth: 'oauth2',
    capabilities: ['calendar_connected'],
  },
]
