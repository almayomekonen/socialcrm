import type { BusinessType } from './fields'

/**
 * Central tax-rate policy for issuer business types.
 *
 * Israeli legal convention:
 *   - `exempt` (עוסק פטור): forbidden from collecting VAT — every line
 *     must carry 0% regardless of the agency's base VAT_STD row.
 *   - `authorized` (עוסק מורשה): collects VAT at the standard rate.
 *   - `company` (חברה): collects VAT at the standard rate.
 *
 * If new business types or per-line exceptions (zero-rated goods, export,
 * etc.) ever land, the branch goes here — every downstream caller already
 * routes through this function so no other file needs to learn the new
 * case.
 */
export type EffectiveTaxRateInput = {
  businessType: BusinessType | null
  baseRatePercent: number
}

export function effectiveTaxRatePercent(input: EffectiveTaxRateInput): number {
  if (input.businessType === 'exempt') return 0
  return input.baseRatePercent
}
