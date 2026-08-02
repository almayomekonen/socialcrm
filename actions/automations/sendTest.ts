'use server'

import { baseUrl } from '@/types/vars'
import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { getAgencyName, getAgencyReplyTo } from '@/db/automations/leadFacts'
import { isAutomationsAgencyAllowlisted, getAutomationsFrom } from '@/lib/automations/flags'
import { resolveSenderIdentity } from '@/lib/automations/identity'
import { renderAutomationEmail } from '@/lib/automations/renderEmail'
import { signLeadUnsubscribe } from '@/lib/automations/unsubscribeToken'
import { unknownTokens } from '@/lib/automations/variables'

/**
 * Test email — the feature's honesty handshake (spec §7): what the admin
 * receives is exactly what a lead would receive.
 *
 * It therefore uses the SAME identity resolver as the worker (ADR-013) and the
 * same renderer. It is not a customer send: it consumes no claim, writes no
 * activity, respects no cap, and goes only to the caller's own address — so it
 * runs regardless of AUTOMATIONS_SEND_MODE without making live sending
 * reachable for leads.
 */

export type SendTestResult = { ok: true } | { ok: false; reason: string }

export async function sendTestEmail(input: { subject: string; body: string }): Promise<SendTestResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) return { ok: false, reason: 'not_available' }
  if (!user.email) return { ok: false, reason: 'no_recipient' }
  if (!input.subject?.trim() || !input.body?.trim()) return { ok: false, reason: 'content_required' }
  if (unknownTokens(input.subject).length || unknownTokens(input.body).length) return { ok: false, reason: 'unknown_variable' }

  const [agencyName, replyTo] = await Promise.all([getAgencyName(user.agencyId), getAgencyReplyTo(user.agencyId)])
  const sender = resolveSenderIdentity({ agencyName, replyTo }, getAutomationsFrom())
  if (!sender.identity) return { ok: false, reason: sender.problem ?? 'identity_unavailable' }

  const rendered = await renderAutomationEmail({
    subject: input.subject,
    body: input.body,
    vars: {
      // Preview with the admin's own name so variable substitution is visible
      // rather than theoretical.
      leadFirstName: user.name ?? null,
      businessName: sender.identity.displayName,
      repName: user.name ?? null,
    },
    // A real, working link — scoped to lead 0, which no lead can ever be, so
    // clicking it in a test can never suppress a real lead.
    unsubscribeUrl: `${baseUrl}/api/automations/unsubscribe?a=${user.agencyId}&l=0&t=${encodeURIComponent(signLeadUnsubscribe(user.agencyId, 0))}`,
  })

  const { sendEmail } = await import('@/lib/email/sender')
  const res = await sendEmail({
    from: sender.identity.from,
    replyTo: sender.identity.replyTo,
    to: user.email,
    subject: `[בדיקה] ${rendered.subject}`,
    html: rendered.html,
    text: rendered.text,
  })
  if ('error' in res) {
    console.error('[automations][test-send] failed', { agencyId: user.agencyId, reason: res.error })
    return { ok: false, reason: 'send_failed' }
  }
  return { ok: true }
}
