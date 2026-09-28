# WhatsApp deterministic questionnaire

A business can answer inbound WhatsApp with a fixed questionnaire instead of the
AI agent: a welcome, its services as a numbered menu, one question at a time,
and a handoff to a נציג with the answers written up. No model is involved at any
point, by construction rather than by policy.

Status: **built, off everywhere, never enabled for a live business.**

---

## 1. What it is

- One questionnaire per business, per channel. Configured by SocialCRM staff.
- Hebrew numbered text menus. Multi-select (`1,3`) and one level of conditional
  question are supported.
- Answers are stored per conversation, shown in the inbox banner, and written as
  a note on the lead's WhatsApp task.
- The rep is told through the existing notification engine
  (`lead.questionnaire_handoff`).

## 2. Feature flags

| Flag | Default | Effect |
| --- | --- | --- |
| `WA_QUESTIONNAIRE_ENABLED` | unset | Master switch. Anything other than `1` means the questionnaire never speaks. |
| `WA_QUESTIONNAIRE_AGENCY_IDS` | unset | Comma-separated agency ids, or `all`. Empty means **no** agency. |
| `WA_QUESTIONNAIRE_INTERACTIVE_AGENCY_IDS` | unset | Tap-to-select (reply buttons / list) for these agency ids, or `all`. Empty means **no** agency: every question is numbered text, as before. Requires the two flags above. |

Absence blocks, in two deliberate steps, exactly like `WA_CONTACTS_*` and
`SMART_REPLY_AGENT_*`. Both are read per call, so a change takes effect on the
next deployment with no other coordination.

**The flags do not decide routing.** Which worker owns a job is decided by the
stored configuration (`db/questionnaireJobs.ts`). If the flag is pulled from a
business that is configured for the questionnaire, its jobs still go to the
questionnaire worker — which then stays silent and hands the conversation to a
person. Pulling a flag can never hand a conversation to the AI agent.

## 3. Configuration (staff)

```bash
# 1. validate and see every message the customer would receive. Writes nothing.
pnpm mig questionnaire/configure.ts -- --agency 123 \
  --file scripts/questionnaire/samples/event-photography.he.json --dry-run

# 2. store it and switch the business over
pnpm mig questionnaire/configure.ts -- --agency 123 \
  --file scripts/questionnaire/samples/event-photography.he.json --enable

# 3. inspect what is stored
pnpm mig questionnaire/configure.ts -- --agency 123 --show

# 4. switch back to the agent
pnpm mig questionnaire/configure.ts -- --agency 123 --disable
```

The business needs an existing `auto_response_settings` row for `whatsapp` (the
owner saves Auto Response settings once). The script refuses to create one,
because that row carries the owner's own switches.

### The definition

See `scripts/questionnaire/samples/event-photography.he.json`. Validated by zod
on write **and** on read; an invalid definition silences the questionnaire and is
never worked around by falling back to the agent.

Limits are Meta's current interactive-message limits, applied now so a later
upgrade from text menus to interactive lists needs no config rewrite: at most 10
options per question, option labels at most 24 characters, at most 12 steps.
Customer-facing text may not contain a dash, because the send path rewrites
dashes into commas.

`when: { step, anyOf }` makes a question conditional on an earlier choice.

## 4. Everything that must be true before a customer sees anything

1. `WA_QUESTIONNAIRE_ENABLED=1`
2. the agency id in `WA_QUESTIONNAIRE_AGENCY_IDS`
3. `auto_response_settings.responder = 'questionnaire'` with a valid definition
4. `agencies.autoResponseEnabled = true` — the owner's master switch
5. `auto_response_settings.enabled = true` for `whatsapp`

Any one of them missing means silence, never an AI reply.

## 5. Local development

```bash
# .env.local
WA_QUESTIONNAIRE_ENABLED=1
WA_QUESTIONNAIRE_AGENCY_IDS=<your local agency id>
```

Then configure a definition with the script against your local database and send
yourself messages, or run the suites below, which exercise the whole path with
the Graph call injected:

```bash
pnpm exec vitest run __tests__/inbox/questionnaire --no-file-parallelism
```

## 6. How it behaves

| Situation | Behaviour |
| --- | --- |
| First message on a fresh conversation | Welcome + first menu + how to reach a person. |
| A readable answer | Next question; conditional questions are skipped when they do not apply. |
| An unreadable answer | The same question again, with a plain reason. After `maxInvalidAttempts` (default 2), handoff to a person. |
| Photo, file, location, interactive reply | A request to answer in text. Counts toward the invalid limit. |
| Voice note | Says it cannot listen, asks for text. Nothing is transcribed. |
| Reaction, or an unknown type | Consumed silently. |
| "נציג" / "תעבירו אותי" | Handoff, with the partial answers. |
| "תפסיקו" / STOP | Silent stop, `opted_out`, permanent. |
| "התחלה מחדש" | Starts over; previous answers are cleared. |
| Several messages before we reply | One question. Newest valid selection wins; free text is joined in order. |
| Rep replies, or presses "אני עונה מכאן" | The questionnaire stops for good on that conversation. |
| Customer returns after `expireAfterHours` (default 24) | Handoff with the partial answers. No nudge is ever sent. |
| Messages after it finished | Silence. The rep owns the conversation. |
| Conversation with earlier history when the feature is switched on | Not eligible. It stays human-handled and gets no automation. |
| The business is switched back to the agent mid-conversation | Handoff with the partial answers. Never continued by the AI. |
| The definition changes mid-conversation | No effect: the session runs on the copy it froze when it started. |
| Outside the 24h window | Nothing is sent, and no template is ever sent. Answers are still saved. |

## 7. Delivery honesty

This is **not** exactly-once delivery, and nothing in the code claims it is.

- A question advances the session only after its message is recorded as sent.
- A terminal turn (completed, handed off, opted out) saves first and sends
  afterwards, so answers survive a failed closing message.
- Each turn carries a key (`metadata.questionnaireTurnKey`). A retry that finds
  the key skips the send and finishes the commit instead of asking twice.
- The Graph call has a 20s timeout, shorter than the 60s job lease.
- **An ambiguous outcome (timeout, dropped connection) is never retried.** The
  session is parked as `needs_review`, the answers are saved, and the
  conversation is handed to a person. A duplicate message and a silent stall are
  both worse than asking a human to look.

## 8. Cost

- **Model calls: none.** The questionnaire tree cannot import the AI router —
  `__tests__/inbox/questionnaire/noLlm.test.ts` walks the whole import graph and
  fails the build if it ever can. Copilot conversation-analysis jobs are also
  suppressed for these conversations, at every site that creates one. The rest of
  the agency's AI is untouched.
- **WhatsApp:** every message is a free-form reply inside an open 24-hour
  customer-service window, which Meta does not charge for under per-message
  pricing. No templates are sent.
- **Infrastructure:** no new cron. The existing minute-ly drain and the webhook
  kick run both workers.

## 9. Rollback

In order, fastest first:

1. **The owner's switch**, or `auto_response_settings.enabled = false`. Stops
   every automatic reply immediately, no deployment.
2. `configure.ts --disable`. New conversations go back to the agent; live
   sessions are handed to a rep on their next turn.
3. Remove the agency from `WA_QUESTIONNAIRE_AGENCY_IDS` (needs a deployment).
4. **Code rollback — do step 1 or 2 FIRST.** Older code does not know the
   `responder` column, so its claim has no questionnaire predicate and the
   agency's jobs would go to the AI worker.
5. `migrations/20260924120000_whatsapp_questionnaire.cjs` has a `down()`. Run it
   only after the code rollback, and export `questionnaire_sessions` first: it
   drops the table.

## 10. Verification checklist

- [ ] `npx tsc --noEmit` clean
- [ ] `pnpm exec vitest run __tests__/inbox/questionnaire --no-file-parallelism`
- [ ] `pnpm run test:a11y`
- [ ] `questionnaire_sessions` has a row with the expected answers
- [ ] the inbox banner shows the answers and "ממתין לטיפול נציג"
- [ ] the lead's task carries the summary note
- [ ] `SELECT count(*) FROM conversation_analysis_jobs WHERE "conversationId" = …` is 0
- [ ] `SELECT count(*) FROM ai_runs WHERE "agencyId" = … AND "createdAt" > <enable time>` is 0
- [ ] the settings page shows the read-only questionnaire notice

## Where the code lives

| Concern | File |
| --- | --- |
| Definition + validation | `lib/inbox/autoresponse/questionnaire/definition.ts` |
| Reading the customer's reply | `…/parseAnswer.ts` |
| The state machine | `…/transition.ts` |
| All customer-facing copy | `…/render.ts` |
| One turn, start to finish | `…/processJob.ts` |
| State + summary writes | `…/effects.ts`, `…/handoffEffects.ts` |
| The drain | `…/worker.ts` |
| Routing predicate | `db/questionnaireJobs.ts` |
| Session storage | `db/questionnaireSessions.ts` |
| Rollout gate | `lib/flags/whatsappQuestionnaireFlags.ts` |
| Staff configuration | `scripts/questionnaire/configure.ts` |
