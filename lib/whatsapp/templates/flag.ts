import 'server-only'

/**
 * Feature flag for WhatsApp ready-made messages (templates).
 *
 * Agency allowlist, mirroring the copilot flags (`lib/copilot/featureFlag.ts`):
 * `WHATSAPP_TEMPLATES_AGENCY_ALLOWLIST` is a comma-separated list of agency ids,
 * or the literal `all`. Empty/unset → OFF everywhere, so the settings page is
 * byte-for-byte unchanged until an agency is opted in (dark launch).
 */

function parseAllowlist(raw: string | undefined): 'all' | number[] {
  const v = (raw ?? '').trim()
  if (!v) return []
  if (v.toLowerCase() === 'all') return 'all'
  return v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
}

export function isTemplatesEnabledForAgency(agencyId: number | null | undefined): boolean {
  if (typeof agencyId !== 'number') return false
  const list = parseAllowlist(process.env.WHATSAPP_TEMPLATES_AGENCY_ALLOWLIST)
  if (list === 'all') return true
  return list.includes(agencyId)
}
