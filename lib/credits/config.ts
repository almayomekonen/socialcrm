/**
 * Usage credits — every price, allowance and switch, read from the environment
 * per call (a flag you must redeploy to flip is not a kill switch).
 *
 * ABSENCE BLOCKS, like every other rollout flag in this codebase:
 *
 *   CREDITS_METERING=1                     record the ledger (grants, debits, refunds).
 *                                          Unset: nothing is written, nothing changes.
 *   CREDITS_ENFORCEMENT_AGENCY_IDS         explicit ids whose agent requests are REFUSED past
 *                                          the free allowance without purchased credits. Never `all`. The Pro
 *                                          plan promises unlimited AI, so no existing
 *                                          subscriber may be listed until that promise
 *                                          is changed.
 *   CREDITS_PURCHASES_AGENCY_IDS           who may BUY a pack (and sees the balance).
 *   CREDITS_UI_AGENCY_IDS                  who sees the balance without buying.
 *
 * A free monthly allowance of agent requests, then one purchased-credit balance
 * per agency. Automation and WhatsApp delivery never touch either.
 *
 * Prices are ILS including VAT, exactly as charged through Grow. Credit amounts
 * are whole credits; the ledger stores milli-credits.
 */

export type PackKind = 'credits_200' | 'credits_500'
export type PackConfig = { kind: PackKind; credits: number; priceIls: number }

export const PACK_KINDS: readonly PackKind[] = ['credits_200', 'credits_500']
export const isPackKind = (k: unknown): k is PackKind => typeof k === 'string' && (PACK_KINDS as readonly string[]).includes(k)

const PACK_DEFAULTS: Record<PackKind, { credits: number; priceIls: number; env: string }> = {
  credits_200: { credits: 200, priceIls: 49, env: '200' },
  credits_500: { credits: 500, priceIls: 99, env: '500' },
}

/** A positive number from the environment, or the default (a typo never becomes 0 or NaN). */
function positive(name: string, fallback: number, opts: { integer?: boolean } = {}): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || (opts.integer && !Number.isInteger(n))) return fallback
  return n
}

/** Explicit positive agency ids only. `all` and anything else are ignored. */
export function parseAgencyIds(raw: string | undefined): number[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0)
}

const listed = (name: string, agencyId: number | null | undefined) =>
  !!agencyId && parseAgencyIds(process.env[name]).includes(agencyId)

export const isCreditsMeteringEnabled = (): boolean => process.env.CREDITS_METERING === '1'
const listedForEnforcement = (agencyId: number | null | undefined): boolean =>
  isCreditsMeteringEnabled() && listed('CREDITS_ENFORCEMENT_AGENCY_IDS', agencyId)
/**
 * Are credits enforced for this agency? The Pro plan promises unlimited AI, so a
 * Pro agency stays unenforced even when listed, until CREDITS_ENFORCE_ON_PRO=1
 * records that the plan policy and customer communication are resolved.
 */
export const isCreditEnforcedFor = (agencyId: number | null | undefined, plan: string | null | undefined): boolean =>
  listedForEnforcement(agencyId) && (plan !== 'pro' || process.env.CREDITS_ENFORCE_ON_PRO === '1')
export const canPurchaseCredits = (agencyId: number | null | undefined): boolean =>
  listed('CREDITS_PURCHASES_AGENCY_IDS', agencyId)
/** May packs be SOLD to this agency? Only where credits are enforced: otherwise usage is not limited and a pack buys nothing. */
export const isPackSellable = (agencyId: number | null | undefined, plan: string | null | undefined): boolean => canPurchaseCredits(agencyId) && isCreditEnforcedFor(agencyId, plan)
export const canSeeCreditBalance = (agencyId: number | null | undefined): boolean =>
  canPurchaseCredits(agencyId) || listed('CREDITS_UI_AGENCY_IDS', agencyId) || listedForEnforcement(agencyId)

/** Free agent requests per agency per calendar month (a COUNT of requests, not credits). */
export const monthlyAllowance = (): number => positive('CREDITS_MONTHLY_ALLOWANCE', 50, { integer: true })

/**
 * Purchased credits a paid request must have available, and the most it can be
 * debited. Cost is unknown until the model has run, so this is what guarantees a
 * balance never goes negative. Default 3 credits ($0.09 at $0.03), above the most
 * expensive request the usage ledger has recorded ($0.076).
 */
export const paidRequestHoldMillis = (): number => Math.round(positive('CREDITS_PAID_REQUEST_HOLD', 3) * 1000)

/** Optional platform-wide monthly automation AI spend (USD) that raises a warning. Unset: no warning. Never blocks. */
export function automationMonthlyUsdAlert(): number | null {
  const n = Number(process.env.CREDITS_AUTOMATION_MONTHLY_USD_ALERT?.trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

/** USD of ACTUAL provider cost that one credit stands for (default: one average assistant question). */
export const aiUsdPerCredit = (): number => positive('CREDITS_AI_USD_PER_CREDIT', 0.03)

/** Warn when the remaining balance falls to this share of the month's allowance (or below). */
export const lowBalancePercent = (): number => Math.min(100, positive('CREDITS_LOW_BALANCE_PERCENT', 20))

/** AI usage rows newer than this are not settled yet: the operation may still be running. */
export const AI_SETTLE_QUIET_MS = 15 * 60_000

export function packConfig(kind: PackKind): PackConfig {
  const d = PACK_DEFAULTS[kind]
  return {
    kind,
    credits: positive(`CREDITS_PACK_${d.env}_CREDITS`, d.credits, { integer: true }),
    priceIls: positive(`CREDITS_PACK_${d.env}_PRICE_ILS`, d.priceIls),
  }
}

export const allPacks = (): PackConfig[] => PACK_KINDS.map(packConfig)

/** The line Grow shows on the card statement for a pack. */
export function creditPackDescription(kind: PackKind, credits: number | null): string {
  const n = credits ?? packConfig(kind).credits
  return `SocialCRM ${n} קרדיטים`
}
