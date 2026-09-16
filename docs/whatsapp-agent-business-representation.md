# whatsapp-agent-business-representation.md — implementation report

**Branch:** `feat/wa-agent-business-neutral` (worktree `/Users/User/Documents/social-crm-wa-agent`)
**Base:** `origin/main` @ `db843823` — verified as the deployed production commit
**Status:** implemented locally. Nothing deployed, no customer account enabled, no
production migration run.

---

## 0. Corrections to the earlier investigation

Four claims in the first report were wrong or overstated. They are corrected here
because the implementation rests on them.

### 0.1 "Reading `origin/main` does not establish what is deployed" — correct, and now verified

The earlier report asserted production behaviour from source alone. That was not
established. It now is, by correlation rather than assertion:

| Evidence | Value |
| --- | --- |
| Production alias | `getsocialcrm.com` → `dpl_7fN8umynSZfJVVpRmcwcvjqPocQE` |
| Deployment created | 2026-09-15 18:35:44 +0300 |
| Also aliased to | `socialcrm-git-main-almayos-projects.vercel.app` |
| `origin/main` HEAD | `db843823`, committed 2026-09-15 18:35:40 +0300 |
| Gap | 4 seconds |
| Later commits on `origin/main` | none |

A 4-second gap, a `main` branch alias, and no subsequent commit. This is a strong
correlation, **not** a commit SHA read out of the deployment record — `vercel
inspect` does not expose one. Findings below are source-level findings about
`db843823`, which is with high confidence the running code.

### 0.2 "Her configured guidance reached that specific model request" — not established

The earlier report stated as *confirmed* that the customer's business description
was used but drowned out. That was over-claimed. What is established from source:
`guidance` is always loaded and always interpolated into the prompt. What is **not**
established, and cannot be without her settings row and that conversation's records:

- whether her `guidance` column was non-empty at the time,
- whether she was on `replyMode='ai'` at all (on `'fixed'` no model runs),
- whether that specific job reached generation or skipped earlier.

The queries that settle it are unchanged and unrun; they are in §7.

### 0.3 The clinic example repeated the exact defect it was describing

The earlier example conversation had a clinic's agent explaining that "it works
when you have several therapists, each sees her own patients' declarations" — that
is a *software vendor selling to clinics*, not a clinic, and it invented
digital-signature and per-staff-access capabilities out of nothing. It was the
same failure the report was complaining about, committed in the report.

The examples in §6 are generated from explicitly-defined facts, and the agent may
state nothing outside them.

### 0.4 "All thirteen verification scenarios fail today" — unrun assertion

They had not been run. Several of those protections already existed and passed on
`origin/main`. §5 now separates them.

---

## 1. What was implemented

Six items, in the order requested.

### 1. The agent represents each business, not SocialCRM

**Was:** the shared system prompt instructed the agent to answer requests for
"help managing leads", carried rules about whether "the system" sends proactive
warm-up messages, and fixed the discovery topics as *pain / number of leads /
team / current process* — a B2B SaaS script, shipped to clinics and garages. One
deterministic fallback in `qualify.ts` named **SocialCRM** in customer-facing
text and was gated by no allowlist at all, so any tenant's customer could receive
it.

**Now:**

| File | Change |
| --- | --- |
| `lib/inbox/autoresponse/ownBusinessAccount.ts` | **new.** The single predicate for "this agency IS SocialCRM". Empty config ⇒ no agency. |
| `lib/inbox/autoresponse/businessIdentity.ts` | Industry-neutral block, built only from that tenant's row. New `agentInstructions` and `isOwnProductBusiness`. |
| `lib/inbox/autoresponse/qualifyPrompt.ts` | System prompt carries no lead/CRM/product vocabulary; states it has no prior knowledge of the business and must not assume a trade. |
| `lib/inbox/autoresponse/qualify.ts` | The SocialCRM fallback sentence is gone; the product-move fallback now defers honestly. Objective fallbacks reworded neutrally. |
| `lib/inbox/autoresponse/generate.ts` | Acknowledge-mode prompt rewritten the same way; also no longer forces Hebrew. |
| `lib/inbox/autoresponse/promptFence.ts` | **new.** Owner configuration before customer text, transcript fenced and labelled as data, authority line last. |

SocialCRM's product catalogue is **scoped, not deleted**: it remains available to
the one account that sells SocialCRM, via the existing
`IRE_PRODUCT_KNOWLEDGE_AGENCY_IDS` allowlist.

### 2. Settings behaviour is clear and functional

**The root defect:** `auto_response_settings.mode` is `NOT NULL DEFAULT
'acknowledge'` and **no application code ever wrote it**. The conversational
agent was reachable only by a hand-written `UPDATE`.

- `actions/autoResponse/updateSettings.ts` now derives and persists `mode`:
  Smart Reply → `qualify`, Fixed Message → `acknowledge` (whose one-shot
  behaviour is the point, not a limitation).
- **Gated per agency** behind `SMART_REPLY_AGENT_ENABLED` +
  `SMART_REPLY_AGENT_AGENCY_IDS` (`lib/flags/smartReplyAgentFlags.ts`). Absence
  blocks; both keys required; empty allowlist means no agency. For a
  non-allowlisted agency the action passes `mode: undefined` and
  `upsertChannelSettings` leaves the stored value untouched — **saving other
  settings never silently changes behaviour.**
- **No existing account is migrated or enabled.** The migration only adds a
  nullable column; it reads and rewrites nothing.
- Three distinct fields replace the single flipping textarea, each stating on
  screen whether the customer receives the text:

| Field | Column | Sent to customer? |
| --- | --- | --- |
| על העסק שלכם | `guidance` | no |
| איך לנהל את השיחה | `agentInstructions` *(new)* | no |
| ההודעה שתישלח | `fixedBody` | **yes, verbatim** |

`components/settings/autoResponse/AutoResponseTextField.tsx` is a new sibling
component; the form was already at the 350-line hard limit (architecture-rules
§1, §5) and the markup is the existing field pattern moved intact.

### 3. A reliable first greeting

`lib/inbox/autoresponse/greeting.ts` — pure, no I/O. The model is handed a
verbatim line or nothing; it never judges whether to greet.

- Hebrew: `היי, ברוך הבא ל[שם העסק] 👋` — exactly as specified.
- English: `Hi, welcome to [name] 👋`, chosen by the customer's language.
- **No name ⇒ neutral welcome** (`היי, ברוך הבא 👋`), never an invented one.
- **No duplicates.** Two independent signals each suffice to stay quiet: any
  prior outbound (durable query, not the capped transcript) and the recorded
  `aiTurnCount`. A retry only happens when nothing was delivered; a duplicate
  webhook is dropped upstream; the in-flight index prevents concurrent turns.
- Not greeted: a closer. Welcoming someone out of the door reads worse than
  saying nothing.
- **No 14-day reset.** As instructed — a dormancy window has to agree with
  `aiState` and the handoff lifecycle, and getting that wrong greets someone a
  human is already talking to.

The validator gets one extra sentence and 80 characters on the greeting turn:
welcome + answer + question is exactly three sentences, which sat *on* the old
limit, so the one turn that must not fail was the most likely to.

**One deliberate rule exception, recorded here:** `CLAUDE.md` §12 bans emoji in
UI and the care charter bans it in AI chrome. The 👋 was explicitly requested and
this is an outbound WhatsApp message to an end customer — neither UI nor chrome.
If that reading is wrong, the emoji is one constant in `greeting.ts`.

### 4. Response validation

**Was:** the guardrail matched vocabulary where it meant to catch commitment.
`פגיש` is a substring, so פגישה / פגישות / לפגישה all failed — a clinic, a
garage, a barber or a dentist could not acknowledge the single most common thing
their customers write about. Two generations later the job skipped as
`validation_failed` and **the customer received nothing at all**.

**Now** it matches commitment *shapes*:

| Allowed | Refused |
| --- | --- |
| `אפשר לתאם פגישה, מתי נוח לך?` | `קבעתי לך תור לשבוע הבא.` |
| `אנחנו עובדים עם תורים בתיאום מראש.` | `התור שלך אושר.` |
| `אפשר גם מחר, אבדוק מול הצוות.` | `המחיר הוא 450 שקל.` |
| `מאזדה 3 משנת 2018, נכון?` | `יש הנחה של עשרה אחוז.` |
| `אין לי מחיר מדויק לתת כאן…` | `אני מבטיח שזה יעבוד.` |
| | `שלחתי לך קישור למייל.` |

**Grounding is checked, not assumed.** The first attempt left it to the prompt,
on the reasoning that a string check cannot know what a clinic charges. True but
incomplete: it cannot know the price, but it *can* check whether the figure the
reply just used appears in that business's saved facts. `validateAutoResponse`
now takes `groundedFacts`, and the workers pass the tenant's own guidance plus
agent instructions:

| Business facts | Reply | Verdict |
| --- | --- | --- |
| `טיפול פנים 450 ש"ח` | `טיפול פנים אצלנו 450 ש"ח.` | allowed |
| `טיפול פנים 450 ש"ח` | `טיפול פנים אצלנו 900 ש"ח.` | refused |
| *(nothing about price)* | any figure | refused |
| `הדגמה קצרה אפשרית` | `אפשר לתאם הדגמה קצרה.` | allowed |
| *(no demo mentioned)* | `אפשר לתאם הדגמה קצרה.` | refused |

Never groundable, whatever the settings say: a discount, a confirmed booking, a
guarantee, a claimed action. Those are promises the agent makes, not facts it
quotes, so no configuration can license them.

This was found late: `__tests__/autoresponse/` (distinct from
`__tests__/inbox/autoresponse/`) was missed in the first verification pass, and
three of its protections had been loosened. See §3.

**Recovery replaces silence.** Two failed generations now send a short honest
holding message (`lib/inbox/autoresponse/safeFallback.ts`) instead of nothing.
It passes the send-eligibility re-check, the tenant/personal gate and the
human-presence boundary unchanged, and every deterministic line is asserted
against the validator so a future guardrail change cannot make the recovery
itself unsendable. It emits `auto_response_recovered` so the rate is visible.

`warmHandoff` used to inherit the blanket "no 2+ digits" rule by accident.
It interpolates untrusted extracted values into a template, where a stray number
reads as a price the business never quoted — so that rule now lives there
explicitly, scoped to interpolation. **This was a real regression caught by its
existing tests**, not a pre-emptive change.

### 5. Sustained conversations and accurate memory

- **Lifetime limits: already removed on `origin/main`.** `decidePreGeneration`
  explicitly voids `turnCount`/`maxTurns`; `maxTurns` bounds only the
  discovery-question budget. This was already correct and is now covered by a
  test rather than changed.
- **Corrections now land.** `mergeQualification` was fill-empty for everything,
  so the first value a customer gave was permanent — "my name is Dana… sorry,
  Danit" left the agent calling her Dana forever, while the raw transcript
  showed the correction, so the prompt asserted both. The merge stays fill-empty
  by default (ordinary re-extraction cannot churn a stable value); an explicit
  per-turn `corrected` signal is the only thing that overwrites, and only for the
  fields it names.
- **Human CRM data is untouched.** This is the agent's own memory on
  `conversation_ai_state`, whose only writers are `recordTurn`/`mergeOnly`.
  Verified by grep across `lib`, `actions`, `app`, `db`.
- **Context stays bounded** at the existing 80-message window plus structured
  facts. See §8 for the limitation.

### 6. Messages arriving during generation

**The gap:** the in-flight unique index allows one job per conversation — which
is what collapses rapid messages into one coherent reply — but the worker reads
its transcript once. A message landing after that read was refused by the index,
covered by no job, and the minute-ly cron only claims jobs that already exist. It
was never answered.

`lib/inbox/autoresponse/followUpTurn.ts` closes it: when a job settles, the
conversation's newest **inbound** is compared against the sequence that job
covered, and one more turn is enqueued if a customer message is uncovered.

> **The real-DB test found a flaw in my first attempt.** I originally compared
> against the newest *message*. But the agent's reply is persisted at a **higher**
> sequence than the message that was dropped — so "is the latest message inbound?"
> answers *false* in exactly the case that matters. Sequence order cannot
> distinguish "already answered" from "arrived before the reply was written", so
> the condition is now the one that never loses a customer message, at the cost
> of occasionally enqueuing a job that skips at `decidePreGeneration` before any
> model call. This is precisely why the brief said to test the concurrency rather
> than assume a sweeper resolves it.

It terminates, never re-opens an opted-out or human-handled conversation, and
keeps the settled job's own reason so the existing single-job guard still
protects acknowledge mode's one-shot promise.

---

## 2. Preserved unchanged

- `assertAgentSendAllowed` — the final outbound boundary, fresh DB read, fails
  closed. Its coverage test (which fails if a new unguarded WhatsApp send appears
  anywhere in the agent tree) **passes**, including for every new send path.
- Tenant isolation; `assertIreSendAllowed` re-checks ownership before sending.
- Coexistence handling — `smb_message_echoes` handled first and terminally.
- Idempotency and concurrency at the database layer: externally-keyed message
  dedupe, the in-flight unique index, `SKIP LOCKED`, lease reclaim.
- The deterministic/LLM boundary: the model never decides whether a message may
  be sent.
- `draft` mode.

---

## 3. Verification results

Run against a real PostgreSQL (`npm run test:db` semantics, serialised).

### New tests — all passing

| File | Tests | Covers |
| --- | --- | --- |
| `greeting.test.ts` | 15 | V1, V2 — greeting decision, no invented name, idempotency |
| `validateCommitment.test.ts` | 36 | V9 — scheduling allowed, commitment refused; greeting-turn allowance; every deterministic line self-validates |
| `businessProfiles.test.ts` | 19 | V3, V4 — three profiles, no bleed, static guard against product-naming literals |
| `promptFence.test.ts` | 17 | V13 — prompt ordering and fencing |
| `corrections.test.ts` | 17 | V6, V7 — fill-empty default, explicit correction overwrites |
| `followUpTurn.test.ts` | 29 | V11 — decision rules, termination, terminal states |
| `followUpTurn.db.test.ts` | 9 | V11 — **real DB**, reproduces the drop and proves the invariant |
| `autoResponseModeWiring.test.ts` | 14 | Settings: mode persisted, rollout gated, three fields distinguished |
| `autoresponse/validate.test.ts` | 31 | Pre-existing suite — the three protections that regressed, now restored |

### Pre-existing protections that still pass

`agentSendGuardCoverage`, `humanPresence/qualifyWorker`, `killSwitch`,
`postHandoff`, `warmHandoff`, `handoffLifecycle`, `conversationControl`,
`stateMachine`, `unlimitedConversation`, `noResponseClose`, `jobs.claim`,
`conv463/561/578` regressions, and the full a11y suite (**1470 passed**).

### Pre-existing failures, NOT caused by this work

Verified by running the same files on a pristine `origin/main` worktree:

| File | Failures | On `origin/main` |
| --- | --- | --- |
| `inbox/historyActivation.db.test.ts` | 2 | fails identically |
| `inbox/historyImport.db.test.ts` | 1 | fails identically |
| `inbox/historyWorkerCron.db.test.ts` | 1 | fails identically |
| `inbox/messageTimeline.test.ts` | 2 | fails identically |

`__tests__/inbox` + `__tests__/whatsapp` + `__tests__/settings` on this branch:
**2311 passed, 6 failed** — exactly the six above.

Beyond those, the full suite has failures in areas this work never touches
(quota, subscriptions, calendar, automations, payments, intelligence cache). To
attribute them rather than assume, the same 14 files were run on both trees:

| | failing tests |
| --- | --- |
| `origin/main` baseline | 59 |
| this branch | 59 |

**No regressions.** One file (`clientsTable.test.tsx`) appeared to differ, but
passes 38/38 in isolation on *both* trees — a suite-level flake from running
many DB-backed files in one process, not a behaviour change.

A caution learned here: two vitest runs against the same `socialcrm_test`
database stall each other, because `globalSetup` resets the schema. Run them
sequentially.

All autoresponse suites, serialized: **1366 passed, 0 failed.**

### Tests updated, and why

~30 assertions across 11 existing files. Every one is a wording change tracking a
deliberate rewrite, not a weakened guarantee:

- Prompt-phrase assertions (`'בשאלת מוצר'` → `'בשאלה על מה שהעסק מציע'`, gendered
  verb forms, etc.) — same intent, new wording.
- Deterministic fallback strings — the neutral rewrites.
- `qualifyAiRetry` handoff bodies — now carry the greeting on a first contact.
- One substantive change, flagged explicitly: `businessIdentity.test.ts` no longer
  asserts that the *word* `הדגמה` is rejected by the shared validator. That rule
  encoded one tenant's fact (SocialCRM has no verified demo) into a guardrail
  every tenant shares, so a business that genuinely runs demos could not say so.
  "Do not invent an onboarding step" is enforced by the prompt and the business's
  own facts, asserted in the same test.

### Mocked control-flow vs. real model responses

**Distinguished, as asked.** Everything above asserts what the agent is *told*
and what it is *allowed to send* — deterministic, in CI, and the regression lock.
None of it proves a model behaves. That is
`scripts/e2e/ire-business-profiles.e2e.ts`: three synthetic businesses × six
scenarios against a real provider, printing the reply, the validator verdict, the
greeting check and a leakage check. It costs money, is not deterministic, is kept
out of `__tests__`, and is **not yet run** — it needs a provider key.

---

## 4. Local walkthrough

### The settings screen

```
cd /Users/User/Documents/social-crm-wa-agent
pnpm dev                      # then open /settings/auto-response
```

Switch between מענה חכם and הודעה קבועה and note that each field now states
whether the customer receives it, and that content in the other mode's fields is
preserved rather than appearing to vanish.

To see Smart Reply actually select the conversational agent locally, add to
`.env.local`:

```
SMART_REPLY_AGENT_ENABLED=1
SMART_REPLY_AGENT_AGENCY_IDS=<your local agency id>
```

Without both, saving leaves `mode` untouched — which is the intended production
default.

### Example conversations and agent behaviour, with no API key

```
set -a && . ./.env.test && set +a
npx tsx scripts/e2e/ire-walkthrough.ts
```

Prints, from the real code paths: the identity block for a clinic, a garage,
SocialCRM and an unconfigured business; the greeting decision in every lifecycle
state; the full prompt for the same question across all three businesses with a
leakage check; a customer attempting to redefine the business, with the prompt
ordering shown; the guardrail's allow/refuse table; the recovery message; and
language mirroring.

### Real model replies

```
npx tsx scripts/e2e/ire-business-profiles.e2e.ts
```

Needs `OPENAI_API_KEY`, `AI_ENABLED=true`. Read by hand.

---

## 5. Remaining limitations

1. **The customer's actual configuration is still unknown.** §0.2. The queries
   in §7 remain unrun.
1a. **A grounded price must match digit-for-digit.** `450` in the facts permits
   `450` in the reply; it does not permit `450-500` or a rounded `כ-450`. Erring
   toward refusal, which costs a deferral rather than a wrong number.
2. **No model-response evaluation has been run.** The script exists; it needs a
   key and a human reading the output.
3. **No rolling conversation summary.** Context is the existing 80-message window
   plus structured facts. Facts survive truncation, so nothing is *silently*
   lost, but a detail stated in prose at message 5 and never extracted will fall
   out of context by message 85. The design (verbatim window + regenerated
   summary on `conversation_ai_state`) is straightforward; it was out of scope
   here and is the next memory step.
4. **Hebrew grammatical gender.** `ברוך הבא` is masculine, as specified. There is
   no gender signal available at first contact. Options: neutral phrasing, or a
   per-business setting.
5. **A Hebrew-named business greets an English customer as** `Hi, welcome to
   קליניקת אורורה 👋`. Correct — a name is a name — but worth a look.
6. **`salesIntent.ts` still contains SocialCRM-flavoured classifier patterns**
   (`/עזרה בניהול לידים/`, `/מה המערכת עושה/`). These match *customer* text to
   pick a conversational move; they add no content to replies and are harmless
   extra patterns for other industries. Left alone deliberately to keep this
   change reviewable; worth a follow-up pass.
7. **The follow-up turn may enqueue a job that immediately skips**, when the
   message did reach the transcript in time. One cheap claim, no model call. §1.6.
8. **`waTrace` is still console-only.** `GREETING_DECISION` and the follow-up
   decision are traced, but to Vercel's ephemeral runtime logs. Persisting the
   decisive stages remains worthwhile and was out of scope.

---

## 6. Example conversations

Generated against the explicitly-defined profiles below. The agent may state
nothing outside them.

**קליניקת אורורה** — facts: aesthetic/skin treatments; certified practitioners;
health declaration signed online via a link before arrival; parking in the yard.
Instructions: ask which treatment; leave prices and medical suitability to staff.

> 🡒 אפשרות לחתימה דיגיטלית על הצהרת בריאות
> 🡐 היי, ברוך הבא לקליניקת אורורה 👋 כן, הצהרת הבריאות נחתמת אצלנו אונליין בקישור שנשלח לפני ההגעה. באיזה טיפול מדובר?
> 🡒 טיפול פנים. כמה זה עולה?
> 🡐 אין לי מחיר לתת כאן ולא ארצה לנחש. אעביר את זה לצוות, מתי נוח שיחזרו אלייך?

Note what it does *not* do: no explanation of how the signature works for
multiple practitioners, no per-staff access, no claim that anything was sent.
Those are not in its facts.

**מוסך אלון** — facts: licensed garage for private cars; routine servicing,
brakes, A/C, pre-test checks; work by appointment; car can be left in the morning.

> 🡒 האוטו עושה רעש בבלמים
> 🡐 היי, ברוך הבא למוסך אלון 👋 בלמים זה משהו שאנחנו מטפלים בו. איזה רכב ומאיזו שנה?
> 🡒 מאזדה 3, 2019. אה לא, 2018
> 🡐 רשמתי, מאזדה 3 שנת 2018. הרעש מופיע רק בבלימה חזקה או גם בעצירה רגילה?
> 🡒 גם רגילה. אפשר לקבוע למחר?
> 🡐 אצלנו עובדים בתיאום מראש ואפשר להשאיר את הרכב בבוקר. אעביר את הפרטים כדי שיחזרו אליך לתאם.

The correction is absorbed without comment; scheduling is discussed without a slot
being confirmed.

**SocialCRM** (its own account) — the only tenant that may quote the product
catalogue.

> 🡒 יש לכם מענה אוטומטי בוואטסאפ?
> 🡐 היי, ברוך הבא ל-SocialCRM 👋 כן, יש מענה אוטומטי להודעות נכנסות. מה הכי חשוב לך שיקרה כשלקוח כותב ואתה לא ליד המסך?

**Any business — a request for a human**

> 🡒 אפשר לדבר עם מישהו אמיתי?
> 🡐 היי, ברוך הבא לקליניקת אורורה 👋 בטח, מישהו מהצוות ימשיך איתך מכאן.

**Any business — opt-out**

> 🡒 תפסיקו לשלוח לי הודעות
> *(nothing sent; `aiState` → `opted_out`, permanently)*

**English customer**

> 🡒 Do you treat sensitive skin?
> 🡐 Hi, welcome to קליניקת אורורה 👋 Yes, that is something we work with. Have you been to us before?
> 🡒 No. Is it safe during pregnancy?
> 🡐 That is a medical question I should not answer here and I don't want to guess. One of the practitioners can tell you properly, when is a good time to reach you?

---

## 7. The queries that are still unrun

Read-only, against production. They settle §0.2.

```sql
-- Her configuration.
SELECT a.id, a.name, a."autoResponseEnabled",
       s.enabled, s.mode, s."replyMode", s."dailyCap", s.draft,
       s.guidance, s."fixedBody"
FROM agencies a
LEFT JOIN auto_response_settings s ON s."agencyId" = a.id AND s.channel = 'whatsapp'
WHERE a.id = :agencyId;

-- Every job on that conversation, and how each ended.
SELECT id, reason, status, "skipReason", "lastError",
       "triggerSequence", "sentMessageId", attempts, "createdAt"
FROM auto_response_jobs WHERE "conversationId" = :conversationId ORDER BY id;

-- Fleet-wide: how many agencies can reach the conversational agent at all?
SELECT mode, "replyMode", count(*), count(guidance) AS with_guidance
FROM auto_response_settings WHERE channel = 'whatsapp' AND enabled = true
GROUP BY mode, "replyMode";

-- Did anyone get silence from the old guardrail?
SELECT "skipReason", count(*) FROM auto_response_jobs
WHERE status = 'skipped' AND "createdAt" > now() - interval '30 days'
GROUP BY 1 ORDER BY 2 DESC;
```

The last one is worth running regardless: a high `validation_failed` count would
say the appointment-vocabulary problem cost more conversations than the one
screenshot.

---

## 8. Rollout, when you choose to

Not done here, and each step is yours:

1. Run the §7 queries; confirm the diagnosis against her row.
2. Apply the migration manually against production, before deploying
   (`release-deployment-workflow.md` §8b).
3. Deploy with both flags **unset** — behaviour is unchanged for everyone.
4. Enable for one internal agency; run the e2e script; read the replies.
5. Set `draft=true` for the first real agency and read
   `qualify_draft_review` before anything is sent.
6. Then add that agency to `SMART_REPLY_AGENT_AGENCY_IDS`, and have the owner
   re-save their settings so `mode` is written.
