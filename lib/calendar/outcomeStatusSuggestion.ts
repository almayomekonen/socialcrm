// Pure function that maps (current lead status, meeting outcome) to a
// suggested next lead status — or null when no nudge is warranted.
//
// Reasoning (locked in during Stage 3 product review):
//
//   - `contacted` in this CRM is the auto-stamp for ANY rep-initiated
//     outreach (LeadQuickActions silently flips new → contacted when the rep
//     taps Call or WhatsApp). It does NOT mean "we had a real conversation."
//   - A meeting that the lead agreed to AND attended is qualitatively
//     beyond `contacted` — it's a self-selection signal that maps to
//     `interested` (מעוניין).
//   - That's why `new + completed → interested` rather than → contacted.
//     Both bumping-from-new and bumping-from-contacted target `interested`.
//
// No-show: never nudges. The setback IS the signal; the rep decides whether
// to retry or mark as lost. Auto-suggesting "step down" would be
// paternalistic — and there's no good answer for it.
//
// Terminal statuses (`closed`, `lost`): never nudges. Reviving requires a
// deliberate manual action; we don't want a one-click nudge to undo a
// committed funnel decision.

export type LeadStatus = 'new' | 'contacted' | 'interested' | 'closed' | 'lost'

export type MeetingOutcome = 'completed' | 'no_show'

// Suggested next status excludes 'new' and 'lost' because we never suggest
// moving backwards along the funnel.
export type SuggestedLeadStatus = 'contacted' | 'interested' | 'closed'

export function suggestNextLeadStatus(
  outcome: MeetingOutcome,
  currentLeadStatus: string | null | undefined,
): SuggestedLeadStatus | null {
  if (outcome === 'no_show') return null
  switch (currentLeadStatus) {
    case 'new':
      return 'interested'
    case 'contacted':
      return 'interested'
    case 'interested':
      return 'closed'
    default:
      // closed, lost, null, undefined, or any unrecognized value → no nudge.
      return null
  }
}
