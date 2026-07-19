import type { ReactElement } from 'react'
import type { Automation, Recipient } from './types'

export type DispatchResult = 'sent' | 'skipped' | 'suppressed' | 'cooldown' | 'failed' | 'mock'

type SendResult = { ok: true; id: string } | { ok: false; error: string }

// All I/O is injected so the decision logic is unit-testable without a DB or Resend.
export type DispatchDeps = {
  enabled: boolean // emailAutomationsEnabled() && IS_PROD, resolved by the caller
  isSuppressed: (userId: number) => Promise<boolean>
  // True when the user already received a lifecycle email inside the global 7-day
  // window. Only consulted for lifecycle automations (transactional are exempt).
  lifecycleCooldownActive: (userId: number) => Promise<boolean>
  claimSend: (row: { automationKey: string; userId: number; agencyId: number; periodKey: string }) => Promise<boolean>
  markSent: (automationKey: string, userId: number, periodKey: string) => Promise<void>
  releaseClaim: (automationKey: string, userId: number, periodKey: string) => Promise<void>
  sendEmail: (input: { to: string; subject: string; html: string; text?: string }) => Promise<SendResult>
  renderHtml: (el: ReactElement) => Promise<string>
  renderText: (el: ReactElement) => Promise<string>
}

/**
 * The single path every automation send takes: gate → suppression + 7-day
 * lifecycle cooldown (lifecycle only) → claim-before-send → render → send →
 * finalize. The cooldown is what turns independent automations into one journey:
 * because the worker runs highest-priority first and each send records a row, the
 * top-priority eligible lifecycle email sends and the cooldown blocks the rest for
 * this user (this run and for 7 days). Transactional emails are exempt. Never throws.
 */
export async function dispatchAutomationEmail(
  automation: Automation,
  recipient: Recipient,
  now: Date,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  if (!deps.enabled) return 'mock'
  if (!automation.enabled) return 'skipped'
  if (!recipient.email) return 'skipped'

  const periodKey = automation.recurring ? automation.recurring.periodKey(now) : ''

  if (automation.category === 'lifecycle') {
    if (await deps.isSuppressed(recipient.userId)) return 'suppressed'
    if (await deps.lifecycleCooldownActive(recipient.userId)) return 'cooldown'
  }

  // Dynamic drips (e.g. the educational journey) resolve the exact content — and
  // therefore the send key — per recipient. null ⇒ nothing to send. Static
  // automations use their own key/subject/template unchanged.
  let sendKey = automation.key
  let element: ReactElement
  let subject: string
  if (automation.resolve) {
    const resolved = await automation.resolve(recipient)
    if (!resolved) return 'skipped'
    sendKey = resolved.key
    element = resolved.template
    subject = resolved.subject
  } else {
    element = automation.template(recipient)
    subject = automation.subject(recipient)
  }

  const claimed = await deps.claimSend({
    automationKey: sendKey,
    userId: recipient.userId,
    agencyId: recipient.agencyId,
    periodKey,
  })
  if (!claimed) return 'skipped'

  try {
    const [html, text] = await Promise.all([deps.renderHtml(element), deps.renderText(element)])
    const res = await deps.sendEmail({ to: recipient.email, subject, html, text })
    if (!('error' in res)) {
      await deps.markSent(sendKey, recipient.userId, periodKey)
      return 'sent'
    }
    await deps.releaseClaim(sendKey, recipient.userId, periodKey)
    return 'failed'
  } catch {
    await deps.releaseClaim(sendKey, recipient.userId, periodKey)
    return 'failed'
  }
}
