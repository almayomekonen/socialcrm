/**
 * Interface-language rollout gate.
 *
 * ABSENCE BLOCKS, like the mobile and notifications gates: with
 * `UI_LOCALE_ENABLED !== '1'` nobody can see or change the interface language,
 * stored preferences are ignored, and every user renders in Hebrew exactly as
 * before. An empty `UI_LOCALE_AGENCY_ALLOWLIST` means NO agency, so flipping the
 * master switch alone still exposes nothing. Pilot value: `103`.
 *
 * Read per call, never cached at module scope, so it is a working kill switch.
 */

export function isUiLocaleEnabled(): boolean {
  return process.env.UI_LOCALE_ENABLED === '1'
}

function parseAllowlist(raw: string | undefined): 'all' | Set<number> {
  const v = raw?.trim() ?? ''
  if (v === 'all') return 'all'
  const ids = v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return new Set(ids)
}

export function canUseUiLocales(agencyId: number | null | undefined): boolean {
  if (!agencyId || !isUiLocaleEnabled()) return false
  const list = parseAllowlist(process.env.UI_LOCALE_AGENCY_ALLOWLIST)
  return list === 'all' ? true : list.has(agencyId)
}
