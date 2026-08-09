# Automation Builder — Adversarial Architecture Review

**Status:** architecture critique. Companion to
[`customer-automation-builder-spec.md`](./customer-automation-builder-spec.md).
Written against my own proposal with the explicit brief to break it.

**Method:** every finding below is a concrete scenario that the proposed
architecture cannot absorb without changing Builder code or migrating the
meaning of stored data. Anything I could not break is recorded as surviving,
with the reasoning, so future reviewers can attack it again.

**Verdict summary:** the core stance — Builder renders metadata, integrations
contribute only Events — survives. But the proposal had **one missing layer
(Connections)** and **three data-shape decisions that must be made now or cost
a migration later** (action list, field freshness, typed requirements). Six
further findings are refinements.

---

## Findings

| # | Finding | Severity | Would force a redesign? |
| --- | --- | --- | --- |
| 1 | No **Connection** layer — parameters cannot be populated | Critical | Yes |
| 2 | **Subject resolution** undefined — the engine is lead-centric | Critical | Yes |
| 3 | Single **action** per automation is a storage decision | Critical | Yes (migration) |
| 4 | **Field freshness** (snapshot vs live) undefined | Critical | Yes (breaks anchored timing) |
| 5 | `capabilities` conflates connection, entitlement and rollout | Important | Yes, when billing gates arrive |
| 6 | **Parameter types** could leak integration knowledge | Important | Yes, silently |
| 7 | No producer model for **derived events** ("lead inactive") | Important | Partial |
| 8 | Discovery breaks down at 100+ events | Important | No, but the UX degrades |
| 9 | Engine **suppression has no channel dimension** | Important | Yes — blocks channel #2 |
| 10 | No **field deprecation** path | Minor | No |

---

## 1. CRITICAL — There is no Connection layer, and parameters cannot exist without it

**The scenario that breaks it.** A business connects two Calendly calendars —
"פגישות ייעוץ" and "פגישות סינון". They build: *"כשנקבעת פגישה ביומן הייעוץ →
שלח תזכורת."*

The proposal handles this with an event `parameter` — "which calendar?" — and a
dropdown. But **where do the dropdown's options come from?** Only Calendly
knows what calendars exist. Either the Builder calls Calendly (it becomes
integration-aware, violating the prime rule), or the parameter is a free-text
box (unusable).

I hand-waved this as "parameters with option sources" and never defined the
source. That is a hole straight through the central architectural claim.

**Why it is worse than it looks.** The same gap appears for every real
integration: which Facebook page, which WhatsApp number, which Shopify store,
which form, which pipeline. Multi-account is the norm, not an edge case. And
without a Connection identity there is no answer to:

- What happens to an automation when its calendar is disconnected?
- What happens when the token expires and is re-authorised — same calendar or
  a new one?
- Does "when a payment completes" mean *any* store or *this* store?

**The fix — add the missing layer.**

```
Integration (type)  ─┐
                     ├─→  Connection (installed instance, per agency)
Connection           ─┘         │
    │                            ├─ emits → Events
    │                            └─ provides → Option sources
    └─ has → health state
```

A **Connection** is one installed instance of an integration for one agency:
stable id, display name, health state, and — critically — the ability to
answer *"list your calendars / pages / numbers / stores"* as generic
`{id, label}` pairs.

The Builder renders a dropdown whose options come from
`connection.options(sourceKey)`. It never learns what a calendar is. Adding
Shopify means the Shopify connector implements the same option interface.

**Consequences that must be designed in:**

- An automation stores a **connection reference** (or the explicit value
  "all connections of this type").
- Connection health becomes a first-class automation state: a disconnected
  connection puts its automations into **דורש טיפול** with a reconnect CTA —
  not silent failure.
- Reconnection must preserve connection identity, or every automation bound to
  it breaks. This is a connector obligation, stated once.

**Without this layer, the architecture cannot support multi-account
integrations at all — which is most of them.**

---

## 2. CRITICAL — Subject resolution is undefined, and the engine is lead-centric

**The scenario that breaks it.** *"כשמתקבל תשלום → שלח קבלה."* A payment
arrives from Grow. Who is it about?

Every law in the shipped engine is keyed to a **lead**: send-once is
`(automation, leadId)`, caps are per-lead, suppression is per-lead, jobs and
activity rows carry `leadId` as NOT NULL. An event that does not resolve to a
lead has **nothing for the law layer to key on** — it cannot be deduplicated,
capped, suppressed, or logged against anyone.

The proposal quietly assumed every event has a lead. It never said so, and
never said whose job it is to make that true.

**This is not a flaw to fix by generalising.** `CLAUDE.md` is explicit: the
system has exactly one entity, the Lead; a "Client" is a Lead with a closed
status. Introducing a parallel Party/Contact abstraction to accommodate
payments would violate the product constitution and fragment the entire CRM.

**The fix — make it an explicit architectural law.**

> **Every Event MUST resolve to exactly one subject Lead. Resolution is the
> connector's responsibility, performed before the Event enters the engine. An
> Event that cannot resolve to a Lead cannot exist.**

Connectors resolve by the existing dedup ladder (external id → phone → email),
creating the lead when genuinely new — exactly what the Facebook and WhatsApp
connectors already do today. `invoice.paid` resolves to the lead the invoice
belongs to; `payment.completed` to the paying lead.

**Why stating this is worth a whole finding:** without it, the first
lead-less integration someone adds discovers at implementation time that the
laws do not apply, and the "fix" on the table will be to weaken the laws. That
is the redesign this rule prevents.

---

## 3. CRITICAL — One action per automation is a storage decision disguised as a UX decision

**The scenario.** *"כשמתקבל תשלום → שלח קבלה, צור משימה למעקב, ועדכן סטטוס
ל'לקוח'."* One business intent. The proposal forces three separate
automations, which means three cards, three condition sets to keep in sync,
three activity logs, and three places to remember to pause.

I listed this as an open question and recommended waiting for evidence. **That
was wrong, and specifically wrong about *what kind* of decision it is.**

The UX question ("do we show one action or several?") can wait. The **storage
question cannot**: an automation that stores one action reference is a
different shape from one that stores a list. Retrofitting a list later means
migrating every stored automation and every consumer — precisely the
"migration of meaning" the engine's own ADRs forbid.

**The fix — store a list from day one; ship the UI with one.**

- Data shape: `actions: [ {actionKey, parameters} ]`. V1 writes exactly one.
- The sentence survives: *"…· שלח אימייל **וגם** צור משימה"*.
- Execution semantics, decided now: actions execute **independently**, with no
  ordering guarantee and no rollback. Each carries its own laws, its own
  activity row, its own success or failure. One action failing never blocks
  another. (Anything else is a workflow engine, which §14 refuses.)
- Send-once remains keyed `(automation, lead)` — unchanged, because the
  automation is the unit of "once".

This is the cheapest possible insurance: zero V1 complexity, and the single
most likely future demand becomes additive.

---

## 4. CRITICAL — Field freshness is undefined, which breaks the headline feature

**The scenario.** *"יום לפני הפגישה → שלח תזכורת, רק אם הליד עדיין לא שילם."*

The event fires at **booking time**, possibly three weeks before the send.
Payment status at booking is irrelevant; payment status at send time is the
whole point. The proposal says conditions read the event's fields — a snapshot
frozen at booking. **Evaluated against stale data, this condition is
meaningless.**

This is not exotic. It is the second-most-common shape of real automation:
*do X before Y unless Z has happened since.* And it lands squarely on
anchor-based timing, which I made a headline capability.

**The fix — declare freshness per field.**

Every field is either:

- **`snapshot`** — the value as of the event. Immutable, always available.
  (`payment.amount`, `appointment.startsAt`.)
- **`live`** — re-read from the subject at execution time.
  (`lead.status`, `lead.owner`, `lead.tags`.)

Conditions are evaluated **at execution time**, using snapshot values for
snapshot fields and freshly-read values for live fields. The engine already
re-reads lead facts at execution (`getLeadFacts`), so live evaluation costs
nothing new for lead fields — it just has to be *declared and honoured*
instead of accidental.

The Builder shows freshness in plain language where it matters
(*"נבדק ברגע השליחה"*), because a user setting a reminder three weeks out
deserves to know which facts are checked when.

---

## 5. IMPORTANT — `capabilities` conflates three different gates

The proposal has one flat list. Real gating has three dimensions that demand
three different user experiences:

| Requirement | Question | If unmet, the user should see |
| --- | --- | --- |
| **Connection** | Is Calendly connected? | "חבר יומן" + the connect flow |
| **Entitlement** | Is this on their plan? | An upgrade path — in the billing surface, per the care charter's commerce boundary |
| **Flag** | Have *we* enabled it? | Nothing at all. Invisible. |

Collapsing these into one boolean means the UI cannot say the right thing, and
a flagged-off internal feature would render as "connect something" — which is
a lie. Worse, **entitlement gating will certainly arrive** (this is a
business), and retrofitting a second gate type into a boolean list touches
every catalog entry and the Builder's locked-state rendering.

**The fix.** `requirements: [{ type: 'connection'|'entitlement'|'flag', key,
cta? }]`. Each type has one generic renderer, written once. Flag-gated events
are hidden entirely; connection-gated events are shown locked with a CTA;
entitlement-gated events are shown locked with a billing link — never an
in-context upsell.

---

## 6. IMPORTANT — Parameter types are the quiet leak

Test: Shopify wants "which product?" — a searchable product picker. Under the
proposal, that is a new parameter type, which is **a Builder code change**. The
prime rule fails silently, one integration at a time, until the Builder is full
of pickers.

**The fix — a closed, generic parameter-type set, declared as a rule:**

`text` · `number` · `boolean` · `date` · `enum_static` · `enum_remote` ·
`reference`

`enum_remote` is the workhorse: *"call this connection's option provider and
render `{id,label}` pairs, with search if the list is long."* A Shopify product
picker, a Calendly calendar picker, and a Facebook page picker are the **same
control** with different providers.

> **No integration may introduce a new parameter type.** If one appears to need
> it, the integration is wrong or the generic set needs one more member added
> deliberately, for everyone.

---

## 7. IMPORTANT — "Lead inactive" has no producer in this model

Their own example list includes *lead inactive*. But inactivity is not emitted
by anyone — it is the **absence** of events, noticed by us, on a schedule.
The proposal assumes every event has a connector behind it.

**The fix — Event Sources are typed:**

| Source type | Producer | Identity rule |
| --- | --- | --- |
| `external` | A connector, from a webhook | Provider's immutable id |
| `internal` | Our own domain writes (lead created, status changed) | Business fact + timestamp (ADR-010) |
| `derived` | A scheduled evaluator over CRM state | **Evaluation-day anchor in `BUSINESS_TZ`** |

Derived events need their own identity discipline or they re-fire daily
forever — ADR-010 already flagged this as the known-hard case. Naming the
source type now means the discipline is designed rather than discovered.

The Builder does not care: all three produce the same Event contract. But
without the taxonomy, someone will implement "lead inactive" as a cron that
emits an event with `now()` as its timestamp, and every lead will be emailed
every day.

---

## 8. IMPORTANT — Discovery degrades at scale, and locked events make it worse

I claimed subject grouping solves 100+ events: "six groups of six." That
arithmetic is wrong. Events distribute unevenly — `lead` alone will hold
20-plus (created, status changed, assigned, tagged, replied, form submitted,
inactive, imported, merged…), while `webinar` holds three.

Worse: a business with 3 integrations connected out of 30 available sees
**mostly locked events**. Interleaved, that is not a capability map — it is
noise burying the six things they can actually use.

**The fix:**

- **Search is primary**, browsing secondary. The box is focused on open.
- **Usage-ranked ordering** within a subject — most-adopted first, from real
  data.
- **Locked events collapse** behind one line per subject
  (*"עוד 4 אפשרויות — דורשות חיבור"*), expandable. Discoverable, not dominant.
- Subjects with many events get an optional second-level `category` — already
  in the model, now with a stated purpose.

---

## 9. IMPORTANT — The engine's suppression has no channel dimension (this is an engine finding)

The Builder is not email-centric. **The engine partly is**, and it will block
channel #2.

`automation_lead_suppressions` is keyed `(agencyId, leadId)` with no channel.
Today that means "unsubscribed from this business's automated email." When
WhatsApp actions ship, that row will silently suppress WhatsApp too — even
though email unsubscribe and WhatsApp opt-out are **different consent
regimes** with different legal bases. Conversely, `automation_email_blocks` is
address-keyed and has no meaning for a phone number.

The delivery ladder has the same shape problem: WhatsApp's `read` state has no
slot in `sent → delivered → bounced|failed`.

**I am not proposing an engine change now** — the engine is frozen and this
costs nothing until a second channel exists. But this must be recorded as a
**prerequisite for the first non-email action**, because the fix (a channel
dimension on suppression) is a data-shape change, and doing it after
suppressions exist means back-filling consent meaning onto rows that never had
it. That is the worst class of migration.

---

## 10. MINOR — No field deprecation path

If an upstream provider removes or retypes a field, automations referencing it
break with no defined behaviour. The proposal covers unknown *events* and
*actions* (render inert, דורש טיפול) but not unknown *fields*.

**The fix:** fields carry `stability`; a deprecated or missing field puts the
automation into דורש טיפול naming the specific field, rather than failing at
execution. Cheap to state now, painful to retrofit.

---

## What survived the attack

These I tried to break and could not:

- **Event-first entry.** Still correct. The alternative attacks (action-first,
  goal-first) fail worse at scale, and event-first's narrowing property gets
  *stronger* as the catalog grows.
- **`fields` as the single bridge** to conditions, variables and anchors. This
  is the best idea in the proposal; findings 4 and 10 refine it rather than
  replace it.
- **`requires` × `fields` action filtering.** Channel-agnostic by construction;
  survives SMS, WhatsApp, and channels not yet invented.
- **Anchors generalising from datetime fields.** Still elegant, still removes
  a whole class of per-integration work.
- **The one-sentence constraint** as the admission test for new capability.
- **The refusal list** (§14). I attacked branching hardest and it held: every
  branching use case I could construct decomposes into two automations that are
  each *more* legible than the branched version.

---

## The revised architecture

```
 ┌────────────────────────────────────────────────────────────────┐
 │  INTEGRATION (type)        e.g. calendly, shopify, whatsapp    │
 │      ↓ installed as                                            │
 │  CONNECTION (instance, per agency)   ── options() ──┐          │
 │      • stable id, health state                      │          │
 └─────────────────────┬───────────────────────────────┼──────────┘
                       │ emits                          │ populates
                       ▼                                │
 ┌────────────────────────────────────────────────┐    │
 │  EVENT SOURCE:  external │ internal │ derived   │    │
 │      ↓ produces                                 │    │
 │  EVENT  (must resolve to exactly ONE Lead)      │    │
 │      • fields: typed + snapshot|live            │    │
 │      • requirements: connection|entitlement|flag│    │
 │      • parameters: closed generic types ────────┼────┘
 └─────────────────────┬──────────────────────────┘
                       ▼
 ┌────────────────────────────────────────────────┐
 │  ENGINE (frozen):  Laws → Actions → Log         │
 └─────────────────────┬──────────────────────────┘
                       ▲ reads catalog / writes automations
 ┌─────────────────────┴──────────────────────────┐
 │  BUILDER — renders metadata, knows nothing else │
 └────────────────────────────────────────────────┘
```

**Changes from the proposal:** Connections added as a first-class layer;
Event Sources typed; subject resolution made a law; fields gain freshness and
stability; requirements typed; parameters constrained to a closed set; actions
stored as a list.

---

## Recommendation

Adopt the revised architecture. The four critical findings are all
**cheap now and expensive later** — three are data-shape decisions that cost
nothing to get right today and force a migration if deferred, and the fourth
(Connections) is a layer the product cannot function without the moment a
customer has two calendars.

Finding 9 is the one to schedule deliberately: it is an **engine** matter, it
is genuinely free to ignore until the second channel, and it must not be
forgotten when that day comes.
