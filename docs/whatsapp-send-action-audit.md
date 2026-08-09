# whatsapp-send-action-audit.md — Architecture Audit before `whatsapp.send`

**Status:** technical audit. No code, no schema, no migrations. Decision input.
**Question:** what already exists, and what is the correct architecture for an automation action
that sends WhatsApp?
**Method:** read at `origin/main` (`e17bb081`). Every claim below cites a file. Where I found
something the strategy document got wrong, it is corrected here.

---

## 0. Executive answer

Far more exists than expected, and it changes both the estimate and the product shape.

1. **Sending is already a clean, reusable service layer.** `sendWhatsappText` and
   `sendWhatsappTemplate` take injected credentials and touch no session, no request and no Inbox
   state. There is nothing to untangle. The automation engine can call them today.
2. **Template sending already exists — end to end.** A full template subsystem is shipped: Meta
   sync, approval/rejection webhooks, categories, variables, positional-parameter resolution, rate
   limiting, an existing preview component, and a working single-lead send action. The strategy
   doc treated this as unbuilt. It is built.
3. **The engine's two messaging laws are genuinely unimplemented**, and CI enforces that no action
   may declare them until they are. That forcing function is doing its job.
4. **There is already a second automated WhatsApp sender** — a ~2,150-line autoresponse / Instant
   Response subsystem with its own worker, job table, eligibility rules and daily cap. This is the
   single largest risk in the feature, and it is a _product_ risk (double-texting a lead), not a
   code-reuse risk. §5.4 and §6.5.
5. **The decisive design conclusion: automation sends must be template-only.** This follows from
   Meta's 24-hour window, and it is not a limitation — it makes the feature deterministic, removes
   the need to implement `window_24h` at all, and eliminates the whole class of "worked yesterday,
   failed today" behaviour. §5 and §6.2.

Net effect on effort: **lower than the strategy document's "Medium"** for the send path, because
templates are done — but with one genuinely new piece of Builder UI (choosing a template and
mapping its variables) and one non-negotiable coordination fix with the existing autoresponse.

---

## 1. What WhatsApp functionality already exists

### 1.1 Cloud API transport — complete

| Capability                                      | Where                                    | Notes                                                                                                                                                                                                          |
| ----------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free-text (`type: 'text'`) send                 | `lib/whatsapp/sendMessage.ts:48`         | `sendWhatsappText({phoneNumberId, accessToken, to, body})`                                                                                                                                                     |
| **Approved template send** (`type: 'template'`) | `lib/whatsapp/sendTemplateMessage.ts:30` | `sendWhatsappTemplate({…, name, language, params})`. Header comment states its purpose explicitly: _"delivers even after the 24-hour customer-care window has closed — that is the whole point of this path."_ |
| Recipient normalisation                         | `lib/whatsapp/israeliPhone.ts`           | Israeli local → E.164 `972…`. Both send paths call it; the comment notes Meta returns `131026` without it.                                                                                                     |
| Structured success/failure envelope             | `sendMessage.ts:5-23`                    | `{ok:true, wamid}` / `{ok:false, error, code, subcode, httpStatus, type, fbtraceId}`. Shared by both paths.                                                                                                    |
| Graph version pinning                           | `lib/facebook/graph.ts`                  | `GRAPH_BASE`, `GRAPH_VERSION`                                                                                                                                                                                  |
| Failure formatting for queues/logs              | `sendMessage.ts:36`                      | `formatWhatsappSendFailure()` — already written for a _job queue's_ `lastError` column                                                                                                                         |
| Structured send tracing                         | `lib/inbox/autoresponse/waTrace.ts`      | `WHATSAPP_SEND_REQUEST` / `WHATSAPP_SEND_RESPONSE` with fbtrace ids                                                                                                                                            |
| Hebrew error copy by Meta code                  | `lib/inbox/whatsappErrorCopy.ts`         | `mapWhatsappError(code) → {text, category}`                                                                                                                                                                    |

### 1.2 Inbound — complete, with broad type coverage

- Webhook: `app/api/webhooks/whatsapp/route.ts`. Handles three independent paths — `messages`,
  `statuses`, and `message_template_status_update` / `message_template_quality_update`.
- Parser: `lib/adapters/whatsappMessage.ts` recognises `text`, `image`, `document`, `audio`,
  `video`, `sticker`, `location`, `contacts`, `interactive`, **`reaction`**. Non-text content is
  captured as a payload object; only `text` populates the text column.
- Ingest: `lib/inbox/ingestWhatsappInbound.ts` → conversation, participants, message,
  `bumpConversationOnInbound`.
- Lead creation from an unknown sender: `lib/system/createLeadFromWhatsappWebhook.ts`.
- Coexistence: `lib/whatsapp/coexistence.ts` + the route's `smb_message_echoes` handling —
  messages the business sent from their own phone are acknowledged and _never_ treated as inbound.

### 1.3 Delivery and read status — complete

`lib/inbox/ingestWhatsappStatuses.ts` with `lib/inbox/messageStatus.ts`:

- `sent → delivered → read → failed`, with per-status timestamp columns.
- **Monotonic**: `statusRank` prevents a late-arriving `sent` from overwriting `read`
  (`ingestWhatsappStatuses.ts:74-75`).
- Never inserts — a status for an unknown message is ignored.
- On `failed`, stores `errorReason` from `mapWhatsappError(code).category`.

This matters for the audit's bottom line: **an automation send needs no new delivery-status work
at all.** `sendTemplateToLead`'s header says it outright — _"the outbound's sent → delivered → read
/ failed lifecycle is handled entirely by the already-shipped statuses webhook."_

### 1.4 Templates — complete subsystem

| Piece                                        | Where                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Storage + agency-scoped reads, status counts | `db/whatsappTemplates.ts`                                               |
| Meta CRUD                                    | `lib/whatsapp/templates/graph.ts`                                       |
| Approval/rejection/quality ingestion         | `lib/whatsapp/templates/ingestStatus.ts`, webhook route                 |
| Periodic reconciliation                      | `app/api/cron/whatsapp-template-sync`, `lib/whatsapp/templates/sync.ts` |
| Variables (chips) and positional params      | `lib/whatsapp/templates/variables.ts`, `parameters.ts`                  |
| Validation, rate limit, status copy          | `validate.ts`, `rateLimit.ts`, `statusCopy.ts`                          |
| Category                                     | `MARKETING` \| `UTILITY` on the row (`db/whatsappTemplates.ts:76`)      |
| **Preview component**                        | `components/settings/templates/WhatsappMessagePreview.tsx`              |
| Agency gate                                  | `lib/whatsapp/templates/flag.ts` — `isTemplatesEnabledForAgency`        |

Notable detail with direct bearing on the automation design: a Meta-synced template whose
positional slots are not mapped is **blocked before send** with an explicit reason rather than sent
with a mismatched parameter count (`sendTemplateToLead.ts:84-87`, "the #132000 fix"). That
guarantee must be preserved by the automation path, not re-derived.

### 1.5 Not present

- **Typing indicators** — not implemented anywhere. (Cloud API has no business-side typing
  indicator for outbound automation purposes; not a gap worth closing.)
- **Outbound media / reactions** — inbound is parsed, outbound is text and template only.
- **Interactive/button templates outbound** — `lib/whatsapp/templates/components.ts` handles
  components, but the send path posts a `body` component only (`sendTemplateMessage.ts:34-35`).
- **A 24-hour window computation.** No code computes whether the customer-service window is open.
  See §5.3 — the _data_ exists, the derivation does not.

---

## 2. Can the system already send WhatsApp? Where, how, and is it reusable?

**Yes — from two places, both of which are thin orchestrators over the same services.**

| Caller                                                                   | Purpose                                                  | Path                                                                                                                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `actions/whatsapp/sendWhatsappReply.ts`                                  | Rep's manual free-text reply from the lead view          | `requireProductAccess` → `resolveWhatsappOutboundTarget` → `sendWhatsappText` → `persistOutboundWhatsapp`                                                                      |
| `actions/whatsapp/templates/sendTemplateToLead.ts`                       | Rep sends an approved ready-made message to one lead     | `requireProductAccess` → flag → `loadTemplateForSend` → `resolveWhatsappOutboundTarget` → `resolveTemplateSendParameters` → `sendWhatsappTemplate` → `persistOutboundWhatsapp` |
| `lib/inbox/autoresponse/worker.ts`, `qualifyWorker.ts`, `postHandoff.ts` | **Automated** AI first-contact / qualification / handoff | own eligibility → `sendWhatsappText` → persist                                                                                                                                 |

**Which service performs the send:** `lib/whatsapp/sendMessage.ts` and
`lib/whatsapp/sendTemplateMessage.ts`. Nothing else talks to Graph for messaging.

**Can the automation engine reuse it? Yes, directly, with no modification.** The reason is that
credentials are _parameters_, not ambient state:

```
sendWhatsappText({ phoneNumberId, accessToken, to, body })   ← no session, no cookies, no db
```

And targeting is already keyed on exactly what an automation job holds:

```
resolveWhatsappOutboundTarget(agencyId, leadId)   ← lib/inbox/whatsappOutboundTarget.ts:25
  → { businessPhoneNumberId, accessToken, customerWaId, customerName, leadName }
  → or { ok:false, reason: 'lead-not-found' | 'no-connection' | 'no-recipient' }
```

An automation worker has `agencyId` and `leadId` in its `ExecutionContext`
(`executors/types.ts:36`). That is the entire input. Its own file comment already declares itself
shared and warns _"Do not re-implement this filter elsewhere."_

---

## 3. Is there a reusable abstraction, or is sending coupled to Inbox code?

**There is a real abstraction, and sending is not coupled to Inbox.** The layering is already what
the brief asks for:

```
UI / Server Action / autoresponse worker      ← callers (3 today)
        ↓
resolveWhatsappOutboundTarget()               ← lib/inbox/*  targeting + token
sendWhatsappText() / sendWhatsappTemplate()   ← lib/whatsapp/*  transport (pure)
persistOutboundWhatsapp()                     ← lib/inbox/*  persistence
        ↓
Meta Cloud API
```

Two honest qualifications:

- **Directory placement is misleading, not the coupling.** `whatsappOutboundTarget.ts` and
  `persistOutboundWhatsapp.ts` live under `lib/inbox/`, which reads like Inbox ownership. Their
  _dependencies_ are `clients`, `whatsapp_connections`, `inbox_conversations`,
  `inbox_messages` — data, not Inbox UI or request context. They are shared services in an
  inbox-named folder. Moving them is optional and cosmetic; **I would not move them** for this
  feature (needless churn across three existing callers).
- **`persistOutboundWhatsapp` has one automation-hostile parameter**:
  `sentByUserId: number` (`persistOutboundWhatsapp.ts:14`), non-nullable. An automation has no
  user. This is the single genuine friction point in an otherwise clean reuse story. §7.

Everything else the three callers do — permission checks, Hebrew error strings, flag gating — is
caller-local and correctly _not_ in the shared layer.

---

## 4. Unused automation-engine support for WhatsApp actions

Searched exactly as asked. Findings:

| Searched        | Result                                                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whatsapp.send` | **No occurrences.** No catalog action entry, no executor, no reference.                                                                                                             |
| Action registry | `lib/automations/executors/registry.ts` — exactly two: `emailExecutor`, `taskExecutor`. `registeredActionKeys()` is pinned against the catalog in CI.                               |
| Catalog actions | `catalog/entries/actions.ts` — `email.send`, `task.create`. Nothing else.                                                                                                           |
| `window_24h`    | Declared in `LAW_KEYS` (`vocabularies.ts:147`), listed in `PIPELINE_ORDER` (`laws.ts:176`), and **`window_24h: null`** in `LAW_EVALUATORS` (`laws.ts:119`).                         |
| `opt_out`       | Same: declared, in pipeline order, **`opt_out: null`** (`laws.ts:118`).                                                                                                             |
| Preview shapes  | `PREVIEW_SHAPES` includes `'message'` (`vocabularies.ts:128`) — **unreferenced anywhere**. The only other `'message'` hits are an unrelated form _field_ key and a connector alias. |

Three details worth more than the list:

**`null` is deliberate and enforced, not an oversight.** The comment at `laws.ts:116-118` reads:
_"Messaging-channel laws: declared in the vocabulary so actions can name them, unimplemented until
B6 brings the channel. No registered action may declare an unimplemented law — asserted in CI."_
And it is:

```
__tests__/automations/lawPipeline.test.ts:189
  'CI guarantee: no REGISTERED action declares an unimplemented law'
```

So the moment `whatsapp.send` declares `opt_out`, the build fails until the evaluator exists.
That is a designed gate, and it is the right one.

**The `phone` recipient is half-wired.** `subject.ts:59` already resolves it:
`phone: ({ lead }) => (lead.exists ? lead.phone : null)`. But **`phone` is not declared as a field
on any event** (`catalog/entries/events.ts` — `LEAD_FIELDS` has `leadFirstName`, `businessName`,
`repName`, `email`, `status`). Since `requires: ['phone']` resolves by _finding the event's field of
that type_, and an unmapped recipient type fails closed with `action_unavailable`
(`recipientBlocks.ts` header + `laws.ts` comment), `whatsapp.send` cannot resolve a recipient until
that one catalog line exists. Resolver present, declaration absent.

**The preview contract is email-shaped.** `PreviewResult` is
`{ok:true, html, subjectLine, fromName}` (`executors/types.ts:121`). A WhatsApp preview has no
subject line and no From name. This is the one place the closed vocabulary's `'message'` shape has
no type behind it.

**`bounce_block` needs nothing.** `recipientBlocks.ts` registers a lookup for `email` only, and
documents that _"a kind with no registered lookup is NOT blocked"_ — the safe default. So
`whatsapp.send` simply does not declare `bounce_block`, and no work is required.

---

## 5. Meta Cloud API limitations, and what they mean for automation

### 5.1 The customer service window (24 hours)

A business may send **free-form** messages only within 24 hours of the customer's most recent
message. Outside it, free-form is rejected — the canonical error is `131047`
("re-engagement message"). The window is refreshed by each new inbound message.

### 5.2 Template messages and business-initiated conversations

Outside the window, only a **pre-approved template** may be sent. Templates carry a category:

- **UTILITY** — transactional, tied to something the customer did or agreed to (an appointment
  reminder, an order update). Cheaper, higher-trust, less throttling risk.
- **MARKETING** — promotional. More expensive, subject to per-user frequency limits, and the first
  thing throttled when quality drops.
- (AUTHENTICATION — OTP; irrelevant here.)

Additional constraints that bear on an automation: template approval is asynchronous and can be
**rejected**; templates carry a **quality rating** that can be lowered by user blocks/reports and
can pause a template; phone numbers have **messaging tier limits**; and pricing is per-message by
category. Treat exact rates as a thing to verify against current Meta pricing rather than a
constant — but the structural fact is enough for design: **WhatsApp sends cost money per message,
and email effectively does not.**

### 5.3 What this must do to automation behaviour

**An automation is business-initiated by definition, and usually time-delayed.** Look at the
existing recipe catalogue through that lens:

| Automation                               | When it fires                   | Is the 24-hour window open?                                   |
| ---------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `appointment_reminder` (1 day before)    | a day before a meeting          | Almost certainly **closed**                                   |
| `lost_lead_follow_up`                    | days after the lead went cold   | **Closed by definition**                                      |
| `welcome_sequence` step 3 (after a week) | 7 days later                    | **Closed**                                                    |
| `welcome_new_lead`                       | seconds after a form submission | The lead never messaged on WhatsApp at all → **never opened** |

So a free-text automation send would fail for most automations most of the time — and, worse,
**succeed sometimes**, depending on whether the lead happened to message recently. That is
nondeterministic product behaviour: the same configured automation works for one lead and silently
skips for the next. It is precisely the "data honesty" failure the frontend guidelines and the care
charter both prohibit, and it would be discovered by customers, not by us.

**Therefore: automation WhatsApp sends are template-only.** Consequences, all of them good:

1. **Deterministic.** It works regardless of window state. There is no "sometimes."
2. **`window_24h` does not need to be implemented.** Templates are exactly the mechanism that makes
   the window irrelevant. `whatsapp.send` should **not declare** `window_24h`; the law stays `null`
   in the vocabulary for a future free-text messaging action that does not exist yet. This removes
   a whole work item from the estimate, honestly rather than by shortcut.
3. **Content is pre-reviewed.** Meta approval means an automation cannot send unreviewed copy at
   scale — a genuine safety property for a system that fires without a human present.
4. **Caps become spend controls.** `per_lead_cap` and `agency_cap` already exist and already apply.
   With per-message pricing they are protecting the customer's money, not only the lead's
   attention. Worth saying out loud in the Builder.
5. **Prefer UTILITY.** The reminder/follow-up automations are utility-shaped. The template row
   already stores `category`, so the Builder can warn when a MARKETING template is chosen for a
   high-frequency automation.

Two failure modes the executor must handle honestly rather than retry blindly:

- **Template no longer approved** (rejected, paused, or deleted at Meta). The registry already
  tracks status; this is a **preflight** problem — a configuration fault, not a lead fault, so it
  must not burn the lead's send-once claim (`executors/types.ts:14-18` explains exactly this
  ordering rule).
- **Unmapped positional parameters.** Must block before send, preserving the `#132000` guarantee.

### 5.4 The limitation nobody asked about: two automated senders

The autoresponse subsystem already sends automated WhatsApp messages with its own rules
(`lib/inbox/autoresponse/eligibility.ts:21`): master/channel flags, `hasPriorHumanReply`,
quiet hours, `sentTodayForAgency >= dailyCap`, `hasPriorAutoFirstContact`, `hasPriorOutbound`.

The automation engine has a _parallel, independent_ set in `laws.ts`. Neither knows about the
other. A lead who submits a website form can therefore receive, within seconds, both the Instant
Response first-contact message **and** a `welcome_new_lead` automation message. Two systems, one
lead, no coordination — and from the lead's side it is simply a business that double-texted them.

This is a product defect waiting to happen and it must be designed for, not discovered. §6.5.

---

## 6. The correct architecture

### 6.1 The shape

Exactly the layering the brief specifies, with **no second WhatsApp implementation**:

```
Automation Engine
  worker → law pipeline (laws.ts) → send-once claim → executor dispatch
        ↓
whatsapp.send  ← ONE new executor  (lib/automations/executors/whatsapp.ts)
   preflight():  load template (agency-scoped) · assert still approved ·
                 resolve target · resolve positional params · no claim burned
   execute():    send · persist · return ExecutionOutcome{ providerMessageId: wamid }
        ↓
EXISTING SERVICES — called, not modified
   resolveWhatsappOutboundTarget(agencyId, leadId)     lib/inbox/whatsappOutboundTarget.ts
   loadTemplateForSend(templateId, agencyId)           db/whatsappTemplates.ts
   resolveTemplateSendParameters(...)                  lib/whatsapp/templates/parameters.ts
   sendWhatsappTemplate({phoneNumberId, accessToken, to, name, language, params})
                                                       lib/whatsapp/sendTemplateMessage.ts
   persistOutboundWhatsapp({...})                      lib/inbox/persistOutboundWhatsapp.ts
   mapWhatsappError(code)                              lib/inbox/whatsappErrorCopy.ts
        ↓
Meta Cloud API
        ↓
statuses webhook → ingestWhatsappStatuses  ← already closes the delivery loop, unchanged
```

The executor is a **composition of existing services**. Its closest analogue is
`sendTemplateToLead.ts` — which is 133 lines and mostly Hebrew error strings and permission
checks that an executor does not need.

### 6.2 The action's catalog declaration (data, not code)

```
key:        'whatsapp.send'
requires:   ['phone']                     ← needs the phone field declared (§7)
parameters: templateId  (enum_remote, optionSource: 'whatsapp_templates')
            + variable bindings for the template's slots
laws:       ['send_once', 'per_lead_cap', 'agency_cap', 'opt_out', 'quiet_hours']
            ← deliberately NOT window_24h (§5.3), NOT bounce_block (§4)
risk:       'external'
preview:    'message'
testable:   true
```

There is no free-text `body` parameter. The template _is_ the content.

### 6.3 Reuse the connector's generic option provider

`ConnectionProvider.options(agencyId, connectionId, optionSource)` already exists and already backs
`enum_remote` pickers generically (`connectors/types.ts:45`), and `whatsappProvider` already
implements `options()`. Serving approved templates as an option source is an addition _inside the
existing contract_ — the Builder learns nothing new, exactly as the form picker works today.

### 6.4 Persistence and attribution

The automation's message must appear in the lead's conversation like any other outbound — same
thread, same status lifecycle, same conversation-intelligence enqueue. `persistOutboundWhatsapp`
already does all of that. The only question it asks that an automation cannot answer is
`sentByUserId`. Resolve it by allowing system attribution rather than by writing a second persist
path (§7, small change).

### 6.5 Coordination with the autoresponse — the required decision

Recommendation: **make the per-lead cap count all automated outbound, not just automation-engine
outbound.** The `per_lead_cap` law's purpose (`laws.ts:111`) is protecting the lead; a lead who
already received an automated message today has been contacted, whichever subsystem sent it. This
is a change to how the _fact_ is gathered (`workerFacts.ts`), not to the law, the engine or the
autoresponse — the smallest possible intervention at the correct layer.

The alternative — a dedicated "recently auto-messaged" guard — adds a concept where an existing law
already expresses the intent. Not recommended.

Second, related decision: **`opt_out` should read the signal that already exists.** The autoresponse
maintains `aiState = 'opted_out'` on the conversation, set by `detectOptOut()` on inbound text
(`autoresponse/stateMachine.ts:39`, `qualifyWorker.ts:167`). A lead who replied "STOP" must not then
receive automation messages. Reusing that signal avoids a second consent store — which is exactly
the consent-fragmentation hazard flagged in the integration strategy.

One ambiguity to settle deliberately rather than assume: `aiState` is currently _conversation_-scoped
and semantically "the AI should stop talking." Using it as "no automated WhatsApp at all" is the
right behaviour but a broader meaning than its name. It does **not** affect a rep's manual reply
(laws apply only to the engine). Name the decision; do not let it happen implicitly.

---

## 7. Every missing piece, classified

### Already exists — zero changes

1. Cloud API text send — `lib/whatsapp/sendMessage.ts`
2. Cloud API **template** send — `lib/whatsapp/sendTemplateMessage.ts`
3. E.164 recipient normalisation — `lib/whatsapp/israeliPhone.ts`
4. Agency-scoped target + token resolution — `lib/inbox/whatsappOutboundTarget.ts`
5. Outbound persistence into the conversation — `lib/inbox/persistOutboundWhatsapp.ts` (except §7 item 2)
6. Delivery lifecycle `sent → delivered → read → failed`, monotonic — statuses webhook + `ingestWhatsappStatuses.ts`
7. Hebrew error copy by Meta code — `lib/inbox/whatsappErrorCopy.ts`
8. Template registry, Meta sync, approval/rejection/quality webhooks, categories — `db/whatsappTemplates.ts`, `lib/whatsapp/templates/*`
9. Positional-parameter resolution + the unmapped-slot block — `templates/parameters.ts`
10. WhatsApp message preview component — `components/settings/templates/WhatsappMessagePreview.tsx`
11. Executor contract, two-phase preflight/execute, activity recording, observation mode — `executors/types.ts`, worker, ADR-009
12. Law pipeline composition, `send_once`, `per_lead_cap`, `agency_cap`, `quiet_hours` — `laws.ts`
13. `phone` subject _resolver_ — `subject.ts:59`
14. `whatsapp_connected` capability + connection listing/options — `connectors/whatsapp.ts`
15. Job queue, delayed jobs, `before_anchor` timing, occurrence keys, reschedule — engine
16. Send tracing — `autoresponse/waTrace.ts`
17. `bounce_block` — correctly a no-op for phone recipients by design

### Needs small changes

1. **Declare `phone` as a catalog field** on lead-bearing events (`LEAD_FIELDS`). One line; the
   resolver already exists. Without it `requires: ['phone']` fails closed.
2. **`persistOutboundWhatsapp` system attribution** — `sentByUserId` is non-nullable; an automation
   has no user. Needs a nullable or system-sender path (three existing callers unaffected).
3. **Implement the `opt_out` law evaluator** — read the existing opted-out signal (§6.5). Required
   by CI before the action can declare the law.
4. **`per_lead_cap` fact gathering counts autoresponse sends too** — `workerFacts.ts` (§6.5).
5. **Template option source** for `enum_remote` in `whatsappProvider.options()`.
6. **A `'message'` preview result variant** — `PreviewResult` is email-shaped
   (`html`/`subjectLine`/`fromName`). Reuse `WhatsappMessagePreview` for rendering.
7. **Reconcile the templates agency flag** — `isTemplatesEnabledForAgency` gates template sending
   today; decide whether the automation action inherits that gate or gets its own.

### Needs new implementation

1. **The `whatsapp.send` executor** — `preflight` / `execute` / `test` / `preview`. The only
   substantial new file. Composes §7-already-exists items 2, 4, 5, 8, 9.
2. **The `whatsapp.send` catalog action entry** — data (§6.2).
3. **Builder UI: pick an approved template and map its slots to automation variables.** The
   `enum_remote` control exists; the _slot-mapping_ control does not. This is the largest genuinely
   new UI piece, and the one most likely to be underestimated.
4. **Automation-context parameter adapter** — `resolveTemplateSendParameters` currently takes a
   rep-facing context `{leadFullName, businessName}`; the automation must supply values from
   catalog subject fields instead. An adapter, not a rewrite.
5. **Marketplace/recipe entries** that use the new action (e.g. a WhatsApp appointment reminder) —
   content, once the action exists.

---

## 8. Complexity

**Overall: Medium — and lower than the integration strategy's estimate**, because the template
subsystem is already shipped. The transport, delivery lifecycle, template lifecycle, persistence
and law pipeline are all done.

| Area                                   | Size    | Note                                                                          |
| -------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| Catalog field + action entry           | **S**   | Data                                                                          |
| `opt_out` evaluator + shared cap facts | **S–M** | Small code, needs the §6.5 decision first                                     |
| `whatsapp.send` executor               | **M**   | Composition; `sendTemplateToLead.ts` is the reference at 133 lines            |
| Builder template picker + slot mapping | **M**   | The real cost; new interaction design                                         |
| Preview variant + `test` affordance    | **S**   | Reuses the existing preview component                                         |
| Tests                                  | **M**   | Law pipeline, preflight faults, window-independence, double-send coordination |
| Persistence attribution                | **S**   | One parameter                                                                 |

Risk concentration is **not** in the send path. It is in (a) the slot-mapping UI and (b) the
two-senders coordination. Budget accordingly.

---

## 9. Recommended implementation order

Ordered so each step is independently verifiable and nothing user-visible ships before the engine
is correct.

1. **Settle the two decisions in §6.5** — shared per-lead cap, and `opt_out` semantics. They shape
   everything downstream and cost nothing to decide now.
2. **Engine groundwork, no UI:** declare the `phone` field, implement the `opt_out` evaluator,
   widen the cap fact. Fully unit-testable; CI's unimplemented-law gate turns green for the laws
   the action will declare.
3. **Persistence attribution** — the one-parameter change, with the three existing callers pinned
   by test.
4. **The `whatsapp.send` catalog entry + executor**, template-only, gated to a canary agency.
   Verifiable through the engine's existing **observation mode** — `mode: 'log'` produces
   `would_send` outcomes (ADR-009), so the whole path can be proven against real production traffic
   **before a single message is sent to anyone.** Use it; it is exactly what it was built for.
5. **Template option source + Builder picker + slot mapping**, with the preview variant. The point
   at which the feature becomes visible.
6. **Verify the coordination end to end** — a lead who triggers both the Instant Response and an
   automation must receive one message, and the skip must be visible in the activity log.
7. **Recipe/marketplace content**, then canary → general rollout, watching template quality rating
   and per-message spend rather than only send counts.

Step 4 before step 5 is deliberate: the executor is provable without UI, and observation mode makes
that proof real rather than theoretical.

---

## 10. Corrections to `integration-platform-strategy.md`

For the record, since that document informed this one:

- It said WhatsApp send was unbuilt and the engine merely "pre-wired." **Half wrong**: the engine is
  pre-wired as described, but the _WhatsApp side_ — including template send, approval lifecycle and
  delivery status — is substantially built. The estimate should come down.
- It did not mention the **autoresponse subsystem**, which already sends automated WhatsApp with its
  own eligibility rules. That is the most important omission, and it changes the design.
- It assumed `window_24h` would need implementing. Under a template-only design, **it does not.**
