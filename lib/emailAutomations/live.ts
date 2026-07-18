import { sendEmail } from '@/lib/email/sender'
import { renderEmail, renderEmailText } from '@/lib/email/render'
import { isSuppressed } from '@/db/emailSuppressions'
import { claimSend, hasRecentLifecycleSend, markSent, releaseClaim } from '@/db/emailAutomationSends'
import { emailAutomationsEnabled } from './config'
import { dispatchAutomationEmail, type DispatchDeps, type DispatchResult } from './dispatch'
import { AUTOMATIONS } from './registry'
import type { Automation, Recipient } from './types'

// A user gets at most one lifecycle email inside this rolling window.
export const LIFECYCLE_COOLDOWN_DAYS = 7

const lifecycleKeys = (): string[] => AUTOMATIONS.filter((a) => a.category === 'lifecycle').map((a) => a.key)

// The production wiring of the dispatcher: binds the real DB helpers, Resend
// sender, and render pipeline. This is the only place the abstract dispatcher
// meets real I/O.
function liveDeps(automation: Automation, now: Date): DispatchDeps {
  return {
    // Per-automation gate (Welcome keeps its legacy WELCOME_EMAIL_ENABLED flag);
    // everything else defaults to the automation-system flag.
    enabled: automation.gate ? automation.gate() : emailAutomationsEnabled(),
    isSuppressed,
    lifecycleCooldownActive: (userId: number) => {
      const since = new Date(now.getTime() - LIFECYCLE_COOLDOWN_DAYS * 86_400_000).toISOString()
      return hasRecentLifecycleSend(userId, lifecycleKeys(), since)
    },
    claimSend,
    markSent,
    releaseClaim,
    sendEmail,
    renderHtml: renderEmail,
    renderText: renderEmailText,
  }
}

// Used by the cron worker as its injected `dispatch`.
export function dispatchLive(automation: Automation, recipient: Recipient, now: Date): Promise<DispatchResult> {
  return dispatchAutomationEmail(automation, recipient, now, liveDeps(automation, now))
}

// Event path: fire every enabled event automation matching the lifecycle event.
// Generic — a new event automation for the same event fires without touching the
// call site. Never throws (safe inside after()).
export async function dispatchLifecycleEvent(
  event: NonNullable<Automation['event']>,
  recipient: Recipient,
  now: Date,
): Promise<void> {
  const matching = AUTOMATIONS.filter((a) => a.enabled && a.trigger === 'event' && a.event === event)
  for (const automation of matching) {
    try {
      await dispatchAutomationEmail(automation, recipient, now, liveDeps(automation, now))
    } catch (err) {
      console.error(`[email-automations] event dispatch failed key=${automation.key}`, err)
    }
  }
}
