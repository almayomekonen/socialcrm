import type { Automation, Recipient } from './types'
import type { DispatchResult } from './dispatch'

export type ScheduledSummary = {
  automations: number
  considered: number
  sent: number
  skipped: number
  suppressed: number
  cooldown: number
  failed: number
  mock: number
}

export type ScheduledDeps = {
  automations: Automation[]
  dispatch: (automation: Automation, recipient: Recipient) => Promise<DispatchResult>
  now: Date
}

const RANK: Record<Automation['priority'], number> = { highest: 0, high: 1, medium: 2, low: 3 }

export async function runScheduledAutomations(deps: ScheduledDeps): Promise<ScheduledSummary> {
  const summary: ScheduledSummary = {
    automations: 0,
    considered: 0,
    sent: 0,
    skipped: 0,
    suppressed: 0,
    cooldown: 0,
    failed: 0,
    mock: 0,
  }

  const scheduled = deps.automations
    .filter((a) => a.enabled && a.trigger === 'scheduled')
    .sort((a, b) => RANK[a.priority] - RANK[b.priority] || (a.order ?? 0) - (b.order ?? 0))

  for (const automation of scheduled) {
    summary.automations++

    let recipients: Recipient[]
    try {
      recipients = automation.audience ? await automation.audience() : []
    } catch (err) {
      console.error(`[email-automations] audience failed key=${automation.key}`, err)
      continue
    }

    for (const recipient of recipients) {
      summary.considered++
      try {
        if (automation.condition && !(await automation.condition(recipient))) continue
        const result = await deps.dispatch(automation, recipient)
        summary[result]++
      } catch (err) {
        summary.failed++
        console.error(`[email-automations] dispatch failed key=${automation.key} user=${recipient.userId}`, err)
      }
    }
  }

  console.log('[email-automations] run complete', summary)
  return summary
}
