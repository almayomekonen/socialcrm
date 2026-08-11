import { getNotificationType } from './registry'
import { resolveChannels } from './policy'
import type { Capabilities, Presence, Priority } from './types'

/**
 * Is this row allowed to become a toast? Decided on the SERVER — spec §13.2.
 *
 * A toast is "an IN_APP notification that arrived while the user is ONLINE", not a
 * separate channel. Which types want that, in which presence state, is already
 * declared by the registry's `channels` policy, so this function is a lookup
 * through the existing intersection rather than a new rule:
 *
 *   toastEligible = 'toast' ∈ resolveChannels(policy, presence, capabilities, …)
 *
 * WHY NOT ON THE CLIENT: the browser has neither presence (server-classified from
 * user_presence, deliberately not client-trusted) nor preferences. A client-side
 * version would be a SECOND channel-routing decision site that could disagree
 * with the worker's — and the disagreement would surface as notifications that
 * toast when policy says they should be silent. The client keeps only the two
 * facts it alone owns: whether the row arrived after mount, and whether this
 * session already toasted it.
 */

/**
 * What a browser tab can receive.
 *
 * `toast: true` because the feed request itself is proof the surface exists — the
 * app is open and rendering. This is NOT the P1 `IN_APP_ONLY_CAPABILITIES`, which
 * models the WORKER's view, where no client is present and toast is genuinely
 * unavailable. Push and email stay false here: they are not client surfaces and
 * they are not wired until P3.
 */
export const CLIENT_SURFACE_CAPABILITIES: Capabilities = {
  in_app: true,
  toast: true,
  web_push: false,
  email: false,
}

export function isToastEligible(args: { type: string; priority: Priority; presence: Presence }): boolean {
  const def = getNotificationType(args.type)
  // An unknown or disabled type never toasts. A row can outlive its registry
  // entry (a type retired while notifications for it are still unread), and the
  // safe reading of "I no longer know what this is" is silence.
  if (!def?.enabled) return false

  return resolveChannels({
    policy: def.channels,
    presence: args.presence,
    capabilities: CLIENT_SURFACE_CAPABILITIES,
    priority: args.priority,
    // No preference reader yet — the table is empty and an absent row means
    // "all defaults" (spec §17), which is exactly what undefined expresses.
    // P3 passes the real preferences through this same argument.
    preferences: undefined,
  }).includes('toast')
}
