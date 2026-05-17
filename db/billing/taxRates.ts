import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import type { BusinessType } from '@/lib/billing/issuer/fields'
import { effectiveTaxRatePercent } from '@/lib/billing/issuer/effectiveTaxRate'

export const DEFAULT_TAX_CODE = 'VAT_STD'
export const DEFAULT_TAX_LABEL = 'מע"מ סטנדרטי'
export const DEFAULT_TAX_RATE_PERCENT = 18.0
export const DEFAULT_TAX_COUNTRY = 'IL'
export const DEFAULT_TAX_EFFECTIVE_FROM = '2024-01-01'

export type BillTaxRateRow = {
  id: number
  agencyId: number
  code: string
  label: string
  ratePercent: number
  country: string
  effectiveFrom: string
  effectiveTo: string | null
  createdByUserId: number | null
  createdAt: string
}

// Single tax-rate resolution query, shared by every caller that needs to know
// the active rate for an agency at a given moment. Both the new-invoice page
// (preview rate) and line persistence (server-side rate) MUST go through this
// — duplicating the query risks subtle divergence (e.g. effectiveFrom filter
// drift) which silently produces different client/server totals.
async function queryActiveTaxRateRow(
  agencyId: number,
  code: string,
  atDate: Date | string | undefined,
  executor: typeof db,
): Promise<Record<string, unknown> | undefined> {
  const at = toIsoDate(atDate)
  return executor('bill_tax_rates')
    .where({ agencyId, code })
    .andWhere('effectiveFrom', '<=', at)
    .andWhere((qb) => {
      qb.whereNull('effectiveTo').orWhere('effectiveTo', '>', at)
    })
    .orderBy('effectiveFrom', 'desc')
    .first()
}

export async function getActiveTaxRate(code: string = DEFAULT_TAX_CODE, atDate?: Date | string): Promise<BillTaxRateRow | null> {
  const user = await requireUser()
  const row = await queryActiveTaxRateRow(user.agencyId, code, atDate, db)
  return row ? normalize(row) : null
}

// Canonical line-side tax resolver. Combines two inputs into a single
// effective rate:
//   1. The agency's base VAT_STD row (or DEFAULT_TAX_RATE_PERCENT if no row
//      exists yet — same client/server fallback that prevented the totals
//      divergence in W0).
//   2. The agency's business-type policy (see lib/billing/issuer/effectiveTaxRate).
//      'exempt' (עוסק פטור) is forbidden from collecting VAT regardless of
//      the base row, so the effective rate is 0 and `id` is null because
//      no rate row is actually being applied.
//
// Callers in a transaction must pass the trx as `executor` so reads see the
// same snapshot as their writes.
export async function resolveActiveTaxRateForLine(
  agencyId: number,
  executor: typeof db = db,
): Promise<{ id: number | null; ratePercent: number }> {
  const [agencyRow, baseRow] = await Promise.all([
    executor('agencies').where({ id: agencyId }).first('businessType'),
    queryActiveTaxRateRow(agencyId, DEFAULT_TAX_CODE, undefined, executor),
  ])

  const baseRatePercent = baseRow ? Number(baseRow.ratePercent) : DEFAULT_TAX_RATE_PERCENT
  const businessType = (agencyRow?.businessType ?? null) as BusinessType | null
  const ratePercent = effectiveTaxRatePercent({ businessType, baseRatePercent })

  // No base row OR exempt → no `bill_tax_rates` row is actually being
  // applied; null the id so the join on the line stays honest.
  const id = ratePercent === 0 || !baseRow ? null : Number(baseRow.id)

  console.log(
    '[w6.trace] resolveActiveTaxRateForLine',
    JSON.stringify({ agencyId, businessType, baseRatePercent, effectiveRatePercent: ratePercent, returnedId: id }),
  )

  return { id, ratePercent }
}

export async function getOrCreateDefaultTaxRate(): Promise<BillTaxRateRow> {
  const existing = await getActiveTaxRate()
  if (existing) return existing

  const user = await requireUser()

  await db.raw(
    `
    INSERT INTO bill_tax_rates
      ("agencyId", code, label, "ratePercent", country, "effectiveFrom")
    VALUES (?, ?, ?, ?, ?, ?::date)
    ON CONFLICT ("agencyId", code, "effectiveFrom") DO NOTHING
    `,
    [
      user.agencyId,
      DEFAULT_TAX_CODE,
      DEFAULT_TAX_LABEL,
      DEFAULT_TAX_RATE_PERCENT,
      DEFAULT_TAX_COUNTRY,
      DEFAULT_TAX_EFFECTIVE_FROM,
    ],
  )

  const row = await getActiveTaxRate()
  if (!row) throw new Error('billing.tax_rate.resolve_failed')
  return row
}

function normalize(raw: Record<string, unknown>): BillTaxRateRow {
  return {
    id: Number(raw.id),
    agencyId: Number(raw.agencyId),
    code: String(raw.code ?? ''),
    label: String(raw.label ?? ''),
    ratePercent: Number(raw.ratePercent),
    country: String(raw.country ?? 'IL'),
    effectiveFrom: toIsoDate(raw.effectiveFrom as Date | string),
    effectiveTo: raw.effectiveTo ? toIsoDate(raw.effectiveTo as Date | string) : null,
    createdByUserId: raw.createdByUserId == null ? null : Number(raw.createdByUserId),
    createdAt: raw.createdAt instanceof Date ? raw.createdAt.toISOString() : String(raw.createdAt),
  }
}

function toIsoDate(d?: Date | string): string {
  if (!d) return new Date().toISOString().slice(0, 10)
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return d.length >= 10 ? d.slice(0, 10) : d
}
