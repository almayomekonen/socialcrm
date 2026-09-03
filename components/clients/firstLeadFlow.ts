/**
 * In-memory, session-scoped latch for the manual first-lead "Aha" flow.
 *
 * WHY A MODULE, NOT REACT STATE: the guidance→completion transition is driven by
 * FollowUpControl's router.refresh() (an RSC re-render). If FirstLeadCallout kept
 * its "am I the first-lead flow?" flag in React state, that flag would re-init
 * from the ?firstLead=1 URL param — which we strip on mount — so ANY remount of
 * the component (a Suspense/RSC state-loss edge, a Next upgrade, dev StrictMode)
 * would reset it to false and the completion state would silently never appear.
 *
 * A module variable is NOT React state: it survives router.refresh() AND any React
 * remount within the same document, so the completion cannot be lost. It lives
 * only in the JS runtime of the current document, so a browser refresh / re-login /
 * fresh load wipes it — the first-lead experience therefore NEVER replays across
 * reloads. Exactly one first lead exists per workspace, so a single active flow is
 * sufficient.
 */

type Flow = { leadId: number; openedFired: boolean; followUpFired: boolean }

let flow: Flow | null = null

/** Begin (idempotent) the first-lead flow for a lead. Set from ?firstLead=1. */
export function beginFirstLeadFlow(leadId: number): void {
  if (!flow || flow.leadId !== leadId) flow = { leadId, openedFired: false, followUpFired: false }
}

/** Is this lead currently in the first-lead flow? Source of truth for the callout. */
export function isFirstLeadFlow(leadId: number): boolean {
  return flow?.leadId === leadId
}

/** Any first-lead callout is on screen — other lead tours must wait. */
export function isAnyFirstLeadFlowActive(): boolean {
  return flow != null
}

/** End the flow (dismiss / back-to-leads) so it cannot re-show for this lead. */
export function endFirstLeadFlow(leadId: number): void {
  if (flow?.leadId === leadId) flow = null
}

/** Returns true exactly once per flow — de-dupes the first_lead_opened event across remounts. */
export function claimOpenedEvent(leadId: number): boolean {
  if (flow?.leadId === leadId && !flow.openedFired) {
    flow.openedFired = true
    return true
  }
  return false
}

/**
 * REMOVED: `claimFollowUpEvent`.
 *
 * It de-duped a client-side `first_follow_up_set`, which no longer exists — the
 * event is emitted by `setLeadFollowUp` and de-duped per agency by
 * `trackOncePerAgency`. A latch in one document could never have been the right
 * guard for an agency-level milestone anyway: it was invisible to the mobile
 * surface entirely, and reset on every reload.
 */

/** Test-only reset so module state does not leak between test cases. */
export function __resetFirstLeadFlowForTests(): void {
  flow = null
}
