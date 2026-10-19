# SocialCRM AI on WhatsApp: pilot (agency 103)

A verified business owner messages SocialCRM's own WhatsApp number in Hebrew and
gets answers grounded in their CRM. **Read-only.** Off by default.

## What it does today

| Request (examples) | How it is answered |
|---|---|
| "סכם לי את היום" | Existing Agent (`lib/agent/run.ts`), tool `get_today_state` and friends |
| "מי לא קיבל מענה?" | Existing Agent read tools (Today state, conversations) |
| "תמצא את הליד דניאל" | `find_lead` |
| "מה הסטטוס של הליד דניאל?" | `find_lead` + `get_lead` |
| A voice note, image or other media | Fixed "text only" note, no model call |
| Anything asking to *do* something | Answered as a question; any proposed action is **not** performed and the reply says so |

Answers are the Agent's validated output (every claim must cite evidence it
read). Phone numbers and emails are redacted from every reply.

## Request lifecycle

1. **Webhook** (`app/api/webhooks/whatsapp/route.ts` → `lib/whatsapp/platform/inbound.ts`):
   signature checked; opt-out ("הסר") and activation codes are decided **first**
   and never reach the assistant. Then a text or media message from a number
   verified for **exactly one** active recipient (`owner_whatsapp_recipients`)
   in an agency on `WA_ASSISTANT_AGENCY_IDS` is queued in `wa_assistant_jobs`,
   in the same transaction, once per Meta message id. Meta gets its 200 at once.
2. **Kick**: `after()` runs the worker right away; `/api/cron/wa-assistant`
   drains every minute as a backstop.
3. **Worker** (`lib/waAssistant/worker.ts`), per job: 23-hour reply window →
   recipient, user, agency, Agent rollout and product access re-checked from the
   database (fail closed) → limits → typing indicator → Agent (read tools only,
   no web research, 5 steps, 35s, last 3 exchanges as context) → one reply.
4. **Reply** (`lib/whatsapp/platform/sendText.ts`): `sending` is committed before
   the call; an unknown outcome is never resent.

## Safeguards

- Identity: Meta's signed `from` + a recipient row proven by code from the
  owner's own phone. Ambiguous numbers (verified for several accounts) are
  refused. Strangers, inactive or opted-out recipients, suspended users, other
  agencies: nothing queued, nothing sent.
- Tenant isolation: the Agent scope is rebuilt per turn from the recipient row
  (same construction as `lib/ai/integration/autonomousScope.ts`); tools close
  over it; the model never supplies an agency or user.
- Limits: 20 messages per sender per hour, 200 per agency per day, durable
  per-agency spend per UTC day (`WA_ASSISTANT_DAILY_USD_CAP`, default 2 USD).
  Only the first message over a count limit gets a "limit" reply.
- Memory: question + answer headline only, last 3 exchanges, cleared 24 hours
  after the message. No customer phone or email is stored.
- Audit: analytics event `wa_assistant_turn` (ids, outcome, timing, cost; never
  text) and the Agent's own `agent_investigations` record.
- No writes: no Action Runtime call exists on this path.

## Configuration (Production only, each change its own approval)

| Variable | Pilot value | Notes |
|---|---|---|
| `WA_ASSISTANT_AGENCY_IDS` | `103` | Absent = off. `all` is ignored |
| `WA_ASSISTANT_DAILY_USD_CAP` | optional | Default 2 |
| `AGENT_AGENCY_IDS`, `AI_ENABLED` | must include 103 | The Agent rollout the assistant reuses |
| Platform number + token | existing | Same as owner reminders |

Migration: `20261019120000_wa_assistant_jobs.cjs` (additive). Apply it manually
before the deploy, per `claude/release-deployment-workflow.md` §8b.

## Release blockers (resolve before ANY Production deployment of this branch)

1. **`OWNER_WA_REMINDERS_SEND_ENABLED=1` is set in Production but not loaded.**
   Any new Production deployment, this one included, turns real reminder
   sending on. Decide go-live or remove the variable first.
2. **Which number is the platform sender** (WABA `2060714354527399`): confirm it
   is the number owners will write to (the 10-17 reminder's sender).
3. **Consent text**: `lib/whatsapp/platform/consentText.ts` v2 covers reminders
   only. Fine for the internal pilot (103); a v3 covering conversational use is
   required before any customer agency is added.
4. The migration must be applied first; `next build` is verified by the Preview.

## Verification plan

- **Local**: `npm run test:db` subsets: `__tests__/waAssistant`,
  `__tests__/whatsapp/platform`, `__tests__/ownerWhatsappReminders`,
  `__tests__/ai/signalCronRoute.test.ts`; `tsc --noEmit`.
- **Preview**: the Preview build must be Ready. Preview has no platform token
  and no flag, so nothing is queued or sent there (expected).
- **Production pilot** (after the blockers): set `WA_ASSISTANT_AGENCY_IDS=103`,
  redeploy, then from the verified 103 phone: "סכם לי את היום", "מי לא קיבל
  מענה?", "תמצא את הליד <name>", "מה הסטטוס של הליד <name>?", a voice note,
  and "הסר" (then re-activate). Check `wa_assistant_jobs` (status, replyState,
  costUsd, durationMs) and `analytics_events.wa_assistant_turn`.
- **Rollback**: remove `WA_ASSISTANT_AGENCY_IDS` and redeploy (queued jobs are
  then refused silently; reminders are unaffected).

---

# Phase 2 assessment: "קבע לי פגישה עם הליד דניאל"

**Status: not built.** The demo at `/admin/whatsapp/assistant-demo` shows the
intended experience as a labelled simulation only.

## What exists

- `meetings` / `meeting_attendees` tables; the CRM row is the source of truth,
  Google is a mirror (`sync_status`).
- `actions/calendar/create.ts` `createMeeting` (session-bound) and
  `actions/calendar/shared.ts` `pushMeetingToGoogle`.
- Google: `lib/integrations/google/calendarClient.ts` has create, update and
  delete only. OAuth scope is `calendar.events`
  (`app/api/auth/google-calendar/route.ts`).
- Agent action `create_meeting` (`lib/agent/actions/domain/createMeeting.ts`,
  LOW_RISK_WRITE) creates the CRM row via `lib/system/createMeetingSystem.ts` and
  leaves it `pending`: **no Google push**.
- Approvals: `lib/agent/actions/approval.ts` + `bridge.ts` `decideOnAction`
  (proposer only, `argsHash`, 15-minute expiry). Idempotency and audit:
  `agent_actions`, `agent_action_approvals`.

## What is missing, in build order

1. **Authorization fixes before any write is reachable from WhatsApp**:
   `transferLeadToRep` (`actions/clients.ts:600`, no admin or recipient-agency
   check), `updateLead` reassignment fields (`:65-66`), the `upsertLead` update
   branch (agency-only), task asserts and `getTasks` (no agency filter). Each
   with a regression test.
2. **Date and time resolution** in `BUSINESS_TZ` (`lib/today/constants.ts`) via
   `businessInstantMs` (`lib/today/time.ts`), deterministic, with a
   clarification turn when the date, time or duration is missing. The web form
   sends the browser time zone today (`MeetingFormDialog.tsx`); the agent path
   must not.
3. **Availability**:
   - CRM-only conflicts (overlapping rows in `meetings` for the organizer) need
     no new scope and can be built first.
   - Google free/busy needs a new OAuth scope (`calendar.freebusy` or
     `calendar.readonly`): **every connected user must re-consent**. Do not
     change the integration silently; until then the assistant may only say it
     checked the SocialCRM calendar, never "your calendar is free".
4. **Google sync from the agent path**: reuse `pushMeetingToGoogle`; report
   success only from the persisted row (`sync_status = synced`), never from the
   model.
5. **WhatsApp confirmation**: interactive reply buttons whose payload carries the
   `actionId` and a single-use token bound to `argsHash` and the recipient;
   decided through the existing approval path. A typed "כן" never approves
   (existing design). Needs a channel-agnostic variant of `decideOnAction`
   (today it is session-bound).
6. **Truthful confirmation message**: built from the Action Runtime's
   `ActionOutcome` and the re-read meeting row, never from the answer's prose.

## Tests required for Phase 2

Date parsing and DST edges; conflict detection (overlap, back-to-back, other
organizer, other agency); approval token replay, expiry, wrong recipient, wrong
args; Google failure leaves `pending` and says so; idempotent re-press; no write
for AGNT outside their leads; every refusal path sends no data.
