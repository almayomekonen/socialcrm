import type { AutomationTriggerEvent, LawDecision, SkipReason } from './types'
import { TERMINAL_LEAD_STATUSES } from './types'
import { withinQuietHours, type QuietHoursConfig } from './timing'

/**
 * The engine's laws — pure decisions over gathered facts, no I/O (the IRE
 * decideEligibility shape). The worker (Phase 4) gathers SendFacts and calls
 * decideSend as the authoritative pre-send check; call sites additionally
 * never enqueue import-origin events (Phase 3), so the origin law here is the
 * second, unconditional layer of the same rule.
 *
 * Laws live HERE, engine-level — never in individual actions — so every
 * future action (WhatsApp, SMS) inherits them unchanged (ADR-001).
 */

// Safe-by-default limits. Lead cap per spec §9 (max automated emails per lead
// per day); agency ceiling cloned from the IRE dailyCap default.
export const DEFAULT_LEAD_DAILY_CAP = 2
export const DEFAULT_AGENCY_DAILY_CEILING = 200

export interface SendFacts {
  event: AutomationTriggerEvent
  // status_changed automations: the status the automation is premised on.
  expectedStatus?: string | null
  lead: {
    exists: boolean
    email: string | null
    currentStatus: string | null
    emailUndeliverable: boolean
  }
  suppressed: boolean
  alreadySent: boolean // send-once claim already recorded (ADR-005)
  sentToLeadToday: number // automated emails this lead received today (all automations)
  sentByAgencyToday: number // automated emails this business sent today
  limits?: { leadDailyCap?: number; agencyDailyCeiling?: number }
  quietHours?: QuietHoursConfig | null
  now: Date
}

export function isTerminalStatus(status: string | null | undefined): boolean {
  return status != null && (TERMINAL_LEAD_STATUSES as readonly string[]).includes(status)
}

const skip = (reason: SkipReason): LawDecision => ({ allow: false, reason })

/**
 * First skip wins; the order is part of the contract (it decides which reason
 * the activity log shows when several apply): provenance → premise →
 * consent → deliverability → dedup → volume → window. quiet_hours is last and
 * is the only transient reason — Phase 4 may treat it as reschedulable rather
 * than final; every other reason is final for this event.
 */
export function decideSend(f: SendFacts): LawDecision {
  if (f.event.origin === 'import') return skip('origin_import')
  if (!f.lead.exists) return skip('lead_deleted')
  if (f.event.trigger === 'lead_created' && isTerminalStatus(f.lead.currentStatus)) return skip('premise_expired')
  if (f.event.trigger === 'status_changed' && f.expectedStatus != null && f.lead.currentStatus !== f.expectedStatus)
    return skip('premise_expired')
  if (f.suppressed) return skip('suppressed')
  if (!f.lead.email?.trim()) return skip('no_email')
  if (f.lead.emailUndeliverable) return skip('address_undeliverable')
  if (f.alreadySent) return skip('already_sent')
  if (f.sentToLeadToday >= (f.limits?.leadDailyCap ?? DEFAULT_LEAD_DAILY_CAP)) return skip('lead_daily_cap')
  if (f.sentByAgencyToday >= (f.limits?.agencyDailyCeiling ?? DEFAULT_AGENCY_DAILY_CEILING))
    return skip('agency_daily_cap')
  if (withinQuietHours(f.quietHours, f.now)) return skip('quiet_hours')
  return { allow: true }
}

/**
 * Send-once claim key (ADR-005). The trailing 'ever' is the explicit
 * semantics component required by ADR-005/ADR-008: a future per-entry option
 * writes keys under a NEW semantics value — historical claims are never
 * reinterpreted.
 */
export function sendOnceKey(automationId: number, leadId: number): string {
  return `auto:${automationId}:lead:${leadId}:ever`
}

/**
 * Definition source-filter matching, applied at EMISSION (the event carries
 * leadSource; jobs deliberately don't persist it — a non-matching definition
 * simply never gets a job). Null filter matches everything; a set filter
 * prefix-matches the lead's source (rows store provider-prefixed values like
 * 'facebook:{id}'). Events without a leadSource (status_changed) match only
 * filterless definitions.
 */
export function sourceFilterMatches(filter: string | null, leadSource: string | null | undefined): boolean {
  if (filter == null || filter.trim() === '') return true
  if (!leadSource) return false
  return leadSource === filter || leadSource.startsWith(`${filter}:`)
}
