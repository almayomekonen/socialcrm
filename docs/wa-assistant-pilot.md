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
   recipient, user, agency, **assistant consent (v3/v4)**, Agent rollout and product
   access re-checked from the database (fail closed) → limits → typing indicator → Agent (read tools only,
   no web research, 5 steps, 35s, last 3 exchanges as context) → one reply.
4. **Reply** (`lib/whatsapp/platform/sendText.ts`): `sending` is committed before
   the call; an unknown outcome is never resent.

## Safeguards

- Identity: Meta's signed `from` + a recipient row proven by code from the
  owner's own phone. Ambiguous numbers (verified for several accounts) are
  refused. Strangers, inactive or opted-out recipients, suspended users, other
  agencies: nothing queued, nothing sent.
- Consent: only a row whose current consent is the assistant's own (v3 or v4)
  is answered; see "Consent" below. Reminder-only consent (v2) never counts.
- Tenant isolation: the Agent scope is rebuilt per turn from the recipient row
  (same construction as `lib/ai/integration/autonomousScope.ts`); tools close
  over it; the model never supplies an agency or user.
- Limits: 20 messages per sender per hour, 200 per agency per day, durable
  per-agency spend per UTC day (`WA_ASSISTANT_DAILY_USD_CAP`, default 2 USD).
  Only the first message over a count limit gets a "limit" reply.
- Memory: `wa_assistant_jobs` keeps the question + answer headline only (last 3
  exchanges are used as context); that text is cleared 24 hours after the
  message, and the headline is redacted before it is stored.
- Retention: every turn ALSO writes the Agent's own `agent_investigations`
  record, exactly as the web Agent does. It keeps the question and the full
  validated answer **indefinitely** and **unredacted** (redaction applies only to
  the WhatsApp reply). It is not shown in any UI.
- Audit: analytics event `wa_assistant_turn` (ids, outcome, timing, cost; never
  text).
- No writes: no Action Runtime call exists on this path.

## Consent (conversations with the assistant)

The owner consents in **Settings → תזכורות בוואטסאפ** (`app/(app)/settings/(user_settings)/whatsapp_reminders/page.tsx`,
`components/settings/whatsappReminders/WhatsappReminderCard.tsx`). The recorded
consent is the row's `owner_whatsapp_recipients.consentTextVersion` (+ `consentAt`,
`consentSource='settings'`); texts and versions live in
`lib/whatsapp/platform/consentText.ts`. No schema change.

| Version | Covers | Recorded when |
|---|---|---|
| `v2` | reminders only | activation in an agency **without** the assistant; or after withdrawing the assistant |
| `v4` (current) | reminders **and** conversations with the assistant; states that it reads **only** the business the number is connected to, and only what the owner's role permits | activation in an agency **with** the assistant (`WA_ASSISTANT_AGENCY_IDS`); or "אישור שיחות עם העוזר" on an already verified number |
| `v3` | the same, earlier wording (live 2026-11-01) | no longer recorded; existing v3 rows stay valid and are never rewritten (`ASSISTANT_CONSENT_VERSIONS`) |

- The page shows the current assistant text (v4) where the assistant is enabled for the agency and v2
  elsewhere; the action records a consent only for the version the page showed
  (`consentVersion`), otherwise "נוסח ההסכמה התעדכן".
- **Enforcement**: `resolveAssistantScope` (every turn, before anything is read)
  refuses a row without an assistant consent (v3 or v4) with `consent_required`: no Agent run, one fixed reply
  (`COPY.consentRequired`, no CRM data) pointing to settings. Applies to turns
  queued before a withdrawal too.
- **Existing rows are v2**: nothing upgrades them. The pilot owner (agency 103)
  must tick the assistant consent once in settings after this ships; until then the
  assistant answers only with the consent reply.
- **Revoking**: "ביטול השיחות עם העוזר" (`withdrawWhatsappAssistantConsent`)
  records v2 again: reminders stay on, the assistant stops. "כיבוי תזכורות" or
  "הסר" to the platform number stop both (unchanged opt-out).
- Tests: `__tests__/waAssistant/consent.db.test.ts`, `consentCard.test.tsx`.

## Configuration (Production only, each change its own approval)

| Variable | Pilot value | Notes |
|---|---|---|
| `WA_ASSISTANT_AGENCY_IDS` | `103` | Absent = off. `all` is ignored |
| `WA_ASSISTANT_DAILY_USD_CAP` | optional | Default 2 |
| `WA_ASSISTANT_MEETINGS_AGENCY_IDS` | `103` (when approved) | Absent = read-only. Lets the assistant create meetings (below). Needs `WA_ASSISTANT_AGENCY_IDS` too |
| `WA_ASSISTANT_TASKS_AGENCY_IDS` | absent | Absent = no tasks/follow-ups. Lets the assistant create tasks and follow-ups (below). Needs the assistant itself too |
| `AGENT_AGENCY_IDS`, `AI_ENABLED` | must include 103 | The Agent rollout the assistant reuses |
| Platform number + token | existing | Same as owner reminders |

Migrations (additive; apply manually before the deploy, per
`claude/release-deployment-workflow.md` §8b): `20261019120000_wa_assistant_jobs.cjs`
(applied in Production, batch 58) and `20261020120000_wa_assistant_approvals.cjs`
(meetings; not yet applied).

## Release blockers (resolve before ANY Production deployment of this branch)

1. **Owner reminders stay a dry run**: `OWNER_WA_REMINDERS_SEND_ENABLED` was
   removed from Production on 2026-10-19. Turning real sending on is its own
   decision; never re-add it as part of an assistant deploy.
2. **Which number is the platform sender** (WABA `2060714354527399`): confirmed
   by the owner as 054-922-1572.
3. **Consent text**: implemented, currently v4 (above). Before adding customer
   agencies, the v4 wording needs the owner's (and, if required, legal) approval;
   any wording change bumps the version.
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

# Meetings from WhatsApp: "תקבע לי עם Itamar Am מחר ב-10:00"

**Status: built, behind `WA_ASSISTANT_MEETINGS_AGENCY_IDS` (absent = off).** Not
yet enabled anywhere. The demo at `/admin/whatsapp/assistant-demo` is still a
labelled simulation.

## How it works

1. **Proposal** (`lib/waAssistant/meetings/propose.ts`). The existing Agent
   returns a `create_meeting` proposal (lead resolved by `find_lead`, grounded in
   evidence). Nothing is created. In order:
   - the date and time are read **deterministically** from the owner's own words
     (`meetings/when.ts`, Asia/Jerusalem, DST-safe) and must equal the Agent's
     arguments. A missing, ambiguous (a bare hour 1-7, two dates, a weekday
     equal to today without "הבא"), past or mismatched value gets a short
     question instead. The answer completes the same request (15-minute window);
   - the lead must be readable by this user (agency, plus rep visibility for
     non-admins), the same bound the executor enforces;
   - the slot must be free among the organizer's **SocialCRM** meetings; on a
     conflict, up to two free slots that day (08:00-20:00) are offered;
   - `submitProposedAction` records the action as **AWAITING_APPROVAL**. It is
     submitted without the owner's words, so the runtime treats it as an agent
     proposal and **always** requires approval, however it was phrased;
   - a card with **"לאשר ולקבוע" / "ביטול"** buttons is sent. Each button carries
     an opaque single-use token (`wa_assistant_approvals`) bound to this
     recipient, this action id and its `argsHash`, expiring in 15 minutes. A new
     card supersedes the previous one.
2. **Decision** (`lib/waAssistant/meetings/decide.ts`), when a button is tapped:
   - the token must belong to the tapping phone's recipient, be pending and
     unexpired, and match the stored action's `argsHash`. It is consumed in one
     guarded statement, so a replay does nothing;
   - availability is re-checked, and a new conflict cancels the action;
   - the decision goes through the existing `decideOnAction`: rollout re-check,
     proposer-only, `argsHash`, the runtime's claim and lock (no duplicates),
     the executor's agency and rep check, and verification against the
     persisted row;
   - after a **verified** meeting only, it is pushed to Google **once**, without
     attendees (no invitation is sent), with a 15-second budget. Google's insert
     has no idempotency key, so it is never retried; an ambiguous push is
     reported as unconfirmed;
   - the reply is built from the **re-read meeting row** and its real sync
     state: date, time, lead, and whether Google has it.
3. A typed "כן" while a card is open **never** approves; the owner is pointed at
   the button.

Nothing in this path sends anything to the customer. As with a meeting booked
by hand, creating the row emits the existing `appointment_booked` automation
event, which runs whatever appointment automations the agency has configured.

## Google Calendar: what is and is not read

- **Write:** the existing connection (`calendar.events`) suffices for the
  one-time push. The organizer's own Google connection is used; when it is not
  connected, the meeting is saved in SocialCRM only and the reply says so.
- **Availability:** **not read from Google.** Free/busy needs `calendar.freebusy`
  (minimal) or `calendar.readonly`, so **every connected user would have to
  re-consent** in `app/api/auth/google-calendar/route.ts`. Until that is
  separately approved and built, every message says availability was checked
  against SocialCRM only.

## Rollout (each step its own approval)

1. Apply `20261020120000_wa_assistant_approvals.cjs` in Production
   (`migrate:list` must show only it), then deploy.
2. Set `WA_ASSISTANT_MEETINGS_AGENCY_IDS=103` and redeploy. Do not touch
   reminder variables.
3. From the verified 103 phone, using a **test lead** (not a real customer):
   "תקבע לי עם <test lead> מחר ב-10:00" → card → "ביטול" → nothing created.
   Repeat → "לאשר ולקבוע" → one meeting in `/calendar`, the reply matches the
   row, and the Google line is truthful.
4. Check read-only: `wa_assistant_approvals` (status), `agent_actions`
   (`executionState`, `verificationState`), `meetings` (one row, `sync_status`).
5. **Before step 3**, check the agency's `appointment_booked` automations. They
   fire as for any booked meeting and can message the LEAD. Production has the
   automation engine configured (`AUTOMATIONS_ENABLED`,
   `AUTOMATIONS_AGENCY_ALLOWLIST`, `AUTOMATIONS_SEND_MODE`). Read-only:
   ```sql
   SELECT id, name, status, "activatedAt", action
   FROM automation_definitions
   WHERE "agencyId" = 103 AND "trigger" = 'appointment_booked' AND "deletedAt" IS NULL;
   ```
   If any row is active, the test lead must be one whose contact details reach
   only you, or the automation should be paused for the test.

**Rollback:** remove `WA_ASSISTANT_MEETINGS_AGENCY_IDS` and redeploy. The
assistant is read-only again, and open cards get "not available". Created
meetings remain normal SocialCRM meetings. The migration's `down` drops the
approvals table and restores the job-kind constraint.

# Tasks and follow-ups from WhatsApp

**Status: built, behind `WA_ASSISTANT_TASKS_AGENCY_IDS` (absent = off).**

"תזכיר לי לחזור לדני מחר", "תפתח משימת מעקב לליד הזה", "תחזור למיכל ביום ראשון
הבא", "תזכיר לי לבדוק את ההצעה בעוד שלושה ימים":

1. **Proposal** (`lib/waAssistant/tasks/propose.ts`): the existing Agent returns a
   `create_task` or `create_follow_up` proposal. A request may span several
   messages ("תיצור לי משימה" → "Oren kakun" → "לשעה 12:00 להתקשר לאורן" →
   "מחר"): the owner's messages that our (or the Agent's) clarifying questions
   answered, within 15 minutes of each other, are read as ONE request
   (`tasks/draft.ts`), the newest mention of each detail winning. The day and
   time come from the owner's words (`meetings/when.ts`), never the Agent's
   arithmetic; "task" / "follow-up" in their words wins over the Agent's
   choice. If the Agent's reads produced several readable leads, the one whose
   full name the owner wrote is taken, otherwise they are asked which (never
   picked). The lead must be readable by this user (agency + rep visibility).
   A missing or unclear detail gets ONE short question ("לאיזה יום?", "ב-4
   בבוקר או אחר הצהריים?"); what is already known is carried in the stored
   headline so the next turn continues. **Time of day:** tasks and follow-ups
   store a date only, so a time is appended to the task title / follow-up note
   ("להתקשר לאורן בשעה 12:00") and shown on the card next to the day; the date
   stays date-only. Then `submitProposedAction` records it as
   AWAITING_APPROVAL and a card is sent ("לאשר וליצור" / "לאשר ולקבוע" /
   "ביטול"), bound to a single-use, recipient-bound, 15-minute token.
2. **Decision** (`lib/waAssistant/decideCard.ts` → `tasks/decide.ts`): the token
   is consumed in one guarded statement (replay, expiry, supersession and
   another phone do nothing), then the existing `decideOnAction` runs the
   `create_task` / `create_follow_up` executors (agency + rep visibility,
   verification against the persisted row). Turning the flag off, withdrawing
   consent, suspension or losing access to the lead between card and tap
   creates nothing.
3. **Task authorization fixes** (user-facing, `lib/tasks/taskAccess.ts`): task
   update/delete/create asserts now require agency AND role (a rep acts only on
   leads owned or created by reps they have permission for); `getTasks` filters
   by the user's agency.

Tests: `__tests__/waAssistant/tasks.db.test.ts`, `__tests__/tasks/taskAccess.db.test.ts`,
`__tests__/waAssistant/taskDraft.test.ts`, relative dates in `__tests__/waAssistant/meetingWhen.test.ts`.

## Next phases (not built)

- **Phase 2, more actions**, each behind the same card and after an
  authorization audit. Known gaps to fix first: `transferLeadToRep`
  (`actions/clients.ts:600`, no admin or recipient-agency check), `updateLead`
  reassignment fields (`:65-66`), the `upsertLead` update branch (agency-only),
  task asserts and `getTasks` (no agency filter). Tasks and follow-ups are built (above). Customer messages must stay on supported, consent-compliant
  channels, with their own confirmation.
- **Phase 3, proactive**: surface overdue follow-ups and unhandled leads with a
  card offering the next action. Pre-authorized routine actions only within
  explicit, configurable limits, all through the same runtime and audit trail.
  No unrestricted autonomy.
