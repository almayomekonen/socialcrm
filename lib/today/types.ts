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
  status: string | null
  leadSource: string | null
  createdAt: number | null
  nextFollowUpAt: number | null
  lastActivityAt: number | null
  lastInboundAt: number | null
  /** Last outbound NOT tagged metadata.source='auto_response' (Amendment C-2). */
  lastHumanOutboundAt: number | null
  hasOverdueOpenTask: boolean
}

/** Instant + business-day bounds (all epoch ms), computed once server-side. */
export type NowCtx = { nowMs: number; dayStart: number; dayEnd: number }

export type BriefItem = {
  id: number
  name: string | null
  state: QualifyingState
  targetSurface: TargetSurface
}

export type MeetingItem = { id: number; title: string | null; at: number }

export type VolumeState = 'clear' | 'normal' | 'busy'
export type StatusVerdict = 'covered' | 'active' | 'unconfirmed'
// INV-10: only channel-scoped values exist; no unscoped ("nothing anywhere") member.
export type PermissionVerdict = 'scoped_all_clear' | 'scoped_partial'

/** The single FE/BE contract. Every field is precomputed server-side. */
export type TodayBrief = {
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
