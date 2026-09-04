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
 * It still respects surface, copilot requirements and first-lead.
 *
 * `toursEnabled` MEANS "TOURS MAY RUN ON THEIR OWN", NOT "TOURS EXIST".
 *
 * It gained `productAccess.hasAccess` so a tour could never auto-open on top of
 * the paywall, where it stood between a lapsed customer and the renewal path.
 * That is right for anything the product decides to start by itself. Applied to
 * a tour the customer explicitly clicked in the Help menu, it produced a dead
 * button: the menu closed and nothing happened.
 *
 * So a direct request from the Help menu is allowed through. This is not a
 * loophole in the paywall — these tours walk the navigation, the leads table,
 * the status tabs and opening a lead, all of which remain available after a
 * lapse. They are local Driver.js walkthroughs of functionality the customer
 * still has: no AI, no provider, no paid resource. Nothing withheld is being
 * handed out.
 *
 * The exemption is deliberately keyed on `source === 'help'` rather than on
 * `force`, because `force: true` is also used by the query-param launch, the
 * copilot auto-start and the overview intro — none of which a human asked for
 * at that moment. Those keep failing closed here even though their own callers
 * already gate on `toursEnabled`, so the guarantee survives if a caller is ever
 * refactored.
 *
 * ORDER IS LOAD BEARING. Surface, copilot and first-lead are checked BEFORE the
 * exemption, so Help can never bypass a real safety rule — only the auto-run
 * gate.
 */
export function isTourEligible(def: TourDefinition, ctx: EligibilityContext): boolean {
  if (ctx.surface !== 'desktop') return false
  if (def.requiresCopilot && !ctx.copilotEnabled) return false
  if (def.blockedByFirstLead && ctx.firstLeadActive) return false

  // A human clicked this in the Help menu. Honour it.
  if (ctx.force && ctx.source === 'help') return true

  // Everything below is the product starting a tour on its own.
  if (!ctx.toursEnabled) return false
  if (ctx.force) return true
  if (!def.auto) return false
  if (isSettled(ctx.record, def.version)) return false
  return true
}

/** Pipeline is in-flight on /leads — don't stack copilot on top of it. */
export function copilotYieldsToPipeline(pathname: string, pipelineSettled: boolean): boolean {
  return pathname.startsWith('/leads') && !pipelineSettled
}

/**
 * The pipeline tour yields to the first-import activation handoff.
 *
 * WHY. Driver.js paints a full-viewport SVG with a cutout around the element it
 * highlights; everything OUTSIDE that cutout is covered and cannot be clicked.
 * The pipeline tour highlights the leads table, while the first-import banner
 * sits above it — so the moment an import made `hasLeads` true, the tour's
 * overlay landed on top of `פתח את הליד הראשון`, the one control the whole
 * activation loop depends on. Measured with `document.elementFromPoint` at the
 * CTA's centre: the topmost node was Driver's `<svg class="driver-overlay">`.
 *
 * This is the same rule the copilot tour already follows for the first-LEAD
 * flow (`copilotYieldsToLead`): an activation handoff in progress outranks an
 * educational tour. It DEFERS rather than cancels — the tour is never started,
 * so it is never recorded as settled, and it launches on the next visit to
 * /leads once the banner's one-shot params are gone.
 */
export function pipelineYieldsToFirstImport(firstImportCount: number): boolean {
  return firstImportCount > 0
}

/** Lead tour is in-flight on a lead page — same stacking rule. */
export function copilotYieldsToLead(pathname: string, leadSettled: boolean, firstLeadActive: boolean): boolean {
  if (!pathname.startsWith('/clients/')) return false
  if (firstLeadActive) return true
  return !leadSettled
}
