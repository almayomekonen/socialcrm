import type { IntegrationDefinition } from '../types'

/**
 * Registered integrations (frozen spec §3.1).
 *
 * An Integration row is presentation plus an auth strategy from the closed set
 * — nothing executable. The code that talks to the provider lives in its
 * connector; this is only what the Builder needs in order to explain a
 * requirement to the user without knowing what the provider is.
 *
 * ONE row today: the customer's website. The appointment occurrence used to
 * need a row here too, back when a third-party scheduling connector produced it;
 * it is now produced by the Meetings domain, which is ours and needs no
 * connection. Removing that row removed the card, the lock and the capability
 * with it — the page iterates this list and authors nothing.
 */
export const INTEGRATION_ENTRIES: readonly IntegrationDefinition[] = [
  {
    /**
     * THE KEY IS AN INTERNAL ROUTING TOKEN, DELIBERATELY LEFT ALONE.
     *
     * The customer connects "האתר שלי"; Contact Form 7 is one implementation
     * of that, and the product must never say otherwise. But nothing branches
     * on this string — it only selects a provider from the connector registry
     * — while it IS persisted on every connection row and inside every
     * `connectionId`. Renaming it would buy a nicer identifier at the cost of
     * a migration across three tables and a compatibility alias.
     *
     * The one place an internal key reaches a customer is the webhook URL
     * built in `actions/automations/connections.ts`. That coupling — a public
     * surface derived from a registry key — is the real defect, and it is
     * fixed where the public API is designed, not by renaming the key here.
     *
     *   product concept   →  Website          (title, below)
     *   platform          →  WordPress        (the connector's setup guide)
     *   implementation    →  Contact Form 7   (this key, and the parser)
     */
    key: 'contact_form_7',
    title: 'האתר שלי',
    icon: 'globe',
    // No OAuth: the site posts to a per-connection webhook URL and signs with
    // a per-connection secret. `api_key` is the closed-set strategy that
    // describes exactly that.
    auth: 'api_key',
    /**
     * The CONTRACT, not the implementation — and the one identifier here that
     * is worth renaming, because it is computed at runtime and persisted
     * nowhere. A future custom-website or Gravity Forms connection grants this
     * same capability truthfully; `wordpress_form_connected` would have made a
     * React site assert something false about itself.
     */
    capabilities: ['website_connected'],
  },
]
