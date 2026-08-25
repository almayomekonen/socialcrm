/**
 * The insight DELIVERY gate — Phase 4.4.
 *
 * A fourth independent gate, and the narrowest. Delivery requires ALL of:
 *   1. `NOTIFICATIONS_ENABLED` + the notifications agency allowlist (existing)
 *   2. the registry entry's own `enabled` flag (ships false)
 *   3. `SIGNAL_INSIGHT_DELIVER_AGENCY_IDS` (this file, unset)
 *   4. `SIGNAL_INSIGHT_KILL` not set (this file)
 *
 * Four gates is not belt-and-braces theatre. Each one is owned by a different
 * concern — the notification engine, the type registry, the AI canary, and the
 * emergency stop — and any of them alone is enough to keep a business owner from
 * being interrupted by a machine.
 *
 * ABSENCE BLOCKS, and there is deliberately no `'all'`, for the same reason
 * `SIGNAL_SWEEP_AGENCY_IDS` and `SIGNAL_INVESTIGATE_AGENCY_IDS` refuse one: this
 * path spends a real business owner's attention, and a canary that can be widened
 * to every tenant by a typo is not a canary.
 *
 * Read per call, never cached: a kill switch you must redeploy to use is not a
 * kill switch.
 */

/** The emergency stop. Fails CLOSED — any truthy value halts all delivery. */
export function isInsightDeliveryKilled(): boolean {
  const kill = process.env.SIGNAL_INSIGHT_KILL
  return kill === '1' || kill === 'true'
}

/** Per-agency canary, default OFF. */
export function isInsightDeliveryEnabled(agencyId: number | null | undefined): boolean {
  if (isInsightDeliveryKilled()) return false
  const raw = (process.env.SIGNAL_INSIGHT_DELIVER_AGENCY_IDS ?? '').trim()
  if (!raw) return false
  if (!agencyId) return false
  if (raw === 'all') {
    console.warn(`[insight-deliver] SIGNAL_INSIGHT_DELIVER_AGENCY_IDS='all' is refused; list agency ids explicitly`)
    return false
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .includes(agencyId)
}

/**
 * The hard daily ceiling on delivered AI insights, per agency, per UTC day.
 *
 * A SAFETY CEILING, NOT A TARGET. Three is low on purpose: if the Value Bar, the
 * refractory window, the open-insight uniqueness and the per-user collapse are all
 * somehow miscalibrated at once, a business owner still is not flooded while we
 * find out. Reaching it leaves the insight OPEN and undelivered — nothing is
 * dropped, nothing is resolved, and a later day can still surface it.
 */
export const INSIGHT_DAILY_CAP = 3
