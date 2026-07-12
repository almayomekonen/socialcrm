/**
 * Phase 1 inbox delta-sync rollout flag. OFF by default — when off, the awareness
 * provider is an inert pass-through and the inbox keeps its router.refresh poller
 * (the safety net). Flip via env to enable the client awareness/sync loops during
 * the production soak. Read server-side and passed to the client as a boolean prop.
 *
 * Wave A1: companion RSC refresh stays mounted when delta is ON (60s), unless the
 * INBOX_REFRESH_POLLER escape hatch says otherwise.
 */

export function isInboxDeltaSyncEnabled(): boolean {
  const v = process.env.INBOX_DELTA_SYNC
  return v === 'true' || v === '1'
}

const REFRESH_5S = 5_000
const REFRESH_60S = 60_000

/**
 * Resolve ConversationRefreshPoller interval for the current flag matrix.
 * Returns `null` only when refresh must not mount (delta ON + INBOX_REFRESH_POLLER=off).
 * When delta is OFF, never returns null — avoids a neither-poller dead state.
 */
export function getInboxRefreshIntervalMs(deltaSyncEnabled: boolean): number | null {
  const raw = (process.env.INBOX_REFRESH_POLLER ?? '').trim().toLowerCase()

  if (raw === 'force5s' || raw === '5s') {
    return REFRESH_5S
  }

  if (raw === 'off' || raw === '0' || raw === 'false') {
    if (deltaSyncEnabled) return null
    // Delta off + refresh off would leave no live path — keep today's 5s safety net.
    return REFRESH_5S
  }

  // default
  return deltaSyncEnabled ? REFRESH_60S : REFRESH_5S
}

export function shouldMountInboxRefreshPoller(deltaSyncEnabled: boolean): boolean {
  return getInboxRefreshIntervalMs(deltaSyncEnabled) != null
}
