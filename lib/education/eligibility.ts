import type { EligibilityContext, TourDefinition, TourRecord } from './types'

export function isSettled(record: TourRecord | undefined, version: number): boolean {
  if (!record) return false
  if (record.version < version) return false
  return record.status === 'completed' || record.status === 'dismissed'
}

/**
 * Should this tour run now?
 *
 * `force` (Help → restart / ?tour=) bypasses completion and auto=false.
 * It still respects surface, the workspace gate, entitlements, and first-lead.
 */
export function isTourEligible(def: TourDefinition, ctx: EligibilityContext): boolean {
  if (!ctx.toursEnabled) return false
  if (ctx.surface !== 'desktop') return false
  if (def.requiresCopilot && !ctx.copilotEnabled) return false
  if (def.blockedByFirstLead && ctx.firstLeadActive) return false
  if (ctx.force) return true
  if (!def.auto) return false
  if (isSettled(ctx.record, def.version)) return false
  return true
}

/** Pipeline is in-flight on /leads — don't stack copilot on top of it. */
export function copilotYieldsToPipeline(pathname: string, pipelineSettled: boolean): boolean {
  return pathname.startsWith('/leads') && !pipelineSettled
}

/** Lead tour is in-flight on a lead page — same stacking rule. */
export function copilotYieldsToLead(pathname: string, leadSettled: boolean, firstLeadActive: boolean): boolean {
  if (!pathname.startsWith('/clients/')) return false
  if (firstLeadActive) return true
  return !leadSettled
}
