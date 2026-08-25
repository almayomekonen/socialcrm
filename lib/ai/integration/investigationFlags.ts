/**
 * The autonomous investigation gate — Phase 4.3.
 *
 * ABSENCE BLOCKS, exactly like every sibling flag in this subsystem. An unset or
 * empty allowlist means NO agency, so a machine that has never heard of this
 * feature — which is every production and preview environment today — runs the
 * deterministic path only and never reaches a model.
 *
 * There is deliberately NO `'all'` value, for the same reason
 * `SIGNAL_SWEEP_AGENCY_IDS` refuses one: this path spends real money against a
 * real provider on production CRM data, and a canary that can be widened to every
 * tenant by a typo is not a canary.
 *
 * Read per call, never cached at module scope: a kill switch you have to redeploy
 * to use is not a kill switch.
 *
 * This is a SECOND gate, not a replacement. An agency must be allowlisted for the
 * sweep (to produce signals at all) AND for investigation (to spend on them), so
 * turning proactive detection on never implicitly turns spending on.
 */

/** The global backstop. Halts every autonomous investigation immediately. */
export function isInvestigationKilled(): boolean {
  const kill = process.env.SIGNAL_INVESTIGATE_KILL
  return kill === '1' || kill === 'true'
}

/** Per-agency canary, default OFF. Empty/unset ⇒ off everywhere. */
export function isInvestigationEnabled(agencyId: number | null | undefined): boolean {
  if (isInvestigationKilled()) return false
  const raw = (process.env.SIGNAL_INVESTIGATE_AGENCY_IDS ?? '').trim()
  if (!raw) return false
  if (!agencyId) return false
  if (raw === 'all') {
    console.warn(`[signal-investigate] SIGNAL_INVESTIGATE_AGENCY_IDS='all' is refused; list agency ids explicitly`)
    return false
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .includes(agencyId)
}
