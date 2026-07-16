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
