# Owner WhatsApp reminders: configuration and rollout

Owners and reps who opted in (PR A, settings → תזכורות בוואטסאפ) get one WhatsApp
reminder from SocialCRM's own number when a hand-off has waited 120 minutes
with no human reply. This file is the operational contract for PR B.

**Every production step below is a separate, explicit approval.** Merging the
code changes nothing: with the defaults, the feature is off.

## Behaviour (fixed)

| Rule | Value |
|---|---|
| Trigger | `conversation_ai_state.aiState = 'escalated'` (AI and questionnaire hand-offs), WhatsApp, conversation `open`, not personal, lead absent or not `closed`/`lost` |
| Delay | 120 minutes after `escalatedAt` with no human reply (`humanOutboundSql`: SocialCRM or WhatsApp Business app; AI, automation, history and failed sends do not count) |
| Maximum age | 24 hours |
| Recipients | the lead's handler if activated; otherwise up to 3 activated users with role exactly `ADMIN`, earliest verified first. Leadless conversations go to the admins |
| Never | a recipient verified after the hand-off; an owner about a conversation with their own number; another agency's users; a suspended user |
| Dedup | one reminder per (conversation, escalation) |
| Cooldown | 12 hours per conversation, counted on deliveries that were `sending`, `sent` or `unknown` |
| Quiet hours | the agency's WhatsApp `auto_response_settings.quietHours`; deliveries wait for the window to end |
| Opt-out | re-checked with the recipient row locked immediately before each send; an opt-out waits for an in-flight send and is never followed by one |
| Unknown outcome | timeout, network error, HTTP 5xx or no message id: recorded `unknown`, **never resent** |
| Rate limit | retried after 1, 5 and 15 minutes, then `failed` |
| Account-wide rejection | `failed`, and all sends pause for 60 minutes |
| Batch | at most 10 sends per minute, 8-second timeout each |

## Template (to be submitted to Meta, not by this PR)

- Name `lead_followup_alert`, category UTILITY, language `he`.
- Body: `עדכון מ-SocialCRM: יש ליד שממתין למענה שלך כבר {{1}}. אפשר להמשיך את השיחה ישירות ב-SocialCRM.`
  `{{1}}` = waiting time in words (`שעתיים`, `3 שעות`). **No lead name or customer data**, by decision.
- Footer: `להפסקת ההתראות השיבו: הסר`
- Button: URL, `פתיחת השיחה`, `https://getsocialcrm.com/inbox?conversation={{1}}` (`{{1}}` = conversation id).
- Source of truth in code: `REMINDER_TEMPLATE` in `lib/ownerWhatsappReminders/constants.ts`.

## Environment variables

| Variable | Added in | Default | Effect |
|---|---|---|---|
| `PLATFORM_WHATSAPP_PHONE_NUMBER_ID` | PR A | unset | Platform webhook branch and the sender's phone number id. Unset: everything is inert |
| `PLATFORM_WHATSAPP_WA_ME_NUMBER` | PR A | unset | wa.me digits for the activation link |
| `OWNER_WA_REMINDERS_AGENCY_IDS` | PR A | **empty** | Explicit agency ids. Empty: no settings page, no activation, no reminders. Pilot: `103`. Never `158` |
| `PLATFORM_WHATSAPP_ACCESS_TOKEN` | PR B | unset | **Sensitive.** System User token for WABA `2060714354527399`. Production only |
| `PLATFORM_WHATSAPP_WABA_ID` | PR B | unset | Readiness check only (template status) |
| `OWNER_WA_REMINDERS_SEND_ENABLED` | PR B | unset | **Kill switch.** Exactly `1` sends; anything else is a dry run that logs counts and writes nothing |

Existing and reused: `CRON_SECRET` (cron and readiness auth), `META_APP_ID` and
`META_APP_SECRET` (readiness `debug_token` only).

Preview deployments must never receive these values.

## Migrations

- `20261012120000_owner_whatsapp_consent.cjs` (PR A): recipients, platform inbound log.
- `20261013120000_owner_whatsapp_reminders.cjs` (PR B): reminders, deliveries, message statuses.

Both are additive. Apply manually, before the steps that need them, following
`claude/release-deployment-workflow.md` §8b (`migrate:list` first). Until PR A's
migration is applied, every new server instance logs "Missing migrations
detected in production"; that is expected and harmless.

PR #134 (`20261010120000`) sorts before both; Knex applies it whenever it lands.

## Activation sequence (each step its own approval)

1. **Meta: System User.** In business portfolio `1484134075940912`: a System
   User with WABA `2060714354527399` (full control) and app `962521689620138`
   assigned; a never-expiring token with `whatsapp_business_messaging` and
   `whatsapp_business_management`.
2. **Meta: template.** Submit `lead_followup_alert` exactly as above; wait for
   APPROVED **and** category UTILITY.
3. **Production environment (no sending).** Set `PLATFORM_WHATSAPP_ACCESS_TOKEN`
   (sensitive) and `PLATFORM_WHATSAPP_WABA_ID` in **Production only**.
   `OWNER_WA_REMINDERS_SEND_ENABLED` stays unset, the allowlist stays empty.
4. **Production migrations.** Apply PR A's and PR B's migrations.
5. **Redeploy** the current production deployment so the variables load.
6. **Readiness check (read-only).**
   `curl -s -H "Authorization: Bearer $CRON_SECRET" https://getsocialcrm.com/api/internal/owner-wa/readiness`
   It only makes GET calls to Meta. Required: `ready: true` (token SYSTEM_USER
   with messaging granted on the WABA; phone CONNECTED, `can_send_message`
   AVAILABLE, quality not RED; template APPROVED, UTILITY, one body variable and
   a URL button variable). It cannot prove Meta will accept a send (payment
   method, business-verification limits).
7. **Consent on, pilot agency only.** Set `PLATFORM_WHATSAPP_PHONE_NUMBER_ID`,
   `PLATFORM_WHATSAPP_WA_ME_NUMBER` and `OWNER_WA_REMINDERS_AGENCY_IDS=103`;
   redeploy. The owner activates their own phone from settings. Nothing is sent.
8. **Dry run.** With sending still off, watch `[OwnerWaReminder][tick] dry run`
   logs (candidates, wouldRemind, noRecipients) for a day. No rows are written.
9. **First real send.** Set `OWNER_WA_REMINDERS_SEND_ENABLED=1`; redeploy.
   Verify on the owner's own phone: one reminder for a real agency 103 hand-off,
   the button opens the conversation, a delivery row `sent` with a wamid, and a
   `delivered`/`read` status in `owner_whatsapp_message_status`. Then a human
   reply must prevent the next one.
10. **Expansion** agency by agency, each approved separately. Never `158`.

## Verification queries (read-only)

```sql
SELECT status, count(*) FROM owner_whatsapp_reminders GROUP BY 1;
SELECT status, "errorScope", "errorCode", count(*) FROM owner_whatsapp_reminder_deliveries GROUP BY 1,2,3;
SELECT s.status, count(*) FROM owner_whatsapp_reminder_deliveries d
  JOIN owner_whatsapp_message_status s ON s.wamid = d.wamid GROUP BY 1;
```

## Rollback

- **Stop sending now:** unset `OWNER_WA_REMINDERS_SEND_ENABLED`, redeploy. Scheduled
  deliveries stay scheduled and are re-checked if sending is turned back on.
- **Stop all reminder work:** empty `OWNER_WA_REMINDERS_AGENCY_IDS`, redeploy.
  Keep `PLATFORM_WHATSAPP_PHONE_NUMBER_ID` set so opt-outs keep being recorded.
- **Remove the code:** revert PR B (PR A can stay).
- **Remove the data:** the migration's `down` drops the three tables (approval
  required; it deletes the delivery history).

## Known limitation

A signed-out owner who taps the button lands on `/auth`, and after signing in
reaches the dashboard, not the conversation: `proxy.ts` does not keep the
destination. Changing that touches authentication and is out of scope.
