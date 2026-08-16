// Today brief — shared types. Pure: no I/O, no framework. Timestamps are epoch ms
// (the facts layer normalizes DB values to numbers) so the domain layer is
// timezone-free and trivially serializable.

export type QualifyingState =
  | 'WAITING_REPLY'
  | 'FOLLOWUP_OVERDUE'
  | 'FOLLOWUP_DUE_TODAY'
  | 'NEW_INBOUND'
  | 'OVERDUE_TASK'
  | 'OPEN_LOOP_SLA'

export type TargetSurface = 'inbox' | 'lead'

/** The fact fields the classifier needs, one row per candidate lead. */
export type LeadFact = {
  id: number
  name: string | null
  phone: string | null
  status: string | null
  leadSource: string | null
  createdAt: number | null
  nextFollowUpAt: number | null
  lastActivityAt: number | null
  lastInboundAt: number | null
  /** Last outbound NOT tagged metadata.source='auto_response' (Amendment C-2). */
  lastHumanOutboundAt: number | null
  /** Any open (incomplete) task exists — the raw fact; the overdue comparison lives in classify. */
  hasOpenTask: boolean
  /** Earliest due date among open tasks (epoch ms), or null. classify compares it to dayStart. */
  earliestOpenTaskDueAt: number | null
}

/** Instant + business-day bounds (all epoch ms), computed once server-side. */
export type NowCtx = { nowMs: number; dayStart: number; dayEnd: number }

export type BriefItem = {
  id: number
  name: string | null
  phone: string | null
  state: QualifyingState
  /** Deterministic Hebrew label for the state (computed server-side; the UI renders it). */
  reason: string
  targetSurface: TargetSurface
  /** Exact Inbox thread when the owed action is a waiting WhatsApp reply. */
  conversationId?: number | null
  href?: string | null
  /** e.g. "ממתין 7 שעות" — precomputed, no client clock. */
  waitingFor?: string | null
  /** e.g. "נותרו 5 שעות בחלון WhatsApp" — precomputed from the inbound window. */
  windowHint?: string | null
}

export type MeetingItem = { id: number; title: string | null; at: number }

export type VolumeState = 'clear' | 'normal' | 'busy'
export type StatusVerdict = 'covered' | 'active' | 'unconfirmed'
// INV-10: only channel-scoped values exist; no unscoped ("nothing anywhere") member.
export type PermissionVerdict = 'scoped_all_clear' | 'scoped_partial'

/** The single FE/BE contract. Every field is precomputed server-side. */
export type TodayBrief = {
  greeting: string
  firstName: string
  items: BriefItem[]
  total: number
  remaining: number
  handledToday: number
  done: boolean
  volumeState: VolumeState
  statusVerdict: StatusVerdict
  permissionVerdict: PermissionVerdict
  meetings: MeetingItem[]
}
