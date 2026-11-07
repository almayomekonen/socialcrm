import type { Knex } from 'knex'
import { businessDateString } from '@/lib/today/time'

/**
 * The official Meta rate for one personal reminder (category `service`) to this
 * recipient. Meta prices by the RECIPIENT's country calling code (verified, the
 * pricing page). Rows are entered by hand from Meta's published rate card;
 * nothing here assumes a price.
 *
 * FAIL CLOSED (architecture v1.5 §1.4), with reason `pricing_unavailable`, when:
 *   - no row matches the recipient's country code, `service`, and the billing currency;
 *   - the row is not effective on the send date (in the billing timezone);
 *   - it was verified more than `maxAgeDays` ago;
 *   - more than one row matches.
 */

export type RateLookup = { ok: true; rateCardId: number; unitPriceMicros: number } | { ok: false }

export async function findServiceRate(
  q: Knex | Knex.Transaction,
  input: { phoneE164: string; currency: string; billingTimezone: string; maxAgeDays: number; nowMs: number },
): Promise<RateLookup> {
  const digits = input.phoneE164.replace(/\D/g, '')
  const onDate = businessDateString(input.nowMs, input.billingTimezone)
  const verifiedSince = new Date(input.nowMs - input.maxAgeDays * 24 * 60 * 60 * 1000)
  const rows = (await q('platform_whatsapp_rate_cards')
    .where({ category: 'service', currency: input.currency })
    .where('effectiveFrom', '<=', onDate)
    .andWhere((b) => b.whereNull('effectiveTo').orWhere('effectiveTo', '>=', onDate))
    .andWhere('verifiedAt', '>=', verifiedSince)
    .select('id', 'countryCode', 'unitPriceMicros')) as { id: string | number; countryCode: string; unitPriceMicros: string | number }[]
  // The longest calling code that prefixes the number is the market (e.g. 972 for Israel).
  const matching = rows.filter((r) => digits.startsWith(r.countryCode))
  const longest = Math.max(0, ...matching.map((r) => r.countryCode.length))
  const best = matching.filter((r) => r.countryCode.length === longest)
  if (best.length !== 1) return { ok: false }
  return { ok: true, rateCardId: Number(best[0].id), unitPriceMicros: Number(best[0].unitPriceMicros) }
}

/** Meta's 24-hour window, from VERIFIED Meta timestamps only: the owner's latest inbound to the platform number. */
export async function latestVerifiedInboundMs(q: Knex | Knex.Transaction, fromHash: string): Promise<number | null> {
  const row = (await q('platform_whatsapp_inbound')
    .where({ fromHash, timestampSource: 'meta' })
    .max<{ ts: string | number | null }[]>('messageTimestamp as ts')) as { ts: string | number | null }[]
  const ts = row[0]?.ts
  return ts === null || ts === undefined ? null : Number(ts) * 1000
}
