# integration-platform-strategy.md — Becoming the Automation Hub for Israeli SMBs

**Status:** product architecture review. No code, no schema. Decision input, not a plan.
**Scope:** what to connect, why, in what order, and what the Connections page becomes.
**Authority:** subordinate to `CLAUDE.md`, `care-charter.md`, `architecture-rules.md`, the Entity
Constraint, and the frozen Customer Automation Engine architecture.

---

## 0. The one-paragraph answer

The instinct behind "become the automation hub" is right, but the model to copy is **not**
Zapier's. Zapier, Make and n8n are _graph_ platforms: N sources × M actions, any-to-any, the
user assembles the wiring, and the moat is breadth (Zapier ships ~8,000 apps). SocialCRM cannot
win breadth, and trying would destroy the thing that makes it sellable — a rep understanding a
screen in 5 seconds. The CRM-native shape is a **funnel**: many sources collapse into **one
canonical entity (Lead)**, which a small number of high-quality actions then act on. Value comes
from _completeness of one lead's story_ and from _the business never having to design the
automation_, not from combinatorics.

So the goal is not "more integrations." It is: **own the lead's full lifecycle — appearance,
conversation, appointment, money, outcome — so that no second automation tool is needed for the
90% case.** Integration count is a means. Read every recommendation below through that lens.

---

## 1. What already exists (and why it changes the answer)

I read the shipped architecture rather than assuming it. It is in unusually good shape for this
expansion, and three specific findings reorder everything that follows.

### 1.1 The platform substrate is real and generic

| Piece                                | State                                                                                                                                                       | Consequence                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog (`lib/automations/catalog/`) | Closed, append-only vocabularies. Events, actions, integrations, subjects are **data**.                                                                     | A new integration is catalog rows + one connector module. The Builder, conditions, timing, preview and locks need **zero** changes. This claim is enforced by conformance tests, not asserted. |
| `ConnectionProvider` contract        | 3 required members (`listConnections`, `listSources`, `options`) + optional inbound trio (`verifyWebhook`, `mapEvent`, `resolveSubject`) + `setup()` guide. | An exact plugin shape for source integrations, including customer-facing setup instructions rendered generically.                                                                              |
| Generic webhook route                | `POST /api/automations/webhooks/[integration]?c=…`                                                                                                          | Every webhook integration, forever, needs **no new route**. Agency is identified by connection id, never by payload — no cross-tenant hole to re-litigate.                                     |
| `automation_connections`             | Columns already include `accessToken`, `refreshToken`, `expiresAt`, `webhookSecret`, `lastEventAt`, `eventCount`.                                           | **OAuth token storage already exists.** See §1.2.                                                                                                                                              |
| `automation_sources`                 | Per-source rows with `subscribed`/`pending`/`failed`.                                                                                                       | Per-form, per-calendar, per-store subscriptions are already modelled.                                                                                                                          |
| Law pipeline                         | Laws declared per action as data (`send_once`, `per_lead_cap`, `suppression`, `quiet_hours`, `opt_out`, `window_24h`…).                                     | New channels inherit consent and cap semantics by declaration.                                                                                                                                 |
| Delivery honesty                     | `never_received` renders as a _warning_, not "מחובר".                                                                                                       | The trust primitive for a connections page already exists.                                                                                                                                     |

### 1.2 Finding 1 — the OAuth flow does not exist, and it blocks most of the wishlist

`STRATEGY.oauth2.needsConnection = false`, with the honest comment that provider-hosted flows are
not implemented and a button leading nowhere is worse than no button. The `oauth2` value is live
vocabulary with **no implementation behind it**.

Every integration a business would name first — Google Sheets, Google Ads, Shopify, Stripe, Wix,
Meta beyond what exists — is OAuth. So the gating item is not an integration at all. It is a
**generic OAuth2 broker**. The good news is that the expensive half is done: the token columns
exist, `needs_reauth` is already in the health vocabulary and already has Hebrew copy. What is
missing is the authorize/callback pair, signed state, refresh scheduling, and revoke — all of
which are **generic**, written once, if per-provider endpoints and scopes are declared as catalog
data rather than code.

**Until this exists, the roadmap is limited to API-key and webhook integrations.** That is not a
disaster (see §7, Wave 2), but it must be a deliberate choice, not a discovery.

### 1.3 Finding 2 — there are only two actions, so every integration is source-only by force

Registered executors: `email.send` and `task.create`. That is the entire action surface.

This is the most important strategic fact in the document. In a funnel platform, value =
**sources × actions**. Adding ten sources to two actions produces ten ways to send the same
email. The marginal value of source #4 is far lower than the marginal value of action #3 —
because action #3 multiplies _every source that already exists and every one that ever will_.

And the highest-value missing action is already half-declared in the vocabulary:

- `PREVIEW_SHAPES` includes `'message'` — unused.
- `LAW_KEYS` includes `window_24h` (the WhatsApp 24-hour free-text window) and `opt_out`
  (messaging opt-out, deliberately distinct from email suppression) — both unused.
- The WhatsApp connection, inbox, and provider already exist and grant `whatsapp_connected`.

**The engine was designed for a WhatsApp send action that was never built.** In Israel, WhatsApp
is the primary business channel — SMBs answer it, ignore email, and their customers expect it.
One action, and every source in this document doubles in value.

### 1.4 Finding 3 — WhatsApp is connected but is not an event source

`whatsappProvider` implements only `listConnections` / `listSources` / `options`. It has **no**
`mapEvent`, so `isWebhookConnector()` is false for it: inbound WhatsApp messages reach the inbox
through separate, older plumbing and **never become automation events**. There is no
`conversation.message_received` event. Combined with the known absence of Instagram/Facebook DM
ingestion, the busiest channel in the product is invisible to the engine.

### 1.5 Two costs worth naming now

- **No polling infrastructure.** `derived` exists as an event origin with no evaluator. Every
  event today is either a webhook or an internal domain write. Polling would mean a scheduler,
  per-source cursors, dedup state and rate-limit handling — a large share of Zapier's operational
  cost. **Recommendation: choose webhook-capable integrations first and defer polling entirely.**
- **The reference connector is 487 lines** (`connectors/contactForm7.ts`), already over the
  350-line hard limit. At that unit cost, 20 integrations is ~10,000 lines of connector code with
  the same HMAC verification, field mapping and lead-resolution ladder copy-pasted 20 times. This
  is the "special-case code" risk the brief asks to avoid, and §4 answers it.

---

## 2. The admission test (the filter that keeps this a CRM and not a Zapier clone)

The engine's Law 2 requires that **every event resolve to exactly one Lead** before the engine
sees it; a connector that cannot resolve a subject returns `null` and the occurrence is dropped.
Combined with the Entity Constraint (only Lead exists; a closed lead is a customer), this yields a
single, sharp admission test:

> **If an event cannot name a person, it is not an event for this platform.**

This is not a limitation to work around. It is the strategy, made mechanical:

- It explains **why** SocialCRM is not Zapier, in one sentence a customer understands.
- It rejects, automatically and without debate, the integrations that would bloat the product:
  inventory alerts, server monitoring, CI pipelines, generic "when a row changes" triggers.
- It protects the Entity Constraint. The only ways to admit a personless event are to fabricate a
  lead or to introduce a second entity — the first is dishonest data, the second is forbidden.

Apply this test before any integration debate. Roughly half the candidates a founder would list
fail it, and that is the correct outcome.

---

## 3. The categories

Grouped by **position in the lead's lifecycle**, not by vendor type. This is deliberate: a business
owner thinks "where do my leads come from" and "where is my money," never "OAuth2 versus API key."
The same grouping drives the Connections page in §6.

| #   | Category (Hebrew)                        | The question it answers                 | Direction bias   |
| --- | ---------------------------------------- | --------------------------------------- | ---------------- |
| 1   | **מאיפה מגיעים הלידים** — Lead Sources   | Who just appeared?                      | Source           |
| 2   | **שיחות** — Conversations                | What did they say, and can we reply?    | Bidirectional    |
| 3   | **פגישות** — Scheduling                  | When are we meeting?                    | Internal (owned) |
| 4   | **כספים** — Money: payments & invoicing  | Did they actually buy? Did they pay?    | Source (mostly)  |
| 5   | **מסחר** — Commerce                      | What did they buy?                      | Source           |
| 6   | **שיווק ומדידה** — Marketing measurement | Which ads produce real customers?       | Action           |
| 7   | **נתונים** — Spreadsheets & data out     | Can I get my data where I already work? | Action           |
| 8   | **מותאם אישית** — Developer / custom     | Everything else.                        | Bidirectional    |

Categories 3 is already owned (CRM Meetings are the source of truth — a decision already taken
when the third-party scheduling connector was removed; it is not reopened here). Category 4 is
the biggest untapped value pool. Category 8 is the highest leverage per unit of effort.

---

## 4. Maximum reuse — the four things to build once

The brief's strongest requirement is "avoid special-case code." Four pieces of shared machinery
convert integration work from bespoke to declarative. Build these and connectors shrink from ~487
lines to roughly ~120.

### 4.1 A connector toolkit (the highest-leverage engineering work in this document)

Everything below is currently inside `contactForm7.ts` and is **not specific to Contact Form 7**:

- **HMAC / shared-secret verification** — one helper, parameterised by header name and algorithm.
- **The lead-resolution ladder** — "prior submission id → phone → email, within the agency" is the
  generic CRM identity resolution. Every source integration needs exactly this. It belongs in one
  place, and it is the single most correctness-critical piece of connector code (it decides whose
  lead gets touched).
- **Field mapping** — provider payload → catalog field keys is a _declaration_ (`{ pageUrl:
'page_url' }`), not a function. A mapping table plus one generic applier replaces per-connector
  transformation code.
- **Payload normalisation** — nested JSON, form-encoded bodies, arrays-of-fields.

Sequencing note: extracting this **while building integration #2** is cheap; extracting it after
integration #6 means rewriting six connectors. It also resolves the existing 487-line hard-limit
violation as a side effect rather than as separate cleanup.

### 4.2 A generic OAuth2 broker, configured by catalog data

One authorize route, one callback route, signed state, refresh-on-expiry, revoke. Per-provider
endpoints, scopes and PKCE requirements are **declared** alongside the integration. `needs_reauth`
already exists in the health vocabulary with copy; the broker only needs to set it.

Two cautions from this codebase's own history:

- **Request the narrowest scope that works.** The Drive migration from `drive.readonly` to
  `drive.file` was undertaken specifically to escape a CASA security assessment. Broad Google
  scopes carry a recurring audit cost, not a one-time integration cost.
- **Tokens are stored in plaintext columns today.** Before the broker holds long-lived tokens for
  many providers, encryption at rest deserves a decision. Flagging as a security consideration,
  not proposing schema.

### 4.3 Reuse the appointment-reminder machinery for money dunning — no new subsystem

This is the sharpest reuse finding in the review. "Remind me about an unpaid invoice 7 days after
it was due" looks like it needs a `derived` event evaluator (a daily scan), which does not exist.

It does not. The appointment reminder already solved this exact shape:

- `before_anchor` timing computes `notBefore` from a `datetime` field on the event.
- The occurrence key (`appointment:meeting:{id}`) makes the job idempotent and re-aimable.
- A **live guard** re-reads the entity at send time and cancels if the premise died — the meeting
  was cancelled, or has passed.

Map it directly: `invoice.issued` carries `dueDate` as a `datetime` anchor → timing fires at
`dueDate + 7d` → the send-time guard re-reads the invoice and **cancels if it has been paid**.
Occurrence key `invoice:{connection}:{invoiceId}`; a payment or a due-date change re-aims it the
same way a reschedule re-aims a reminder. **Zero new scheduling infrastructure**, and it reuses
machinery already proven in production.

The same pattern covers "renewal in 30 days," "subscription expiring," and "quote expiring."

### 4.4 A generic inbound webhook connector — and treat Zapier as a supplier, not a rival

One connector, `custom_webhook`, granting a `custom_source_connected` capability and emitting a
generic person-shaped event. It ships a per-connection URL and secret via the existing `setup()`
guide and the existing generic route.

The strategic move this enables: **do not compete with Zapier for the long tail — consume it.**
Any of the other ~8,000 apps can reach SocialCRM through Zapier/Make/n8n pointed at this URL. The
customer who needs an obscure Slovenian booking tool is served on day one, by them, at no
engineering cost. Effort is roughly one day; coverage is effectively unbounded. Build the deep
native integrations for the ten that matter and let the aggregators carry the rest.

Its mirror — an **outbound webhook action** — gives the same unbounded reach in the other
direction and is the cheapest possible answer to "can it talk to my system?"

---

## 5. The integration catalogue

Complexity is engineering effort assuming §4 exists. Maintenance is the recurring annual cost:
API version churn, OAuth re-review, breaking payload changes. Automations named are the real
built-ins shipped today.

### 5.1 Category 1 — Lead Sources (מאיפה מגיעים הלידים)

Maximum architectural reuse in the entire document. Every item emits the **existing**
`form.submitted` event and grants the **existing** `website_connected` capability. No new subject,
no new event, no new catalog vocabulary, no Builder change — a new connector module and one
integration row. Every website form automation works the day the connector ships.

| Integration                        | Why an SMB connects it                                                                                                                                 | Events produced                         | Consumed today by                                                                                   | Auth                    | Cx           | Maint                                    | Direction     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- | ------------ | ---------------------------------------- | ------------- |
| **Wix Forms**                      | Israel's dominant SMB site builder (Israeli company, very high local share). Wix Automations can POST to a webhook natively — no plugin, no developer. | `form.submitted`                        | `contact_form_thank_you`, `website_lead_follow_up`, `welcome_sequence`, `internal_task_on_new_lead` | Webhook + secret        | **Low**      | Low                                      | Source        |
| **Elementor Forms**                | The most-used WordPress form builder in Israel. Has a built-in Webhook action.                                                                         | `form.submitted`                        | same                                                                                                | Webhook + secret        | **Very low** | Low                                      | Source        |
| **Generic web form / custom site** | React/Next/bespoke sites with no plugin ecosystem — currently unservable.                                                                              | `form.submitted`                        | same                                                                                                | Webhook + secret        | **Very low** | Very low                                 | Source        |
| **Gravity Forms**                  | Common on agency-built WordPress sites.                                                                                                                | `form.submitted`                        | same                                                                                                | Webhook + secret        | Very low     | Low                                      | Source        |
| **Google Forms**                   | Zero-cost intake for the smallest businesses.                                                                                                          | `form.submitted`                        | same                                                                                                | Webhook via Apps Script | Low          | Medium (script fragility)                | Source        |
| **Instagram / Facebook DMs**       | Closes the acknowledged gap: DMs are a primary lead channel and are invisible to the engine today.                                                     | `conversation.message_received` _(new)_ | Nothing yet — needs the WhatsApp send action to be useful                                           | Meta OAuth + webhook    | **High**     | **High** (Meta review, permission churn) | Bidirectional |
| **TikTok / Google Lead Forms**     | Relevant only to businesses already buying on those platforms.                                                                                         | `lead.created`                          | `welcome_new_lead`, `internal_task_on_new_lead`                                                     | OAuth + webhook         | Medium       | Medium                                   | Source        |

### 5.2 Category 2 — Conversations (שיחות)

| Integration                                             | Why an SMB connects it                                                                                                      | Events produced                                          | Consumed today by                       | Auth              | Cx           | Maint    | Direction |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------- | ----------------- | ------------ | -------- | --------- |
| **WhatsApp as an event source** (§1.4)                  | The busiest channel in the product cannot trigger anything. "Someone messaged and nobody replied for 2 hours" is invisible. | `conversation.message_received`, `conversation.no_reply` | Needs a message action to be worth much | Already connected | Medium       | Low      | Source    |
| **Israeli SMS** (InforUMobile, 019, Cellact, Multisend) | Reaches customers when no approved WhatsApp template exists; the pragmatic fallback for reminders.                          | — (action only)                                          | Reuses appointment-reminder timing      | API key           | **Very low** | Very low | Action    |

### 5.3 Category 4 — Money (כספים) — the biggest untapped value

Money is what makes a CRM the system of record for a business. "Did they pay?" is the question
SMBs chase manually every single day, and the answer currently lives in another tab.

**A strategic tension to decide before building:** SocialCRM has its own invoicing (invoice
editor, issuer identity, PDF). Integrating an invoicing provider's _issuing_ API duplicates a
shipped feature and creates two sources of truth for the same document. **Recommendation:
integrate these as a source of payment truth (money in), not as an invoice-issuing action.** Let
businesses that already live in Green Invoice keep their accounting there while SocialCRM learns
what it needs to know about the lead. Do not build "issue invoice via Green Invoice."

| Integration                 | Why an SMB connects it                                                                             | Events produced                                                                                | Consumed today by                                                                                    | Auth              | Cx        | Maint        | Direction |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------- | --------- | ------------ | --------- |
| **Green Invoice / Morning** | The most widely used invoicing platform for Israeli SMBs and freelancers. Has an API and webhooks. | `payment.received`, `invoice.issued`, `invoice.overdue` (via §4.3 anchor, not a new evaluator) | `deal_closed_thank_you` fires on real payment rather than a manual status flip; dunning is new value | API key + webhook | Medium    | Medium       | Source    |
| **iCount**                  | Second major Israeli invoicing platform. Same event shape.                                         | same                                                                                           | same                                                                                                 | API key + webhook | Medium    | Medium       | Source    |
| **Cardcom**                 | Very common Israeli payment gateway; often the actual moment of truth.                             | `payment.received`, `payment.failed`                                                           | `deal_closed_thank_you`; failed payment → `task.create`                                              | API key + webhook | Medium    | Medium       | Source    |
| **Grow (ex-Meshulam)**      | Payment links — how the smallest Israeli businesses actually collect money.                        | `payment.received`                                                                             | same                                                                                                 | API key + webhook | **Low**   | Low          | Source    |
| **Sumit**                   | Growing combined invoicing + payments platform.                                                    | same                                                                                           | same                                                                                                 | API key + webhook | Medium    | Medium       | Source    |
| **Stripe**                  | Only for Israeli SaaS/e-commerce and international billing. Best-in-class webhooks.                | `payment.received`, `subscription.cancelled`                                                   | `deal_closed_thank_you`; churn → recovery task                                                       | API key + webhook | **Low**   | **Very low** | Source    |
| **Tranzila**                | Long-established Israeli gateway, older API surface.                                               | `payment.received`                                                                             | same                                                                                                 | API key + webhook | Medium    | Medium-high  | Source    |
| ~~Priority / חשבשבת~~       | **Decline.** Enterprise ERP, wrong customer, heavy integration, fails the "not an ERP" rule.       | —                                                                                              | —                                                                                                    | —                 | Very high | Very high    | —         |

New subject `payment` — a one-line catalog row, exactly as `appointment` and `form` were.

### 5.4 Category 5 — Commerce (מסחר)

| Integration     | Why an SMB connects it                                                                          | Events produced                      | Consumed today by                              | Auth              | Cx      | Maint                               | Direction     |
| --------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------- | ----------------- | ------- | ----------------------------------- | ------------- |
| **Shopify**     | Turns buyers into leads with purchase history; abandoned checkout is a genuine recovery moment. | `order.placed`, `checkout.abandoned` | `deal_closed_thank_you`; abandoned → follow-up | OAuth + webhook   | Medium  | Medium (versioned API, predictable) | Bidirectional |
| **WooCommerce** | The WordPress half of Israeli e-commerce; pairs with existing WP form connectors.               | `order.placed`                       | same                                           | API key + webhook | **Low** | Low                                 | Source        |
| **Wix Stores**  | Rides on the Wix connection once it exists.                                                     | `order.placed`                       | same                                           | Reuses Wix        | Low     | Low                                 | Source        |

### 5.5 Category 6 — Marketing measurement (שיווק ומדידה) — the retention weapon

Action-only, and strategically the strongest item in the document after WhatsApp send. Sending
_real closed-deal outcomes_ back to the ad platform lets its algorithm optimise for buyers instead
of form-fillers. The customer's cost per acquisition falls. The testimonial is
**"SocialCRM made my ads cheaper"** — which is a retention and pricing argument, not a feature.

`lib/facebook/conversionsApi.ts` and `lib/facebook/metaLeadConversion.ts` already exist, so part
of the work is done.

| Integration                        | Why an SMB connects it                                                     | Events consumed                        | Trigger available today                        | Auth                | Cx                    | Maint                 | Direction |
| ---------------------------------- | -------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------- | ------------------- | --------------------- | --------------------- | --------- |
| **Meta Conversions API**           | Report the closed deal back to Meta so ad spend optimises on real revenue. | consumes `lead.status_changed(closed)` | **Yes — and it now fires from Close Deal too** | Existing Meta token | **Low** (code exists) | Medium (API versions) | Action    |
| **Google Ads offline conversions** | Same, for Search/PMax.                                                     | same                                   | Yes                                            | OAuth               | Medium                | Medium                | Action    |
| **TikTok Events API**              | Same, for businesses buying on TikTok.                                     | same                                   | Yes                                            | OAuth               | Medium                | Medium                | Action    |

### 5.6 Category 7 — Data out (נתונים)

| Integration                    | Why an SMB connects it                                                                                                                                                                    | Role   | Auth  | Cx                | Maint    | Direction |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- | ----------------- | -------- | --------- |
| **Google Sheets (append row)** | The emotional pacifier. Every one of these businesses came _from_ a spreadsheet; "my data is still in my sheet" removes the fear of switching. Low functional value, high adoption value. | Action | OAuth | Low (post-broker) | Low      | Action    |
| **Outbound webhook**           | Universal escape hatch — reaches anything, including Zapier/Make.                                                                                                                         | Action | none  | **Very low**      | Very low | Action    |
| ~~Airtable / Notion / Monday~~ | **Decline for now.** Their events are about records, not people — they fail §2's admission test as sources, and as destinations the outbound webhook already covers them.                 | —      | —     | —                 | —        | —         |

### 5.7 Explicit declines, with reasons

Naming these prevents them being re-litigated every quarter.

| Candidate                                        | Why not                                                                                                                                                                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Slack / Teams**                                | Israeli SMBs coordinate on WhatsApp. An internal-notification integration for a channel they do not use, when `task.create` already covers the rep's worklist.                                                                                     |
| **Mailchimp / ActiveTrail / Smoove**             | SocialCRM now sends email itself with consent, caps and unsubscribe handled. Pushing leads to a competing ESP exports the customer's relationship and splits suppression state across two systems — an actual consent hazard, not just redundancy. |
| **Calendly and third-party schedulers**          | Already decided and removed: CRM Meetings are the source of truth. Not reopened.                                                                                                                                                                   |
| **Zoom / Meet recording, transcription tools**   | Interesting later for conversation intelligence; not a lead-lifecycle event today.                                                                                                                                                                 |
| **Inventory, monitoring, CI, generic databases** | Fail §2 — the events cannot name a person.                                                                                                                                                                                                         |
| **Priority, חשבשבת, SAP**                        | Wrong customer segment; violates "not an enterprise ERP."                                                                                                                                                                                          |

---

## 6. What the Connections page becomes

Today the page iterates `catalog.integrations` — **one row** — so it inevitably reads as
"Facebook and WhatsApp settings." The target feeling is _"I can connect my business to this."_

### 6.1 Principles

1. **Cards describe what they unlock, not what they are.** "כשמישהו משלם — הליד יתעדכן ותישלח לו
   קבלה", never "Green Invoice API v2". A business connects an outcome, not a vendor.
2. **Group by lifecycle, not by vendor type** — the §3 categories, in that order. The order itself
   tells the story: leads in → conversation → meeting → money → measurement.
3. **Honesty over completeness.** Extend the existing `DELIVERY` vocabulary; never say "מחובר"
   about a connection that has never received data. That primitive already exists and is the most
   valuable thing on the page.
4. **Never show a card for something that cannot be connected.** Thirty greyed-out logos is a
   promise you have not kept and violates "never show meaningless data."
5. **One primary action per card.** Connect, or (once connected) view details.
6. **No emoji. Reuse `IntegrationConnectionCard`, `ConnectionDetails`, `SetupGuidePanel`.** No new
   card component, no new layout layer.

### 6.2 Structure

```
┌────────────────────────────────────────────────────────────────┐
│  חיבורים                                                       │
│  חברו את המערכות שהעסק כבר עובד איתן — הלידים, הכסף והפגישות   │
│  יגיעו לכאן אוטומטית.                                          │
│                                                                │
│  4 מחוברים · 3 מקבלים נתונים · 1 דורש חיבור מחדש    [הצג הכל]  │
├────────────────────────────────────────────────────────────────┤
│  מאיפה מגיעים הלידים                                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ האתר שלי     │ │ פייסבוק      │ │ Wix          │            │
│  │ מקבל אירועים │ │ מחובר        │ │ לא מחובר     │            │
│  │ 2 טפסים      │ │              │ │              │            │
│  │ [פרטים]      │ │ [פרטים]      │ │ [יצירת חיבור]│            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
├────────────────────────────────────────────────────────────────┤
│  שיחות            ← WhatsApp                                   │
│  פגישות           ← Google Calendar                            │
│  כספים            ← חשבונית ירוקה / iCount / Cardcom           │
│  שיווק ומדידה     ← Meta Conversions                           │
│  מותאם אישית      ← חיבור בהתאמה (webhook)                     │
├────────────────────────────────────────────────────────────────┤
│  לא מצאתם את המערכת שלכם?  [ספרו לנו איזו]                     │
└────────────────────────────────────────────────────────────────┘
```

### 6.3 Three specific recommendations

**Show which automations depend on each connection.** The real fear when connecting or
disconnecting is "what breaks?" The data is already derivable — requirement → capability →
installed automations. On the connected card: "3 אוטומציות משתמשות בחיבור הזה." Before
disconnecting, name them. This is cheap and it is the difference between a settings page and a
trust surface.

**Handle "not yet available" with a demand signal, not with greyed cards.** A single line —
_"לא מצאתם את המערכת שלכם? ספרו לנו איזו"_ — is honest, breaks no charter law, and returns
prioritisation data you cannot otherwise buy. Ship the roadmap by measured demand rather than by
guessing, and let the generic webhook (§4.4) serve the impatient today.

**The empty state must tell the funnel story, not show a grid.** With nothing connected, explain
in one sentence what connecting produces — leads arriving on their own, payments updating statuses
— with the two or three highest-value connections as the CTA. This follows the existing empty-state
law: what is happening, why it matters, what to do next.

---

## 7. Roadmap

Scored on the brief's four axes. The ordering principle: **platform unlocks before integrations,
and actions before sources** — because an action multiplies every source, present and future,
while a fourth source only adds another way to send the same email.

### Wave 0 — Platform unlocks (no new integration ships)

| #   | Item                                       | Value                   | Effort       | Reuse                                                                   | Maint                     | Why first                                                                                                          |
| --- | ------------------------------------------ | ----------------------- | ------------ | ----------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 0.1 | **WhatsApp send action** (`whatsapp.send`) | **Highest in document** | Medium       | Very high — `message` preview, `window_24h`, `opt_out` all pre-declared | Medium                    | The primary Israeli business channel. Multiplies every existing and future source. The engine was designed for it. |
| 0.2 | **Connector toolkit** (§4.1)               | Compounding             | Low–Medium   | —                                                                       | **Negative** (reduces it) | Cheap now, a six-connector rewrite later. Also clears the existing 487-line violation.                             |
| 0.3 | **Generic inbound webhook** (§4.4)         | High                    | **Very low** | Total                                                                   | Very low                  | Unbounded coverage for ~1 day, and turns Zapier from rival into supplier.                                          |
| 0.4 | **Generic OAuth2 broker** (§4.2)           | Unblocking              | Medium–High  | Very high — token columns and `needs_reauth` exist                      | Medium                    | Gates Google, Shopify, Wix, Meta. Written once or ten times.                                                       |

### Wave 1 — Money (חשבונית ירוקה + Cardcom or Grow)

New `payment` subject, `payment.received` and `invoice.issued`; dunning via the §4.3 anchor reuse
with **no new scheduler**. API-key + webhook, so it **does not wait on Wave 0.4** — it can run in
parallel with the broker.

Why before more lead sources: it converts SocialCRM from "where leads are tracked" to "where the
business's money is visible," makes `deal_closed_thank_you` fire on a real payment rather than a
remembered status flip, and creates genuinely new automation value (unpaid-invoice recovery) rather
than another path to an existing email.

### Wave 2 — Capture breadth (Wix + Elementor + generic form)

The maximum-reuse wave: three connectors, the **same** `form.submitted` event, the **same**
`website_connected` capability, zero new catalog vocabulary. Every website automation works on
day one. Wix in particular unlocks a large share of the Israeli SMB market with no plugin and no
developer on the customer's side.

Ship after Wave 1 despite being easier, because breadth of capture without depth of lifecycle is
what makes a product look like a thinner Zapier.

### Wave 3 — Close the ad loop (Meta Conversions API)

Depends on `lead.status_changed(closed)`, which now fires from Close Deal as well. Partially
built. Lowers the customer's CAC — the strongest retention and pricing argument available, and the
best testimonial this product can earn.

### Wave 4 — Data out and commerce

Google Sheets append (adoption pacifier, post-broker), outbound webhook action (trivial, universal),
then Shopify/WooCommerce for product businesses. Israeli SMS as a cheap reminder fallback wherever
WhatsApp templates are unapproved.

### Deferred deliberately

Instagram/Facebook DM ingestion — high value but **high** effort and **high** maintenance (Meta
review cycles, permission churn). Worth doing _after_ `whatsapp.send` proves the messaging action
surface, so DM ingestion arrives into an action that can already reply.

Polling-only integrations, and any `derived`-origin event evaluator, stay deferred until a
concrete case cannot be expressed as an anchored send with a live guard (§4.3).

---

## 8. Risks

| Risk                                                                                                                                                                                                      | Mitigation                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Integration count becomes the metric.** Ships 30 shallow connectors, product feels like a worse Zapier.                                                                                                 | Judge each by §2 and by which _shipped_ automation it makes better. "Adds a card to a page" is a failing answer.                                                                    |
| **Token security.** `accessToken`/`refreshToken` are plaintext columns; the broker turns one integration's exposure into many.                                                                            | Decide on encryption at rest before Wave 0.4 holds third-party tokens.                                                                                                              |
| **OAuth review is calendar time, not engineering time.** Meta, Google and Shopify review cycles run weeks; Google broad scopes trigger CASA — already learned once on Drive.                              | Request the narrowest scope that works. Start reviews well before the wave that needs them. Prefer API-key integrations for early waves — which is why Wave 1 is money, not Google. |
| **Maintenance compounds silently.** Roughly one engineer-day per integration per quarter for API churn. Ten integrations is a standing tax.                                                               | Cap the native set at the ten that matter; route the long tail through the generic webhook. Prefer providers with versioned, dated APIs (Stripe, Shopify) over undated ones.        |
| **Consent fragmentation across channels.** WhatsApp `opt_out` and email `suppression` are deliberately distinct; a third channel invites a third rule and an accidental contact of someone who opted out. | Keep laws declared per action in the catalog. A new channel declares its laws before it ships, never after.                                                                         |
| **A connection breaks and nobody notices.** A revoked token silently stops a source.                                                                                                                      | `never_received` already exists; extend it to _stopped_ receiving. Surface it where the automation lives, not only on the settings page.                                            |

---

## 9. If only three things get built

1. **`whatsapp.send`** — the action the engine was designed for, in the channel Israeli businesses
   actually use. Multiplies everything else in this document.
2. **Green Invoice / Cardcom money events** — turns the CRM into the place the business's money is
   visible, and unlocks unpaid-invoice recovery with no new scheduling infrastructure.
3. **The generic inbound webhook** — one day of work, unbounded coverage, and it converts the
   competitor into a supplier.

Wix and Elementor are the cheapest genuine wins after that. Everything else can wait for evidence
from the demand signal in §6.3.
