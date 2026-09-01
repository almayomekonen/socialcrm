import {
  loadWhatsappComposerContext,
  queryConversationSendScope,
  queryLatestConversationForLead,
  queryLatestInboundAt,
  type ComposerContextDeps,
} from '@/lib/inbox/whatsappComposerContext'
import { resolveWhatsappServiceWindow } from '@/lib/inbox/whatsappServiceWindow'

export type FreeTextGateReason = 'health-blocked' | 'window-closed' | 'window-unknown' | 'leadless'

export type FreeTextGateResult = { ok: true } | { ok: false; reason: FreeTextGateReason }

/**
 * Server-side free-text guard. Same health-then-window rule as the composer.
 * CLOSED / UNKNOWN / non-operational health never reach Graph as session text —
 * except `throttled`, which means the status probe was rate-limited rather than
 * the connection being broken.
 */
export async function assertWhatsappFreeTextAllowed(
  input: {
    agencyId: number
    leadId: number
    conversationId?: number | null
  },
  injected?: Partial<ComposerContextDeps>,
): Promise<FreeTextGateResult> {
  if (!Number.isFinite(input.leadId) || input.leadId <= 0) {
    return { ok: false, reason: 'leadless' }
  }

  const getConversation = injected?.getConversation ?? queryConversationSendScope
  const getLatestForLead = injected?.getLatestConversationForLead ?? queryLatestConversationForLead
  const getLatestInboundAt = injected?.getLatestInboundAt ?? queryLatestInboundAt

  const scope = input.conversationId
    ? await getConversation(input.agencyId, input.conversationId)
    : await getLatestForLead(input.agencyId, input.leadId)

  if (!scope || scope.leadId !== input.leadId) {
    return { ok: false, reason: 'window-unknown' }
  }

  const ctx = await loadWhatsappComposerContext(input.agencyId, scope.conversationId, { deps: injected })
  // `throttled` passes. Meta rate-limited our status PROBE (#80008), so the check
  // could not run — an absence of information, not evidence of a fault. The
  // credential here is the same one the probe was using, so a genuinely dead
  // token still fails at Graph and reports itself. Refusing on "we could not
  // check" would turn a transient Meta limit into an outage.
  //
  // Every genuinely broken state — token, restricted, webhook,
  // registration_pending, unknown, disconnected — still blocks, unchanged.
  if (ctx.health !== 'operational' && ctx.health !== 'throttled') {
    return { ok: false, reason: 'health-blocked' }
  }

  const inboundAt = await getLatestInboundAt(input.agencyId, scope.conversationId)
  const window = resolveWhatsappServiceWindow(inboundAt)
  if (window === 'OPEN') return { ok: true }
  if (window === 'UNKNOWN') return { ok: false, reason: 'window-unknown' }
  return { ok: false, reason: 'window-closed' }
}
