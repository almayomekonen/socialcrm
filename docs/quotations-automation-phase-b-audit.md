# Quotation as an Automation Action — Phase B Audit

**Status:** audit. No implementation. Supersedes nothing.
**Predecessors:** [quotations-architecture-audit.md](quotations-architecture-audit.md) (the entity),
[quotations-automation-audit.md](quotations-automation-audit.md) (Phase A scoping).
**Baseline:** the tree at `fix/automation-action-vocabulary` — Phase A merged into the working
branch, commit `274a41ac`.

---

## 0. What Phase A changed, and why it matters here

Phase A was not only a constraint fix. It exercised the whole "add an action" path twice and turned
three assumptions into verified facts:

| Phase A change                                                                                                                      | Consequence for Quotation                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automation_definitions.action` CHECK widened; bridge made total; CI now pins catalog ↔ bridge ↔ `ACTION_TYPES` in both directions  | A fourth action fails CI if unregistered, rather than failing at the INSERT. The registration checklist in §2 is now _enforced_, not remembered.                                                                                                      |
| `title` joined `DefinitionContent`; the Builder gained a third configuration shape selected by the action's own declared parameters | There is a **proven pattern** for "an action with its own config": a flat optional field on the content document, a conditional projection line, and one branch in `AutomationActionSection`. Quotation is the fourth instance of it, not a new idea. |
| `authoredContentOf` replaced the hand-listed duplicate                                                                              | Any field Quotation adds to the content document survives duplication automatically. No new obligation.                                                                                                                                               |

Two things Phase A deliberately did **not** do, and Quotation must not assume: it did not build a
generic parameter renderer, and it did not touch scheduling, claims, laws or the worker.

---

## 1. Current action architecture, traced

Traced end to end on **`task.create`** — the configurable, non-communication action, and the closest
structural analogue to `quote.create`. `whatsapp.send` is compared alongside because it is the
closest analogue to `quote.send_email`.

### 1.1 The trace

| Stage               | File · symbol                                                                                             | What happens                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Library**         | [AutomationsSettings.tsx](components/settings/automations/AutomationsSettings.tsx)                        | "אוטומציה חדשה" opens one `ModalPop`; `BLANK` from [automationDrafts.ts](components/settings/automations/automationDrafts.ts) seeds it                                                        |
| **Action offered**  | [registry.ts `listActionsForEvent`](lib/automations/catalog/registry.ts)                                  | `catalog.actions.filter(a => a.requires.every(t => eventFieldTypes.has(t)))`. `task.create` declares `requires: []`, so it is offered on **every** event                                      |
| **Action chosen**   | [AutomationSheet.tsx](components/settings/automations/AutomationSheet.tsx)                                | `chosenActionKey` state; falls back to `actions[0]`. The `Select lbl='מה לעשות'` renders **only when `actions.length > 1`**                                                                   |
| **Config shape**    | [AutomationActionSection.tsx](components/settings/automations/AutomationActionSection.tsx)                | Three-way branch on the action's **own declared parameters**: `templateId` → `AutomationTemplateSection`; `title` → `AutomationTitleSection`; else → `AutomationContentSection`               |
| **Config authored** | [AutomationTitleSection.tsx](components/settings/automations/AutomationTitleSection.tsx)                  | One `Input`, `lbl` and `maxLength` read from the catalog `ParameterDefinition`; chips from `TITLE_VARIABLE_FIELDS`, CI-pinned to `taskExecutor.resolvableFields`                              |
| **Payload**         | `AutomationSheet.payload()`                                                                               | `{ …, actionKey, title, subject, body, templateId, templateBindings, timing }`                                                                                                                |
| **Validated**       | [manage.ts `validate`](actions/automations/manage.ts)                                                     | Action resolved **first**, then judged by its own shape: `isTemplateAction` → template required; `isTitleAction` → `title_required` / `title_invalid` / `unknown_variable`; else subject+body |
| **Content built**   | `manage.ts toContent`                                                                                     | Flat `DefinitionContent`; every action's fields present, `null` when unused                                                                                                                   |
| **Persisted**       | [definitions.ts `createDefinition`](db/automations/definitions.ts)                                        | `action = engineActionForActionKey(actionKey)` (→ `create_task`), `content` jsonb, `actions = actionsForContent(actionKey, content)`                                                          |
| **Projection**      | [actionEntry.ts `actionParametersFromContent`](lib/automations/actionEntry.ts)                            | `content` → `actions[0].parameters`. Conditional per field: `title` is projected only when non-blank                                                                                          |
| **Activated**       | `manage.ts setAutomationStatus`                                                                           | Separate call; save always writes `status: 'draft'`                                                                                                                                           |
| **Emitted**         | [emit.ts `emitAutomationEventWith`](lib/automations/emit.ts)                                              | origin gate → kill switch → allowlist → active definitions → **snapshot conditions** → `resolveSendAtDetailed` → `enqueueAutomationJob`                                                       |
| **Queued**          | [jobs.ts](db/automations/jobs.ts)                                                                         | SQL re-checks the definition is active; `ON CONFLICT (automationId, leadId, eventKey) DO NOTHING`                                                                                             |
| **Drained**         | [api/cron/automations-dispatch](app/api/cron/automations-dispatch/route.ts) `*/5 * * * *`                 | `reclaim(60s)` → `claim(25)` → `processJob`                                                                                                                                                   |
| **Resolved**        | [worker.ts `processJob`](lib/automations/worker.ts)                                                       | `actionKeyFor(def)` → `getAction` → `executorFor`; all three fail **closed** to `action_unavailable`                                                                                          |
| **Facts**           | [workerFacts.ts `resolveSubjectContext`](lib/automations/workerFacts.ts)                                  | three lazy key-sets: live premise, recipients, executor variables                                                                                                                             |
| **Laws**            | [laws.ts `decideSendForAction`](lib/automations/laws.ts)                                                  | universal guards, then the pipeline **composed from the action's declared `laws`**                                                                                                            |
| **Preflight**       | `taskExecutor.preflight`                                                                                  | `deps.handlerId(agencyId, leadId)`; no handler ⇒ a `PreflightProblem` → `dead` in live mode                                                                                                   |
| **Claim**           | [claims.ts `claimSendOnce`](db/automations/claims.ts)                                                     | `(automationId, leadId, 'ever')`, conflict-ignore                                                                                                                                             |
| **Effect**          | `taskExecutor.execute`                                                                                    | substitutes `{{שם הליד}}`, calls `deps.createTask` → `createSystemTask`                                                                                                                       |
| **Recorded**        | [activity.ts `appendActivity`](db/automations/activity.ts) + `confirmSendClaim` + `completeAutomationJob` | `kind: 'sent' \| 'would_send'`, `subject` = one-line summary                                                                                                                                  |

### 1.2 The three shipped actions, compared

|                    | `email.send`                                                                | `task.create`            | `whatsapp.send`                                               |
| ------------------ | --------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| `requires`         | `['email']`                                                                 | `[]`                     | `['phone']`                                                   |
| `laws`             | send_once, per_lead_cap, agency_cap, suppression, bounce_block, quiet_hours | **send_once only**       | send_once, per_lead_cap, agency_cap, **opt_out**, quiet_hours |
| `risk` / `preview` | external / email                                                            | internal / record        | external / message                                            |
| `requirements`     | —                                                                           | —                        | `connection: whatsapp_connected`                              |
| Config shape       | subject + body + CTA                                                        | one title                | template + slot bindings                                      |
| Config source      | authored text                                                               | authored text            | chosen from a remote list                                     |
| Deps               | mailer                                                                      | handler id + task writer | template store + target resolver + Graph + persistence        |
| Domain seam        | `lib/email/sender`                                                          | **`createSystemTask`**   | `sendWhatsappTemplate` + `persistOutboundWhatsapp`            |

**`task.create`'s law set is the architectural proof that matters here.** It declares `send_once`
and nothing else, so a _suppressed_ lead still gets a task — suppression is consent not to be
contacted, which says nothing about internal record-keeping. That distinction is expressed
**entirely in the catalog entry**, and it is the reason §3 rejects a `mode` parameter.

---

## 2. Exact integration point

### 2.1 Where `quotation` registers

Verified against the Phase A change set — this is the complete list, in dependency order.

| #   | Registration point                                         | File                                                          | Needed?           |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------- | ----------------- |
| 1   | **Action catalog entry**                                   | `lib/automations/catalog/entries/actions.ts`                  | **yes**           |
| 2   | **Persisted vocabulary** — `ACTION_TYPES` (append-only)    | `lib/automations/types.ts`                                    | **yes**           |
| 3   | **Engine bridge** — both maps                              | `lib/automations/catalog/engineBridge.ts`                     | **yes**           |
| 4   | **DB CHECK** — widen `automation_definitions_action_check` | new migration                                                 | **yes**           |
| 5   | **Executor** + registry entry                              | `lib/automations/executors/quote.ts`, `executors/registry.ts` | **yes**           |
| 6   | **Authored field(s)** on `DefinitionContent`               | `db/automations/definitions.ts`                               | yes (has config)  |
| 7   | **Projection line**                                        | `lib/automations/actionEntry.ts`                              | yes (has config)  |
| 8   | `AutomationInput` + `toContent` + `validate` branch        | `actions/automations/manage.ts`                               | yes (has config)  |
| 9   | `SheetDraft` + state + `payload()`                         | `AutomationSheet.tsx`                                         | yes (has config)  |
| 10  | Config-shape branch + section component                    | `AutomationActionSection.tsx` + new file                      | yes (new shape)   |
| 11  | Draft round-trip                                           | `settings/automations/page.tsx`, `automationDrafts.ts`        | yes (has config)  |
| 12  | Hebrew error copy                                          | `sheetOptions.ts`                                             | yes (new reasons) |
| 13  | Skip reasons + copy                                        | `types.ts` `SKIP_REASONS`, `copy.ts`                          | only if new skips |
| 14  | Conformance tests                                          | `catalogConformance.test.ts`, `executors.test.ts`             | **yes**           |

### 2.2 What needs **no** change — verified, not assumed

- **Action picker** — `listActionsForEvent` filters by `requires` × event field types. Nothing to add.
- **Card label** — `AutomationCard` reads `getAction(actionKey)?.title` ([line 122](components/settings/automations/AutomationCard.tsx#L122)).
- **Sentence** — `automationSentence` takes `actionTitle` as data.
- **Laws** — `composeLawPipeline` builds the pipeline from the action's declared `laws`.
- **Worker, queue, scheduling, leases, retries, claims, activity, cron** — untouched.
- **Vocabularies** — `quote.create` is `risk: 'internal'`, `preview: 'record'`; `quote.send_email`
  is `external` / `email`. Both already in `ACTION_RISKS` and `PREVIEW_SHAPES`. **No vocabulary
  widening, so Law 4 is not engaged.**

---

## 3. Recommended action model

### 3.1 The proposed shape, tested against the architecture

```ts
quotation: {
  mode: ('create' | 'create_and_send', templateId, channel)
}
```

**Rejected. Three independent reasons, each fatal on its own.**

**(a) `mode` cannot be a parameter, because `laws` is per action key.** The pipeline is composed in
`composeLawPipeline(action.laws, action.requires, …)` from the _catalog entry_, before any parameter
is read. A single entry must declare one law set covering both modes:

| If the entry declares | `create` behaviour                                                                                                                   | `create_and_send` behaviour                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `suppression`         | a suppressed lead gets **no quote drafted for the rep** — contradicts the exact correctness case `task.create` exists to demonstrate | correct                                                 |
| no `suppression`      | correct                                                                                                                              | a suppressed lead is **emailed a quote**. Unacceptable. |

There is no third option. `risk` (`internal` vs `external`) and `preview` (`record` vs `email`) are
per-key for the same reason.

**(b) `channel` cannot be a parameter, because `requires` is per action key** — and `requires` does
two jobs: it filters the picker (`listActionsForEvent`), and it selects the missing-recipient skip
reason (`MISSING_RECIPIENT`: `email → no_email`, `phone → no_phone`). Declaring
`requires: ['email','phone']` would demand _both_; declaring `[]` would offer the action on events
that cannot deliver it, which the architecture explicitly refuses. Consent differs too:
`suppression` (email unsubscribe) vs `opt_out` (messaging "עצור") are deliberately distinct.

**(c) The nesting is unprecedented.** `DefinitionContent` is **flat** — `subject`, `body`,
`ctaLabel`, `ctaUrl`, `templateId`, `templateBindings`, `title`. `actionParametersFromContent`
projects field by field. A nested `quotation: {…}` object would be the first nested config in the
document and would need special projection handling for no benefit.

### 3.2 Recommended: two action keys, flat config

| Key                | Title                 | `requires`  | `laws`                                                                                 | `risk`     | `preview` | `testable` |
| ------------------ | --------------------- | ----------- | -------------------------------------------------------------------------------------- | ---------- | --------- | ---------- |
| `quote.create`     | הכנת הצעת מחיר לנציג  | `[]`        | `['send_once']`                                                                        | `internal` | `record`  | `false`    |
| `quote.send_email` | שליחת הצעת מחיר במייל | `['email']` | `['send_once','per_lead_cap','agency_cap','suppression','bounce_block','quiet_hours']` | `external` | `email`   | `false`    |

Engine values (append-only, verb_noun like `send_email` / `create_task`): `create_quote`,
`send_quote_email`. A later `quote.send_whatsapp` → `send_quote_whatsapp`.

**`quote.send_email` creates _and_ sends.** A standalone "send an existing quote" action is not
expressible: the engine executes exactly one action per definition (`actionEntryFor` = `actions[0]`),
and no current trigger can mean "a quote exists and is unsent" — that would require a `quote.*`
**event**, which is a different feature. So the brief's three behaviours map honestly onto two keys.

---

## 4. Configuration schema

Flat optional fields on the existing jsonb document — **no migration**, exactly the trade `templateId`
and `title` already made.

```ts
// db/automations/definitions.ts — DefinitionContent
quoteTemplateId?: number | null      // which quote to build from
quoteValidityDays?: number | null    // optional; falls back to the domain default
```

```ts
// lib/automations/catalog/entries/actions.ts — declared on BOTH quote actions
parameters: [
  {
    key: 'quoteTemplateId',
    type: 'enum_remote',
    label: 'הצעת המחיר',
    optionSource: 'quote_templates',
    validation: { required: true },
  },
  { key: 'quoteValidityDays', type: 'number', label: 'תוקף ההצעה בימים', validation: { min: 1, max: 90 } },
]
```

```ts
// lib/automations/actionEntry.ts — two conditional projection lines
if (content.quoteTemplateId != null) parameters.quoteTemplateId = content.quoteTemplateId
if (content.quoteValidityDays != null) parameters.quoteValidityDays = content.quoteValidityDays
```

**No `mode` field** — the action key is the mode. **No `channel` field** — the action key is the
channel. Both are recoverable from `actionKeyFor(def)`, which the card, the sheet and the worker
already read.

### 4.1 One honest wrinkle

`enum_remote` is documented as "the key passed to `connection.options(sourceKey)`", and both
resolution doors are connection-scoped: `listOptionsAction(connectionId, …)` and
`listOptionsForCapabilityAction(capability, …)` — the latter returns `{ ok: true, options: [] }`
when no connection grants the capability. A quote template is **first-party agency data behind no
connector and no capability**, so it resolves empty through both.

`whatsapp.send` already stretches this: its options come by _capability_, not by the event's bound
connection, and it is rendered by a dedicated component rather than by `RemoteParameters`. Quotation
takes the same road one step further — see §5.2. The type declaration stays `enum_remote` (no
vocabulary change); only the resolver differs.

---

## 5. Builder UX

### 5.1 The proposed flow, corrected

The brief's mock has three selects:

```text
THEN  [ הצעת מחיר ]
פעולה:      [ צור הצעת מחיר ▼ ]
הצעת מחיר:  [ בחר הצעה / תבנית ▼ ]
ערוץ:       [ WhatsApp / Email ]
```

Two of the three already exist or should not exist:

- **"פעולה" is the existing action picker.** `AutomationActionSection` already renders
  `<Select lbl='מה לעשות'>` over `listActionsForEvent(event)`, and it appears automatically once more
  than one action is offerable. `quote.create` and `quote.send_email` are two entries in **that**
  dropdown — not a nested sub-select under a "Quotation" umbrella.
- **"ערוץ" must not exist** (§3.1b). The channel is in the key: `quote.send_email` vs a future
  `quote.send_whatsapp` are two rows in the same list.

### 5.2 The smallest configuration UI

```text
  ───────────────────────────────────────
  מה לעשות   [ שליחת הצעת מחיר במייל ▼ ]     ← EXISTING Select, existing component
             שולח לליד הצעת מחיר מוכנה        ← EXISTING action.description line
  ───────────────────────────────────────
  שליחת הצעת מחיר במייל                       ← section heading = action.title (existing pattern)
  הצעת המחיר        [ בחר תבנית ▼ ]           ← ONE new control
  תוקף ההצעה בימים  [ 14 ]                    ← optional
  ───────────────────────────────────────
  מתי לשלוח   [ שעתיים אחרי ▼ ]               ← EXISTING AutomationTimingSection
  תצוגה מקדימה                                ← EXISTING AutomationPreviewSection
```

**One new component: `AutomationQuoteSection.tsx`** — the fourth branch in
`AutomationActionSection`'s parameter-driven switch, keyed on a declared `quoteTemplateId`
parameter:

```
templateId → AutomationTemplateSection      (whatsapp.send)
title      → AutomationTitleSection         (task.create)     ← added in Phase A
quoteTemplateId → AutomationQuoteSection    (quote.*)         ← Phase B
else       → AutomationContentSection       (email.send)
```

It fetches its own options from a first-party server action (`listQuoteTemplatesAction`), exactly as
`AutomationTemplateSection` fetches via `listOptionsForCapabilityAction` and `listTemplateSlots`.
That is the precedent, it needs **zero** change to `RemoteParameters` or the connection layer, and
it is ~45 lines.

**Alternative considered:** extend the option-resolution layer with a generic first-party source and
render through `RemoteParameters`. Cleaner long-term, and it is the natural consolidation once a
_third_ first-party picker exists. Deferring it matches the repo's own "optimise from evidence, not
anticipation" principle: two instances is not yet a pattern.

**Preview:** `quote.create` → `record` shape (already renders a one-line summary — Phase A repointed
it at the action's own authored value). `quote.send_email` → `email` shape, which routes through the
executor's `preview()`, so what the customer approves is what the lead receives.

---

## 6. Execution contract

The existing `ExecutionContext` ([executors/types.ts](lib/automations/executors/types.ts)) is
sufficient. **No engine change.**

| Required                      | Source                                             | Notes                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **agency**                    | `ctx.agencyId`                                     | from the job row; the worker re-verifies `def.agencyId === job.agencyId`                                                                                                                          |
| **lead**                      | `ctx.leadId`                                       | every event must declare `identity.leadResolution` or CI rejects it                                                                                                                               |
| **owner / user**              | **not on the context** — the executor fetches it   | `deps.handlerId(agencyId, leadId)` → `getLeadHandlerId` (falls back `handlerId ?? userId`). This is the `task.create` precedent and it is deliberate: the worker declares no executor dependency. |
| **quotation config**          | `ctx.parameters`                                   | `{ quoteTemplateId, quoteValidityDays }`                                                                                                                                                          |
| **communication destination** | `ctx.recipients.email`                             | resolved from `requires: ['email']` via `recipientFieldFor(event, 'email')`. Empty `{}` for `quote.create`                                                                                        |
| **lead variables**            | `ctx.subject`                                      | keyed by catalog field key, from `resolvableFields`                                                                                                                                               |
| **execution identity**        | `ctx.agencyId` + `ctx.automationId` + `ctx.leadId` | **this triple is the idempotency key material** — §7                                                                                                                                              |
| **mode**                      | `ctx.mode`                                         | `'live' \| 'log'`; a `log` pass must perform **no** effect                                                                                                                                        |

`quote.create` needs no recipient at all, so it declares `requires: []` and `ctx.recipients` is `{}`
— the same shape `task.create` already runs on.

**Preflight vs execute** (ADR-013, and the rule that shapes §7):

- `preflight` runs **before** the claim and must have **no effects**. It resolves the template, the
  handler, and the recipient, and returns a `PreflightProblem` for any configuration fault → `dead`
  in live mode, never retried.
- `execute` runs **after** the claim. Returning normally confirms it; **throwing releases the claim
  and the job retries.**

---

## 7. Idempotency

### 7.1 The existing model — three layers, none to be reinvented

| Layer               | Mechanism                                                                                                                                     | Protects against                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Emission dedup**  | `automation_jobs` unique `(automationId, leadId, eventKey)` + `ON CONFLICT DO NOTHING`                                                        | webhook retries, duplicate emissions of the same occurrence                                    |
| **Send-once claim** | `automation_send_claims` unique `(automationId, leadId, semantics='ever')`; `claimSendOnce` returns false when consumed → `already_sent` skip | the same automation ever acting twice on the same lead                                         |
| **Crash recovery**  | `getSendClaimState` = `'claimed'` (unconfirmed) in live mode → `dead('ambiguous_after_crash')`                                                | a re-run after a crash mid-effect. The engine **refuses to guess** whether the effect happened |

The claim identity is `sendOnceKey(automationId, leadId)` → `auto:{automationId}:lead:{leadId}:ever`
([laws.ts](lib/automations/laws.ts)). The trailing `ever` is an explicit semantics component:
a future per-entry option writes keys under a _new_ semantics value, so historical claims are never
reinterpreted.

### 7.2 The gap quotation opens

For `email.send`, a throw from `execute` is safe: nothing was created, the claim is released, the
retry re-sends. For `quote.send_email`, `execute` has **two effects in sequence** — create the quote,
then send it. A throw after the create would release the claim, and the retry would create a
**second quote**.

This is the one genuinely new invariant. It is the executor's own obligation, not the engine's — and
it must reuse the engine's identity rather than invent one.

### 7.3 Design — the engine's key, stored opaquely by the domain

```sql
-- on sales_quotes (quotation domain)
"automationKey" text
CREATE UNIQUE INDEX sales_quotes_agency_automation_key_uniq
  ON sales_quotes ("agencyId", "automationKey") WHERE "automationKey" IS NOT NULL;
```

Value: `sendOnceKey(ctx.automationId, ctx.leadId)` — **the engine's own exported function**, not a
parallel scheme. The partial-unique-when-set shape is the `bill_financial_events.idempotencyKey`
precedent, already in the codebase.

Executor behaviour:

| Step                 | Guard                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `preflight`          | resolve template + handler + recipient. **Look up** an existing quote by `automationKey` and carry it into `ready`, so a retry after a partial failure finds the row instead of racing to make another. Creates nothing. |
| `execute` — create   | `INSERT … ON CONFLICT ("agencyId","automationKey") DO NOTHING RETURNING id`; on no row, `SELECT` the existing one. Two concurrent workers converge on one quote.                                                         |
| `execute` — send     | Guarded by the **quote's own** `sentAt`: a quote already marked sent is not re-sent. Domain state, not automation state — which is the correct boundary.                                                                 |
| `execute` — log mode | Returns `would_send` and performs **no** effect. A `would_send` that wrote a `sales_quotes` row would corrupt the pilot's meaning (ADR-009).                                                                             |

**Why an opaque string and not an `automationId` FK:** an FK would make the sales domain depend on
the automation schema, and the engine's own tables deliberately avoid FKs to `clients` for the same
class of reason ("history must survive lead deletion"). The quotation domain stores and uniquely
indexes the string; it never parses it. That keeps the dependency one-directional — §9.

**Ambiguous-after-crash** stays as it is: the engine marks the job `dead` and never re-runs it.
For a quotation this is _better_ than for email, because the `automationKey` makes any partially
created quote findable by a human rather than invisible.

---

## 8. Delayed execution and revalidation

### 8.1 How the example is scheduled today

```
Lead becomes "Interested" → wait 2 hours → create and send quotation
```

1. `actions/clients.ts` / `leadOutcome.ts` writes the status change and calls `emitAutomationEvent`.
2. `emitAutomationEventWith` gates (origin → kill switch → allowlist → active definitions), decides
   **snapshot** conditions, then computes `notBefore = resolveSendAtDetailed(triggerAt, timing)`.
3. `enqueueAutomationJob` inserts one row per matching definition with that `notBefore`.
4. The cron (`*/5 * * * *`) claims jobs where `notBefore <= now()`.

**Scheduling happens at emission, not in the worker.** Accuracy is bounded by the 5-minute cadence
and stated honestly in `TIMING_ACCURACY_COPY` — never presented as exact. Quotation adds nothing.

### 8.2 What is revalidated when the job actually runs

In `processJob`, in order — every one of these already protects a quotation:

| #   | Check                                                                    | Failure                               |
| --- | ------------------------------------------------------------------------ | ------------------------------------- |
| 1   | definition exists, agency matches                                        | `definition_missing`                  |
| 2   | definition still `active`                                                | `definition_inactive`                 |
| 3   | content schema version + timing validity                                 | `definition_invalid_content`          |
| 4   | claim state (crash recovery)                                             | `dead('ambiguous_after_crash')`       |
| 5   | action key resolvable → catalog entry → executor                         | `action_unavailable`                  |
| 6   | **lead still exists**                                                    | `lead_deleted`                        |
| 7   | **live conditions still hold**                                           | **`premise_expired`**                 |
| 8   | composed law pipeline (recipient, consent, caps, quiet hours, send-once) | the declared reason                   |
| 9   | executor preflight (configuration still valid)                           | `dead` with the executor's own reason |

**Step 7 is the answer to "what if the lead changes state during the 2 hours".** The `lead` subject's
`status` field is declared `freshness: 'live'`, so it is re-read at execution and re-evaluated in
`premiseHolds`. A lead that moved to `lost` fails it, and the job skips with `premise_expired` and an
activity row explaining why. **No quote is created. Zero new code.**

The one quotation-specific revalidation to **add**, in preflight, mirroring
`whatsapp.send`'s `template_missing` / `template_not_approved`: the chosen quote template still
exists and is still usable. Configuration validity is re-checked at execution, never trusted from
authoring time.

---

## 9. Communication integration

### 9.1 How the two shipped channels send

|             | `email.send`                                                   | `whatsapp.send`                                                         |
| ----------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Destination | `ctx.recipients.email` (from `requires`)                       | `resolveWhatsappOutboundTarget(agencyId, leadId)`                       |
| Transport   | `deps.send` → lazy `import('@/lib/email/sender')`              | lazy `import('@/lib/whatsapp/sendTemplateMessage')`                     |
| Content     | `renderAutomationEmail` — the **same** renderer as the preview | approved Meta template + slot params                                    |
| Failure     | throw `transport: …` → release claim → retry                   | throw `whatsapp: …` → same                                              |
| Persistence | —                                                              | `persistOutboundWhatsapp`, `sentByUserId: null` (marks it the system's) |
| Consent     | `suppression` + RFC 8058 unsubscribe headers                   | `opt_out`                                                               |

Transports are loaded **lazily inside `defaultDeps()`** so a log-mode pass never constructs a
client. Quotation must follow this.

### 9.2 How quotation delivery hooks in

**Reuse, do not add a sender.** `quote.send_email` renders a quote email and calls the same
`lib/email/sender` through its own `deps.send`, with a `QuoteSentEmail` react-email template
alongside the existing `InvoiceSentEmail`.

**It must not call `actions/billing/send.ts`.** That is a `'use server'` action gated by
`requireProductAccess()` — a session boundary a cron worker has no session for. The executor calls
the quotation domain's **system-level** send primitive; the interactive UI calls the session-gated
server action. Both converge on one domain function. This is the `createTask` / `createSystemTask`
split, already documented in that file's header as the rule.

### 9.3 The async-PDF constraint (carried forward, now with the contract as evidence)

The quote PDF renders asynchronously — Gotenberg → presigned PUT → S3, observed by an S3
`HeadObject` poll. `execute()` returns its outcome synchronously and its throw semantics are
"retry", so it **cannot** wait for a render: the cron runs `limit: 25` jobs under `maxDuration = 60`
against a 60-second lease.

**The email carries a link to the quote, not the PDF bytes.** `execute()` becomes a DB write plus one
`sendEmail`; the render completes in the background and the link resolves by the time a human clicks
it. `InvoiceSentEmail` already embeds a URL rather than an attachment, so this is the existing
pattern.

### 9.4 WhatsApp, deferred

`whatsapp.send` is **template-only** by an explicit prior decision: an automation is
business-initiated and usually delayed, so Meta's 24-hour window is normally closed and free text
would fail for most automations most of the time. A WhatsApp quote therefore needs an **approved Meta
template with the quote link in a parameter slot** — an approval workload, not a code one. Later phase.

---

## 10. Domain boundary

```
┌─ AUTOMATION LAYER ────────────────────────────────────────────────┐
│  trigger · conditions · timing · action config · laws · claims    │
│  worker · queue · activity                                        │
│                                                                   │
│  lib/automations/executors/quote.ts                               │
│    defaultDeps: () => ({                                          │
│      handlerId:    getLeadHandlerId,          // db/automations   │
│      loadTemplate: getQuoteTemplateSystem,    // ↓ domain         │
│      createQuote:  createQuoteFromTemplateSystem,                 │
│      sendQuote:    sendQuoteEmailSystem,                          │
│    })                                                             │
└────────────────────────────┬──────────────────────────────────────┘
                             │  one-directional: calls down only
┌────────────────────────────▼──────────────────────────────────────┐
│  QUOTATION DOMAIN  (db/quotes, lib/quotes, actions/quotes)        │
│  quote creation · data · items · totals · PDF · status · sending  │
│                                                                   │
│  Knows NOTHING about automations. Accepts an opaque               │
│  `automationKey: string` it stores and uniquely indexes but       │
│  never parses.                                                    │
└───────────────────────────────────────────────────────────────────┘
```

**The rule, stated as `createSystemTask` states it:** the domain exposes _system-level_ primitives
with no session authorization, for verified server flows only; the user-facing boundary stays the
`requireProductAccess()`-gated server actions. Keeping the two apart means product authorization
never blocks the worker, and the user boundary can never be reached without product access.

**Enforceable.** `__tests__/automations/boundary.test.ts` already pins the customer-automation ↔
platform-email boundary by source inspection. The same shape asserts that no file under
`lib/quotes/**` or `db/quotes/**` imports from `lib/automations/**`.

**One deliberate crossing:** `automationKey`. It is generated by the automation layer
(`sendOnceKey`) and stored by the domain as an opaque unique string. The domain does not know what
an automation is; it knows it must not create two rows with the same key.

---

## 11. MVP scope

### 11.1 The recommendation

> **Ship `quote.create` alone first. Add `quote.send_email` as the next phase.**

### 11.2 The trade-off, stated honestly

|                                                  | one action: `quote.send_email` (create + send)     | one action: `quote.create`         |
| ------------------------------------------------ | -------------------------------------------------- | ---------------------------------- |
| Delivers the headline promise                    | **yes**                                            | no — a rep still presses send      |
| External effect on day one                       | yes — a customer receives a price                  | none                               |
| Needs a quote email template                     | yes                                                | no                                 |
| Needs the async-PDF link design                  | yes                                                | no                                 |
| Engages consent laws                             | yes (suppression, caps, quiet hours)               | no (`send_once` only)              |
| Can be validated in `log` mode against real data | partly — a `would_send` proves nothing was created | fully                              |
| Blast radius of a bug                            | a wrong price emailed to a customer, unrecoverable | a wrong draft on a lead, deletable |
| Implementation shape                             | new: email template + link + consent               | **known**: `task.create` exactly   |

Three reasons the create-only first step wins:

1. **It isolates the new risk.** Every hard problem — async PDF timing, email template, consent,
   WhatsApp approval, the send cooldown — belongs to _sending_, not to _creating_. Shipping create
   first proves the catalog entry, the executor, the config shape, the idempotency key and the
   Builder branch against real production data with **no customer-facing effect**.
2. **It is the `task.create` shape exactly** — `requires: []`, `laws: ['send_once']`,
   `risk: 'internal'`, `preview: 'record'`, one picker parameter, ~80-line executor. A known
   quantity, not an estimate.
3. **Care-charter alignment.** A quote drafted for the rep to review is "surface and catch, never
   seize" (Law 15). Auto-sending a price is the opposite, and Law 1 makes any fabricated amount
   unrecoverable. Earning the send with a proven create is the sequence the charter asks for.

**The cost, named:** `quote.create` alone does not deliver "the system sends quotes automatically."
It is a deliberate first step, not the destination. If a demo needs the headline, the honest answer
is that `quote.send_email` is one phase away — not that it should ship first.

### 11.3 The hard prerequisite

**Neither action is buildable yet.** `sales_quotes`, `sales_quote_items` and `sales_quote_templates`
do not exist. `quoteTemplateId` has nothing to resolve against, and a quote with no line items and no
prices is not a quote — and inventing prices is forbidden outright.

**Phase B is designed by this document and blocked on the quotation entity work.** The order is:
quote entity → quote templates → `quote.create` → `quote.send_email`.

---

## 12. Risks

| #     | Risk                                                                                                           | Severity | Mitigation                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12.1  | **Double-creation on retry** — `execute` creates then sends; a throw between them retries the whole step       | **High** | §7.3: `automationKey` unique index + `ON CONFLICT DO NOTHING`; preflight looks up the existing row first. Test the partial-failure path explicitly.                       |
| 12.2  | **A `would_send` that writes a row** would corrupt the observation pilot's meaning                             | **High** | `if (ctx.mode !== 'live') return { kind: 'would_send', … }` before any write — the `task.create` shape. Assert it in tests.                                               |
| 12.3  | **AI or template inventing a price**                                                                           | **High** | Care-charter Law 1. Prices come from the quote template's stored line items only. No model in the executor path at all.                                                   |
| 12.4  | **Blocking the worker on the PDF render** starves the queue and trips 60s leases                               | **High** | §9.3: email a link, never wait. `execute` performs one DB write and at most one send.                                                                                     |
| 12.5  | **Calling a session-gated server action from the worker**                                                      | Medium   | §9.2: the domain exposes system primitives; the executor never imports `actions/**`. Boundary test.                                                                       |
| 12.6  | **`quoteTemplateId` resolving empty in the Builder** because option resolution is connection-scoped            | Medium   | §4.1 / §5.2: dedicated section component + first-party server action. Never render a picker that silently shows nothing.                                                  |
| 12.7  | **A stale template at execution** — deleted or edited during a 2-hour delay                                    | Medium   | Preflight re-checks existence and usability, mirroring `template_missing` / `template_not_approved`. Never trusted from authoring time.                                   |
| 12.8  | **Engine ships OFF in production** (`AUTOMATIONS_ENABLED`, allowlist, `SEND_MODE=log`)                         | Medium   | Feature Rollout Standard: either document and set the env vars in the same PR, or do not merge the catalog entry.                                                         |
| 12.9  | **DB-backed tests cannot run** (repo-wide harness blocker)                                                     | Medium   | Unit-test the pure layer; assert data-layer queries at SQL level via `.toSQL()`, as the existing `queueDb.sql.test.ts` does. Do not weaken the design to fit the harness. |
| 12.10 | **A fourth Builder branch** pushes `AutomationActionSection` toward a controller                               | Low      | It is 134 lines after Phase A; a fourth branch keeps it under the 250 soft limit. The generic-renderer consolidation is the documented exit when a _fifth_ arrives.       |
| 12.11 | **Card sentence reads oddly** — `AutomationCardData.subject` is `content.subject`, empty for non-email actions | Low      | Pre-existing since `task.create`; the sentence degrades to the action title alone. Fix by passing the action's own summary line — a small follow-up, not Phase B scope.   |

---

## 13. Phase B implementation plan

Each step is independently revertible. Everything stays behind `AUTOMATIONS_ENABLED` +
`AUTOMATIONS_AGENCY_ALLOWLIST`, and `AUTOMATIONS_SEND_MODE` defaults to `log`.

### B0 — Prerequisite gate _(not automation work)_

`sales_quotes`, `sales_quote_items`, `sales_quote_templates` exist, with system-level primitives
`createQuoteFromTemplateSystem` and `getQuoteTemplateSystem` and the `automationKey` column +
partial unique index. **Phase B does not start until this is true.**

### B1 — Register `quote.create`

- Catalog entry (`requires: []`, `laws: ['send_once']`, `internal`, `record`, `testable: false`).
- `ACTION_TYPES` += `create_quote`; both bridge maps; migration widening the action CHECK.
- `executors/quote.ts` + registry line. Preflight: handler + template + existing-quote lookup.
  Execute: conflict-safe insert, `would_send` in log mode.
- Conformance: the totality assertions added in Phase A cover it automatically; add executor tests.
- **Gate:** `tsc` clean; the automation suite's pre-existing failure count unchanged; a `quote.create`
  definition saves, activates, and produces a `would_send` activity row in log mode.

### B2 — Configuration and Builder

- `quoteTemplateId` / `quoteValidityDays` on `DefinitionContent` + projection lines.
- `AutomationInput` + `toContent` + a `isQuoteAction` validation branch + Hebrew error copy.
- `AutomationQuoteSection.tsx` + the fourth branch; `listQuoteTemplatesAction`.
- `SheetDraft` round-trip through `page.tsx` and `automationDrafts.ts`.
- **Gate:** create → save → activate → reopen → the template selection round-trips; email and
  WhatsApp automations round-trip byte-identically.

### B3 — Idempotency proof

- Tests: retry after a simulated post-create failure creates exactly one quote; two concurrent
  workers converge on one; `already_sent` still skips; log mode writes nothing.
- **Gate:** the partial-failure path is covered by a test that fails without the unique index.

### B4 — Observation pilot

- One allowlisted agency, `SEND_MODE=log`, real triggers.
- **Gate:** activity rows match expectations for `premise_expired`, `lead_deleted` and
  `already_sent` before anything goes live.

### B5 — `quote.send_email` _(separate phase, separate decision)_

- Second catalog entry with the external law set; `QuoteSentEmail`; link-not-attachment; preview
  through the executor; save-time template validation.
- **Gate:** log mode first; consent, caps and `no_email` observed in the activity log before
  `SEND_MODE=live` for one pilot agency.

### Deferred

`quote.send_whatsapp` (needs Meta template approval) · quote-triggered **events**
(`quote.viewed` / `quote.accepted` / `quote.expiring` — needs a `scheduled` trigger origin and an
expiry evaluator) · the generic first-party parameter renderer.

---

## Summary

The engine needs **no new capability**. Quotation is one catalog entry, one executor, two flat
content fields, one Builder branch and one migration — the same path Phase A walked twice.

The three questions the brief flagged as open are already answered by existing infrastructure:
**delay** is `notBefore` computed at emission, **state revalidation** is live-freshness conditions
producing `premise_expired`, and **idempotency** is the send-once claim whose key the quote row
stores opaquely.

The two real decisions are architectural, not technical: **the action key carries the mode and the
channel** (because `laws` and `requires` are per key), and **the automation layer calls down into the
quotation domain, never the reverse** (via system primitives, as `createSystemTask` already does).

The binding constraint is not the automation layer at all — it is that the quotation entity and its
templates do not yet exist.
