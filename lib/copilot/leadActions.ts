import type { FollowUpSignals } from '@/lib/ai/followUpRules'
import type { PredefinedCopilotActionId } from './copilotResponse'
import type { CopilotGlanceFact, CopilotSuggestedAction, LeadStatusTone } from './copilotContext'

/**
 * Catalog of predefined AI actions the copilot can dispatch through the
 * "Tools" popover. Single source of truth for `(id, label, tone)`. The
 * panel-side dispatcher in `CopilotPanel` reads this and overlays its own
 * loading-label + server-action wiring.
 *
 * Adding a new predefined action: add an entry here, add the server action +
 * payload variant in actions/ai/ and lib/copilot/copilotResponse.ts, then
 * spread the new entry into the panel's HANDLERS map with its loadingLabel
 * and dispatcher.
 */
export const PREDEFINED_ACTIONS = {
  'draft-followup-message': {
    id: 'draft-followup-message',
    label: 'הודעת followup',
    tone: 'neutral',
  },
  'next-best-step': {
    id: 'next-best-step',
    label: 'הצעד הבא',
    tone: 'neutral',
  },
} as const satisfies Record<PredefinedCopilotActionId, CopilotSuggestedAction>

/**
 * Today the suggestion list is purely a function of `statusTone`: terminal
 * leads get nothing, everyone else gets the two predefined actions. Signals
 * and pulse are not currently used; if we add a urgency-aware ordering or a
 * pulse-driven third action, expand the parameter shape then.
 */
export function buildLeadSuggestedActions({ statusTone }: { statusTone: LeadStatusTone }): CopilotSuggestedAction[] {
  if (statusTone === 'terminal') return []
  return [PREDEFINED_ACTIONS['draft-followup-message'], PREDEFINED_ACTIONS['next-best-step']]
}

export function buildLeadGlanceFacts({
  signals,
  statusTone,
}: {
  signals: FollowUpSignals
  statusTone: LeadStatusTone
}): CopilotGlanceFact[] {
  const facts: CopilotGlanceFact[] = []

  if (signals.overdueTaskCount > 0) {
    facts.push({
      id: 'overdue',
      label: signals.overdueTaskCount === 1 ? 'משימה אחת באיחור' : `${signals.overdueTaskCount} משימות באיחור`,
      tone: 'urgent',
    })
  } else if (signals.dueTodayTaskCount > 0) {
    facts.push({
      id: 'due-today',
      label: signals.dueTodayTaskCount === 1 ? 'משימה אחת להיום' : `${signals.dueTodayTaskCount} משימות להיום`,
      tone: 'attention',
    })
  } else if (signals.openTaskCount > 0) {
    facts.push({
      id: 'open',
      label: signals.openTaskCount === 1 ? 'משימה פתוחה אחת' : `${signals.openTaskCount} משימות פתוחות`,
      tone: 'neutral',
    })
  } else if (statusTone === 'active') {
    facts.push({ id: 'no-open', label: 'אין משימה פתוחה', tone: 'attention' })
  }

  if (typeof signals.daysSinceLastInteraction === 'number') {
    const d = signals.daysSinceLastInteraction
    if (d >= 21) {
      facts.push({ id: 'silence-long', label: `אין יצירת קשר ${d} ימים`, tone: 'urgent' })
    } else if (d >= 14) {
      facts.push({ id: 'silence-medium', label: `אין יצירת קשר ${d} ימים`, tone: 'attention' })
    } else if (d >= 7) {
      facts.push({ id: 'silence-short', label: `${d} ימים ללא יצירת קשר`, tone: 'neutral' })
    } else if (d <= 1) {
      facts.push({
        id: 'recent-contact',
        label: d === 0 ? 'נוצר קשר היום' : 'נוצר קשר אתמול',
        tone: 'positive',
      })
    }
  } else if (typeof signals.daysInCurrentStatus === 'number' && signals.daysInCurrentStatus >= 14 && statusTone !== 'terminal') {
    facts.push({
      id: 'static-status',
      label: `${signals.daysInCurrentStatus} ימים באותו סטטוס`,
      tone: 'attention',
    })
  }

  return facts.slice(0, 2)
}
