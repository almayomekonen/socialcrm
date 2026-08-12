-- activation-funnel-queries.sql
-- Read-only diagnostic probes for the SocialCRM activation funnel.
-- Every query runs against PRODUCTION as-is. No writes, no schema changes.
-- Source of truth: analytics_events + agencies + clients + subscriptions.
--
-- IMPORTANT: these are the questions the CURRENT instrumentation can answer.
-- Q1-Q9 are answerable today. Everything the instrumentation cannot answer is
-- listed in docs/funnel/activation-funnel-audit.md §4.

-- ---------------------------------------------------------------------------
-- Q1. THE MASTER FUNNEL, per registration cohort week.
--     One row per week; each column is a distinct agency count.
-- ---------------------------------------------------------------------------
WITH reg AS (
  SELECT "agencyId",
         min("createdAt")                       AS registered_at,
         min(props->>'device')                  AS device
  FROM analytics_events
  WHERE event = 'registration_completed'
  GROUP BY "agencyId"
),
ev AS (
  SELECT "agencyId", event, min("createdAt") AS at
  FROM analytics_events
  GROUP BY "agencyId", event
),
first_lead AS (
  SELECT "agencyId", min("createdAt") AS at
  FROM clients
  GROUP BY "agencyId"
)
SELECT
  date_trunc('week', r.registered_at)::date                             AS cohort_week,
  count(*)                                                              AS registered,
  count(*) FILTER (WHERE r.device = 'desktop')                          AS registered_desktop,
  count(*) FILTER (WHERE r.device = 'mobile')                           AS registered_mobile,
  count(dfa.at)                                                         AS reached_desktop_workspace,
  count(ts.at)                                                          AS trial_started,
  count(fl.at)                                                          AS has_any_lead,
  count(fo.at)                                                          AS facebook_operational,
  count(afr.at)                                                         AS first_real_inbound_lead,
  count(uc.at)                                                          AS upgrade_clicked,
  count(sa.at)                                                          AS subscribed
FROM reg r
LEFT JOIN ev dfa ON dfa."agencyId" = r."agencyId" AND dfa.event = 'desktop_first_access'
LEFT JOIN ev ts  ON ts."agencyId"  = r."agencyId" AND ts.event  = 'trial_started'
LEFT JOIN ev fo  ON fo."agencyId"  = r."agencyId" AND fo.event  = 'facebook_connected_operational'
LEFT JOIN ev afr ON afr."agencyId" = r."agencyId" AND afr.event = 'activation_first_real_lead'
LEFT JOIN ev uc  ON uc."agencyId"  = r."agencyId" AND uc.event  = 'upgrade_clicked'
LEFT JOIN ev sa  ON sa."agencyId"  = r."agencyId" AND sa.event  = 'subscription_activated'
LEFT JOIN first_lead fl ON fl."agencyId" = r."agencyId"
GROUP BY 1
ORDER BY 1 DESC;

-- ---------------------------------------------------------------------------
-- Q2. THE DEVICE CLIFF — the single highest-value query in this file.
--     SocialCRM redirects every phone UA to /activate (MobileHandoff).
--     A user who registers on a phone must physically switch devices to enter
--     the product. This measures how many ever do.
-- ---------------------------------------------------------------------------
WITH reg AS (
  SELECT "agencyId", min("createdAt") AS registered_at, min(props->>'device') AS device
  FROM analytics_events WHERE event = 'registration_completed' GROUP BY "agencyId"
),
desktop AS (
  SELECT "agencyId", min("createdAt") AS at
  FROM analytics_events WHERE event = 'desktop_first_access' GROUP BY "agencyId"
)
SELECT
  coalesce(r.device, 'unknown')                                          AS registered_on,
  count(*)                                                               AS registrations,
  count(d.at)                                                            AS ever_reached_desktop,
  round(100.0 * count(d.at) / nullif(count(*), 0), 1)                    AS pct_crossed_over,
  round(avg(EXTRACT(EPOCH FROM (d.at - r.registered_at)) / 3600)::numeric, 1)
                                                                         AS avg_hours_to_cross
FROM reg r
LEFT JOIN desktop d ON d."agencyId" = r."agencyId"
GROUP BY 1
ORDER BY 2 DESC;

-- ---------------------------------------------------------------------------
-- Q3. THE TRIAL WALL. A new desktop agency sees WorkspaceTeaser + a
--     NON-DISMISSIBLE WelcomeTrialModal. The ONLY way into the product is the
--     CTA. Anyone shown the modal who did not start is a hard, total loss.
-- ---------------------------------------------------------------------------
WITH ev AS (
  SELECT "agencyId", event, min("createdAt") AS at
  FROM analytics_events GROUP BY "agencyId", event
)
SELECT
  count(*) FILTER (WHERE m.at IS NOT NULL)                               AS modal_shown,
  count(*) FILTER (WHERE t.at IS NOT NULL)                               AS trial_started,
  count(*) FILTER (WHERE m.at IS NOT NULL AND t.at IS NULL)              AS shown_but_never_started,
  round(100.0 * count(*) FILTER (WHERE m.at IS NOT NULL AND t.at IS NULL)
        / nullif(count(*) FILTER (WHERE m.at IS NOT NULL), 0), 1)        AS pct_lost_at_modal
FROM (SELECT DISTINCT "agencyId" FROM analytics_events) a
LEFT JOIN ev m ON m."agencyId" = a."agencyId" AND m.event = 'welcome_modal_shown'
LEFT JOIN ev t ON t."agencyId" = a."agencyId" AND t.event = 'trial_started';

-- ---------------------------------------------------------------------------
-- Q4. THE EMPTY-CRM POPULATION. Agencies that started a trial and never got a
--     single lead into the system. These users saw the product and bounced off
--     an empty workspace — the clearest "registered but never activated" set.
-- ---------------------------------------------------------------------------
WITH t AS (
  SELECT "agencyId", min("createdAt") AS trial_at
  FROM analytics_events WHERE event = 'trial_started' GROUP BY "agencyId"
)
SELECT
  count(*)                                                               AS trials,
  count(*) FILTER (WHERE c.n IS NULL OR c.n = 0)                         AS zero_leads_ever,
  count(*) FILTER (WHERE c.n BETWEEN 1 AND 4)                            AS leads_1_to_4,
  count(*) FILTER (WHERE c.n >= 5)                                       AS leads_5_plus,
  round(100.0 * count(*) FILTER (WHERE c.n IS NULL OR c.n = 0)
        / nullif(count(*), 0), 1)                                        AS pct_empty_crm
FROM t
LEFT JOIN (SELECT "agencyId", count(*) AS n FROM clients GROUP BY "agencyId") c
       ON c."agencyId" = t."agencyId";

-- ---------------------------------------------------------------------------
-- Q5. THE META CONNECT FUNNEL, stage by stage.
--     NOTE: the true denominator (facebook_connect_started) is DECLARED in
--     lib/analytics/track.ts but NEVER EMITTED, so OAuth-dialog abandonment
--     is invisible. This starts at the first stage that is actually recorded.
-- ---------------------------------------------------------------------------
WITH ev AS (
  SELECT "agencyId", event, min("createdAt") AS at
  FROM analytics_events GROUP BY "agencyId", event
)
SELECT
  count(oc.at)  AS oauth_completed,
  count(pd.at)  AS pages_discovered,
  count(ps.at)  AS page_selected,
  count(ws.at)  AS webhook_subscribed,
  count(op.at)  AS operational,
  count(fr.at)  AS first_real_lead_delivered,
  round(100.0 * count(op.at) / nullif(count(oc.at), 0), 1) AS pct_oauth_to_operational,
  round(100.0 * count(fr.at) / nullif(count(op.at), 0), 1) AS pct_operational_to_lead
FROM (SELECT DISTINCT "agencyId" FROM analytics_events) a
LEFT JOIN ev oc ON oc."agencyId" = a."agencyId" AND oc.event = 'facebook_oauth_completed'
LEFT JOIN ev pd ON pd."agencyId" = a."agencyId" AND pd.event = 'facebook_page_discovered'
LEFT JOIN ev ps ON ps."agencyId" = a."agencyId" AND ps.event = 'facebook_page_selected'
LEFT JOIN ev ws ON ws."agencyId" = a."agencyId" AND ws.event = 'facebook_webhook_subscribed'
LEFT JOIN ev op ON op."agencyId" = a."agencyId" AND op.event = 'facebook_connected_operational'
LEFT JOIN ev fr ON fr."agencyId" = a."agencyId" AND fr.event = 'activation_first_real_lead';

-- ---------------------------------------------------------------------------
-- Q6. WHY META CONNECTIONS FAIL. Exact reason + stage, already recorded.
-- ---------------------------------------------------------------------------
SELECT
  props->>'stage'                AS stage,
  props->>'reason'               AS reason,
  count(*)                       AS failures,
  count(DISTINCT "agencyId")     AS agencies
FROM analytics_events
WHERE event IN ('facebook_connect_failed', 'whatsapp_connect_failed')
GROUP BY 1, 2
ORDER BY failures DESC;

-- ---------------------------------------------------------------------------
-- Q7. TIME TO VALUE (current best proxy).
--     registration -> first lead of ANY source lands in the CRM.
--     Percentiles, so a few slow outliers cannot hide a fast median.
-- ---------------------------------------------------------------------------
WITH reg AS (
  SELECT "agencyId", min("createdAt") AS registered_at, min(props->>'device') AS device
  FROM analytics_events WHERE event = 'registration_completed' GROUP BY "agencyId"
),
fl AS (
  SELECT "agencyId", min("createdAt") AS first_lead_at FROM clients GROUP BY "agencyId"
)
SELECT
  coalesce(r.device, 'unknown')                                          AS registered_on,
  count(fl.first_lead_at)                                                AS agencies_with_a_lead,
  round(percentile_cont(0.50) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (fl.first_lead_at - r.registered_at)) / 60)::numeric, 1)
                                                                         AS p50_minutes,
  round(percentile_cont(0.90) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (fl.first_lead_at - r.registered_at)) / 3600)::numeric, 1)
                                                                         AS p90_hours,
  count(*) FILTER (WHERE fl.first_lead_at <= r.registered_at + interval '1 hour')
                                                                         AS within_1h,
  count(*) FILTER (WHERE fl.first_lead_at <= r.registered_at + interval '24 hours')
                                                                         AS within_24h
FROM reg r
LEFT JOIN fl ON fl."agencyId" = r."agencyId"
GROUP BY 1;

-- ---------------------------------------------------------------------------
-- Q8. TRIAL -> REVENUE. Where paying intent dies.
-- ---------------------------------------------------------------------------
WITH ev AS (
  SELECT "agencyId", event, min("createdAt") AS at
  FROM analytics_events GROUP BY "agencyId", event
)
SELECT
  count(t.at)                                              AS trials_started,
  count(x.at)                                              AS trials_expired,
  count(u.at)                                              AS clicked_upgrade,
  count(s.at)                                              AS subscribed,
  round(100.0 * count(u.at) / nullif(count(t.at), 0), 1)   AS pct_trial_to_intent,
  round(100.0 * count(s.at) / nullif(count(u.at), 0), 1)   AS pct_intent_to_paid,
  round(100.0 * count(s.at) / nullif(count(t.at), 0), 1)   AS pct_trial_to_paid
FROM (SELECT DISTINCT "agencyId" FROM analytics_events) a
LEFT JOIN ev t ON t."agencyId" = a."agencyId" AND t.event = 'trial_started'
LEFT JOIN ev x ON x."agencyId" = a."agencyId" AND x.event = 'trial_expired'
LEFT JOIN ev u ON u."agencyId" = a."agencyId" AND u.event = 'upgrade_clicked'
LEFT JOIN ev s ON s."agencyId" = a."agencyId" AND s.event = 'subscription_activated';

-- ---------------------------------------------------------------------------
-- Q9. RETURN VISITS — the ONLY retention signal that exists today.
--     There is no login/session event. users_info.ips is a rolling login
--     history (max 10 entries, written by recordLoginActivity on cookie mint).
--     It is a hard ceiling of 10 and it is per-user, not per-agency.
-- ---------------------------------------------------------------------------
WITH logins AS (
  SELECT u."agencyId",
         u.id AS user_id,
         jsonb_array_length(coalesce(ui.ips, '[]'::jsonb)) AS login_count,
         (ui.ips->0->>'at')::timestamptz                   AS last_login_at
  FROM users u
  LEFT JOIN users_info ui ON ui.id = u.id
)
SELECT
  count(*)                                                    AS users,
  count(*) FILTER (WHERE login_count <= 1)                    AS one_and_done,
  count(*) FILTER (WHERE login_count BETWEEN 2 AND 4)         AS returned_2_to_4,
  count(*) FILTER (WHERE login_count >= 5)                    AS returned_5_plus,
  count(*) FILTER (WHERE last_login_at > now() - interval '7 days')  AS active_last_7d,
  count(*) FILTER (WHERE last_login_at > now() - interval '30 days') AS active_last_30d
FROM logins;
