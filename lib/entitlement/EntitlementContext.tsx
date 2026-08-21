'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * "Does this agency's plan currently cover the product?", known to the CLIENT.
 *
 * WHY THIS EXISTS. The server already answers this correctly — one guard,
 * `requireProductAccess`, over one source of truth, `getAgencyProductAccess`.
 * The problem the forensic audit found is entirely downstream: the answer never
 * reaches the browser in a form it can recognise. Route handlers return a typed
 * 403 nobody reads; Server Actions THROW, and Next masks that as an opaque 500
 * (React #441). So the client renders "משהו השתבש, נסה שוב" for a permanent,
 * deliberate refusal — and retries it forever.
 *
 * WHY THIS IS NOT A SECOND ENTITLEMENT SYSTEM. Nothing here decides anything.
 * The value is computed ONCE, on the server, by the existing
 * `getAgencyProductAccess` (React `cache()`d, so it costs no extra query) and
 * handed down. The client only READS it. Server-side enforcement is untouched
 * and remains the only thing that actually protects data — this exists purely so
 * the UI can stop calling a subscription lapse a crash.
 *
 * WHY SEEDING BEATS RETROFITTING 70 SERVER ACTIONS. `requireProductAccess` has
 * 70 callers and exactly 2 of them catch it. Converting every action to a typed
 * result would touch all of them, change signatures the UI depends on, and risk
 * the working paid path for a presentation bug. Seeding the state once means the
 * client already KNOWS access is denied before any action fails — so a failure
 * can be rendered correctly without the failure itself carrying the reason.
 *
 * Default is `hasAccess: true`: an unwrapped tree (or any render outside the app
 * layout) must never lock the product on a guess. Only a server-confirmed denial
 * locks anything.
 */

export type EntitlementState = {
  /** From getAgencyProductAccess().hasAccess — the single source of truth. */
  hasAccess: boolean
  /** The derived lifecycle status, for copy: TRIAL_EXPIRED vs NEVER_STARTED etc. */
  status: string
  /** When the paid period lapsed, for "expired on …" copy. ISO, or null. */
  expiresAt: string | null
}

const FALLBACK: EntitlementState = { hasAccess: true, status: 'UNKNOWN', expiresAt: null }

const EntitlementCtx = createContext<EntitlementState>(FALLBACK)

export function EntitlementProvider({ value, children }: { value: EntitlementState; children: ReactNode }) {
  return <EntitlementCtx.Provider value={value}>{children}</EntitlementCtx.Provider>
}

export function useEntitlement(): EntitlementState {
  return useContext(EntitlementCtx)
}

/**
 * The question almost every call site actually asks: "is this failure a
 * subscription lapse rather than a bug?" Keeps `hasAccess === false` from being
 * re-derived (and re-inverted) at a dozen call sites.
 */
export function useAccessDenied(): boolean {
  return !useContext(EntitlementCtx).hasAccess
}
