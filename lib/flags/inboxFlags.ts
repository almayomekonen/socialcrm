/**
 * Phase 1 inbox delta-sync rollout flag. OFF by default — when off, the awareness
 * provider is an inert pass-through and the inbox keeps its router.refresh poller
 * (the safety net). Flip via env to enable the client awareness/sync loops during
 * the production soak. Read server-side and passed to the client as a boolean prop.
 */
export function isInboxDeltaSyncEnabled(): boolean {
  const v = process.env.INBOX_DELTA_SYNC
  return v === 'true' || v === '1'
}
