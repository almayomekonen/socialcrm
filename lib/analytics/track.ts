import { db } from '@/config/db'

export type AnalyticsEventName =
  | 'registration_completed'
  | 'desktop_first_access'
  | 'welcome_modal_shown'
  | 'trial_started'
  | 'trial_expired'
  | 'upgrade_clicked'
  | 'subscription_activated'
  | 'general_mode.opened'
  | 'general_mode.question_asked'
  | 'general_mode.answer_rendered'
  | 'general_mode.deeplink_clicked'
  | 'general_mode.error'
  | 'operator_take.rendered'
  | 'operator_take.suppressed'
  | 'operator_take.citation_opened'
  | 'operator_take.dismissed'
  | 'auto_response_sent'
  | 'auto_response_skipped'
  | 'auto_response_escalated'
  | 'auto_response_draft'
  | 'post_handoff_sent'
  | 'post_handoff_stop'
  | 'activation_started'
  | 'oauth_completed'
  | 'subscription_completed'
  | 'subscription_failed'
  | 'activation_abandoned'
  // Manual first-lead "Aha" funnel (client-emitted via recordFirstLeadEvent).
  | 'first_manual_lead_created'
  | 'first_lead_opened'
  | 'first_follow_up_set'
  // --- Integration activation funnel (Facebook) ---
  | 'facebook_connect_started'
  | 'facebook_oauth_completed'
  | 'facebook_page_discovered'
  | 'facebook_page_selected'
  | 'facebook_webhook_subscribed'
  | 'facebook_connected_operational'
  | 'facebook_connect_failed'
  // --- Integration activation funnel (WhatsApp) ---
  | 'whatsapp_connect_started'
  | 'whatsapp_signup_completed'
  | 'whatsapp_phone_discovered'
  | 'whatsapp_webhook_subscribed'
  | 'whatsapp_messaging_ready'
  | 'whatsapp_connected_operational'
  | 'whatsapp_connect_failed'
  // --- First delivered value ---
  | 'activation_first_real_lead'
  // --- Meta Ads attribution ---
  // Marker row proving the Meta CAPI `Lead` conversion was accepted for this
  // agency. Doubles as the idempotency key — see lib/facebook/metaLeadConversion.ts.
  | 'meta_capi_lead_sent'

type TrackInput = {
  agencyId: number
  userId?: number | null
  event: AnalyticsEventName
  props?: Record<string, unknown>
}

export async function track({ agencyId, userId, event, props }: TrackInput): Promise<void> {
  try {
    await db.raw(
      `INSERT INTO analytics_events ("agencyId", "userId", event, props)
       VALUES (?, ?, ?, ?::jsonb)
       ON CONFLICT DO NOTHING`,
      [agencyId, userId ?? null, event, JSON.stringify(props ?? {})],
    )
  } catch (err) {
    console.error('[analytics] track failed', { event, agencyId, err: String(err) })
  }
}

/**
 * Emit `activation_first_real_lead` exactly once per agency per integration.
 *
 * "First delivered value" is the moment a real inbound provider lead is
 * persisted — not a manual lead, seed row, page discovery, or connection row.
 * Call this only after a genuinely NEW webhook lead is inserted (skip on dedup).
 *
 * Idempotency is a best-effort existence check (there is no unique constraint to
 * key on): a rare race could emit twice, which is acceptable for a funnel event
 * and never affects lead creation. Fully swallowed — never throws, never blocks
 * the webhook returning 200 to Meta.
 */
export async function trackFirstRealLeadOnce(
  agencyId: number,
  integration: 'facebook' | 'whatsapp',
): Promise<void> {
  try {
    const existing = await db('analytics_events')
      .where({ agencyId, event: 'activation_first_real_lead' })
      .whereRaw("props->>'integration' = ?", [integration])
      .first()
    if (existing) return
    await track({ agencyId, event: 'activation_first_real_lead', props: { integration } })
  } catch (err) {
    console.error('[analytics] first-real-lead track failed', { agencyId, integration, err: String(err) })
  }
}
