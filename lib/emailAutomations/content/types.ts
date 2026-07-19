import type { AutomationCategory, AutomationPriority, Recipient } from '../types'

// The editorial category of a content item — used for topic rotation and
// reporting. Not the same as AutomationCategory (which drives suppression).
export type ContentTopic =
  | 'welcome'
  | 'activation'
  | 'feature'
  | 'hidden_feature'
  | 'productivity_tip'
  | 'ai'
  | 'best_practice'
  | 'success_story'
  | 'testimonial'
  | 'small_win'
  | 'business_tip'
  | 'weekly_discovery'
  | 'case_study'
  | 'new_feature'
  | 'quick_tip'

// Reusable building blocks. A content item is a list of these plus a headline
// and a CTA — never JSX. Adding a new email = adding one content file.
export type ContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'tip'; label?: string; text: string }
  | { type: 'feature'; title: string; text: string }
  | { type: 'testimonial'; quote: string; source?: string }
  | { type: 'steps'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'divider' }

export type ContentCta = { label: string; route: string } // route → appUrl(route)

export type ContentSchedule =
  | { kind: 'event'; event: NonNullable<import('../types').Automation['event']> } // welcome
  | { kind: 'condition' } // state-triggered (FB/WhatsApp/trial/…); audience/condition on the item
  | { kind: 'step'; step: number } // educational sequence position (order is informational)

// Optional A/B variant (inactive in Phase 1 — structure only).
export type ContentVariant = {
  key: string
  subject?: string
  preview?: string
  headline?: string
  blocks?: ContentBlock[]
  cta?: ContentCta
}

export type ContentItem = {
  key: string // stable id: send-once/dedup + analytics key
  category: AutomationCategory // 'lifecycle' honors suppression; 'transactional' ignores it
  topic: ContentTopic // editorial category, for rotation + reporting
  schedule: ContentSchedule
  priority: AutomationPriority
  enabled?: boolean // default true

  subject: string
  preview: string
  headline: string
  greet?: boolean // when true, prepend a light "היי {שם}," line if the recipient has a name
  blocks: ContentBlock[]
  cta: ContentCta

  // Binding for non-calendar (state/event) items only. Calendar/educational
  // items derive their audience from the engine, not here.
  audience?: () => Promise<Recipient[]>
  condition?: (r: Recipient) => Promise<boolean>
  gate?: () => boolean

  // Future (inactive in Phase 1):
  variants?: ContentVariant[]
  locale?: string // default 'he'
}
