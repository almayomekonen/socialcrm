// Today brief — the SOLE home of every threshold, enum, and priority. Both the
// pure classifier and (as bound query parameters) the SQL layer read from here;
// no literal is duplicated in SQL or the UI. Changing behavior means changing a
// value here, and the unit matrix asserts against these real values.

import type { QualifyingState } from './types'

export const BUSINESS_TZ = 'Asia/Jerusalem'

export const TERMINAL_STATUSES = ['closed', 'lost'] as const

// Amendment C-1: leadSource is a composite `channel:externalId`. A new lead is
// "inbound" when its leadSource starts with an ingested-channel prefix.
export const INBOUND_CHANNEL_PREFIXES = ['whatsapp:', 'facebook:'] as const

// Amendment C-2: outbound counts as automated when metadata.source is this value.
export const AUTO_RESPONSE_SOURCE = 'auto_response'

// Per-status SLA for the OPEN_LOOP_SLA state (hours since lastActivityAt with no
// scheduled next step). Statuses absent here need an explicit nextFollowUpAt to
// qualify. Reused from the existing worklist aging bands.
export const SLA_HOURS_BY_STATUS: Readonly<Record<string, number>> = { contacted: 24, interested: 72 }

// Beyond this, a dormant lead is "cold" → Leads-side revival, never Today.
export const STALE_CEILING_DAYS = 14

// "Customer waiting" only counts if their last inbound is at most this old.
export const PROMISED_WAITING_RECENCY_DAYS = 14

// remaining > this ⇒ volumeState 'busy' (honest label; never a cap).
export const HIGH_VOLUME_THRESHOLD = 12

// Completeness verdict may claim "covered" only if the inbound sync is at most
// this fresh. Interim (no sync-health signal yet): freshness is treated unknown.
export const FRESHNESS_SLA_MS = 10 * 60 * 1000

// Total, strict evaluation order. classifyLead returns the first match ⇒ a lead
// that satisfies several states is attributed to its highest-priority one.
export const STATE_PRIORITY: readonly QualifyingState[] = [
  'WAITING_REPLY',
  'FOLLOWUP_OVERDUE',
  'FOLLOWUP_DUE_TODAY',
  'NEW_INBOUND',
  'OVERDUE_TASK',
  'OPEN_LOOP_SLA',
]

export const DAY_MS = 86_400_000
export const HOUR_MS = 3_600_000
