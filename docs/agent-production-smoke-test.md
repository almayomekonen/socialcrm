# SocialCRM Agent: Production smoke test

For whoever runs the check after a deployment. It shows that an ordinary customer
account, not the founder's, can use each Agent capability in Production.

**Automated tests do not count as this check.** Report a capability as verified
only after it was exercised here and the database row was read back.

## Before starting: what must be approved

The WhatsApp assistant can only be exercised by a real person messaging the
SocialCRM number from their own phone. So this test needs explicit approval for:

1. **The account:** a named non-founder agency whose owner agreed to this test.
   Agency 103 / user 332 does not qualify.
2. **The phone:** that owner sends the messages and taps the buttons themselves.
   Nobody messages them unprompted, and nothing is sent on their behalf.

Ask the owner to send the first message, because Meta's 24-hour window only opens
when they write to the number.

## Hard limits

- No message goes to any lead or customer. Use only the test lead below, with no
  real phone number.
- Google Calendar should not be connected for this test. If it is, use an event
  with no attendees.
- Do not buy credits or save a card. Do not change any `CREDITS_*` variable.
- Do not run any step against a real lead or a real appointment.

## Preparation

Create one lead in that agency from the normal SocialCRM screen:

- Name: `בדיקה מערכת`
- Phone: leave empty, or use a number the owner confirms is theirs
- Status: `חדש`

Confirm the reminder consent, read-only, because a reminder needs consent v5:

```sql
SELECT status, "consentTextVersion" FROM owner_whatsapp_recipients WHERE "agencyId" = :agency;
```

If it is not on v5, the owner has to accept the current consent over WhatsApp
first. Do not change it by hand.

Record `agent_requests` for the agency before starting, to confirm counting at the end:

```sql
SELECT count(*) FROM agent_requests WHERE "agencyId" = :agency AND "periodKey" = to_char(now(), 'YYYY-MM');
```

## Steps

Send each message in order. After each approval card, tap the approve button.

| # | Capability | Owner sends | Expected reply | Confirm in the database |
| --- | --- | --- | --- | --- |
| 1 | Create task | `תיצור משימה לבדיקה מערכת להתקשר מחר` | Card, then "המשימה נוצרה" | `tasks` row on the test lead |
| 2 | Edit task | `תעביר את המשימה של בדיקה מערכת למחרתיים` | Card showing old and new date | `tasks."dueDate"` moved, title unchanged |
| 3 | Complete task | `תסמן שהמשימה של בדיקה מערכת בוצעה` | Card, then "המשימה סומנה כבוצעה" | `tasks.completed = true` |
| 4 | Create appointment | `תקבע פגישה עם בדיקה מערכת מחר ב-10:00` | Card, then "הפגישה נקבעה" | `meetings` row, `status = 'scheduled'` |
| 5 | Appointment lookup | `מה הפגישות שלי מחר?` | The appointment from step 4 | No write |
| 6 | Move appointment | `תזיז את הפגישה עם בדיקה מערכת למחר ב-11:00` | Card showing old and new time | `meetings.start_at` moved, same length |
| 7 | Cancel appointment | `תבטל את הפגישה עם בדיקה מערכת` | Card with "להשאיר את הפגישה", then "הפגישה בוטלה" | `meetings.status = 'cancelled'` |
| 8 | Status update | `תעביר את בדיקה מערכת לסטטוס מעוניין` | Card, then confirmation | `clients.status = 'interested'` |
| 9 | Note | `תרשום אצל בדיקה מערכת שזו בדיקה` | Card, then confirmation | New `lead_notes` row |
| 10 | Reminder (consent v5) | `בעוד שעה תזכיר לי לבדוק את המערכת` | Card, then confirmation | `owner_personal_reminders` row, `scheduled` |

Steps 2, 3, 6 and 7 exist only after the record-changes work is deployed.

Also check, once each:

- **Rejecting:** repeat step 3 on a new task and tap "ביטול". Nothing changes.
- **Ambiguity:** create two tasks on the test lead, then send step 3. The assistant lists both and asks which.

## Reading back

```sql
SELECT "actionType", "executionState", "createdAt" FROM agent_actions
WHERE "agencyId" = :agency ORDER BY "createdAt" DESC LIMIT 20;

SELECT tier, source, "operationKind", "settledAt" FROM agent_requests
WHERE "agencyId" = :agency ORDER BY id DESC LIMIT 20;
```

Each step should show one action, and one counted request per typed message. A
tap on a card is not a request.

## Cleanup

From the normal SocialCRM screens, delete the test lead's tasks, the test lead,
and any reminder still scheduled ("מה התזכורות שלי" and then cancel). Leave
`agent_actions` and `agent_requests` as they are: they are the audit record.

## Reporting

For each step record the account, the time, the reply received and the row read
back. Mark a step not run rather than leaving it out.
