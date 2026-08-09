# customer-automation-builder-spec.md — The Universal Automation Builder

**Status:** product specification and architecture proposal. No implementation,
no schema, no migrations. The shipped email engine (Events → Laws → Actions →
Log, ADR-001…014) is **correct and untouched** by this document — this
redesigns the _Builder_ that sits on top of it.

**Objective:** one Builder that never needs redesigning. Every future
integration adds Events; the Builder itself stays frozen.

> ## ⚠ Revision v2 — read this first
>
> This document was reviewed adversarially in
> [`customer-automation-builder-architecture-review.md`](./customer-automation-builder-architecture-review.md),
> which found ten weaknesses. The core stance survived; **seven changes are
> binding and override the v1 text below wherever they conflict:**
>
> 1. **Connections are a first-class layer.** An Integration is a *type*; a
>    **Connection** is one installed instance per agency, with a stable id, a
>    health state, and an `options()` provider. Event parameters are populated
>    from connections — without this, "which calendar?" is unanswerable and the
>    Builder would have to become integration-aware.
> 2. **Every Event MUST resolve to exactly one subject Lead**, and resolution
>    is the *connector's* job, before the Event reaches the engine. An Event
>    that cannot resolve to a Lead cannot exist. (The engine's laws are all
>    lead-keyed; the one-entity constitution forbids a parallel Party model.)
> 3. **Actions are stored as a list** from day one — `actions: [...]` — even
>    though V1 offers exactly one. Independent execution, no ordering, no
>    rollback. This is a storage decision, not a UX one; deferring it costs a
>    migration.
> 4. **Fields declare freshness:** `snapshot` (as of the event) or `live`
>    (re-read at execution). Conditions evaluate at **execution time**. Without
>    this, anchored timing ("day before, unless X changed") is meaningless.
> 5. **Requirements are typed**, not a flat capability list:
>    `connection` (show locked + connect CTA), `entitlement` (locked + billing
>    link, never an in-context upsell), `flag` (hidden entirely).
> 6. **Parameter types are a closed generic set** — `text`, `number`,
>    `boolean`, `date`, `enum_static`, `enum_remote`, `reference`. **No
>    integration may introduce a new one.** `enum_remote` (options from a
>    connection) is what makes every picker the same control.
> 7. **Event Sources are typed:** `external` (connector), `internal` (our own
>    domain writes), `derived` (scheduled evaluation, e.g. "lead inactive",
>    which needs an evaluation-day identity anchor or it re-fires daily).
>
> One further finding is an **engine** matter, deliberately deferred:
> `automation_lead_suppressions` has no channel dimension, so it will silently
> suppress WhatsApp when that channel ships. Free to ignore today; a
> prerequisite for the first non-email action.

**Authority:** subordinate to `CLAUDE.md`, `claude/ux-guidelines.md`,
`claude/care-charter.md`, and the engine ADRs. Where this conflicts with them,
they win.

---

## 1. Product philosophy

### The Builder is not a workflow tool

A business owner never wakes up wanting to "build a workflow." They wake up
with a worry: _did anyone follow up with the people who registered?_ The
Builder's job is to turn that worry into a rule in under a minute, and then
disappear.

Three commitments follow:

1. **You complete a sentence; you do not assemble a system.** The entire
   Builder is one sentence with four blanks. Every screen, every control, and
   every piece of copy serves filling in a blank.
2. **The product asks; the user answers.** Not "configure a trigger" but
   _"מתי זה צריך לקרות?"_ The user is answering business questions, and the
   Builder is doing the translation into engine vocabulary invisibly.
3. **Growth must be invisible.** SocialCRM will have ten times the
   integrations in three years. The Builder must feel _identical_ then — same
   four blanks, same one screen. Growth shows up as more options inside a
   blank, never as more structure around it.

### The rule that makes this survivable

> **The Builder renders metadata. It never knows what an integration is.**

There is no `if (event === 'webinar.registered')` anywhere in the Builder,
ever. Facebook, Zoom, Shopify, Grow, Calendly are names that appear only in
_data_ — the Event catalog. The Builder reads that catalog and renders it.
This is the single rule that buys us years, and §8 makes it enforceable.

---

## 2. Universal architecture

```
   Connectors                Catalog                 Engine              Record
 ┌─────────────┐        ┌──────────────┐       ┌──────────────┐    ┌───────────┐
 │  Facebook   │        │              │       │              │    │           │
 │  WhatsApp   │──emit─→│    EVENTS    │──────→│  Laws (deterministic) │       │
 │  Calendly   │        │  (metadata)  │       │      ↓       │    │ Activity  │
 │  Grow       │        │              │       │   ACTIONS    │───→│    Log    │
 │  Shopify    │        │   ACTIONS    │       │              │    │           │
 │  …future    │        │  (metadata)  │       │              │    │           │
 └─────────────┘        └──────┬───────┘       └──────────────┘    └───────────┘
                               │                       ▲
                               │  reads                │ writes automations
                               ▼                       │
                        ┌──────────────┐               │
                        │   BUILDER    │───────────────┘
                        │ (renders     │
                        │  metadata)   │
                        └──────────────┘
```

**Four layers, four responsibilities:**

| Layer         | Owns                                                                       | Never does                                          |
| ------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| **Connector** | Talking to one external system; converting its webhooks into engine Events | Know the Builder exists; contain business rules     |
| **Catalog**   | The declared set of Events and Actions, with their metadata                | Contain logic; execute anything                     |
| **Engine**    | Laws, queue, execution, logging (shipped, unchanged)                       | Know about integrations                             |
| **Builder**   | Rendering the catalog as one sentence; saving user answers                 | Know about integrations; contain per-event branches |

**The contract between them is metadata, not code.** A connector's entire
contribution to the Builder is a catalog entry. That is why adding Shopify is
a connector project, not a Builder project.

---

## 3. Builder flow

### The mental-model decision: Event-first — and why

I evaluated four candidate entry points against cognitive load:

| Model              | First question                    | Why rejected / chosen                                                                                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action-first**   | "What should happen?"             | Rejected. Actions are few (≈8) and events are many (→50+), so starting with the small set only _defers_ the hard choice. Worse, the available conditions and variables depend on the event, so the Builder would have to re-ask everything after the event is finally picked. And the user's real decision — _which moment_ — gets made last. |
| **Recipe-first**   | "Pick a template"                 | Rejected as _the_ model, kept as an _accelerator_. A gallery of 8 recipes is wonderful; a gallery of 200 has exactly the paralysis we are avoiding. Recipes are a pre-filled entry into the Builder, not a parallel system.                                                                                                                   |
| **Goal-first**     | "What are you trying to achieve?" | Rejected. Sounds friendly, is unanswerable. "Get more customers" cannot be mapped to a rule without a second, harder question. It adds a step without removing one.                                                                                                                                                                           |
| **Event-first** ✅ | "When should this happen?"        | **Chosen.**                                                                                                                                                                                                                                                                                                                                   |

**Why event-first is the lowest cognitive load:**

1. **Causality reads forward.** "כשנקבעת פגישה — שלח תזכורת" is how a person
   says the rule out loud. Action-first forces you to hold the action in
   working memory while you go hunting for the moment.
2. **The event is the only real decision.** Once you have chosen the moment,
   "send an email" is nearly automatic. Put the hard choice first, while
   attention is highest.
3. **The event constrains everything downstream** — which conditions are
   offered, which variables exist, which actions are even possible, which
   timing anchors are available. Choosing it first means every later blank is
   pre-narrowed to only valid options. **The Builder gets simpler as you go**,
   which is the opposite of every workflow tool.
4. **It matches the engine.** Events → Laws → Actions is already the truth
   underneath. A Builder that mirrors its engine has no translation layer to
   get wrong.

### Solving event-first's one weakness

Event-first fails if the user must scan a flat list of 50 events. Two devices
fix it, both purely metadata-driven:

- **Subject grouping.** Every event declares a `subject` (ליד, פגישה, תשלום,
  וובינר, שיחה). One list of 50 becomes ~6 groups of ~6. Businesses already
  think in these objects.
- **Search as the accelerator.** One box: _"מה תרצו להפוך לאוטומטי?"_ — matches
  event titles, descriptions, and subjects. The user who knows what they want
  types three letters and skips the browsing entirely.

### The flow

```
    ┌──────────────────────────────────────────────────┐
    │  0. ENTRY                                        │
    │     • Recipe card (pre-fills every blank)  ──┐   │
    │     • "אוטומציה חדשה" (blank sentence)      ├──→│
    │     • Contextual ("automate this?")         ─┘   │
    └──────────────────────────────────────────────────┘
                            ↓
    ┌──────────────────────────────────────────────────┐
    │  1. כש…    Pick the EVENT   (search or subject)  │
    │            → then its parameters, if any          │
    └──────────────────────────────────────────────────┘
                            ↓
    ┌──────────────────────────────────────────────────┐
    │  2. רק אם…  CONDITIONS      (optional, skippable) │
    │            offered from the event's own fields    │
    └──────────────────────────────────────────────────┘
                            ↓
    ┌──────────────────────────────────────────────────┐
    │  3. אז…    Pick the ACTION  (only valid ones)     │
    │            → then its parameters                  │
    └──────────────────────────────────────────────────┘
                            ↓
    ┌──────────────────────────────────────────────────┐
    │  4. מתי…   TIMING           (defaults to מיד)     │
    └──────────────────────────────────────────────────┘
                            ↓
    ┌──────────────────────────────────────────────────┐
    │  5. PREVIEW with real data → test → activate      │
    └──────────────────────────────────────────────────┘
```

**All five on one screen.** Not a wizard — a single form that reveals blanks 2–4
once blank 1 is answered. You can always see the whole sentence. No step
counter, no "next", no back button, nothing to get lost in.

---

## 4. Event model

The Event is the extensibility contract. Everything the Builder can do with an
event, it learns from this metadata.

| Field          | Purpose                                                     | Example                                               |
| -------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `key`          | Stable, namespaced identity. Append-only forever.           | `appointment.booked`                                  |
| `subject`      | The business object — drives grouping and available actions | `appointment`                                         |
| `title`        | User-facing Hebrew                                          | `נקבעה פגישה`                                         |
| `description`  | One line: when this fires, in business terms                | `כשליד קובע פגישה ביומן`                              |
| `icon`         | Visual anchor (existing icon set)                           | `calendar`                                            |
| `category`     | Optional secondary grouping for large subjects              | `scheduling`                                          |
| `capabilities` | What must exist for this event to be _available_            | `[calendar_connected]`                                |
| `parameters`   | Event-scoped config the user fills in                       | `which calendar?`                                     |
| `fields`       | **The data this event exposes.** Typed.                     | `appointment.startsAt: datetime`, `lead.email: email` |
| `identity`     | How one occurrence is distinguished (ADR-010)               | `appointment.id`                                      |
| `cardinality`  | How often it can fire per subject                           | `many` \| `once_per_subject`                          |
| `stability`    | `stable` \| `beta` \| `deprecated`                          | `stable`                                              |

### The two fields that do all the work

**`capabilities`** is how integrations appear without the Builder knowing them.
The Builder asks the platform "which capabilities does this agency have?" and
renders any event whose capabilities aren't met as **locked, with the reason
and a link to fix it**:

```
   תשלומים                                   🔒
   ○ תשלום התקבל     דורש חיבור מערכת תשלומים  ←חבר
```

Adding Shopify means declaring `capabilities: [payments_connected]` on its
events. The Builder's locked-state rendering already exists and never changes.
**Locked events are shown, not hidden** — they are the product's honest
capability map and its best discovery surface.

**`fields`** is the bridge to everything downstream:

- **Conditions** are built from `fields` (§6).
- **Message variables** are built from `fields` (§5).
- **Timing anchors** are the `fields` of type `datetime` (§7).
- **Action compatibility** is `fields` matched against action requirements (§5).

This is the core mechanism: _declare an event's data once, and the Builder
automatically knows what you can filter on, personalise with, schedule
against, and act on._ Adding an event is a data change. There is no
corresponding Builder change. Ever.

### Field types (closed, append-only)

`text` · `number` · `boolean` · `enum` · `date` · `datetime` · `email` ·
`phone` · `money` · `url` · `reference`

Each type determines its condition operators (§6) and whether it can anchor
timing (`datetime` only) or satisfy an action requirement (`email` for email
sends, `phone` for WhatsApp/SMS).

### Custom API events

"Custom API event" is not an escape hatch from this model — it is an event
**registered through it**. A customer (or we, on their behalf) declares a key,
a title, and a typed field schema; the connector posts occurrences to it.
Thereafter it is indistinguishable from a built-in event, and the Builder
handles it with zero special-casing. **An event without a declared schema
cannot exist**, because conditions and variables would have nothing to read.

---

## 5. Action model

| Field                            | Purpose                                      | Example                                   |
| -------------------------------- | -------------------------------------------- | ----------------------------------------- |
| `key`                            | Stable, namespaced                           | `email.send`                              |
| `title` / `description` / `icon` | User-facing                                  | `שליחת אימייל`                            |
| `capabilities`                   | What must be connected/enabled               | `[email_sending]`                         |
| `requires`                       | Field types the subject must expose          | `[email]`                                 |
| `parameters`                     | The action's own form                        | subject, body                             |
| `laws`                           | Channel policies the engine enforces         | send-once, caps, suppression, quiet hours |
| `risk`                           | `reversible` \| `external` \| `irreversible` | `external`                                |
| `observation`                    | Whether it supports would-do logging         | `true`                                    |

### `requires` is what makes actions self-filtering

The Builder offers only actions whose `requires` are satisfied by the chosen
event's `fields`. If an event exposes no `phone` field, "שלח וואטסאפ" simply
is not offered — with no Builder logic about WhatsApp. When an action is
unavailable, the Builder says why in the event's own terms
(_"האירוע הזה לא כולל מספר טלפון"_), which is honest and teaches the model.

### The action set (present and planned)

| Action              | `requires`        | `risk`     | Notes                                       |
| ------------------- | ----------------- | ---------- | ------------------------------------------- |
| `email.send`        | `email`           | external   | Shipped                                     |
| `whatsapp.send`     | `phone`           | external   | Inherits 24h-window + template laws         |
| `sms.send`          | `phone`           | external   | Cost visibility required                    |
| `task.create`       | —                 | reversible | Cheapest expansion; no consent surface      |
| `lead.set_status`   | `reference(lead)` | reversible | **Must not re-trigger status events** (§8)  |
| `lead.assign_owner` | `reference(lead)` | reversible |                                             |
| `notify.internal`   | —                 | reversible | To the team, not the customer               |
| `ai.draft`          | varies            | external   | Validator-gated; observation-mode mandatory |
| `webhook.post`      | —                 | external   | Deliberately last (§14)                     |

`risk` and `observation` drive rollout policy generically: any `external`
action must support observation mode before it can go live. That rule is
written once and applies to actions that don't exist yet.

---

## 6. Condition model

### V1: deliberately, almost insultingly simple

- A flat list of predicates, joined by **AND only**.
- Each predicate is `field · operator · value`, where `field` comes **only**
  from the chosen event's declared `fields`.
- No OR. No nesting. No groups. No branches. No expressions.
- Conditions are **optional** — the blank is skippable and most automations
  will leave it empty.

Operators are derived from field type, never hand-authored:

| Type                    | Operators             |
| ----------------------- | --------------------- |
| `text`                  | הוא / אינו / מכיל     |
| `enum`                  | הוא / אינו / אחד מ    |
| `number`, `money`       | שווה / גדול מ / קטן מ |
| `boolean`               | כן / לא               |
| `date`, `datetime`      | לפני / אחרי / בטווח   |
| `email`, `phone`, `url` | קיים / לא קיים        |
| `reference`             | הוא / אינו            |

The user's examples — lead source, status, tags, pipeline, owner, custom
fields — are **all just fields**. They need no special support: expose them in
the event's `fields` and they become filterable, personalisable, and
schedulable at once. Custom fields work the day they exist.

### V2 scalability without redesign

The stored shape is a predicate list plus a combinator that is **fixed to
`AND` in V1**. If OR is ever genuinely needed, it becomes a value in that
existing slot — additive, no migration of meaning, no Builder restructuring.
We ship the simple thing in a shape that can grow.

**What conditions may never do:** reference data outside the event's declared
fields, perform joins, run queries, or contain user-authored expressions.
Conditions must be evaluable deterministically by the Laws layer from data
already in hand — that is what keeps the engine honest (Business State Engine
boundary).

---

## 7. Timing model

One model, four modes, all resolved in `BUSINESS_TZ`:

| Mode            | Meaning                                  | Available when                        |
| --------------- | ---------------------------------------- | ------------------------------------- |
| `immediate`     | At the moment of the event               | Always (default)                      |
| `after_delay`   | Event time + N minutes/hours/days        | Always                                |
| `before_anchor` | N before a `datetime` field on the event | The event declares a `datetime` field |
| `after_anchor`  | N after a `datetime` field on the event  | Same                                  |

Plus one orthogonal modifier:

- **`business_hours_only`** — a checkbox. When set, a send that would land
  outside the agency's configured hours is held to the next window rather than
  dropped. One boolean, one agency-level setting, applies to every action.

### Why anchors generalise perfectly

This is the quiet win of the field model. ADR-007 deferred the "event date
anchor" as webinar-specific scope. In this model it is not a feature at all —
it is a consequence: **any event that declares a `datetime` field can be
scheduled against it.**

- "יום לפני הפגישה" → anchor on `appointment.startsAt`
- "שעה לפני הוובינר" → anchor on `webinar.startsAt`
- "3 ימים לפני מועד התשלום" → anchor on `invoice.dueAt`

One model, zero per-integration work. When an anchor moment has already passed
at evaluation time, the send is skipped with an honest reason — never sent
late, never sent about a past moment.

---

## 8. Extensibility rules

These are the constitution. Each one is a rule a reviewer can enforce.

1. **The Builder branches on metadata, never on identity.** No `if (event.key
=== …)` or `if (action.key === …)` in Builder code. If a behaviour is
   needed for one event, it becomes a metadata field available to all.
2. **Adding an integration touches the connector and the catalog. Nothing
   else.** If a new integration requires a Builder change, the model has
   failed and the change is rejected until the metadata gap is fixed.
3. **No integration name appears in Builder code, types, or copy.** Names live
   in catalog data only.
4. **Vocabularies are append-only.** Event keys, action keys, field types,
   operators. Unknown values render inert with דורש טיפול, never crash, never
   guess (ADR-008 rule 1).
5. **Conditions and variables derive from `fields`.** Never enumerated by
   hand per event.
6. **Every capability the Builder gains must be expressible in the sentence.**
   If it cannot be said in one Hebrew sentence, it does not belong in the
   Builder (see §14).
7. **Actions must not silently become events.** An action that changes state
   (`lead.set_status`) must not re-enter the engine as a trigger. Any future
   exception requires an explicit, bounded, documented rule — this is the
   no-loops guarantee, restated for a multi-action world.
8. **`external` actions require observation mode before go-live.** Written
   once, binding on actions not yet designed.

---

## 9. UI wireframe (text only)

### 9.1 Empty state / entry

```
┌──────────────────────────────────────────────────────────┐
│ אוטומציות                                                │
│ אוטומציה עושה בשבילכם דבר אחד, ברגע הנכון.               │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 🔍  מה תרצו להפוך לאוטומטי?                          │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ מוכן להפעלה                                              │
│ ┌────────────────────────┐ ┌───────────────────────────┐ │
│ │ ✉  אימייל פתיחה לליד   │ │ ✉  אישור הרשמה            │ │
│ │    חדש                 │ │                           │ │
│ │    מיד כשליד נכנס      │ │    מיד עם ההרשמה          │ │
│ └────────────────────────┘ └───────────────────────────┘ │
│ ┌────────────────────────┐ ┌───────────────────────────┐ │
│ │ ⏰ תזכורת לפני פגישה   │ │ ＋ אוטומציה חדשה מאפס     │ │
│ │    יום לפני המועד      │ │                           │ │
│ └────────────────────────┘ └───────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 9.2 Blank 1 — choosing the event

```
┌──────────────────────────────────────────────────────────┐
│ אוטומציה חדשה                                       [✕] │
├──────────────────────────────────────────────────────────┤
│ כש…                                                      │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 🔍  חפשו מתי זה צריך לקרות                           │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ לידים                                                    │
│   ○ ליד חדש נכנס                                         │
│   ○ סטטוס ליד השתנה                                      │
│   ○ ליד ללא מענה                                         │
│                                                          │
│ פגישות                                                   │
│   ○ נקבעה פגישה                                          │
│   ○ בוטלה פגישה                                          │
│                                                          │
│ תשלומים                                            🔒    │
│   ○ תשלום התקבל       דורש חיבור מערכת תשלומים   ←חבר   │
│                                                          │
│ הודעות                                             🔒    │
│   ○ התקבלה הודעה      דורש חיבור וואטסאפ         ←חבר   │
└──────────────────────────────────────────────────────────┘
```

### 9.3 The assembled sentence (one screen)

```
┌──────────────────────────────────────────────────────────┐
│ תזכורת לפני פגישה                                   [✕] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ כש─   נקבעה פגישה                              [שנה]    │
│       יומן:  כל היומנים                    ▾            │
│                                                          │
│ רק אם─                                       [+ הוספה]  │
│       מקור הליד     הוא ▾    פייסבוק ▾          [✕]     │
│       (אפשר להשאיר ריק — יפעל על כל הפגישות)            │
│                                                          │
│ אז─   שליחת אימייל                             [שנה]    │
│       נושא   ┌────────────────────────────────────────┐  │
│              │ נתראה מחר, {{שם הליד}}                 │  │
│              └────────────────────────────────────────┘  │
│       תוכן   ┌────────────────────────────────────────┐  │
│              │ רק מזכירים — נתראה ב-{{מועד הפגישה}}.  │  │
│              │                                        │  │
│              └────────────────────────────────────────┘  │
│              [שם הליד] [שם העסק] [שם הנציג] [מועד הפגישה]│
│                                                          │
│ מתי─  ○ מיד                                              │
│       ○ אחרי  [ 1 ]  [ שעות ▾ ]                         │
│       ● [ יום ▾ ] לפני  [ מועד הפגישה ▾ ]               │
│       ☐ רק בשעות הפעילות                                 │
│                                                          │
│ ────────────────────────────────────────────────────     │
│ כך זה ייראה אצל דנה לוי (פגישה ב-12/8, 10:00)           │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ נתראה מחר, דנה                                       │ │
│ │ רק מזכירים — נתראה ב-12/8 בשעה 10:00.                │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ [ שלח אליי בדיקה ]              [ שמור והפעל ]          │
└──────────────────────────────────────────────────────────┘
```

Notes that matter: the variable chips under the body are **generated from the
event's fields** — `מועד הפגישה` appears because this event declares a
`datetime`, and would be absent for `lead.created`. Likewise the timing anchor
dropdown lists that same field. Nothing here is hardcoded per integration.

### 9.4 The managed list

```
┌──────────────────────────────────────────────────────────┐
│ אוטומציות                                  [+ חדשה]     │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ תזכורת לפני פגישה                          ● פעיל   │ │
│ │ כשנקבעת פגישה · שולח אימייל · יום לפני המועד        │ │
│ │ נשלחו 12 אימיילים השבוע                              │ │
│ │ [השהה] [ערוך] [יומן] [שכפל] [מחק]                    │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ אימייל פתיחה לליד חדש                    ⚠ דורש טיפול│ │
│ │ כשליד חדש נכנס · שולח אימייל · מיד                   │ │
│ │ חסרה כתובת אימייל לתשובות                            │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

Every card is the sentence. That is the anti-amnesia device: you never have to
open an automation to remember what it does.

---

## 10. Domain model (conceptual)

**Catalog — code-owned, versioned by deploy, never user-editable:**

- **EventDefinition** — `key`, `subject`, presentation, `capabilities`,
  `parameters`, `fields`, `identity`, `cardinality`, `stability`
- **ActionDefinition** — `key`, presentation, `capabilities`, `requires`,
  `parameters`, `laws`, `risk`, `observation`
- **SubjectDefinition** — `key`, title, icon (grouping only)
- **CapabilityDefinition** — `key`, title, how to obtain it (the CTA behind a
  🔒)

**User data — what an automation actually is:**

An **Automation** is one row of answers:

```
Automation
├── name
├── status            draft | active | paused | deleted
├── trigger
│   ├── eventKey      → EventDefinition
│   └── parameters    answers to that event's parameters
├── conditions        [ { field, operator, value } ]  (AND, may be empty)
├── action
│   ├── actionKey     → ActionDefinition
│   └── parameters    answers to that action's parameters
├── timing
│   ├── mode          immediate | after_delay | before_anchor | after_anchor
│   ├── offset        { value, unit }            (not for immediate)
│   ├── anchorField   → a datetime field         (anchor modes only)
│   └── businessHoursOnly
└── contentVersion    forward-compatibility marker
```

**Engine-owned (already shipped, unchanged):** Job, Activity, SendClaim,
Suppression, Block.

The important property: an Automation stores **references plus answers**. It
never stores logic. That is why the catalog can grow, and why an automation
written today still means the same thing in three years.

---

## 11. Worked examples

The point of these four is that they are _the same shape_. Nothing about the
Builder changes between them.

### Lead Created

```
כש─   ליד חדש נכנס            [event: lead.created]
      מקור: הכול               [parameter]
רק אם─ (ריק)
אז─   שליחת אימייל            [action: email.send · requires email ✓]
      נושא/תוכן …             [variables: שם הליד, שם העסק, שם הנציג]
מתי─  מיד                     [no datetime field ⇒ no anchor offered]
```

### Webinar Registration

```
כש─   נרשם לוובינר            [event: webinar.registered · cap: webinars]
      וובינר: "שיווק בפייסבוק" [parameter: which webinar]
רק אם─ (ריק)
אז─   שליחת אימייל
מתי─  ● שעה לפני מועד הוובינר  [anchor: webinar.startsAt — offered because
                                the event declares a datetime field]
```

The reminder that ADR-007 deferred as special scope is here a default
capability, produced by the field model rather than by a feature.

### Purchase Completed

```
כש─   תשלום התקבל             [event: payment.completed · cap: payments]
רק אם─ סכום  גדול מ  500       [condition from field payment.amount: money]
אז─   שליחת אימייל
מתי─  מיד
```

Note the condition: `money` type ⇒ numeric operators, automatically. No
payment-specific Builder code exists.

### Appointment Booked

```
כש─   נקבעה פגישה             [event: appointment.booked · cap: calendar]
      יומן: כל היומנים
רק אם─ מקור הליד  הוא  פייסבוק
אז─   שליחת אימייל
מתי─  ● יום לפני מועד הפגישה
      ☐ רק בשעות הפעילות
```

Four different integrations. One Builder. Zero Builder changes.

---

## 12. Design decisions

1. **Event-first, not action-first** (§3) — causality reads forward, the event
   is the real decision, and it narrows everything downstream.
2. **Two-level narrowing (subject → event) plus search**, not a flat list —
   the only way event-first survives 50+ events.
3. **Locked events are shown, not hidden** — the capability map doubles as the
   discovery surface and the honest answer to "can this product do X?".
4. **`fields` is the single source for conditions, variables, and anchors** —
   one declaration, three capabilities, zero duplication.
5. **`requires` × `fields` makes actions self-filtering** — no per-action
   compatibility logic.
6. **AND-only conditions in a shape that permits OR later** — ship simple,
   stay open.
7. **Anchors generalise from datetime fields** — the webinar-reminder problem
   dissolves instead of being solved.
8. **One screen, progressive reveal** — not a wizard. The sentence is always
   visible; there is nothing to get lost inside.
9. **Recipes are pre-filled Builder entries**, not a parallel system — they
   scale as data and teach the Builder's model on first use.
10. **The card shows the sentence** — automations stay legible without being
    opened, which is what prevents the forgotten-automation failure.

---

## 13. Future-proof guarantees

If these hold, the Builder never needs redesigning:

| Future capability                                    | What changes                                            |
| ---------------------------------------------------- | ------------------------------------------------------- |
| New integration (Shopify, Zoom, Calendly…)           | Connector + catalog entries                             |
| New event on an existing integration                 | One catalog entry                                       |
| New action (SMS, task, AI…)                          | One catalog entry (+ its executor in the engine)        |
| New filterable field (tags, pipeline, custom fields) | Add to an event's `fields`                              |
| New scheduling need ("2 days before X")              | Nothing — anchors already generalise                    |
| New capability gate                                  | One capability definition                               |
| Custom customer-specific event                       | Registered event with a declared schema                 |
| A hundred more events                                | Nothing — subject grouping and search already absorb it |

**The test for any future proposal:** _does it require the Builder to know
something new about a specific integration?_ If yes, it is designed wrong —
send it back until it can be expressed as metadata.

---

## 14. Things we intentionally refuse to support

Each of these is a deliberate, permanent refusal. Reversing any one requires a
superseding decision with its cost stated — not a feature request.

| Refused                                                      | Why                                                                                                                                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Visual flowchart / canvas**                                | Demos brilliantly, rots in production, and is deeply LTR-biased. Our users describe rules in sentences, not diagrams.                                             |
| **Branching (if/else)**                                      | Where users create automations they don't understand, which misfire, which destroy trust in _all_ automation. Two automations instead of one branched automation. |
| **Loops / recursion**                                        | No business rule our ICP needs requires them; every one of them is an outage waiting to happen.                                                                   |
| **Multi-step sequences as one object**                       | A sequence is presented as a group of single rules. The single-rule invariant is what keeps the sentence true.                                                    |
| **OR / nested condition groups (V1)**                        | The shape allows it later; the UI does not offer it until a real, recurring need proves it.                                                                       |
| **User-authored expressions, formulas, or code**             | Unreviewable, unvalidatable, and the end of deterministic laws.                                                                                                   |
| **Cross-object joins in conditions**                         | Conditions must be evaluable from data in hand. Anything else is a query builder wearing a costume.                                                               |
| **Audience / segment blasts**                                | That is a campaign product with different consent stakes. It must never be smuggled in as "an automation with many recipients."                                   |
| **Engagement triggers (opens, clicks)**                      | ADR-012: substantially fictional post-MPP, and telemetry must never become a trigger.                                                                             |
| **Triggering on our own actions by default**                 | The no-loops guarantee (§8.7).                                                                                                                                    |
| **Freeform custom events without a schema**                  | Conditions and variables would have nothing to read; it would break the field model that makes everything else work.                                              |
| **Per-recipient send-time optimisation, A/B tests, scoring** | Enterprise marketing features. Not our product, not our user.                                                                                                     |

---

## 15. Open questions

1. **Where do subjects come from?** Proposed: a small closed catalog
   (`lead`, `appointment`, `payment`, `webinar`, `conversation`) that grows
   deliberately. Alternative — free-form per integration — risks fragmenting
   the grouping. Recommend closed.
2. ~~**Multiple actions per automation.**~~ **RESOLVED by review v2.3.** The UX
   question (offer one or several?) may wait; the *storage* question may not.
   Actions are stored as a list from day one, executed independently with no
   ordering and no rollback; V1 renders exactly one. My earlier "wait for
   evidence" answer confused a UX decision with a data-shape decision.
3. ~~**Condition on current state vs event payload.**~~ **RESOLVED by review
   v2.4.** Event-payload-only was wrong: it makes anchored timing meaningless
   ("day before the appointment, unless they already paid" reads three-week-old
   data). Fields declare `snapshot` or `live`; conditions evaluate at execution
   time.
4. **Who may register custom events** — us on a customer's behalf, or
   self-serve? Consent and abuse implications differ sharply.
5. **Capability CTA ownership** — each 🔒 needs a destination that actually
   completes the connection. Who owns those flows per integration?
6. **Connection identity across re-authorisation** (new, review v2.1). When a
   customer disconnects and reconnects Calendly, is it the same Connection?
   It must be, or every automation bound to it breaks. This is a connector
   obligation and needs stating per integration.
7. **Multi-connection default** (new, review v2.1). When an agency has two
   calendars, does a new automation default to "all" or force a choice?
   "All" is friendlier and riskier. Recommend: force the choice when more than
   one connection exists, default to the only one when there is exactly one.

---

_This document defines the Builder's architecture, not its implementation. No
code, schema, or engine behaviour changes accompany it._
