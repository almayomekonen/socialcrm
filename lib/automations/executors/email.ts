import { baseUrl } from '@/types/vars'
import { resolveSenderIdentity, type SenderIdentity } from '../identity'
import { renderAutomationEmail } from '../renderEmail'
import { leadUnsubscribeUrl } from '../unsubscribeToken'
import { getAutomationsFrom } from '../flags'
import type { ActionExecutor, ExecutionContext, ExecutorDeps, PreflightResult } from './types'

/**
 * `email.send` — Action #1, and nothing more than that.
 *
 * Every line below was lifted out of the worker unchanged: the identity
 * resolution, its ordering before the claim, the exact dead-reason string, the
 * exact log transitions, the rendering, the `mode === 'live' && identity`
 * send condition, and the activity fields. The worker did not become simpler
 * by losing behaviour — it became simpler by losing knowledge of email.
 */

/** What preflight resolves and execute consumes. */
export type EmailReady = {
  identity: SenderIdentity | null
  /** The agency name as stored, used when the identity could not be resolved. */
  businessName: string | null
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

export const emailExecutor: ActionExecutor<EmailReady> = {
  actionKey: 'email.send',

  /**
   * Identity is resolved BEFORE the claim (ADR-013). In log mode an
   * unresolvable identity is NOT blocking: the engine still renders a truthful
   * preview of what it would have sent, which is the whole point of
   * observation mode.
   */
  async preflight(ctx: ExecutionContext, deps: ExecutorDeps): Promise<PreflightResult<EmailReady>> {
    const businessName = await deps.agencyName(ctx.agencyId)
    const sender = resolveSenderIdentity(
      { agencyName: businessName, replyTo: await deps.replyTo(ctx.agencyId) },
      getAutomationsFrom(),
    )
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

  async execute(ctx: ExecutionContext, ready: EmailReady, deps: ExecutorDeps) {
    const rendered = await renderAutomationEmail({
      subject: asText(ctx.parameters.subject),
      body: asText(ctx.parameters.body),
      vars: {
        // The identity's display name and the rendered business name are the
        // same resolved value — the email cannot say one thing and sign another.
        leadFirstName: ctx.lead.firstName,
        businessName: ready.identity?.displayName ?? ready.businessName,
        repName: await deps.repName(ctx.lead.handlerId),
      },
      unsubscribeUrl: leadUnsubscribeUrl(baseUrl, ctx.agencyId, ctx.leadId),
    })

    if (ctx.mode === 'live' && ready.identity) {
      const res = await deps.send({
        from: ready.identity.from,
        replyTo: ready.identity.replyTo,
        to: ctx.lead.email as string,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
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
}
