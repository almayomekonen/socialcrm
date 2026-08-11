/**
 * Channel policy — which channels a type wants, per presence state. Spec §19.
 *
 * Policy is only ever the STARTING SET. What actually gets dispatched is
 * (spec §15.1):
 *
 *   selected = policyChannels(type, presence)
 *            ∩ enabledByPreferences(user, category)
 *            ∩ availableCapabilities(user)
 *
 * so a channel a user cannot receive, or has turned off, simply drops out —
 * there is no per-device branch anywhere in the engine. "Desktop" is never
 * encoded as an assumption: push works for whoever has a subscription row.
 *
 * The five shapes below are named rather than repeated per type, because the
 * name states the intent ("toast while you are here, push once you are not")
 * and stops fifteen near-identical literals from drifting apart.
 */

import type { Channel, ChannelPolicy, Capabilities, Presence, Priority } from './types'

const IN_APP = ['in_app'] as const
const IN_APP_TOAST = ['in_app', 'toast'] as const
const IN_APP_PUSH = ['in_app', 'web_push'] as const

/** Quiet, ambient state changes. Never interrupts, in any presence state. */
export const IN_APP_ONLY: ChannelPolicy = { online: IN_APP, idle: IN_APP, offline: IN_APP }

/** Normal work: toast while present, silent while idle, push once away. */
export const TOAST_THEN_PUSH_WHEN_OFFLINE: ChannelPolicy = {
  online: IN_APP_TOAST,
  idle: IN_APP,
  offline: IN_APP_PUSH,
}

/** Time-sensitive: toast while present, push the moment attention lapses. */
export const TOAST_THEN_PUSH_WHEN_AWAY: ChannelPolicy = {
  online: IN_APP_TOAST,
  idle: IN_APP_PUSH,
  offline: IN_APP_PUSH,
}

/** Already-waiting work: no toast (nothing just happened), push when away. */
export const PUSH_WHEN_AWAY: ChannelPolicy = {
  online: IN_APP,
  idle: IN_APP_PUSH,
  offline: IN_APP_PUSH,
}

/**
 * The only shape that emails by default — reserved for "your business is broken
 * and you cannot find out any other way" (spec §16). Three types carry it, and
 * one of those three is disabled, so two types email by default in practice.
 * Everything else reaches email only by failing to be handled (escalation, P4).
 */
export const CRITICAL_WITH_EMAIL: ChannelPolicy = {
  online: ['in_app', 'toast', 'email'],
  idle: ['in_app', 'web_push', 'email'],
  offline: ['in_app', 'web_push', 'email'],
}

/**
 * P1 capabilities: in-app only.
 *
 * Not a temporary hack — it is the capability model working as designed. Push
 * has no subscription rows until P3 and email is not wired until P3, so those
 * capabilities are genuinely false right now. When they become true, the same
 * intersection starts selecting them with no change to this function or to any
 * registry entry.
 */
export const IN_APP_ONLY_CAPABILITIES: Capabilities = {
  in_app: true,
  toast: false,
  web_push: false,
  email: false,
}

/**
 * Preference lookup result. An ABSENT entry means "default", i.e. allowed —
 * a user with no preference rows at all gets the full policy matrix (spec §17),
 * which is why the product needs no configuration to behave correctly.
 */
export type ChannelPreferences = Partial<Record<Channel, boolean>>

/**
 * The intersection. Order of the result follows the policy's own order so
 * dispatch is deterministic and testable.
 *
 * One asymmetry, deliberate (spec §17): a CRITICAL notification's IN_APP
 * channel cannot be switched off. An integration being down is not an opinion,
 * and the in-app row is the only record that survives the user being away.
 * Push and email for CRITICAL types remain fully user-controllable.
 */
export function resolveChannels(input: {
  policy: ChannelPolicy
  presence: Presence
  capabilities: Capabilities
  priority: Priority
  preferences?: ChannelPreferences
}): Channel[] {
  const { policy, presence, capabilities, priority, preferences } = input
  return policy[presence].filter((channel) => {
    if (!capabilities[channel]) return false
    if (channel === 'in_app' && priority === 'critical') return true
    return preferences?.[channel] !== false
  })
}
