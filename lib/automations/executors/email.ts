import { baseUrl } from '@/types/vars'
import { getAgencyName, getAgencyReplyTo, getRepName } from '@/db/automations/leadFacts'
import { DEFAULT_DISPLAY_NAME, resolveSenderIdentity, type SenderIdentity } from '../identity'
import { renderAutomationEmail } from '../renderEmail'
import { leadUnsubscribeUrl, signLeadUnsubscribe } from '../unsubscribeToken'
import { getAutomationsFrom } from '../flags'
import type {
  ActionExecutor,
  ExecutionContext,
  PreflightResult,
  PreviewResult,
  PreviewTarget,
  TestResult,
  TestTarget,
} from './types'

/**
 * `email.send` — Action #1, and nothing more than that.
 *
 * Everything email-specific in the execution path lives here: the transport,
 * the sender identity, the unsubscribe link, the rendering, the variables the
 * renderer can substitute, and the test send. Nothing above this file — not
 * the worker, not the laws, not the actions layer — knows any of it.
 */

/** What preflight resolves and execute consumes. */
export type EmailReady = {
  identity: SenderIdentity | null
  /** The agency name as stored, used when the identity could not be resolved. */
  businessName: string | null
}

/**
 * The email executor's OWN dependencies. The worker never declares these — an
 * action that needs a database row instead of a mailer declares that instead,
 * and the worker is unchanged either way.
 */
export type EmailDeps = {
  agencyName: (agencyId: number) => Promise<string | null>
  replyTo: (agencyId: number) => Promise<string | null>
  repName: (userId: number | null) => Promise<string | null>
  from: () => string
  send: (args: {
    from: string
    replyTo: string
    to: string
    subject: string
    html: string
    text: string
    headers?: Record<string, string>
  }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
}

/**
 * The three subject fields the renderer can substitute. This is the AUTHORITY
 * the actions layer validates authored content against — replacing the global
 * "email variables" constant that used to apply to every action regardless of
 * which one it was.
 */
const RESOLVABLE_FIELDS = [
  'leadFirstName',
  'businessName',
  'repName',
  // The appointment occurrence's meeting. Declared here because this is the
  // AUTHORITY the actions layer validates authored content against; the Builder
  // still only offers them as chips on events that declare them.
  'meetingTitle',
  'meetingWhen',
  'meetingDetails',
] as const

/**
 * The optional CTA action block, read out of the stored parameters. One block:
 * both halves or nothing, so a label without a destination renders no button
 * rather than a dead one.
 */
/**
 * RFC 8058 one-click unsubscribe.
 *
 * The body link alone left Gmail without a native unsubscribe control, and left
 * a bulk sender looking like one that offers no way out — a deliverability cost
 * as much as a UX one. Both headers are required: `List-Unsubscribe` alone does
 * not enable one-click, and `List-Unsubscribe-Post` without a POST-capable URL
 * would advertise a control that fails.
 *
 * The engine's unsubscribe route already mutates on POST only (ADR-003
 * amendment), which is exactly what this needs.
 */
const unsubscribeHeaders = (url: string): Record<string, string> => ({
  'List-Unsubscribe': `<${url}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
})

/** Lead 0 — an id no lead can ever have, so test and preview links are inert. */
const inertUnsubscribeUrl = (agencyId: number) =>
  `${baseUrl}/api/automations/unsubscribe?a=${agencyId}&l=0&t=${encodeURIComponent(signLeadUnsubscribe(agencyId, 0))}`

const actionFrom = (parameters: Record<string, unknown>) => {
  const label = asText(parameters.ctaLabel).trim()
  const url = asText(parameters.ctaUrl).trim()
  return label && url ? { label, url } : null
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')
const asVar = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** The variable map, built from whatever the subject resolved to. */
const varsFrom = (subject: Record<string, unknown>, businessName: string | null) => ({
  leadFirstName: asVar(subject.leadFirstName),
  // The identity's display name and the rendered business name are the same
  // resolved value — the email cannot say one thing and sign another.
  businessName: businessName ?? asVar(subject.businessName),
  repName: asVar(subject.repName),
  // Already formatted by the subject resolver, in the BUSINESS timezone. The
  // renderer substitutes strings and never formats a date itself.
  meetingTitle: asVar(subject.meetingTitle),
  meetingWhen: asVar(subject.meetingWhen),
  meetingDetails: asVar(subject.meetingDetails),
})

export const emailExecutor: ActionExecutor<EmailReady, EmailDeps> = {
  actionKey: 'email.send',
  resolvableFields: RESOLVABLE_FIELDS,

  defaultDeps: () => ({
    agencyName: getAgencyName,
    replyTo: getAgencyReplyTo,
    repName: getRepName,
    from: getAutomationsFrom,
    // Transport is an effect-time concern (ADR-011): loaded lazily so the
    // log-mode engine never touches the Resend client, whose construction
    // requires the platform API key at import.
    send: async (args) => {
      const { sendEmail } = await import('@/lib/email/sender')
      return sendEmail(args)
    },
  }),

  /**
   * Identity is resolved BEFORE the claim (ADR-013). In log mode an
   * unresolvable identity is NOT blocking: the engine still renders a truthful
   * preview of what it would have sent, which is the whole point of
   * observation mode.
   */
  async preflight(ctx: ExecutionContext, deps: EmailDeps): Promise<PreflightResult<EmailReady>> {
    const businessName = await deps.agencyName(ctx.agencyId)
    const sender = resolveSenderIdentity({ agencyName: businessName, replyTo: await deps.replyTo(ctx.agencyId) }, deps.from())
    const ready: EmailReady = { identity: sender.identity, businessName }
    if (!sender.problem) return { ready, problem: null }
    return {
      // Log mode continues with the unresolved identity; the worker only
      // blocks in live mode. Handing `ready` back keeps that possible.
      ready,
      problem: {
        reason: sender.problem,
        deadReason: `identity_unavailable:${sender.problem}`,
        warnTransition: 'identity_incomplete',
        logClass: 'identity',
      },
    }
  },

  async execute(ctx: ExecutionContext, ready: EmailReady, deps: EmailDeps) {
    const unsubscribe = leadUnsubscribeUrl(baseUrl, ctx.agencyId, ctx.leadId)
    const rendered = await renderAutomationEmail({
      subject: asText(ctx.parameters.subject),
      body: asText(ctx.parameters.body),
      vars: varsFrom(ctx.subject, ready.identity?.displayName ?? ready.businessName),
      unsubscribeUrl: unsubscribe,
      action: actionFrom(ctx.parameters),
    })

    // The recipient is whatever the action's `requires: ['email']` resolved to
    // — read by catalog field key, never assumed to be a property called
    // "email" on a lead-shaped object.
    const to = ctx.recipients.email ?? null

    if (ctx.mode === 'live' && ready.identity && to) {
      const res = await deps.send({
        from: ready.identity.from,
        replyTo: ready.identity.replyTo,
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: unsubscribeHeaders(unsubscribe),
      })
      if ('error' in res) throw new Error(`transport: ${res.error}`)
      return {
        kind: 'sent' as const,
        summary: rendered.subject,
        deliveryState: 'sent' as const,
        providerMessageId: res.id,
        log: { reason: 'transport_accepted', providerMessageId: res.id },
      }
    }

    return {
      kind: 'would_send' as const,
      summary: rendered.subject,
      log: { reason: 'log_mode', subject: rendered.subject },
    }
  },

  /**
   * "שלח אליי בדיקה" — the honesty handshake (spec §7): what the admin
   * receives is exactly what a lead would receive, because it goes through the
   * same identity resolver and the same renderer as `execute`.
   *
   * It is not a customer send: no claim, no activity row, no cap, and only to
   * the caller's own address — so it runs regardless of the send mode without
   * making live sending reachable for leads.
   */
  async test(parameters, target: TestTarget, deps: EmailDeps): Promise<TestResult> {
    const businessName = await deps.agencyName(target.agencyId)
    const sender = resolveSenderIdentity({ agencyName: businessName, replyTo: await deps.replyTo(target.agencyId) }, deps.from())
    if (!sender.identity) return { ok: false, reason: sender.problem ?? 'identity_unavailable' }

    const testUnsubscribeUrl = inertUnsubscribeUrl(target.agencyId)
    const rendered = await renderAutomationEmail({
      subject: asText(parameters.subject),
      body: asText(parameters.body),
      // Previewed with the admin's own name so substitution is visible rather
      // than theoretical.
      vars: {
        leadFirstName: target.toName,
        businessName: sender.identity.displayName,
        repName: target.toName,
      },
      // A real, working link — scoped to lead 0, which no lead can ever be, so
      // clicking it in a test can never suppress a real lead.
      unsubscribeUrl: testUnsubscribeUrl,
      // The test send carries the CTA too, or it would not be the same email.
      action: actionFrom(parameters),
    })

    const res = await deps.send({
      from: sender.identity.from,
      replyTo: sender.identity.replyTo,
      to: target.address,
      subject: `[בדיקה] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
      headers: unsubscribeHeaders(testUnsubscribeUrl),
    })
    if ('error' in res) {
      console.error('[automations][test-send] failed', { agencyId: target.agencyId, reason: res.error })
      return { ok: false, reason: 'send_failed' }
    }
    return { ok: true }
  },

  /**
   * The Builder preview — the SAME renderer and the SAME identity resolver as
   * `execute`, so what the customer sees is what a lead receives.
   *
   * Renders even when the identity cannot be resolved: the shell and content are
   * still truthful, and blanking the preview because a reply-to is missing would
   * hide the very content the customer is editing. The dedicated "דורש טיפול"
   * surface is what reports the configuration fault.
   */
  async preview(parameters, target: PreviewTarget, deps: EmailDeps): Promise<PreviewResult> {
    const businessName = await deps.agencyName(target.agencyId)
    const sender = resolveSenderIdentity({ agencyName: businessName, replyTo: await deps.replyTo(target.agencyId) }, deps.from())
    const displayName = sender.identity?.displayName ?? businessName ?? DEFAULT_DISPLAY_NAME

    const rendered = await renderAutomationEmail({
      subject: asText(parameters.subject),
      body: asText(parameters.body),
      // The admin's own name stands in for the lead, and the REAL business name
      // is used — the old preview passed nulls and showed the placeholder
      // "העסק", so the customer never saw their own name in place.
      vars: { leadFirstName: target.toName, businessName: displayName, repName: target.toName },
      // Inert but real in shape: lead 0, which no lead can ever be.
      unsubscribeUrl: inertUnsubscribeUrl(target.agencyId),
      action: actionFrom(parameters),
    })

    return { ok: true, html: rendered.html, subjectLine: rendered.subject, fromName: displayName }
  },
}
