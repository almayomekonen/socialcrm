/**
 * Pure eligibility decision for the Instant Response Engine (Phase 1: first
 * contact only). No I/O — the worker gathers these facts and calls this for the
 * authoritative re-check before sending. Re-engage is a separate Phase 2 project.
 */
export interface EligibilityInput {
  masterEnabled: boolean
  channelEnabled: boolean
  hasPriorOutbound: boolean // any outbound ever on this conversation
  hasPriorHumanReply: boolean // inbox_messages.sentByUserId not null
  hasPriorAutoFirstContact: boolean // a sent first_contact job exists
  withinQuietHours: boolean
  sentTodayForAgency: number
  dailyCap: number
}

export type EligibilityResult =
  | { shouldRespond: true; reason: 'first_contact' }
  | { shouldRespond: false; skipReason: string }

export function decideEligibility(i: EligibilityInput): EligibilityResult {
  if (!i.masterEnabled) return { shouldRespond: false, skipReason: 'feature_off' }
  if (!i.channelEnabled) return { shouldRespond: false, skipReason: 'channel_off' }
  if (i.hasPriorHumanReply) return { shouldRespond: false, skipReason: 'human_replied' }
  if (i.withinQuietHours) return { shouldRespond: false, skipReason: 'quiet_hours' }
  if (i.sentTodayForAgency >= i.dailyCap) return { shouldRespond: false, skipReason: 'daily_cap' }
  if (i.hasPriorAutoFirstContact) return { shouldRespond: false, skipReason: 'already_first_contact' }
  if (i.hasPriorOutbound) return { shouldRespond: false, skipReason: 'already_responded' }
  return { shouldRespond: true, reason: 'first_contact' }
}
