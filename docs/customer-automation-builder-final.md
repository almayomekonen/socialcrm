# Customer Automation Builder — Final Frozen Architecture & Implementation Specification

**Status: FROZEN.** This supersedes
[`customer-automation-builder-spec.md`](./customer-automation-builder-spec.md)
(v1 proposal) and
[`customer-automation-builder-architecture-review.md`](./customer-automation-builder-architecture-review.md)
(adversarial review). Both are retained as history; **this document is the
source of truth.**

**Frozen means:** the layers, contracts, and laws below do not change without a
superseding ADR that states what it costs. Everything the product gains for the
next five years should arrive as _catalog data_, not as changes to this
document.

**Not frozen:** the catalog contents (events, actions, connectors) — those grow
forever, which is the entire point.

**Engine:** the shipped email engine (ADR-001…014) is untouched by this
document, with two prerequisites recorded in §11 that must be paid before the
second channel ships.

---

## 1. What survived three passes

The architecture was proposed, attacked, revised, and attacked again. These
held every time and are now frozen:

- **The Builder renders metadata and never knows what an integration is.**
- **Event-first entry**, narrowed by subject, accelerated by search.
- **`fields` is the single bridge** to conditions, variables, and timing
  anchors — declare an event's data once, get three capabilities.
- **`requires` × `fields`** makes actions self-filtering, channel-agnostic.
- **Timing anchors generalise** from any `datetime` field.
- **One sentence** as the admission test for every future capability.
- **The refusal list** (§12) — attacked hardest at branching; it held.

---

## 2. The frozen layer model

```
┌──────────────────────────────────────────────────────────────────────┐
│ INTEGRATION            a type. "calendly", "shopify", "whatsapp"     │
│   ↓ authorised as                                                    │
│ CONNECTION             one authorisation, per agency                 │
│   • stable id · auth strategy · health · options()                   │
│   ↓ contains                                                         │
│ SOURCE                 one subscribable stream within a connection   │
│   • page / calendar / phone number / store / form                    │
│   • webhook subscription and health attach HERE                      │
│   ↓ emits                                                            │
│ EVENT                  must resolve to exactly ONE Lead              │
│   • origin: external | internal | derived                            │
│   • fields (typed, snapshot|live) · requirements · parameters        │
└─────────────────────────────┬────────────────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ ENGINE (frozen, ADR-001…014)   Laws → Actions → Activity Log         │
│   • law set is declared PER ACTION, not global                       │
└─────────────────────────────┬────────────────────────────────────────┘
                              ▲ reads catalog · writes automations
┌─────────────────────────────┴────────────────────────────────────────┐
│ BUILDER          renders metadata. Contains zero integration names.  │
└──────────────────────────────────────────────────────────────────────┘
```

**Change from v2: SOURCE is now a first-class layer.** The evidence is already
in the codebase — Facebook subscribes webhooks **per page**, WhatsApp **per
WABA/phone-number-id**. Those are Sources, not Connections. Without the layer
there is nowhere to hang a per-stream subscription, per-stream health, or an
automation's binding when one calendar of three is deleted.

**Users never see the word "Source."** It renders as an ordinary
`enum_remote` parameter (_"יומן: פגישות ייעוץ"_). The layer exists for the
system, not the vocabulary.

---

## 3. The metadata contracts

These seven declarations are the entire extensibility surface. Everything the
Builder can do, it learns from them.

### 3.1 Integration

| Field           | Purpose                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `key`           | `calendly`, `shopify` — append-only                                     |
| `title`, `icon` | Presentation                                                            |
| `auth`          | One of a **closed** set: `oauth2`, `api_key`, `embedded_signup`, `none` |
| `capabilities`  | What connecting unlocks — used for the connect CTA copy                 |

### 3.2 Connection _(runtime, per agency)_

| Field                                       | Purpose                                                     |
| ------------------------------------------- | ----------------------------------------------------------- |
| `id`                                        | **Stable across re-authorisation.** A connector obligation. |
| `integrationKey`, `agencyId`, `displayName` | Identity                                                    |
| `health`                                    | `ok` \| `needs_reauth` \| `degraded` \| `revoked`           |
| `options(sourceKey)`                        | Returns `{id,label}[]` — the generic option provider        |

### 3.3 Source _(runtime, within a connection)_

| Field                         | Purpose                                                          |
| ----------------------------- | ---------------------------------------------------------------- |
| `id`, `connectionId`, `label` | Identity                                                         |
| `subscription`                | `subscribed` \| `pending` \| `failed` — per-stream webhook state |
| `health`                      | Independent of connection health                                 |

### 3.4 Event _(catalog)_

| Field                                      | Purpose                                                               |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `key`                                      | `appointment.booked`. **Append-only forever.**                        |
| `origin`                                   | `external` \| `internal` \| `derived`                                 |
| `subject`                                  | Grouping: `lead`, `appointment`, `payment`, `webinar`, `conversation` |
| `title`, `description`, `icon`, `category` | Presentation                                                          |
| `lifecycle`                                | `stable` \| `beta` \| `deprecated`                                    |
| `requirements`                             | `[{type: connection\|entitlement\|flag, key, cta?}]`                  |
| `parameters`                               | Closed generic types only (§3.7)                                      |
| `fields`                                   | Typed, with `freshness` and `lifecycle` (§3.6)                        |
| `identity.occurrenceKey`                   | How one occurrence is distinguished (ADR-010)                         |
| `identity.leadResolution`                  | **How this event resolves to exactly ONE Lead (Law 2).** Required.    |

**`identity` is a required pair, not a single rule.** `occurrenceKey` answers
*"which occurrence is this?"* (ADR-010, dedup). `leadResolution` answers *"who
is this about?"* — the declaration that satisfies Law 2. Both are required and
both are CI-validated: §4 Q3 mandates that "events with no subject resolution
fail the build", and an event whose lead resolution is undeclared is exactly
the event that will discover at implementation time that none of the engine's
lead-keyed laws apply to it. Declaring it in the contract makes the connector's
obligation reviewable before code exists.

**`SubjectDefinition` is deliberately a catalog entity, not a hardcoded union.**
§12 open question 1 (closed subject list vs open per integration) is
*unresolved*, and modelling subjects as catalog entries is what lets it stay
unresolved without weakening anything: an event's `subject` must reference a
registered `SubjectDefinition` — CI rejects an unregistered one, so validation
is strict today — while adding a subject remains a catalog change rather than a
code change, so ratifying either answer later costs nothing. Hardcoding a union
would have pre-decided the question in code; leaving subjects free-form would
have surrendered validation. The catalog entity preserves both.

### 3.5 Action _(catalog)_

| Field                          | Purpose                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `key`                          | `email.send`, `task.create`. Append-only.                       |
| `title`, `description`, `icon` | Presentation                                                    |
| `requirements`                 | Same typed shape as events                                      |
| `requires`                     | Field types the subject must expose: `[email]`, `[phone]`, `[]` |
| `parameters`                   | Closed generic types, with **declarative validation**           |
| `laws`                         | **Declared per action** (§3.8) — this is new and load-bearing   |
| `risk`                         | `internal` \| `external` \| `irreversible`                      |
| `preview`                      | `email` \| `message` \| `record` \| `none` (§3.9)               |
| `testable`                     | Whether "send me a test" is offered                             |

### 3.6 Field

| Attribute   | Values                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------- |
| `type`      | `text` `number` `boolean` `enum` `date` `datetime` `email` `phone` `money` `url` `reference` |
| `freshness` | `snapshot` (as of the event) \| `live` (re-read at execution)                                |
| `lifecycle` | `stable` \| `deprecated`                                                                     |
| `label`     | Hebrew, user-facing                                                                          |

Type determines condition operators. `datetime` enables timing anchors.
`email`/`phone` satisfy action `requires`. `freshness` decides what a delayed
condition actually reads.

### 3.7 Parameter types — CLOSED SET

`text` · `number` · `boolean` · `date` · `enum_static` · `enum_remote` ·
`reference`

Each carries **declarative validation**: `required`, `maxLength`, `min`, `max`,
`pattern`, `oneOf`. Validation is data, never code.

> **No integration may introduce a new parameter type or a new validator.**
> `enum_remote` — options from `connection.options(key)` — is what makes a
> Shopify product picker, a Calendly calendar picker, and a Facebook page
> picker the _same control_.

### 3.8 Law sets are per action — NEW, and a correctness fix

The shipped engine applies one law pipeline to everything. That is correct for
email and **wrong for the actions coming next**:

| Action            | Laws that apply                                                             | Laws that must NOT                 |
| ----------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| `email.send`      | send-once, per-lead cap, agency cap, suppression, bounce block, quiet hours | —                                  |
| `whatsapp.send`   | send-once, caps, opt-out, 24h window, quiet hours                           | _email_ suppression                |
| `task.create`     | send-once                                                                   | **suppression, caps, quiet hours** |
| `lead.set_status` | send-once                                                                   | suppression, caps, quiet hours     |
| `webhook.post`    | send-once                                                                   | suppression, caps                  |

**A suppressed lead must still get a task created for the rep.** Suppression is
consent not to be _contacted_; it says nothing about internal record-keeping.
Applying it to `task.create` would silently break the rep's workflow, and the
user would never learn why.

So: `laws` becomes a declared list per action, drawn from a closed registry.
The engine composes the pipeline from the declaration instead of hardcoding it.
**This is engine prerequisite #2 (§11).**

### 3.9 Preview and test — the last two Builder leaks, closed

The Builder previews what will happen. Naively, previewing an email, a WhatsApp
message, and a task are three different renderers — integration knowledge
creeping in one channel at a time.

**Fix:** the action declares a `preview` _shape_ from a closed set, and its
executor returns a payload matching that shape:

| Shape     | Payload             | Rendered as               |
| --------- | ------------------- | ------------------------- |
| `email`   | `{subject, body}`   | Subject line + body block |
| `message` | `{body}`            | A single message bubble   |
| `record`  | `{title, fields[]}` | A labelled key/value card |
| `none`    | —                   | "לא נשלחת הודעה ללקוח"    |

Likewise `testable` + a generic `action.test(params, self)` in the contract —
so "שלח אליי בדיקה" works for any future channel without the Builder learning
what the channel is.

---

## 4. The eight scalability questions, answered

### Q1 — 500+ integrations without Builder changes?

**Yes, with one architectural change made here.** At 500 integrations
(≈2,500 events) two things break that my earlier "locked events collapse"
answer did not solve:

1. **The catalog cannot be shipped to the client.** It becomes a **server-side
   queryable registry**; the Builder's picker is a server query with paging,
   never an in-memory list.
2. **Discovery must invert.** Showing everything-with-locks-collapsed is wrong
   at this scale. The default view is **connection-scoped**: the events from
   _this agency's connections_, plus internal/derived events. Everything else
   lives behind a deliberate _"חיבורים נוספים"_ exploration surface.

> **Show what they can use. Make what they cannot use discoverable, not
> present.**

With those two, the Builder's code is identical at 5 integrations and 500 —
only the query result size changes.

### Q2 — Every connector as a plugin?

**Yes as a contract; deliberately NOT as a runtime plugin system.**

Every connector implements six functions:

```
authorise()      → Connection        (one of 4 closed auth strategies)
listSources()    → Source[]          (pages, calendars, numbers, stores)
verifyWebhook()  → boolean           (signature check)
mapEvent()       → Event | null      (provider payload → engine Event)
resolveSubject() → leadId            (MUST resolve; see §5)
options(key)     → {id,label}[]      (for enum_remote)
health()         → health state
```

That is plugin _shape_. What we explicitly refuse is a plugin _runtime_ —
dynamically loaded third-party code — which brings sandboxing, versioning,
and security problems out of all proportion to the benefit. Connectors are
statically registered modules implementing the contract. We get every
architectural benefit and none of the runtime risk.

### Q3 — Can AI generate Builder metadata from connector manifests?

**Yes, as a drafting accelerator with mandatory human review and mechanical
validation — never as a trusted source.**

An LLM reading an OpenAPI spec or webhook docs can credibly draft event keys,
Hebrew titles and descriptions, field lists, and parameter declarations. But
two things are unsafe to trust:

- **Field `type` and `freshness`** drive condition operators and correctness. A
  hallucinated type produces silently wrong behaviour.
- **Hebrew user-facing copy** is product voice, governed by the terminology
  rules.

Therefore this architecture requires something it did not have: **build-time
catalog validation.** Every catalog entry is schema-validated in CI — unknown
types, unknown parameter kinds, unknown law keys, missing identity rules, and
events with no subject resolution all fail the build. AI drafts; the schema
enforces; a human approves the copy.

That validation layer is what makes AI-assisted connector authoring safe, and
it is the reason the catalog must be strictly declarative.

### Q4 — Sources, Events, Fields, Actions fully metadata-driven?

**Yes for the Builder. No for the engine — correctly.**

The line, stated precisely: **metadata describes; code executes.** The Builder
consumes only metadata. Executors (send the email, create the task, call the
webhook) are engine code. The two leaks that would have crossed this line —
parameter validation and preview/test rendering — are closed in §3.7 and §3.9
by making both declarative.

### Q5 — Any remaining integration-specific leak into the Builder?

I hunted these and found exactly two, both now closed: **preview rendering**
and **test send** (§3.9). Everything else resolves to existing generic
mechanisms:

| Candidate leak              | Resolution                               |
| --------------------------- | ---------------------------------------- |
| "Which calendar?" options   | `enum_remote` via `connection.options()` |
| Connect CTA per integration | `requirement.cta` — data                 |
| Variable chips              | Generated from `fields`                  |
| Timing anchor list          | Generated from `datetime` fields         |
| Parameter validation        | Declarative validators (§3.7)            |
| Preview                     | Closed shape set (§3.9)                  |
| Test send                   | Contract function (§3.9)                 |
| Error copy                  | Generic, from law/skip taxonomy          |

**Enforcement:** an import-boundary rule — Builder code may not import from
any connector module, and no integration key may appear as a string literal in
Builder code. This is testable in CI, the same way the platform/customer email
boundary already is.

### Q6 — Should Source be first-class?

**Yes — decided above (§2).** The deciding evidence is that webhook
subscriptions already attach per-page and per-WABA in the shipped code. A
Source is the unit of subscription, of stream health, and of automation
binding. Without it, deleting one of three calendars has no representable
consequence.

### Q7 — Should Event versioning exist from day one?

**Yes — as append-only keys plus lifecycle states. Never as a numeric version
field.**

A numeric version invites the idea that automations can be _migrated_ between
versions — precisely the migration-of-meaning the engine ADRs forbid. Instead:

- **Additive change** (new field): same key, no version.
- **Breaking change** (field removed, semantics changed): **a new event key.**
  Old automations keep running against the old event, which is marked
  `deprecated` and hidden from new automations.
- **Upstream-forced field removal**: the field is marked `deprecated`;
  automations referencing it surface **דורש טיפול** naming that field, rather
  than failing at execution.

Honest and cheap. Versioning discipline without a version number.

### Q8 — Every future channel on one Action contract?

**Yes for channels. Qualified for AI.**

| Channel                   | `requires`     | Fits?                                                   |
| ------------------------- | -------------- | ------------------------------------------------------- |
| Email                     | `[email]`      | ✓                                                       |
| WhatsApp                  | `[phone]`      | ✓ — window/template rules are _laws_, declared          |
| SMS                       | `[phone]`      | ✓ — cost surfaces as a parameter/warning                |
| Push                      | `[push_token]` | ✓ — a lead field like any other                         |
| Webhook                   | `[]`           | ✓ — destination is a parameter; suppression law omitted |
| Internal notification     | `[]`           | ✓                                                       |
| **AI content generation** | varies         | ✓ — validator-gated, observation-first                  |
| **AI autonomous agent**   | —              | ✗ **REFUSED**                                           |

The refusal matters. An AI that _generates content_ for a deterministic action
fits perfectly. An AI that _decides whether_ to act, or _which_ action to take,
destroys the property the entire engine rests on: that a business owner can
predict what their automation will do. It also violates the Business State
Engine boundary — facts and states are deterministic; judgment lives in the
Copilot, a separate surface. If autonomous agents are ever wanted, they are a
different product, not an action.

---

## 5. The architectural laws

Eight rules. Each is enforceable in review or CI.

1. **The Builder renders metadata.** No integration key appears as a literal in
   Builder code. CI-enforced.
2. **Every Event resolves to exactly one Lead**, by the connector, before the
   engine. An event that cannot resolve cannot exist.
3. **Vocabularies are append-only.** Event keys, action keys, field types,
   parameter types, law keys, operators. Unknown ⇒ inert + דורש טיפול, never
   guess, never crash.
4. **No integration may add a parameter type, a validator, a preview shape, or
   a law.** Those sets grow deliberately, for everyone, or not at all.
5. **Actions are a list; execution is independent.** No ordering, no rollback,
   no inter-action data flow. Anything else is a workflow engine.
6. **Conditions evaluate at execution time**, honouring each field's declared
   freshness.
7. **Actions must not silently become events.** State-changing actions do not
   re-enter the engine as triggers.
8. **Every capability must be expressible in one Hebrew sentence.** If it
   cannot be said, it does not ship in the Builder.

---

## 6. Domain model (frozen)

**Catalog — code-owned, CI-validated, never user-editable:**
`Integration` · `EventDefinition` · `ActionDefinition` · `SubjectDefinition` ·
`RequirementDefinition` · `LawDefinition`

**Runtime — per agency:**
`Connection` (id, integration, health, auth state) ·
`Source` (id, connection, label, subscription state, health)

**User data — one Automation is one set of answers:**

```
Automation
├── name · status(draft|active|paused|deleted)
├── trigger
│   ├── eventKey            → EventDefinition
│   ├── connectionId?       → Connection   (null = all)
│   ├── sourceIds?          → Source[]     (null = all in connection)
│   └── parameters          {}
├── conditions              [{field, operator, value}]   AND-only, may be empty
├── actions                 [{actionKey, parameters}]    list; V1 length 1
├── timing
│   ├── mode                immediate|after_delay|before_anchor|after_anchor
│   ├── offset?             {value, unit}
│   ├── anchorField?        → a datetime field
│   └── businessHoursOnly   bool
└── schemaVersion
```

**Engine-owned (shipped):** Job · Activity · SendClaim · Suppression · Block.

An Automation stores **references plus answers — never logic.** That is why the
catalog can grow for years and an automation written today still means the same
thing.

---

## 7. Builder flow and UI (frozen)

Event-first, one screen, four labelled blanks, progressive reveal.

```
┌──────────────────────────────────────────────────────────┐
│ תזכורת לפני פגישה                                   [✕] │
├──────────────────────────────────────────────────────────┤
│ כש─   נקבעה פגישה                              [שנה]    │
│       יומן:  פגישות ייעוץ                  ▾            │  ← enum_remote
│                                                          │
│ רק אם─                                       [+ הוספה]  │
│       סטטוס הליד   אינו   סגור                 [✕]      │
│       (נבדק ברגע השליחה)                                 │  ← live field
│                                                          │
│ אז─   שליחת אימייל                             [שנה]    │
│       נושא  [____________________________]              │
│       תוכן  [____________________________]              │
│             [שם הליד] [שם העסק] [מועד הפגישה]           │  ← from fields
│                                              [+ וגם]    │  ← actions list
│                                                          │
│ מתי─  ○ מיד   ○ אחרי [1][שעות▾]                         │
│       ● [יום▾] לפני [מועד הפגישה▾]                      │  ← datetime anchor
│       ☐ רק בשעות הפעילות                                 │
│                                                          │
│ ──────────────────────────────────────────────────       │
│ תצוגה מקדימה (דנה לוי · פגישה 12/8 10:00)               │  ← preview shape
│ ┌──────────────────────────────────────────────────────┐ │
│ │ נתראה מחר, דנה                                       │ │
│ └──────────────────────────────────────────────────────┘ │
│ [שלח אליי בדיקה]                    [שמור והפעל]        │
└──────────────────────────────────────────────────────────┘
```

Event picker at 500 integrations:

```
┌──────────────────────────────────────────────────────────┐
│ 🔍 מה תרצו להפוך לאוטומטי?                               │
│                                                          │
│ מהחיבורים שלכם                                           │  ← connection-scoped
│   לידים        ○ ליד חדש  ○ סטטוס השתנה  ○ ללא מענה     │     DEFAULT
│   פגישות       ○ נקבעה פגישה  ○ בוטלה פגישה             │
│   וואטסאפ      ○ התקבלה הודעה                            │
│                                                          │
│ ────────────────────────────────────────────────────     │
│ 🔌 חיבורים נוספים — 40 אפשרויות נוספות          [פתח]   │  ← everything else,
└──────────────────────────────────────────────────────────┘     behind a door
```

---

## 8. Implementation plan

Same discipline as the engine: each phase independently shippable, flag-gated,
reversible.

| Phase  | Delivers                                                                                                                                                                                                           | Gate                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **B0** | Catalog schema + **CI validation**; Integration/Connection/Source contracts as types; boundary lint (no integration literals in Builder)                                                                           | Validation fails a deliberate bad entry               |
| **B1** | Catalog registry (server-queryable) + the existing email action and the two internal events (`lead.created`, `lead.status_changed`) expressed **as catalog entries** — proving the model against shipped behaviour | Existing automations behave identically               |
| **B2** | Engine: **per-action law sets** (prereq #2) — `email.send` declares today's pipeline; behaviour unchanged                                                                                                          | Byte-identical email behaviour                        |
| **B3** | Builder v2: event-first picker, conditions from fields, timing from anchors, preview shapes, actions-as-list (rendering one)                                                                                       | Rebuild every current automation in the new Builder   |
| **B4** | Connections + Sources for one existing integration (WhatsApp or Facebook) — no new integration, just the layer                                                                                                     | Multi-source selection works; disconnect ⇒ דורש טיפול |
| **B5** | Second action (`task.create`) — proves law sets, preview `record`, and `requires: []`                                                                                                                              | Suppressed lead still gets a task                     |
| **B6** | Engine: **suppression channel dimension** (prereq #1), then the first non-email channel                                                                                                                            | Email opt-out does not silence WhatsApp               |
| **B7** | First genuinely new connector (e.g. Calendly) — the real test: **connector + catalog only, zero Builder commits**                                                                                                  | A Builder diff of zero                                |

**B7 is the proof.** If adding Calendly touches Builder code, the architecture
failed and must be fixed before more integrations land.

---

## 9. Five-year survival test

| Future demand                                 | What changes                                      |
| --------------------------------------------- | ------------------------------------------------- |
| 500 integrations                              | Catalog rows; discovery already connection-scoped |
| New event on an existing integration          | One catalog entry                                 |
| New channel (SMS, Push)                       | One action entry + its executor + a law-set line  |
| New filterable field (tags, pipeline, custom) | Add to an event's `fields`                        |
| "3 days before X" scheduling                  | Nothing — anchors generalise                      |
| Plan-based gating                             | Nothing — `requirement.type: entitlement` exists  |
| Multi-account customers                       | Nothing — Connections and Sources exist           |
| AI-drafted connector metadata                 | Nothing — schema validation makes it safe         |
| Breaking upstream change                      | New event key; old one deprecated                 |
| A hundred more events                         | Nothing — search + connection scoping absorb it   |

**The standing test for any proposal:** _does it require the Builder to learn
something about a specific integration?_ If yes, it is designed wrong. Send it
back until it is metadata.

---

## 10. What we refuse, permanently

Visual flowcharts · branching · loops · multi-step sequences as one object ·
OR/nested conditions in V1 · user-authored expressions or code ·
cross-object joins · audience/segment blasts · engagement triggers
(opens/clicks, ADR-012) · actions silently re-triggering ·
schema-less custom events · runtime-loadable third-party plugins ·
**AI autonomous decision-making as an action** · per-recipient send-time
optimisation, A/B testing, lead scoring.

Each refusal is reversible only by a superseding ADR that names its cost.

---

## 11. Engine prerequisites (the debts this architecture creates)

Two, both in the frozen engine, both free today and expensive later:

1. **Suppression needs a channel dimension.** `automation_lead_suppressions` is
   keyed `(agencyId, leadId)`. When WhatsApp ships, an email opt-out would
   silently suppress WhatsApp — different consent regimes, different legal
   bases. **Must be paid before the first non-email action (B6).** Doing it
   after suppressions exist means back-filling consent meaning onto rows that
   never had it.
2. **Law sets must become per-action.** The engine applies one pipeline to
   everything. Correct for email; wrong for `task.create`, where suppression
   and caps must not apply. **Must be paid before the second action (B2/B5).**

Neither is urgent today. Both become migrations-of-meaning if forgotten.

---

## 12. Open questions (deliberately unresolved)

1. **Subject catalog** — closed (`lead`, `appointment`, `payment`, `webinar`,
   `conversation`) or open per integration? Recommend closed; open fragments
   grouping.
2. **Connection identity across re-authorisation** — a connector obligation
   that needs stating per integration, or automations break on reconnect.
3. **Multi-connection default** — force a choice when >1 exists; auto-select
   when exactly 1. Recommended, not yet ratified.
4. **Who may author custom events** — us on request, or self-serve? Different
   consent and abuse profiles.
5. **When to introduce the second action in the UI** — the list shape exists
   from B1; when do we _show_ "+ וגם"?

None blocks B0–B3.

---

**Architecture frozen 2026-08-03.** Changes require a superseding ADR stating
the cost. The catalog is expected to grow forever; this document is not.
