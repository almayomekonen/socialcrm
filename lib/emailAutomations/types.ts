import type { ReactElement } from 'react'

export type AutomationCategory = 'transactional' | 'lifecycle' // determines suppression behavior
export type AutomationPriority = 'high' | 'normal'

export type Recipient = {
  userId: number
  agencyId: number
  email: string
  firstName: string | null
}

export type Automation = {
  key: string // stable unique id; also the dedup key
  description?: string // human-readable note: what it does + why
  enabled: boolean // toggle off without deleting code
  priority: AutomationPriority // ordering within a cron pass (high first)
  category: AutomationCategory // 'lifecycle' honors suppression; 'transactional' ignores it
  subject: (r: Recipient) => string
  template: (r: Recipient) => ReactElement
  trigger: 'event' | 'scheduled'
  event?: 'user.registered' // event automations only (Phase 1 uses only this)
  audience?: () => Promise<Recipient[]> // scheduled automations only
  condition?: (r: Recipient) => Promise<boolean> // optional extra filter
  gate?: () => boolean // per-automation send gate; defaults to emailAutomationsEnabled() when omitted
  recurring?: { periodKey: (now: Date) => string } // omit ⇒ send once forever
}
