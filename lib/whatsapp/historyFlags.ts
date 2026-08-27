/**
 * The second key on the history gate: a per-phone-number allowlist.
 *
 * WHY TWO KEYS. `HISTORY_SYNC_ENABLED` in `lib/whatsapp/coexistence.ts` is a
 * code constant, so lifting it requires a diff and a review — but a code
 * constant is all-or-nothing, and the first real activation must reach exactly
 * ONE consenting number. This allowlist is the narrow half. Both must pass:
 *
 *   HISTORY_SYNC_ENABLED (code, reviewed)  AND  allowlist (env, operational)
 *
 * Neither alone does anything. A dashboard edit cannot enable history, because
 * the constant is still false. A merged constant change cannot enable it for
 * anyone either, because the allowlist defaults to empty. That is the property
 * an env-var-only flag cannot give: no single action, by any one person, in any
 * one place, turns this on for a customer.
 *
 * DEFAULT DENY. Unset or empty means OFF for everyone — not "on for everyone",
 * which is the failure mode that makes a one-shot archive irrecoverable.
 *
 * KEYED BY `phone_number_id`, NOT agency. The archive is per-WhatsApp-number and
 * spent per-number; an agency with two connected numbers must be able to
 * activate one and leave the other untouched. This is the only allowlist in the
 * repo keyed this way, and deliberately so — every sibling flag gates a UI
 * surface, where agency is the right unit.
 *
 * ROLLBACK IS REMOVING AN ENTRY. No deploy, no migration, and already-imported
 * messages are untouched.
 *
 * The parse shape mirrors `lib/whatsapp/templates/flag.ts` and the other
 * allowlists exactly, including the literal `all` escape hatch.
 */

function parseAllowlist(raw: string | undefined): 'all' | string[] {
  const v = (raw ?? '').trim()
  if (!v) return []
  if (v.toLowerCase() === 'all') return 'all'
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** The raw allowlist, for the worker's claim filter and for diagnostics. */
export function historyAllowlist(): 'all' | string[] {
  return parseAllowlist(process.env.WHATSAPP_HISTORY_PHONE_ALLOWLIST)
}

/**
 * Is history activated for this specific business number?
 *
 * Callers must ALSO check `HISTORY_SYNC_ENABLED`. This function deliberately
 * does not read it: the constant lives with the code that owns it, and importing
 * it here would create a cycle and hide one of the two keys behind the other.
 */
export function isHistoryEnabledForPhoneNumber(phoneNumberId: string | null | undefined): boolean {
  if (typeof phoneNumberId !== 'string' || phoneNumberId.length === 0) return false
  const list = historyAllowlist()
  if (list === 'all') return true
  return list.includes(phoneNumberId)
}

/** Observable activation state for logs and diagnostics. Never logs the numbers themselves. */
export function historyActivationState(): { mode: 'off' | 'allowlist' | 'all'; count: number } {
  const list = historyAllowlist()
  if (list === 'all') return { mode: 'all', count: -1 }
  return { mode: list.length === 0 ? 'off' : 'allowlist', count: list.length }
}
