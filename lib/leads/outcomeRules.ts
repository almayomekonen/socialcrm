/**
 * Inline Outcome Logging — Stage 1 (pure rules).
 *
 * Maps a post-call disposition to its effect: which lastOutcomeType code to
 * store, whether to progress the lead's status (the outcome is now the source
 * of truth for progression), and what follow-up to schedule. Pure + exhaustive
 * so the status transitions and follow-up defaults are fully unit-testable.
 *
 * Constraints: 4 outcomes only, no inline "won", no activity history (we write
 * only the latest outcome into the existing lastOutcomeType column).
 */

export type LeadOutcome = 'call_no_answer' | 'call_reached' | 'call_interested' | 'call_not_interested'

export const LEAD_OUTCOMES: LeadOutcome[] = ['call_no_answer', 'call_reached', 'call_interested', 'call_not_interested']

export function isLeadOutcome(v: unknown): v is LeadOutcome {
  return typeof v === 'string' && (LEAD_OUTCOMES as string[]).includes(v)
}

/** What to do with the lead's next follow-up after this outcome. */
export type FollowUpDirective = { kind: 'in_days'; days: number } | { kind: 'clear' } | { kind: 'none' }

export type OutcomeResolution = {
  /** value written to lastOutcomeType */
  code: string
  /** new lead status, or null to leave status unchanged (no needless statusChangedAt reset) */
  nextStatus: string | null
  followUp: FollowUpDirective
}

/**
 * Resolve an outcome against the lead's current status.
 * Progression rules never downgrade a further-along lead and never resurrect a
 * won deal; a lost lead can be reopened as 'interested' (they came back).
 */
export function resolveOutcome(outcome: LeadOutcome, currentStatus: string | null): OutcomeResolution {
  switch (outcome) {
    case 'call_no_answer':
      // Missed them — no status change; retry tomorrow.
      return { code: 'call_no_answer', nextStatus: null, followUp: { kind: 'in_days', days: 1 } }

    case 'call_reached':
      // Spoke — progress a brand-new lead to contacted; never downgrade others.
      return { code: 'call_reached', nextStatus: currentStatus === 'new' ? 'contacted' : null, followUp: { kind: 'in_days', days: 3 } }

    case 'call_interested':
      // Positive — move to interested unless already there or already won.
      return {
        code: 'call_interested',
        nextStatus: currentStatus === 'interested' || currentStatus === 'closed' ? null : 'interested',
        followUp: { kind: 'in_days', days: 3 },
      }

    case 'call_not_interested':
      // Terminal negative — mark lost and stop following up (unless already lost/won).
      return {
        code: 'call_not_interested',
        nextStatus: currentStatus === 'lost' || currentStatus === 'closed' ? null : 'lost',
        followUp: { kind: 'clear' },
      }
  }
}

/** Hebrew labels for display (lead summary, AI context). Covers call + meeting codes. */
export const OUTCOME_LABELS: Record<string, string> = {
  call_no_answer: 'לא ענה',
  call_reached: 'דיברנו',
  call_interested: 'מעוניין',
  call_not_interested: 'לא מעוניין',
  meeting_completed: 'פגישה הושלמה',
  meeting_no_show: 'לא הגיע לפגישה',
}

export function outcomeLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return OUTCOME_LABELS[code] ?? code
}
