# Quotations in the Automation Library — Flow Audit & Integration Point

**Status:** audit. No code written, none to be written from this document alone.
**Scope:** the Automation Library flow only. The Quotation entity itself is audited separately in
[quotations-architecture-audit.md](quotations-architecture-audit.md).
**Question answered:** where does a Quotation action attach to the existing engine, and what is the
smallest change that makes it real.

---

## 0. The lifecycle diagram, corrected against the implementation

The diagram in the brief is close but wrong in six places. Every correction below is load-bearing
for where Quotation attaches.

| # | Brief says | Implementation | Why it matters |
| --- | --- | --- | --- |
| 1 | trigger → conditions → **delay** → action → configure action | The sheet's order is **WHEN → IF → THEN → WAIT**. [AutomationSheet.tsx](components/settings/automations/AutomationSheet.tsx) renders `AutomationTriggerSection` → `ConditionsEditor` → `AutomationActionSection` → `AutomationTimingSection` → `AutomationPreviewSection`. **Timing comes after the action, not before.** | Timing anchors are derived from the *event's* `datetime` fields, so timing must be able to see the event; putting it before the action is just a UI ordering, and the real order is already the one the brief's §10 mock-up wants. |
| 2 | "Create automation" then "choose trigger" | It is **event-first and one modal**. There is no wizard, no multi-step create. `BLANK` in [automationDrafts.ts](components/settings/automations/automationDrafts.ts) opens on `listSelectableEvents()[0]`. | A Quotation action must fit into one `ModalPop`, not add a step. |
| 3 | "Save / activate" | **Two separate operations.** `createAutomation` always writes `status: 'draft'` ([definitions.ts:191](db/automations/definitions.ts#L191)). Activation is `setAutomationStatus(id, 'active')` from the card. | A quote automation is saved inert by default — good, it means a misconfigured one cannot fire. |
| 4 | "Matching / condition evaluation" is one step after the event | **It happens twice.** Snapshot conditions are decided at *emission* (`snapshotConditionsMatch`, [emit.ts](lib/automations/emit.ts)); live conditions are re-decided at *execution* (`premiseHolds` inside `universalGuards`, [laws.ts](lib/automations/laws.ts)). | This split is the entire answer to §5's "what if the lead changes state during the 2 hours". |
| 5 | "Delay / scheduling" after matching | Scheduling happens at **emission**: `resolveSendAtDetailed` computes `notBefore` and it is written onto the job row. The worker never schedules. | A Quotation action needs no scheduling code at all. |
| 6 | "Success / skip / retry / failure" | Job statuses are `pending · processing · done · skipped · dead`. **Retry is not terminal** — it is a return to `pending` with `LEAST(attempts,5) * 30s` backoff. And two steps are missing from the diagram entirely: the **send-once claim** and the executor **preflight**, which sit on either side of the effect. | Claim-before-effect is what makes "don't create two quotes" free. |

### The actual flow

```
Automation Library  (settings/automations page → AutomationsSettings)
   ↓  "אוטומציה חדשה" → AutomationSheet (one ModalPop)
WHEN   event picker, grouped by catalog subject · connection · event parameters
IF     ConditionsEditor — fields/operators derived from the event's catalog fields
THEN   AutomationActionSection — action picker (only if >1 offerable) + its config
WAIT   AutomationTimingSection — preset | custom | before_anchor
PREVIEW AutomationPreviewSection — rendered BY THE ACTION, not by the builder
   ↓  createAutomation / updateAutomation  → status='draft'
   ↓  setAutomationStatus(…, 'active')     → separate, from the card
─────────────────────────────────────────────────────────────────────────
real business write (actions/clients.ts, leadOutcome.ts, meetings, webhook)
   ↓  emitAutomationEvent(event)
   ├─ origin==='import'? → blocked, never enqueued
   ├─ kill switch / agency allowlist
   ├─ listActiveDefinitionsForTrigger(agencyId, trigger)
   ├─ SNAPSHOT conditions decided here
   ├─ resolveSendAtDetailed(triggerAt, timing, anchors) → notBefore
   └─ enqueueAutomationJob  … ON CONFLICT (automationId, leadId, eventKey) DO NOTHING
─────────────────────────────────────────────────────────────────────────
cron */5 * * * *  → /api/cron/automations-dispatch → runAutomationWorker(limit:25)
   ├─ reclaimStaleAutomationJobs(60s lease)
   ├─ claimAutomationJobs  (FOR UPDATE SKIP LOCKED, attempts+1)
   └─ processJob:
        definition still active? content schema valid? timing valid?
        getLeadFacts + getSendClaimState  → crash recovery branch
        actionKeyFor(def) → getAction → executorFor       (fails CLOSED)
        resolveSubjectContext  (premise · recipients · variables)
        decideSendForAction(action, facts)   ← universal guards + composed laws
        executor.preflight(ctx)              ← BEFORE the claim
        claimSendOnce()                      ← the once-ever allowance
        executor.execute(ctx, ready)         ← the effect
        appendActivity + confirmClaim + completeJob
        catch → releaseClaim → failJob → retry(pending) | dead
```

---

## 1. Automation Builder — where Quotation appears

### 1.1 The file flow

| Step | File | What it learns from the catalog |
| --- | --- | --- |
| Library + control centre | [AutomationsSettings.tsx](components/settings/automations/AutomationsSettings.tsx) → `AutomationControlCenter`, `AutomationTemplatesSection` | — |
| Page data load | [settings/automations/page.tsx](<app/(app)/settings/(admin_settings)/automations/page.tsx>) | maps each row to a `SheetDraft`, including `actionKey: actionKeyFor(d)` |
| The one sheet | [AutomationSheet.tsx](components/settings/automations/AutomationSheet.tsx) (324 lines — at the hard limit) | events grouped by `listSubjects()`, chips from `variableChipsForEvent`, anchors from `listAnchorFields` |
| WHEN | `AutomationTriggerSection` | event picker, locked-with-CTA state, connection intersection, `RemoteParameters` for **event** parameters |
| IF | `ConditionsEditor` | fields + `OPERATORS_BY_FIELD_TYPE` |
| THEN | `AutomationActionSection` | `listActionsForEvent(event)` = `requires` × the event's field types |
| THEN config | `AutomationContentSection` **or** `AutomationTemplateSection` | **branches on whether the action declares a `templateId` parameter** |
| WAIT | `AutomationTimingSection` | `timingOptionsFor` + anchor fields |
| PREVIEW | `AutomationPreviewSection` | `action.preview` shape; content rendered by the executor's own `preview()` |
| Save | [actions/automations/manage.ts](actions/automations/manage.ts) | validates content **against the chosen action**, not against a global email vocabulary |

The builder is genuinely catalog-driven. `newEventNoBuilderChange.test.ts` and
`builderBoundary.test.ts` pin it. Adding an event costs zero builder code.

### 1.2 Where Quotation appears — the answer

**In `THEN`, as one more entry in the action picker.** Nothing else in the builder moves.

`listActionsForEvent` filters by `requires` × the event's declared field types. A
`quote.*` action declaring `requires: []` or `requires: ['email']` is offered automatically on
`lead.status_changed`, `lead.created`, `form.submitted` and `appointment.booked` — no picker code,
no event edits, no new section. The picker only renders when `actions.length > 1`, which is
already true today.

### 1.3 The one place the builder is not generic

[AutomationActionSection.tsx:97](components/settings/automations/AutomationActionSection.tsx#L97) is a
two-way branch dressed as a registry:

```tsx
const templateParameter = action?.parameters.find((p) => p.key === 'templateId') ?? null
…
{templateParameter ? <AutomationTemplateSection … /> : <AutomationContentSection … />}
```

`AutomationContentSection` is hard-coded email: `נושא האימייל`, `תוכן האימייל`, variable chips,
CTA block. So a Quotation action whose parameters are `quoteTemplateId` + `channel` would fall
into the `else` branch and be configured with an **email subject and body form**.

The fix is small and already half-built: [RemoteParameters.tsx](components/settings/automations/RemoteParameters.tsx)
*already* renders `enum_static` and `enum_remote` parameters generically from catalog metadata — it
is simply only wired to the **event's** parameters in `AutomationTriggerSection`, never to the
**action's**. Wiring it as the default branch (with email content and WhatsApp templates as the two
named special cases they actually are) is roughly ten lines and makes the file more honest, not less.

**Verdict: the builder does not need redesigning.** It needs one generic branch it already owns.

---

## 2. Trigger → event → execution, traced end to end

Representative path: **`whatsapp.send` on `lead.status_changed`** — chosen because it is the most
recent action added and therefore the truest template for a new one.

| Stage | File · function | What actually happens |
| --- | --- | --- |
| Business write | `actions/clients.ts` / `actions/leadOutcome.ts` | the lead's status changes |
| Emission | [emit.ts `emitAutomationEventWith`](lib/automations/emit.ts) | origin gate (pure) → kill switch → allowlist → `listActiveDefinitionsForTrigger` → **snapshot conditions** → `resolveSendAtDetailed` → `enqueueAutomationJob`. **Never throws** — a failure here is logged and swallowed. |
| Identity | `eventKeyFor(event)` | ADR-010: `status_changed:{newStatus}:{occurredAt}` — deterministic, never random |
| Queue | [jobs.ts](db/automations/jobs.ts) | SQL-level re-check that the definition is still active, `ON CONFLICT (automationId, leadId, eventKey) DO NOTHING` |
| Heartbeat | [api/cron/automations-dispatch](app/api/cron/automations-dispatch/route.ts), `*/5 * * * *` | `reclaim(60s)` → `claim(25)` → `processJob` → prune terminal rows >90d |
| Definition re-read | `getDefinitionForWorker` | agency re-verified, `status !== 'active'` ⇒ quiet skip, unknown content schema ⇒ inert |
| Action resolution | `actionKeyFor(def)` → `getAction` → `executorFor` | all three fail **closed** to `action_unavailable` |
| Facts | [workerFacts.ts `resolveSubjectContext`](lib/automations/workerFacts.ts) | resolves three key-sets lazily: live premise, recipients, executor variables |
| Laws | `decideSendForAction` | universal guards, then the action's **declared** law pipeline in `PIPELINE_ORDER` |
| Preflight | `executor.preflight` | template exists / approved / slots mapped — **before** the claim |
| Claim | `claimSendOnce` | `ON CONFLICT DO NOTHING`; false ⇒ `already_sent` |
| Effect | `executor.execute` | Graph send + `persistOutboundWhatsapp` |
| Record | `appendActivity` + `confirmSendClaim` + `completeAutomationJob` | |

**What this means for Quotation:** the execution context a quote executor receives is
`{agencyId, automationId, leadId, mode, subject, recipients, parameters}` — everything needed to
create a quote against the right tenant and the right lead, with zero new plumbing.

---

## 3. Action architecture

### 3.1 How actions are registered and typed

Three coordinated declarations, and nothing else:

1. **Catalog entry** — [catalog/entries/actions.ts](lib/automations/catalog/entries/actions.ts).
   `ActionDefinition = { key, title, description, icon, requirements, requires, parameters, laws, risk, preview, testable }`.
2. **Executor** — [executors/registry.ts](lib/automations/executors/registry.ts), a static array.
   `ActionExecutor = { actionKey, resolvableFields, defaultDeps, preflight, execute, test?, preview? }`.
3. **Engine value** — the persisted `automation_definitions.action` column, via
   [engineBridge.ts](lib/automations/catalog/engineBridge.ts).

CI pins 1↔2 both ways ([executors.test.ts:214-227](__tests__/automations/executors.test.ts#L214-L227)):
*declared means runnable, runnable means described.*

### 3.2 Two-phase execution — the contract that matters

From [executors/types.ts](lib/automations/executors/types.ts):

> `preflight()` runs **BEFORE** the send-once claim (ADR-013). An unresolvable configuration is a
> fault of the business's setup, not of the lead; burning the lead's once-ever allowance on it
> would mean the lead never receives the message even after the configuration is fixed.
>
> `execute()` runs **AFTER** the claim. Throwing releases the claim and the job retries; returning
> normally confirms it.

`preflight` problems become `dead` in live mode — **definitive, never retried**. `execute` throws
become **retries with backoff**, then `dead` at `maxAttempts`.

### 3.3 The rest, verified

| Concern | Mechanism |
| --- | --- |
| Configuration storage | §4 |
| Worker resolves the action | `actionKeyFor(def)` → catalog → executor registry; any miss ⇒ `action_unavailable` |
| Lead/agency context | `ExecutionContext`; §6 |
| Idempotency | two layers: job unique index `(automationId, leadId, eventKey)`, and `automation_send_claims` unique `(automationId, leadId, semantics='ever')` |
| Retries | `failAutomationJob` → `pending` + `LEAST(attempts,5)*30s`; `dead` at `maxAttempts` |
| Failures | `dead` + a `failed` activity row + `FAILURE_COPY.terminal` |
| Skip reasons | `SKIP_REASONS` in [types.ts](lib/automations/types.ts) — **persisted data, append-only**, Hebrew copy in `copy.ts`, exhaustively tested |
| Results logged | `automation_activity`: `kind ∈ sent·would_send·skipped·failed`, `subject` (one-line summary), `deliveryState`, `providerMessageId` |
| Executor dependencies | the executor's own `defaultDeps()` — the worker declares none |

### 3.4 The smallest possible addition — and the wall it hits first

On the evidence above, adding an action *should* be: one catalog entry + one executor module + one
registry line. `task.create` is 78 lines and proves it.

**It is not, and there is a blocking defect on that path.**

`automation_definitions.action` was created as:

```sql
action text NOT NULL DEFAULT 'send_email' CHECK (action IN ('send_email'))
```
— [20260802000001_create_customer_automation_engine.cjs:39](migrations/20260802000001_create_customer_automation_engine.cjs#L39)

**No migration has ever widened it.** (`automation_definitions_trigger_check` was widened twice, in
`…04` and `…05`. The action check never was.) Meanwhile:

```ts
// db/automations/definitions.ts:197
action: engineActionForActionKey(input.actionKey) as ActionType,

// lib/automations/catalog/engineBridge.ts:52
const ACTION_KEY_TO_ENGINE_ACTION = { 'email.send': 'send_email' }
export function engineActionForActionKey(k: string) { return ACTION_KEY_TO_ENGINE_ACTION[k] ?? null }
```

`engineActionForActionKey('task.create')` → `null`. And knex binds an explicit NULL rather than
omitting the key — verified by building the real insert:

```
insert into "automation_definitions" ("action", "actions", "agencyId", …) values (?, ?, ?, …)
[null, "[]", 1, …]
```

A NULL into a `NOT NULL` column is a `23502` violation; even if it were nullable, the CHECK admits
only `'send_email'`.

> **`task.create` and `whatsapp.send` are catalog-complete, executor-complete, builder-complete,
> law-complete, preview-complete, CI-conformance-tested — and cannot be saved.**

The conformance suite even *pins* the gap rather than catching it:
`expect(bridgedActionKeys()).toEqual(['email.send'])`
([catalogConformance.test.ts:114](__tests__/automations/catalogConformance.test.ts#L114)).

This is not a Quotation problem — it is the **existing** second and third actions being unreachable
— but Quotation is the fourth action, and it hits the same wall on day one.

**Verify before acting** (the production column could have been altered outside migrations):

```sql
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'automation_definitions'::regclass AND conname LIKE '%action%';
SELECT action, count(*) FROM automation_definitions GROUP BY 1;
```

**So the smallest possible addition is:**

| # | Change | Size |
| --- | --- | --- |
| 0 | Widen the `action` CHECK + add bridge entries for `task.create`, `whatsapp.send`, and the new quote keys + update the conformance assertion | 1 migration, 4 map lines, 1 test line |
| 1 | Catalog entries for the quote actions | data |
| 2 | Executor modules + registry lines | ~80–140 lines each |
| 3 | Optional fields on `DefinitionContent` + projection lines | ~6 lines, **no migration** |
| 4 | Wire `RemoteParameters` to action parameters | ~10 lines |
| 5 | New `SKIP_REASONS` values | append-only, + Hebrew copy |

---

## 4. Configuration model

### 4.1 How it is actually stored

Two representations, one authored and one derived — this is the single most important thing to get
right, because writing to the wrong one silently does nothing.

```
automation_definitions
  action      text        the engine's persisted value  ('send_email')          ← §3.4 blocker
  actions     jsonb       [{ actionKey, parameters }]   the executor reads this
  content     jsonb       { schemaVersion, subject, body, timing,
                            ctaLabel, ctaUrl, templateId, templateBindings }    ← what the Builder writes
  conditions  jsonb       [{ field, operator, value }]
  trigger     text        CHECK-constrained; widened twice already
```

The **Builder authors `content`**. `actions[].parameters` is a *compatibility projection* produced
in exactly one place:

```ts
// lib/automations/actionEntry.ts
export function actionParametersFromContent(content: AuthoredContent): Record<string, unknown> {
  const parameters = { subject: content.subject, body: content.body }
  if (label && url) { parameters.ctaLabel = label; parameters.ctaUrl = url }
  if (content.templateId != null) parameters.templateId = content.templateId
  if (content.templateBindings && …) parameters.templateBindings = content.templateBindings
  return parameters
}
```

`createDefinition` and `updateDefinitionContent` both call `actionsForContent(actionKey, content)`,
so the two can never disagree. The file names its own removal condition: *"when `content` stops
being the authored surface."*

### 4.2 The precedent: how `whatsapp.send` added its configuration

Exactly four touches, **no migration** (`content` is jsonb):

1. `DefinitionContent` gained `templateId?: number | null` and `templateBindings?: Record<string,string> | null`
2. `actionParametersFromContent` gained two conditional projection lines
3. `AutomationInput` + `toContent()` in `manage.ts` gained the two fields
4. `SheetDraft` gained them, and the page's draft mapping read them back

**This is the template for Quotation. Follow it exactly.**

### 4.3 Proposed quotation configuration

```ts
// lib/automations/catalog/entries/actions.ts — the declaration
parameters: [
  { key: 'quoteTemplateId', type: 'enum_remote', label: 'הצעת המחיר',
    optionSource: 'quote_templates', validation: { required: true } },
  { key: 'validityDays',    type: 'number', label: 'תוקף ההצעה בימים',
    validation: { min: 1, max: 90 } },
]

// db/automations/definitions.ts — DefinitionContent, additive jsonb, no migration
quoteTemplateId?: number | null
quoteValidityDays?: number | null
```

**No `channel` parameter.** Channel belongs in the action key, not in a parameter — see §8.2.

### 4.4 The one genuinely new Builder need

`enum_remote` option resolution is **entirely connection-scoped**. Both doors end in
`optionsFor(agencyId, connectionId, optionSource)`:

- `listOptionsAction(connectionId, source)` — needs a connection id
- `listOptionsForCapabilityAction(capability, source)` — finds the connection *by capability*, and
  returns `{ ok: true, options: [] }` when none grants it

A quote template is **first-party agency data behind no connector and no capability**, so it
resolves to an empty list through both. This needs a third resolution path: an option source served
from agency data rather than from a connector. It is small (one server action + one branch in
`RemoteParameters`), it is generic (the next first-party picker reuses it), and it does **not**
introduce a parameter type — Law 4 is respected.

---

## 5. Timing semantics — and the state-during-delay question

### 5.1 What exists

| Capability | Implementation |
| --- | --- |
| Immediate | `{kind:'preset', preset:'immediate'}` → `notBefore = triggerAt` |
| After X time | `{kind:'custom', value, unit:'hours'\|'days'}`, bounded at 720h / 30d |
| Presets | `one_hour`, `one_day` |
| Before an anchor | `{kind:'before_anchor', anchorField, value, unit}` — `anchorField` is any `datetime` catalog field |
| Anchor misses | `anchor_missing` / `anchor_too_late` — **ordinary outcomes, not errors**; no job is created |
| Rescheduling | `discardPendingJobsForOccurrence` — deletes **`pending` only**, then re-emits |
| Stale jobs | 60s lease + `reclaimStaleAutomationJobs` |
| Cancellation | there is no cancel verb; a paused/deleted definition makes the job a quiet skip at claim time |
| Accuracy | bounded by the 5-minute cron and **stated honestly** in `TIMING_ACCURACY_COPY` — never presented as exact |

Note `resolveSendAtDetailed` compares the anchor against the **trigger** moment, not `Date.now()`,
so emission is a pure function of its inputs and replays identically.

### 5.2 "What happens if the lead changes state during those 2 hours?"

**The engine already answers this, precisely, and no new mechanism is needed.**

Every catalog field declares `freshness: 'snapshot' | 'live'`
([vocabularies.ts](lib/automations/catalog/vocabularies.ts)). The `lead` subject's `status` field is
declared **`live`** ([entries/events.ts](lib/automations/catalog/entries/events.ts)). Then:

- **Snapshot** conditions are decided once, at emission (`snapshotConditionsMatch`). Their value
  cannot change, so re-checking would be meaningless.
- **Live** conditions are re-read from the lead at execution and must still hold —
  `premiseHolds(f)` inside `universalGuards`, and the skip reason when they do not is
  **`premise_expired`**.

So for the brief's example:

```
WHEN  lead.status_changed        →  job enqueued with notBefore = +2h
IF    status is "interested"     →  a LIVE condition
WAIT  2 hours
THEN  quote.send
```

- lead still `interested` at T+2h → premise holds → laws → claim → quote created and sent
- lead moved to `lost` / `closed` → `premiseHolds` false → **`premise_expired`**, job skipped, a
  `skipped` activity row records why, nothing is created, nothing is sent
- lead deleted → `universalGuards`: `!f.lead.exists` → **`lead_deleted`**

There is also a precedent for a guard the **customer cannot delete**: `appointmentGuard` blocks a
reminder when the meeting is missing/cancelled/already started, because *"a reminder that fires for
a cancelled meeting is wrong in a way the customer cannot be asked to guard against — so it must
not be expressible as a condition they could delete."* If quotations need an equivalent
(§9), that is the shape to copy — engine-level, ~8 lines, not a new subsystem.

---

## 6. Lead context

```ts
export type ExecutionContext = {
  agencyId: number
  automationId: number
  leadId: number
  mode: 'live' | 'log'
  subject: SubjectValues                       // by catalog field key
  recipients: Record<string, string | null>    // what `requires` resolved to
  parameters: Record<string, unknown>          // the action's stored parameters
}
```

| Needed | Source |
| --- | --- |
| `agencyId` | job row; the worker re-verifies `def.agencyId !== job.agencyId` and skips `definition_missing` |
| `leadId` | job row; every event must declare `identity.leadResolution` (Law 2) or CI rejects it |
| lead status / fields | [subject.ts](lib/automations/subject.ts) `subjectResolver` — lazy, memoised, one resolver per catalog field key; an unresolved key returns `null`, **never a wrong value** |
| lead facts | `getLeadFacts` → `{exists, currentStatus, email, phone, firstName, displayName, handlerId}` |
| owner / rep | **not on the context.** `task.create` fetches it itself: `deps.handlerId(agencyId, leadId)` → `getLeadHandlerId`. A quote executor does the same for `createdByUserId` / `ownerUserId`. |
| channels | `recipients[key]`, keyed by the subject field `recipientFieldFor(event, type)` resolved |
| automation metadata | `automationId` — and it is the natural idempotency key for the quote row (§9.7) |

**Tenant safety is structural**: the job carries `agencyId`, the definition is re-verified against
it, `getLeadFacts` is agency-scoped, and every `db/automations/*` read filters by agency. A quote
executor inherits all of it by using `ctx.agencyId` and nothing else.

**One gap, and it is the executor's own to fill:** there is no actor user on the context. Quotes
need a `createdByUserId`. Resolve it exactly as `task.create` does — from the lead's handler — and
fail preflight with a `no_handler`-shaped problem when there is none.

---

## 7. Existing communication actions — reuse assessment

| Concern | `email.send` | `whatsapp.send` | Reusable for `quote.send`? |
| --- | --- | --- | --- |
| Destination resolution | `requires:['email']` → `recipientFieldFor(event,'email')` → `recipients[key]` | `requires:['phone']` + `resolveWhatsappOutboundTarget` | **Yes, unchanged** |
| Missing destination | `no_email` skip | `no_phone` skip | **Yes** |
| Content model | authored `subject`/`body` + variable chips + optional CTA | **template-only**, chosen not typed | see below |
| Opt-out | `suppression` (email unsubscribe) | `opt_out` (messaging "עצור") — deliberately distinct | **Yes — declare the right one per action** |
| Bad address | `bounce_block` | not declared (no phone block list; `recipientBlocks` treats an unregistered kind as unblocked) | Yes for email |
| Caps / quiet hours | `per_lead_cap`, `agency_cap`, `quiet_hours` | same | **Yes** |
| Failure | throw → release claim → retry → dead | same | **Yes** |
| Activity | `appendActivity` + `deliveryState` + `providerMessageId` | same | **Yes** |
| Test send | `testable: true` | `testable: false` — a WhatsApp test costs money and template rating | quote: `false` (a test quote is a real DB row) |
| Preview | `shape:'email'` | `shape:'message'` | `record` for prepare, `email` for send |

### 7.1 The WhatsApp constraint you must plan around

From [executors/whatsapp.ts](lib/automations/executors/whatsapp.ts):

> **TEMPLATE-ONLY**, by the audit's decisive conclusion. An automation is business-initiated and
> usually delayed … so Meta's 24-hour customer-service window is normally CLOSED, and a free-text
> send would fail for most automations most of the time.

So *"send the quote on WhatsApp"* is **not** free text with a link. It requires an approved Meta
template carrying the quote link in a parameter slot, plus `templateBindings` mapping that slot.
That is a product and Meta-approval workload, not a code one — which is why WhatsApp quote delivery
belongs in a later phase than email.

### 7.2 The async-PDF tension, and the way around it

The quote PDF renders **asynchronously** (Gotenberg → presigned PUT → S3, observed by an
`S3 HeadObject` poll — see the entity audit §1.2). The worker's `execute()` cannot wait for it:
the cron runs `limit: 25` jobs under `maxDuration = 60`, and blocking on a render would starve the
queue and trip leases.

Three options, one correct:

| Option | Verdict |
| --- | --- |
| `execute()` polls until the PDF is ready | **No.** Blocks a worker slot ~10–30s per job under a 60s lease. |
| Enqueue a second, follow-up job after render | **No.** That is a parallel scheduling system — explicitly out of scope. |
| **Email a link to the quote; render in the background** | **Yes.** `execute()` becomes a DB write + one `sendEmail`. The link resolves the PDF when a human opens it, seconds later. |

The invoice path already embeds a URL rather than an attachment (`InvoiceSentEmail` takes `pdfUrl`),
so this is the existing pattern, not a new one. **No engine change.**

---

## 8. Proposed quotation action

### 8.1 Does the `action + subtype` model match the existing vocabulary?

**No — and the reason is structural, not stylistic.**

`laws` and `requires` are declared **per action key**, and the engine composes the law pipeline from
that declaration ([laws.ts `composeLawPipeline`](lib/automations/laws.ts)). A subtype stored in
`parameters` is invisible to that composition. So a single `quote` action with
`subtype ∈ {create, send, create_and_send}` would have to declare **one** law set covering both, and
both possible answers are wrong:

- declare `suppression` → a suppressed lead gets **no quote drafted for the rep**, contradicting the
  frozen §3.8 correctness case that `task.create` exists to demonstrate;
- omit `suppression` → a suppressed lead gets a quote **emailed to them**. Unacceptable.

The same argument kills `channel` as a parameter: `requires: ['email']` vs `['phone']` and
`suppression` vs `opt_out` differ by channel, and `requires` is what makes actions self-filter in
the picker. Declaring `requires: ['email','phone']` would demand both; declaring `[]` would offer
the action on events that cannot deliver it, which the architecture explicitly refuses
(*"an event without one can never offer this action, which is exactly right"*).

**Recommendation: separate action keys. Channel and internal/external live in the key.**

### 8.2 The proposed actions

| Key | Title | `requires` | `laws` | `risk` | `preview` | `testable` |
| --- | --- | --- | --- | --- | --- | --- |
| `quote.prepare` | הכנת הצעת מחיר לנציג | `[]` | `['send_once']` | `internal` | `record` | `false` |
| `quote.send` | שליחת הצעת מחיר במייל | `['email']` | `['send_once','per_lead_cap','agency_cap','suppression','bounce_block','quiet_hours']` | `external` | `email` | `false` |
| *(later)* `quote.send_whatsapp` | שליחת הצעת מחיר בוואטסאפ | `['phone']` | `['send_once','per_lead_cap','agency_cap','opt_out','quiet_hours']` | `external` | `message` | `false` |

`quote.prepare`'s law set is `['send_once']` and nothing else — **identical reasoning to
`task.create`**: suppression is consent not to be *contacted*, which says nothing about preparing
internal work for the rep.

### 8.3 Challenge: "Send quotation" as a standalone automation action does not exist

The brief lists three actions: create / send / create-and-send. Two of them are real; one is not.

The engine executes **exactly one action per definition** — `actionEntryFor(def)` returns
`def.actions[0]`, and V1 executes only that. So a definition cannot "create, then send". And a
standalone *send* would need a quote to already exist and be unsent — which no current trigger can
express, because there is no `quote.*` **event** (that is a different feature: quote-triggered
automations, out of scope here).

Therefore:

- `quote.prepare` = the brief's **create** (draft + a task for the rep to review and send)
- `quote.send` = the brief's **create-and-send** (create → ready → dispatch render → email the link)
- standalone **send** is not expressible and should not be built

Two actions cover all three requested behaviours honestly.

### 8.4 The product blocker: there is no quote template

Both actions take `quoteTemplateId`, and **nothing in the repository provides one.** There is no
product/service catalog and no reusable line-item set. Without it:

- `quote.send` would email an **empty quote**, or
- something would have to **invent the prices** — which the care charter's Law 1 forbids outright,
  and which `lib/inbox/autoresponse/validate.ts` already blocks the auto-responder from doing.

> **A `sales_quote_templates` concept (a named, agency-owned set of line items) is a hard
> prerequisite for the automation, not a nice-to-have.** It is also the thing `optionSource:
> 'quote_templates'` resolves against, which is why §4.4's first-party option source is needed.

Sequence accordingly: quote entity → quote templates → quotation automation. Building the action
first produces a builder screen whose only dropdown is permanently empty.

---

## 9. Business invariants

| # | Case | Existing convention | New work |
| --- | --- | --- | --- |
| 9.1 | **Existing open quote** — automation tries to create another | `send_once` already prevents *this automation* from ever quoting *this lead* twice. Cross-automation duplication is genuinely uncovered. | Add `hasOpenQuote` as a **live boolean** field on the `lead` subject + a resolver in `subject.ts`. It becomes a customer condition (`אין הצעה פתוחה`) and is re-read at execution, so it works through delays. **Do not add a law key yet** — follow the `window_24h` discipline: declare nothing until a real caller proves it is needed. |
| 9.2 | **Already sent / fires twice** | Two independent layers: the job unique index `(automationId, leadId, eventKey)` `ON CONFLICT DO NOTHING`, and `automation_send_claims` unique `(automationId, leadId, 'ever')`. Second attempt → `already_sent` skip + activity row. | None |
| 9.3 | **Missing destination** | `requires: ['email']` → `no_email`; `['phone']` → `no_phone`. `quote.prepare` requires nothing and is unaffected. | None |
| 9.4 | **Lead changed state during the delay** | Live conditions re-evaluated at execution → `premise_expired` (§5.2) | None |
| 9.5 | **Quote template deleted / invalid** | Exactly `whatsapp.send`'s `template_not_found` / `template_not_approved` shape: a **preflight** problem → `dead` in live mode, never retried, plus a save-time check in `manage.ts` so an unsendable automation cannot be stored | Copy the pattern |
| 9.6 | **Deleted lead** | `universalGuards`: `!f.lead.exists` → `lead_deleted`. Activity rows snapshot `leadName` so history survives. | None |
| 9.7 | **Duplicate execution / crash mid-flight** | Claim → effect → confirm. An unconfirmed claim in live mode ⇒ `dead('ambiguous_after_crash')`, **never retried** — the engine refuses to guess whether the effect happened. | **This one needs executor-owned work.** If `execute()` creates the quote and the email then fails, throwing retries and would create a **second quote**. The executor must be internally idempotent: stamp `sales_quotes.metadata.automationKey = 'auto:{automationId}:lead:{leadId}'` and look it up before creating. This is the executor's own business — no engine change. |
| 9.8 | **Action failure** | `execute()` throws → `releaseClaim` → `failJob` → `pending` with `LEAST(attempts,5)*30s` backoff → `dead` at `maxAttempts` + a `failed` activity row. **Retry, not skip, not fail-the-automation** — a definition is never disabled by a failing job. | None, given 9.7 |
| 9.9 | **Observation mode** | `AUTOMATIONS_SEND_MODE !== 'live'` ⇒ `execute()` must return `would_send` and perform **no effect**. | The quote executor must honour this — a `would_send` that still writes a `sales_quotes` row would corrupt the pilot's meaning. Follow `task.create`: `if (ctx.mode !== 'live') return { kind: 'would_send', … }`. |

New `SKIP_REASONS` values needed: **at most one** (`quote_template_missing`), and only if 9.5's
preflight-dead path is judged too harsh. Prefer zero.

---

## 10. UX recommendation

No new patterns. The sheet already renders every control this needs.

```
Automation Library → "אוטומציה חדשה"        [ModalPop, existing]

  שם האוטומציה                              [Input, existing]
  ───────────────────────────────────────
  כש    מתי זה צריך לקרות                    [Select, grouped by subject — existing]
        › לידים  ›  סטטוס הליד השתנה
  ───────────────────────────────────────
  תנאים  סטטוס הליד  is  מעוניין             [ConditionsEditor, existing]
         אין הצעה פתוחה  is_true             [same editor — new catalog FIELD, not new UI]
  ───────────────────────────────────────
  מה לעשות                                   [Select — appears only when >1 offerable]
        › שליחת הצעת מחיר במייל
        הצעת המחיר      [ ▾ ]                [RemoteParameters — enum_remote, EXISTING renderer]
        תוקף ההצעה בימים [ 14 ]              [RemoteParameters — number]
  ───────────────────────────────────────
  מתי לשלוח   › שעתיים אחרי                   [AutomationTimingSection, existing]
  ───────────────────────────────────────
  תצוגה מקדימה                                [AutomationPreviewSection — shape 'email']

  [ שמור אוטומציה ]                           → saved as draft; activated from the card
```

The action picker appears automatically because `listActionsForEvent` now returns more than one
entry. The parameter block is `RemoteParameters`, which already exists and is already used for event
parameters. **Zero new components.** The only builder edit is making
`AutomationActionSection` route non-email, non-template actions to that existing renderer (§1.3).

Terminology stays `ליד` / `נציג` / `הצעת מחיר` (never `לקוח`, never `סוכן`), and the timing copy
keeps `TIMING_ACCURACY_COPY`'s honest "approximately" framing.

---

## 11. Does the engine already have the primitives?

> **Yes — with one exception, and that exception is not about quotations.**
> The engine needs no new capability. It needs a five-year-old CHECK constraint widened so that
> *any* action other than email can be saved at all.

### Already exists — zero change

Trigger/event catalog and its CI validation · condition model with `snapshot`/`live` freshness ·
two-phase condition evaluation (emission + execution) · `premise_expired` · delay and
before-anchor timing · anchor-miss semantics · job queue with `FOR UPDATE SKIP LOCKED`, 60s lease,
stale reclaim, linear backoff, dead-lettering, 90-day prune · send-once claims with crash recovery ·
per-action law composition · recipient resolution by field type · missing-recipient skip reasons ·
opt-out vs suppression separation · daily caps counted across **both** automated senders ·
observation mode · activity log with delivery-state ladder · executor registry + two-phase contract
+ executor-owned dependencies · generic `enum_static`/`enum_remote` parameter renderer · preview and
test contracts · action picker filtered by `requires` × event fields · agency scoping · requirement
gating (connection / entitlement / flag) · Hebrew skip copy · the 5-minute cron heartbeat.

### Small additions — catalog data plus one module each

1. 2 action catalog entries (`quote.prepare`, `quote.send`)
2. 2 executor modules + 2 registry lines
3. 2 optional fields on `DefinitionContent` + 2 projection lines + the `manage.ts`/`SheetDraft`
   round-trip (**no migration** — `content` is jsonb)
4. `RemoteParameters` wired to action parameters in `AutomationActionSection` (~10 lines)
5. A **connection-less option source** for `enum_remote` (§4.4) — one server action + one branch
6. `hasOpenQuote` live boolean field on the `lead` subject + one resolver in `subject.ts`

### Genuine engine changes — exactly one

**Widen `automation_definitions.action`.** One migration dropping and re-adding the CHECK, four
entries in `ACTION_KEY_TO_ENGINE_ACTION` / `ENGINE_ACTION_TO_ACTION_KEY`, `ACTION_TYPES` extended
(append-only), and the `bridgedActionKeys()` conformance assertion updated deliberately rather than
accidentally.

This unblocks `task.create` and `whatsapp.send` at the same time. **It is a pre-existing production
defect, and it should be fixed and shipped on its own merits before any quotation work begins.**

Everything else the brief worried about — a parallel engine, a parallel scheduler, new timing
semantics, a new state-validation mechanism, redesigning the Library — is **not needed**.

---

## 12. Phased implementation plan

Each phase is independently shippable and independently revertible. Everything from Phase B onward
stays behind the existing `AUTOMATIONS_ENABLED` + `AUTOMATIONS_AGENCY_ALLOWLIST` gates and defaults
to `AUTOMATIONS_SEND_MODE=log`.

### Phase A — Unblock the action vocabulary *(no quotation code at all)*
- Verify the production constraint with the two SQL probes in §3.4.
- Migration: drop and re-add `automation_definitions_action_check` admitting the full set.
- Bridge entries for `task.create` and `whatsapp.send`; extend `ACTION_TYPES`; update the
  `bridgedActionKeys()` assertion.
- **Gate:** a `task.create` automation saves, activates, and runs. Email automations are byte-identical.
- **Ships value on its own** — two finished actions become reachable.

### Phase B — Generic action-parameter rendering
- `AutomationActionSection` routes to `RemoteParameters` by default; email content and WhatsApp
  templates become the two named special cases.
- Add the connection-less `enum_remote` option source (§4.4).
- **Gate:** existing email and WhatsApp automations round-trip unchanged through save → reopen.

### Phase C — `quote.prepare` (internal, reversible, lowest risk)
- Catalog entry + executor (`task.create` is the 78-line model).
- `quoteTemplateId` / `quoteValidityDays` on `DefinitionContent` + projection + `SheetDraft` round-trip.
- Executor idempotency via `metadata.automationKey` (§9.7); honours `mode !== 'live'` (§9.9).
- **Prerequisite:** the quote entity and `sales_quote_templates` exist (§8.4).
- **Gate:** a draft quote appears on the lead with a task for the rep; a suppressed lead still gets one.

### Phase D — `quote.send` (external)
- Catalog entry with the full external law set; executor creates → ready → dispatches render →
  emails a **link** (§7.2).
- Save-time template validation in `manage.ts` mirroring `validateTemplateChoice`.
- `QuoteSentEmail` template.
- **Gate:** end to end in log mode first; caps, suppression, `no_email` and `premise_expired` all
  observed in the activity log before `AUTOMATIONS_SEND_MODE=live` for one pilot agency.

### Phase E — Safeguards proven against real data
- `hasOpenQuote` live field + condition (§9.1).
- Decide from pilot evidence whether an engine-level quote guard is warranted; add it only then,
  in the `appointmentGuard` shape.
- **Gate:** no duplicate quotes across a full pilot window.

### Phase F — `quote.send_whatsapp` *(only after Meta template approval)*
- Approved template carrying the quote link in a parameter slot + `templateBindings`.
- **Gate:** template approved by Meta before any code merges.

### Deferred
Quote-triggered **events** (`quote.viewed`, `quote.accepted`, `quote.expiring`) — these make
quotations an event *subject* as well as an action, need a `scheduled` trigger origin and an expiry
evaluator, and belong to the quotation entity roadmap, not here.

---

## Deliverable summary

**1. Current automation flow** — §0. Event-first single-modal builder (WHEN → IF → THEN → WAIT),
save-as-draft then activate separately; emission decides snapshot conditions *and* the schedule;
a 5-minute cron worker claims jobs and runs claim → preflight → law pipeline → effect → confirm.

**2. Exact integration point** — the `THEN` step, as one more entry in `ACTION_ENTRIES`. It appears
in the picker automatically via `listActionsForEvent` = `requires` × event field types. No new
section, no new step, no builder redesign.

**3. Existing reusable infrastructure** — everything in §11's first list. Most importantly: the
two-phase executor contract, the per-action law composition, the send-once claim, and the
`snapshot`/`live` freshness split that already answers the state-during-delay question.

**4. Missing pieces** — (a) the `action` CHECK constraint blocks *any* non-email action from being
saved, today, including the two already shipped; (b) `AutomationActionSection` has a two-way
email/template hardcode where a generic renderer already exists next door; (c) `enum_remote` cannot
resolve options for first-party data; (d) **there is no quote template concept**, without which a
quotation automation has nothing to quote.

**5. Recommended action model** — two separate action keys, not one action with a subtype.
`quote.prepare` (internal, `laws:['send_once']`, `requires:[]`) and `quote.send` (external, full law
set, `requires:['email']`). Subtypes and a `channel` parameter are both structurally impossible
because `laws` and `requires` are declared per action key and drive both the picker and the pipeline.
Standalone "send an existing quote" is not expressible in a single-action engine and should not be built.

**6. UX flow** — §10. Existing `ModalPop`, existing sections, existing `RemoteParameters`. Zero new
components.

**7. Edge cases / invariants** — §9. Eight of nine are already handled by existing engine
conventions. The one genuinely new obligation is executor-level idempotency, so that a retry after a
failed email cannot create a second quote.

**8. Phased plan** — §12, six phases, the first two containing no quotation code.

**9. What we should build first**

> **Phase A — widen the `action` CHECK constraint and the engine bridge.**

It is a pre-existing production defect, not quotation scope: `task.create` and `whatsapp.send` are
finished, tested, and unsaveable. It is one migration and four map lines. It ships user-visible value
on its own. Every subsequent phase is blocked behind it, and no amount of quotation design changes
that.

**Do not start with the quotation action.** Beyond Phase A, `quote.send` has a hard product
prerequisite the automation layer cannot supply: a quote template. Until a named, reusable set of
line items exists, a quotation automation can only send an empty quote or an invented price — and
the second is forbidden outright.
