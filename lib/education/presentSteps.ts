import { LEAD_OPEN_EDU, eduSel } from './types'
import type { TourStep } from './types'

/** First-run Leads page (zero tenant leads) — not a tour target and not data-edu. */
export const LEADS_EMPTY_SEL = '[data-leads-empty]'
/** Existing Add Lead control on First Run. Table toolbar uses data-edu="leads-add". */
export const ADD_LEAD_SEL = '[data-add-lead]'

export type QueryFn = (selector: string) => Element | null

/** Bounded wait after navigation. Not a MutationObserver and not an open-ended poll. */
export const TOUR_TARGET_WAIT_MS = 1500

function defaultQuery(selector: string): Element | null {
  if (typeof document === 'undefined') return null
  return document.querySelector(selector)
}

/**
 * Drop steps whose target is missing. A tour with no remaining steps must not
 * start — never throw, never highlight the body.
 *
 * Overview still uses this after wait: items hidden by role/feature stay omitted.
 * It must not run until `waitForTourTargets` has given the sidebar a chance to paint.
 */
export function presentSteps(steps: TourStep[], query: QueryFn = defaultQuery): TourStep[] {
  return steps.filter((step) => {
    if (!step.element) return true
    return query(step.element) != null
  })
}

function hasTargetedStep(steps: TourStep[]): boolean {
  return steps.some((step) => !!step.element)
}

function hasPresentTargetedStep(steps: TourStep[], query: QueryFn): boolean {
  return presentSteps(
    steps.filter((step) => !!step.element),
    query,
  ).length > 0
}

/** Sidebar item selectors (`nav-today`, …) — not the generic rail (`nav`). */
export function isNavEduSelector(selector: string): boolean {
  return /\[data-edu="nav-[^"]+"\]/.test(selector)
}

/** Lead-name open control — painted with table rows, after the toolbar. */
export function isLeadOpenSelector(selector: string): boolean {
  return selector === '[data-edu="lead-open"]'
}

function navTargetedSteps(steps: TourStep[]): Array<TourStep & { element: string }> {
  return steps.filter((step): step is TourStep & { element: string } => !!step.element && isNavEduSelector(step.element))
}

function leadOpenSteps(steps: TourStep[]): Array<TourStep & { element: string }> {
  return steps.filter((step): step is TourStep & { element: string } => !!step.element && isLeadOpenSelector(step.element))
}

/**
 * Ready when the tour's slowest required target has painted.
 * Overview waits for a `nav-*` item (not header/copilot).
 * Leads waits for `lead-open` (not the table wrapper / Add button).
 */
export function isTourDomReady(steps: TourStep[], query: QueryFn = defaultQuery): boolean {
  const nav = navTargetedSteps(steps)
  if (nav.length > 0) return nav.some((step) => query(step.element) != null)
  const open = leadOpenSteps(steps)
  if (open.length > 0) return open.some((step) => query(step.element) != null)
  return hasPresentTargetedStep(steps, query)
}

export type WaitForTourTargetsOpts = {
  timeoutMs?: number
  query?: QueryFn
  now?: () => number
  /** Test seam. Production uses requestAnimationFrame. */
  schedule?: (cb: () => void) => unknown
  signal?: AbortSignal
}

/**
 * True when the tour can start.
 *
 * Tours with sidebar steps wait until at least one `nav-*` target is present.
 * The Leads tour waits until `lead-open` is present (table rows), not merely
 * the wrapper or Add button. Header/copilot/Add must not skip those waits.
 *
 * If a required nav item never appears, overview does not start.
 * If `lead-open` never appears, remaining Leads steps may still start.
 * Other tours: wait for any targeted node; at timeout, untargeted steps may start.
 */
export function waitForTourTargets(steps: TourStep[], opts: WaitForTourTargetsOpts = {}): Promise<boolean> {
  const query = opts.query ?? defaultQuery
  if (isTourDomReady(steps, query)) return Promise.resolve(true)
  if (!hasTargetedStep(steps)) return Promise.resolve(presentSteps(steps, query).length > 0)
  if (opts.signal?.aborted) return Promise.resolve(false)

  const timeoutMs = opts.timeoutMs ?? TOUR_TARGET_WAIT_MS
  const now = opts.now ?? Date.now
  const schedule =
    opts.schedule ??
    (typeof window !== 'undefined' ? (cb: () => void) => window.requestAnimationFrame(cb) : null)
  if (!schedule) return Promise.resolve(false)

  const nav = navTargetedSteps(steps)

  return new Promise((resolve) => {
    const started = now()
    let settled = false
    let handle: unknown

    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      if (typeof window !== 'undefined' && typeof handle === 'number') {
        window.cancelAnimationFrame(handle)
      }
      resolve(value)
    }

    const onAbort = () => finish(false)
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const tick = () => {
      if (isTourDomReady(steps, query)) {
        finish(true)
        return
      }
      if (now() - started >= timeoutMs) {
        if (nav.length > 0) finish(false)
        else finish(presentSteps(steps, query).length > 0)
        return
      }
      handle = schedule(tick)
    }

    handle = schedule(tick)
  })
}

function hasLeadsTourList(query: QueryFn): boolean {
  return (
    query(eduSel('leads-table')) != null ||
    query(eduSel('leads-add')) != null ||
    query(eduSel(LEAD_OPEN_EDU)) != null
  )
}

/**
 * True when the Leads workspace has no leads (First Run), not a filtered-empty table.
 * A table/add/open target means leads exist even if the current tab has no rows.
 */
export function isLeadsWorkspaceEmpty(query: QueryFn = defaultQuery): boolean {
  if (query(LEADS_EMPTY_SEL) != null) return true
  return !hasLeadsTourList(query)
}

/**
 * Resolves true when the Leads workspace is empty — Driver.js must not start.
 * Resolves false when the list exists (run the existing Leads Tour, including
 * filtered-empty tables that still have leads-table / leads-add).
 */
export function waitForLeadsWorkspaceEmpty(opts: WaitForTourTargetsOpts = {}): Promise<boolean> {
  const query = opts.query ?? defaultQuery
  if (query(LEADS_EMPTY_SEL) != null) return Promise.resolve(true)
  if (hasLeadsTourList(query)) return Promise.resolve(false)
  if (opts.signal?.aborted) return Promise.resolve(false)

  const timeoutMs = opts.timeoutMs ?? TOUR_TARGET_WAIT_MS
  const now = opts.now ?? Date.now
  const schedule =
    opts.schedule ??
    (typeof window !== 'undefined' ? (cb: () => void) => window.requestAnimationFrame(cb) : null)
  if (!schedule) return Promise.resolve(false)

  return new Promise((resolve) => {
    const started = now()
    let settled = false
    let handle: unknown

    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      if (typeof window !== 'undefined' && typeof handle === 'number') {
        window.cancelAnimationFrame(handle)
      }
      resolve(value)
    }

    const onAbort = () => finish(false)
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const tick = () => {
      if (query(LEADS_EMPTY_SEL) != null) {
        finish(true)
        return
      }
      if (hasLeadsTourList(query)) {
        finish(false)
        return
      }
      if (now() - started >= timeoutMs) {
        finish(isLeadsWorkspaceEmpty(query))
        return
      }
      handle = schedule(tick)
    }

    handle = schedule(tick)
  })
}
