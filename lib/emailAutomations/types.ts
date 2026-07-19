import type { ReactElement } from 'react'

export type AutomationCategory = 'transactional' | 'lifecycle'
export type AutomationPriority = 'highest' | 'high' | 'medium' | 'low'

export type Recipient = {
  userId: number
  agencyId: number
  email: string
  firstName: string | null
}

// A per-recipient resolved send, used by dynamic drips (e.g. the educational
// journey) whose content depends on the recipient's own progression. When an
// automation supplies `resolve`, the dispatcher uses this key for
// claim/send-once/cooldown and this subject/template for rendering.
export type ResolvedSend = { key: string; subject: string; template: ReactElement }

export type Automation = {
  key: string // stable unique id; also the dedup key
  description?: string // human-readable note: what it does + why
  enabled: boolean // toggle off without deleting code
  priority: AutomationPriority // ordering within a cron pass (high first)
  order?: number // secondary sort within a priority tier (e.g. calendar day); default 0
  category: AutomationCategory // 'lifecycle' honors suppression; 'transactional' ignores it
  subject: (r: Recipient) => string
  template: (r: Recipient) => ReactElement
  trigger: 'event' | 'scheduled'
  event?: 'user.registered' // event automations only (Phase 1 uses only this)
  audience?: () => Promise<Recipient[]> // scheduled automations only
  condition?: (r: Recipient) => Promise<boolean> // optional extra filter
  gate?: () => boolean // per-automation send gate; defaults to emailAutomationsEnabled() when omitted
  recurring?: { periodKey: (now: Date) => string } // omit ⇒ send once forever
  // Dynamic drip: resolve the specific content this recipient should receive now.
  // null ⇒ nothing to send for this recipient (skip). When present, overrides
  // key/subject/template at send time (see dispatchAutomationEmail).
  resolve?: (r: Recipient) => Promise<ResolvedSend | null>
}
