import { db } from '@/config/db'
import { businessDateString } from '@/lib/today/time'

export type AnalyticsEventName =
  | 'registration_completed'
  | 'desktop_first_access'
  | 'welcome_modal_shown'
  | 'trial_started'
  /**
   * The welcome modal is NON-DISMISSIBLE: the CTA is the only way through. So a
   * `welcome_modal_shown` with no `trial_started` could mean the user walked
   * away, or that the CTA was pressed and the start failed — and production had
   * exactly one such agency with no way to tell which. These two close that gap.
   * There is deliberately no `dismissed` event: the state cannot occur.
   */
  | 'trial_start_clicked'
  | 'trial_start_failed'
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
  // Generation failed validation twice and a safe holding reply went out
  // instead of silence. Counts the recovery path, not an error.
  | 'auto_response_recovered'
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
  // --- Activation instrumentation (funnel audit §6, Tier 1) ---
  /**
   * THE activation milestone: a rep did something to a lead. ONE event across
   * both devices, carrying `surface: 'mobile' | 'desktop'` — never a separate
   * `mobile_lead_action_taken`, because two events would make the cross-surface
   * Activation KPI uncomputable and leave desktop activation invisible, which is
   * the exact blindness this instrumentation exists to remove.
   * props: { surface: 'mobile'|'desktop', action: 'status'|'follow_up'|'assign'|'message'|'note'|'outcome' }
   */
  | 'lead_action_taken'
  /**
   * THE CONTACT TRIAD. `lead_action_taken` measures INTENT ONLY — it is recorded
   * on tap, before the outcome is known, which is why production shows nine
   * `action: 'message'` taps and zero conversations. These three separate the
   * three things that tap can mean, and they carry one invariant:
   *
   *   every `lead_contact_clicked` resolves to exactly ONE
   *   `lead_contact_succeeded` OR `lead_contact_blocked`, and NEITHER terminal
   *   is ever emitted without a matching intent for the same action.
   *
   * Both halves matter. A terminal without an intent — e.g. emitted because a
   * blocked composer merely RENDERED — would count passive reading as a failed
   * contact attempt and make the blocked rate meaningless. Measuring how often
   * blocked conversation states are viewed is a separate question and needs its
   * own event; it is deliberately not one of these.
   *
   * `lead_action_taken` is deliberately KEPT alongside them so the existing
   * Activation KPI does not break mid-experiment; it is the intent numerator,
   * these are the outcome.
   *
   * props: { leadId, surface, intendedChannel? }
   */
  | 'lead_contact_clicked'
  /**
   * The user wanted to contact a lead and the product could not deliver a
   * channel. `reason` is the whole point of the event.
   * props: { leadId, surface, reason: 'no_phone'|'no_connection'|'window_unknown'|'window_closed_no_template' }
   */
  | 'lead_contact_blocked'
  /**
   * SocialCRM delivered a usable contact channel for this lead.
   *
   * SEMANTICS, and they differ per channel — read this before building a funnel
   * on top of it. For `whatsapp_api` the rep reached a real composer they can
   * type into. For `whatsapp_native` it means ONLY that SocialCRM successfully
   * handed the rep to WhatsApp with this lead's number. It does NOT mean a
   * message was composed, sent, delivered, or replied to: once the handoff
   * happens the conversation leaves our process and we can observe nothing
   * further. Never report `whatsapp_native` as "messages sent".
   * props: { leadId, surface, channel: 'whatsapp_api'|'whatsapp_native'|'phone' }
   */
  | 'lead_contact_succeeded'
  /** Bulk import completed. props: { count, format: 'excel'|'csv', surface } */
  | 'leads_imported'
  /** A lead typed in by hand (every one, not just the first). props: { surface, origin } */
  | 'lead_created_manual'
  /**
   * The real workspace rendered with page children — NOT the teaser. The
   * denominator for every in-product metric. `desktop_first_access` cannot
   * serve: it only fires while the trial is NEVER_STARTED, so it goes silent
   * the moment the trial starts. Emitted from the shell in Phase 2.
   * props: { surface }
   */
  | 'workspace_first_viewed'
  /**
   * The FIRST-RUN SCREEN itself rendered — a workspace with zero leads showing
   * `LeadsFirstRun` (desktop) or `LeadsFirstRunMobile` (mobile).
   *
   * Deliberately NOT once-per-agency, and deliberately distinct from
   * `workspace_first_viewed`. That event is emitted by the (app) layout, once,
   * for the whole agency — so it cannot say whether this screen rendered, nor
   * how many times a user came back to an empty workspace and left again.
   * Coming back to nothing is itself the signal.
   *
   * This is the denominator for first-run activation: the funnel is
   * `first_run_viewed` → (`connection_offered` →) `*_connect_started` |
   * `lead_created_manual` | `leads_imported`. An agency with `first_run_viewed`
   * and no following event is the abandonment cohort the funnel audit could not
   * see.
   * props: { surface: 'mobile'|'desktop', metaConnected, whatsappConnected }
   */
  | 'first_run_viewed'
  /** Connect options were rendered / navigated away from. Separates "chose not
   *  to connect" from "never saw the option". props: { channel, surface } */
  | 'connection_offered'
  | 'connection_deferred'
  // --- Mobile workspace (Phase 15 of the mobile plan) ---
  /** props: { agencyId implicit, path } — emitted once the mobile shell mounts. */
  | 'mobile_workspace_viewed'
  | 'mobile_lead_opened'
  /** First delivered value reached on a phone. props: { via } */
  | 'mobile_first_value_reached'
  /** The phone handoff screen was shown / the user tried to cross to desktop. */
  | 'mobile_handoff_shown'
  | 'mobile_handoff_link_copied'
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
  /**
   * Terminal end of the WhatsApp lifecycle. The connection row is HARD
   * deleted, so once it is gone the database holds no trace of when the
   * disconnect happened, who did it, or from where — this event is the only
   * durable record. Agency 130 disconnected an operational, lead-producing
   * number and left us nothing to read; that is the gap this closes.
   */
  | 'whatsapp_disconnected'
  // --- First delivered value ---
  | 'activation_first_real_lead'
  // --- Meta Ads attribution ---
  // Marker row proving the Meta CAPI `Lead` conversion was accepted for this
  // agency. Doubles as the idempotency key — see lib/facebook/metaLeadConversion.ts.
  | 'meta_capi_lead_sent'
  // --- Customer Automation Engine ---
  // Shadow metric: a trigger event reached the emission gate but the engine
  // kill switch (AUTOMATIONS_ENABLED) blocked it — proof of what WOULD have
  // been processed. See lib/automations/emit.ts.
  | 'automation_event_shadow'
  // --- Support Center (first-party product support) ---
  // SocialCRM customer -> SocialCRM platform support. No third party is ever
  // involved in these events.
  | 'support_request_created'
  | 'support_request_replied'
  // Emitted when a support notification email fails (Phase 4). Carries
  // requestId, notification type and recipient CATEGORY only — never a message
  // body, subject, address, name or token.
  | 'support_notification_failed'
  // --- Product education (Driver.js tours + in-app Help) ---
  | 'tour_started'
  | 'tour_step_viewed'
  | 'tour_completed'
  | 'tour_dismissed'
  | 'contextual_help_opened'
  | 'help_action_clicked'
  | 'education_action_offered'
  | 'education_action_clicked'
  | 'education_tour_started_from_copilot'
  /**
   * Retention primitive: one row per user per SocialCRM business day on which
   * they actually entered the authenticated workspace.
   *
   * Return behaviour previously had no honest instrument — "did this agency come
   * back" was inferred from "did any other event happen on a later date", which
   * measures instrumentation coverage as much as user behaviour. A user who
   * returned, read an empty lead list and clicked nothing was indistinguishable
   * from one who never came back.
   */
  | 'session_started'

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
 * Emit an event at most once per agency, WITHOUT a schema change.
 *
 * The DB-level dedup index (`analytics_events_once_per_agency`) covers exactly
 * five funnel events and extending it needs a migration, which is out of scope.
 * This generalises the existing `trackFirstRealLeadOnce` mechanism instead: a
 * best-effort existence check, then an insert.
 *
 * DOCUMENTED LIMITATION — this is NOT the same guarantee as the index:
 *   · Two concurrent requests can both miss the check and both insert. A
 *     duplicate funnel row is acceptable; it never affects the user's request.
 *   · It costs one indexed SELECT per call, so callers on a render path MUST
 *     wrap it in `after()` so the read happens post-response.
 * If exact once-per-agency semantics are ever required for these events, the
 * honest fix is to add them to the partial unique index — not to build a second
 * deduplication mechanism here.
 *
 * Fully swallowed: analytics must never break a page render.
 */
export async function trackOncePerAgency(
  agencyId: number,
  event: AnalyticsEventName,
  userId?: number | null,
  props?: Record<string, unknown>,
): Promise<void> {
  try {
    const existing = await db('analytics_events').where({ agencyId, event }).first()
    if (existing) return
    await track({ agencyId, userId, event, props })
  } catch (err) {
    console.error('[analytics] once-per-agency track failed', { agencyId, event, err: String(err) })
  }
}

type SessionStartedInput = {
  agencyId: number
  userId: number
  /** Injected only by tests; production uses the current instant. */
  now?: Date
  /** The workspace shell already knows whether this was desktop or mobile. */
  surface?: 'desktop' | 'mobile'
}

/**
 * Emit one `session_started` event for a user on each SocialCRM business day.
 *
 * The date is derived with the existing `Asia/Jerusalem` business-calendar
 * helper rather than the server's local/UTC clock — a rep opening the workspace
 * at 00:30 Jerusalem time is on the new business day, which is the boundary
 * every other "today" question in this product already uses.
 *
 * The analytics table has no schema-level unique key for a per-user/day event,
 * so this follows the repository's existing best-effort read-then-track pattern
 * (same as `trackOncePerAgency`). Sequential reloads are deduplicated; a
 * simultaneous cross-request race could emit twice, which is acceptable for a
 * funnel row and never affects the user's request. Adding a unique index is a
 * migration and is deliberately out of scope.
 *
 * Called only after the authenticated workspace has passed every access gate —
 * never for a redirect, and never for the trial teaser.
 *
 * Fully swallowed: analytics must never break a page render.
 */
export async function trackSessionStartedOncePerDay({
  agencyId,
  userId,
  now = new Date(),
  surface,
}: SessionStartedInput): Promise<void> {
  const date = businessDateString(now.getTime())
  try {
    const existing = await db('analytics_events')
      .where({ userId, event: 'session_started' })
      .whereRaw("props->>'date' = ?", [date])
      .first()
    if (existing) return

    await track({
      agencyId,
      userId,
      event: 'session_started',
      props: surface ? { date, surface } : { date },
    })
  } catch (err) {
    console.error('[analytics] session-start track failed', { agencyId, userId, err: String(err) })
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
  /**
   * Widened beyond the two webhook integrations. As `'facebook' | 'whatsapp'`
   * the type system made "first delivered value" impossible to record for a
   * business that imported a spreadsheet or typed its first lead — i.e. it
   * encoded the assumption that value requires an integration, which is exactly
   * what the funnel audit found blocking source-agnostic activation.
   */
  integration: 'facebook' | 'whatsapp' | 'manual' | 'import',
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
