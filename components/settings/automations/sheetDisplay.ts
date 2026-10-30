import type { UiLocale } from '@/lib/i18n/config'
import type { ActionDefinition, EventDefinition, FieldDefinition, SubjectDefinition } from '@/lib/automations/catalog/types'
import type { EvaluatedEvent } from '@/lib/automations/requirements'
import { fieldLabelIn, localizeAction, localizeEvent, localizeSubject } from '@/lib/automations/catalogI18n'

/**
 * What the automation sheet's sections SHOW, in the interface language
 * (Phase E5b). Display copies only — in Hebrew the catalog objects themselves —
 * so every key, value and token the draft and its payload use still comes from
 * the draft (useAutomationSheetDraft), never from these. A chip keeps its TOKEN
 * (what is inserted and stored) and gains a `label` (what the button says).
 */
export function sheetDisplay(
  input: {
    grouped: readonly { subject: SubjectDefinition; items: readonly EvaluatedEvent[] }[]
    event: EventDefinition | null
    actions: readonly ActionDefinition[]
    action: ActionDefinition | null
    anchors: readonly FieldDefinition[]
    chips: readonly { token: string; field: string }[]
  },
  L: UiLocale,
) {
  const { grouped, event, actions, action, anchors, chips } = input
  return {
    grouped: L === 'he' ? grouped : grouped.map((g) => ({ subject: localizeSubject(g.subject, L), items: g.items.map((e) => ({ ...e, event: localizeEvent(e.event, L)! })) })),
    event: localizeEvent(event, L),
    actions: L === 'he' ? actions : actions.map((a) => localizeAction(a, L)!),
    action: localizeAction(action, L),
    anchors: L === 'he' ? anchors : anchors.map((f) => ({ ...f, label: fieldLabelIn(f.key, f.label, L) })),
    chips: chips.map((c) => ({ ...c, label: fieldLabelIn(c.field, c.token, L) })),
  }
}
