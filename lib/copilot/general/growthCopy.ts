/**
 * Deterministic growth copy. Facts only — never invents revenue or rates.
 */
export type { GrowthCounts } from './businessAdvice'
import { composeBusinessAdvice, type GrowthCounts } from './businessAdvice'

export function composeGrowthCopy(c: GrowthCounts): string {
  return composeBusinessAdvice('advice', c)
}
