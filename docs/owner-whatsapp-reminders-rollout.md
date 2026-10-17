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
| `OWNER_WA_ONE_OFF_RECIPIENT_ID` | one-off test | unset | The one agency-103 recipient row the one-off test route may send to. Unset: the route answers 404. Remove after the test |

Existing and reused: `CRON_SECRET` (cron and readiness auth), `META_APP_ID` and
`META_APP_SECRET` (readiness `debug_token` only).

Preview deployments must never receive these values.

## Migrations

- `20261012120000_owner_whatsapp_consent.cjs` (PR A): recipients, platform inbound log.
- `20261013120000_owner_whatsapp_reminders.cjs` (PR B): reminders, deliveries, message statuses.

Both are additive. Apply both manually, before any platform variable or the
allowlist is set (activation step 3), following
`claude/release-deployment-workflow.md` §8b (`migrate:list` first). Until PR A's
migration is applied, every new server instance logs "Missing migrations
detected in production"; that is expected and harmless.

PR #134 (`20261010120000`) sorts before both; Knex applies it whenever it lands.

> **Migration order is mandatory.** Never configure `PLATFORM_WHATSAPP_PHONE_NUMBER_ID`
> or `OWNER_WA_REMINDERS_AGENCY_IDS` in Production until **both** PR A's and PR B's
> migrations are applied. Once either is set, the platform webhook branch writes
> to `platform_whatsapp_inbound`, `owner_whatsapp_recipients` and
> `owner_whatsapp_message_status`, and the reminders cron queries the reminder
> tables every minute. Before the migrations those tables do not exist: inbound
> and status writes fail (and Meta is asked to redeliver), and the cron errors
> every minute. This supersedes the activation order in PR #135's description.

## Activation sequence (each step its own approval)

0. **Merge PR B.** It must be merged, and its production deployment live,
   before any step below. The deployment is inert: no variable in this file is
   set yet.
1. **Meta: System User.** In business portfolio `1484134075940912`: a System
   User with WABA `2060714354527399` (full control) and app `962521689620138`
   assigned; a never-expiring token with `whatsapp_business_messaging` and
   `whatsapp_business_management`.
2. **Meta: template.** Submit `lead_followup_alert` exactly as above; wait for
   APPROVED **and** category UTILITY.
3. **Production migrations.** Apply PR A's (`20261012120000`) and PR B's
   (`20261013120000`) migrations, `migrate:list` first. Nothing below may start
   until both are applied (see the warning above).
4. **Production environment for readiness (no sending, no agency).** In
   **Production only**, set `PLATFORM_WHATSAPP_ACCESS_TOKEN` (sensitive),
   `PLATFORM_WHATSAPP_WABA_ID` and, now that both migrations are applied,
   `PLATFORM_WHATSAPP_PHONE_NUMBER_ID`. `OWNER_WA_REMINDERS_SEND_ENABLED` stays
   unset; `OWNER_WA_REMINDERS_AGENCY_IDS` and `PLATFORM_WHATSAPP_WA_ME_NUMBER`
   stay unset. With the allowlist empty the only effects are: messages to the
   platform number are logged without content, keyword opt-outs are honoured,
   and delivery statuses are recorded. No settings page, no activation, no
   reminder, no send.
5. **Redeploy** the current production deployment so the variables load.
6. **Readiness check (read-only, sending disabled).**
   `curl -s -H "Authorization: Bearer $CRON_SECRET" https://getsocialcrm.com/api/internal/owner-wa/readiness`
   It only makes GET calls to Meta and never sends; sending stays disabled
   (`OWNER_WA_REMINDERS_SEND_ENABLED` unset) throughout. It needs the three
   variables from step 4. Required: `ready: true` (token SYSTEM_USER with
   messaging granted on the WABA; phone CONNECTED, `can_send_message` AVAILABLE
   or LIMITED (never BLOCKED; the reasons for LIMITED/BLOCKED are listed per
   entity in `healthEntities`, e.g. business verification `141010` or an
   unapproved display name),
   quality not RED; template APPROVED, UTILITY, one body variable and a URL
   button variable). It cannot prove Meta will accept a send (payment method,
   business-verification limits). Do not continue unless it is ready.
7. **Consent on, agency 103 only.** Only after steps 3 to 6: set
   `PLATFORM_WHATSAPP_WA_ME_NUMBER` and `OWNER_WA_REMINDERS_AGENCY_IDS=103`;
   redeploy. The owner activates their own phone from settings. Nothing is sent.
8. **Dry run.** With sending still off, watch `[OwnerWaReminder][tick] dry run`
   logs (candidates, wouldRemind, noRecipients) for a day. No reminder rows are
   written.
9. **First real send.** Set `OWNER_WA_REMINDERS_SEND_ENABLED=1`; redeploy.
   Verify on the owner's own phone: one reminder for a real agency 103 hand-off,
   the button opens the conversation, a delivery row `sent` with a wamid, and a
   `delivered`/`read` status in `owner_whatsapp_message_status`.
   Then verify the human-reply rule on a **separate** eligible hand-off in a
   **different** conversation: answer it from SocialCRM or the WhatsApp
   Business app within 120 minutes, and confirm no reminder and no reminder row
   is created for it. Do not reuse the conversation that was just reminded: its
   12-hour cooldown and per-escalation dedup would suppress a reminder anyway,
   so the test would prove nothing.
10. **Expansion** agency by agency, each approved separately. Never `158`.

## One-off test send (agency 103 only, single use)

`POST /api/internal/owner-wa/one-off-send` sends ONE real `lead_followup_alert`
to the recipient row named by `OWNER_WA_ONE_OFF_RECIPIENT_ID`, about one real
hand-off, without `OWNER_WA_REMINDERS_SEND_ENABLED`
(`lib/ownerWhatsappReminders/oneOffSend.ts`).

- **Gates:** 404 unless the variable is set; `CRON_SECRET` bearer; body exactly
  `{ "conversationId": <id> }` (no recipient or number is accepted). Agency 103
  is a code constant and must be in `OWNER_WA_REMINDERS_AGENCY_IDS`. The
  recipient must be `active`, verified, not suspended, and selectable by the
  cron's own rules for that hand-off. The conversation must be eligible now
  (escalated 120 minutes to 24 hours ago, open, no human reply, lead not
  closed/lost, no cooldown). Refused inside quiet hours.
- **Single use:** refused once the recipient has any delivery row.
  Concurrent requests serialise on an advisory lock; exactly one reaches Meta.
- **No transaction during the Meta request.** The delivery is committed as
  `sending` first (the cron never claims `sending`), consent and eligibility are
  re-read immediately before the request, and the outcome is written after it.
  Timeout, network error or 5xx is `unknown`; a rate limit is `failed`. Nothing
  is retried. An interrupted attempt stays `sending` and is reaped to `unknown`
  by the cron when live: never resent.
- **Residual race:** an opt-out committed after that last read and before Meta
  receives the request cannot stop this one send (at most the 8-second request
  bound). The cron avoids this by holding the recipient row lock during the
  request; this path deliberately does not.

Use (each step its own approval): set the variable in Production only, redeploy,
create a real hand-off in agency 103 from a phone that is not the recipient,
wait 120 minutes without replying, then:

```
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
  -d '{"conversationId": <id>}' https://getsocialcrm.com/api/internal/owner-wa/one-off-send
```

Then unset the variable and redeploy. API acceptance is `outcome: "sent"` with a
`wamid`; delivery is only `delivered`/`read` in `owner_whatsapp_message_status`.

**Immediate test mode:** add `"mode": "immediate"` to the body to accept a
hand-off that has waited at least 1 minute instead of 120. The approved
template is unchanged; its `{{1}}` then states the true wait in minutes
(`דקה`, `5 דקות`; hours from 60 minutes on), so the message never claims a
longer wait. Every other gate above applies unchanged, including single use.
The cron and the standard one-off keep the 120-minute rule.

**From /admin/whatsapp (no secret handled):** while `OWNER_WA_ONE_OFF_RECIPIENT_ID`
is set, a platform owner sees "שליחת תזכורת בדיקה אחת" there. It calls the
Server Action `actions/admin/ownerWaOneOff.ts`, which re-checks platform
ownership itself (and refuses a suspended owner), accepts only a conversation
id, fixes the mode to `immediate`, and runs the same `sendOneOffReminder`, so
every gate and the single use above are shared with the route. Each attempt is
audited as `owner_wa_one_off_send` (ids and outcome only). After any answer the
control stays disabled; an `unknown` outcome must not be retried.

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
