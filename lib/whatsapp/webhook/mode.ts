/**
 * EMERGENCY KILL SWITCH for durable WhatsApp webhook processing.
 *
 *   unset / anything else      durable (the default): record a receipt, acknowledge,
 *                              then process in the worker
 *   WA_WEBHOOK_DIRECT_PROCESSING=1
 *                              direct (fallback): process inside the request, the
 *                              pre-receipt behaviour, but answering 503 when an event
 *                              was not stored, so nothing is acknowledged unsaved
 *
 * The mode is read ONCE per request and decides which single path that request takes,
 * so one delivery is never processed by both. Receipts recorded before a switch keep
 * draining through the worker and cron in either mode. Message-level uniqueness makes a
 * redelivery that crosses the switch harmless.
 *
 * Changing it is an environment change plus a redeploy (this codebase has no runtime
 * configuration store, and inventing one for a kill switch would add a failure mode).
 * Procedure: docs/whatsapp-webhook-durable-receipt.md. Temporary: remove the direct
 * path, this file and its tests once durable processing has run cleanly in production.
 */
export type WhatsappWebhookMode = 'durable' | 'direct'

export function whatsappWebhookMode(env: Record<string, string | undefined> = process.env): WhatsappWebhookMode {
  return env.WA_WEBHOOK_DIRECT_PROCESSING?.trim() === '1' ? 'direct' : 'durable'
}

/**
 * The line an Axiom monitor matches. Emitted on every webhook handled in direct mode and
 * on every cron run while direct mode is set, so the alert fires even with no traffic.
 * Counts only.
 */
export function logDirectModeActive(where: 'webhook' | 'cron', fields: Record<string, number> = {}): void {
  console.warn('[wa-webhook] direct_mode_active', JSON.stringify({ where, ...fields }))
}
