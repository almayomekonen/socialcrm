/**
 * Facebook Comments — capability gates.
 *
 * TWO INDEPENDENT GATES, deliberately separate:
 *
 *  1. `isFacebookCommentsEnabledForAgency` — OUR rollout switch. Absence blocks
 *     (kill switch + agency allowlist), mirroring `lib/automations/flags.ts`.
 *  2. `hasCommentTextCapability` — META'S gate. Comment text requires
 *     `pages_read_user_content` (approved by Meta; was pending until 2026-10). Verified in
 *     production 2026-08-10: with only pages_show_list + pages_manage_metadata +
 *     leads_retrieval, the feed webhook delivers comment_id / post_id / from,
 *     but never `message`.
 *
 * Keeping them separate is what makes approval a config change rather than a
 * rewrite: when Meta approves, scopes widen and gate 2 flips on its own.
 */

/** The one permission that unlocks comment text. */
export const COMMENT_TEXT_PERMISSION = 'pages_read_user_content'

/** `all`, or a comma-separated list of agency ids. Shared by every Meta rollout gate. */
export function parseAllowlist(raw: string | undefined): 'all' | number[] {
  const v = (raw ?? '').trim()
  if (!v) return []
  if (v.toLowerCase() === 'all') return 'all'
  return v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
}

/** Our rollout gate. Unset ⇒ OFF everywhere (dark launch). */
export function isFacebookCommentsEnabledForAgency(agencyId: number | null | undefined): boolean {
  if (typeof agencyId !== 'number') return false
  if (process.env.FACEBOOK_COMMENTS_ENABLED !== '1') return false
  const list = parseAllowlist(process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST)
  if (list === 'all') return true
  return list.includes(agencyId)
}

/**
 * Meta's gate. `scopes` comes from a token inspection (debug_token) or the
 * OAuth grant check — never hardcoded, so this becomes true on its own the day
 * the permission is granted.
 */
export function hasCommentTextCapability(scopes: readonly string[]): boolean {
  return scopes.includes(COMMENT_TEXT_PERMISSION)
}
