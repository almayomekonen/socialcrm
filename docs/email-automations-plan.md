# email-automations-plan.md — Email Automations Product Specification

**Status:** product specification and UX proposal only. No implementation, no schema,
no API design. This document guides a future implementation plan; it does not replace one.

**Authority:** subordinate to `CLAUDE.md`, `claude/ux-guidelines.md`,
`claude/frontend-experience-guidelines.md`, `claude/care-charter.md`, and
`claude/do-not-touch.md`. Where this document conflicts with those, they win.

**Origin:** a customer asked for automatic emails for webinar registrations. This
document deliberately designs the generic feature — Email Automations — and treats
the webinar case as its first proof, not its shape.

**Framing:** email is not the product. The product is the **Customer Automation
Engine**, and email is its first supported action. The engine stance — what it
is, what it will support, and what the user must never see of it — is defined in
its own section after §0.

**Critical naming note for implementers:** the codebase already contains an internal
system called "email automations" (`lib/emailAutomations`) — SocialCRM sending
lifecycle emails **to its own users**. The feature in this document is the opposite
direction: **businesses sending emails to their leads**. Section 0 below is the
binding separation between the two domains; read it before anything else.

---

# 0. Platform Emails vs Customer Automations

This section is the result of an audit of the existing email infrastructure. It is
the boundary contract: the future Customer Automations feature must be able to
evolve — and fail — without ever touching the platform's own email lifeline, and
vice versa.

## What exists today (audit summary)

The platform email system has three layers, all serving one relationship:
**SocialCRM → its own users.**

1. **Transport** — `lib/email/` (`sender.ts`, `config.ts`): a single `sendEmail()`
   over Resend with bounded transient retry, structured logging, and a
   no-silent-loss guard. Governed by a deliberate **one-sender doctrine**: every
   email leaves as `SocialCRM <hello@getsocialcrm.com>` (`RESEND_FROM`), gated by
   `EMAIL_ENABLED`.
2. **Direct transactional callers** — auth verification (`actions/auth.ts`),
   invitations (`actions/invitations.ts`), billing (`actions/billing/send.ts`).
   These are the platform's lifeline emails: if they fail, users cannot sign in,
   join, or pay.
3. **The platform automation registry** — `lib/emailAutomations/`:
   developer-authored `Automation` objects in code (trial, onboarding drips,
   announcements), a recipient model keyed to the **platform user**
   (`userId`/`agencyId`), userId-keyed suppression, a stateless HMAC-over-userId
   unsubscribe token, a global **7-day lifecycle cooldown** (one marketing-ish
   email per user per week, transactional exempt), claim-before-send idempotency,
   and an hourly cron (`/api/cron/email-automations`). A separate lifecycle-events
   emitter (`lib/events/emit.ts`) pushes platform-user events to Resend's audience
   tooling.

Every one of these design decisions is _correct_ for platform email — and _wrong_
for customer automations. That asymmetry, not code hygiene, is why the domains
must stay separate.

## Why they are different products

| Dimension                | Platform Emails                                | Customer Automations                                                                |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Relationship**         | SocialCRM → its users                          | A business → its leads                                                              |
| **Author**               | SocialCRM developers, in code, reviewed in git | The business owner, in the product, as data                                         |
| **Recipient identity**   | Platform user (`userId`)                       | Lead, scoped to one business                                                        |
| **Voice & content**      | SocialCRM's voice, our templates               | The business's voice, their words                                                   |
| **Sender identity**      | One address: `hello@getsocialcrm.com`          | Business display name; reply-to the business; eventually custom domains             |
| **Consent & law**        | Our users accepted our terms                   | The business's obligation to its leads (Israeli spam law, per-business unsubscribe) |
| **Volume policy**        | 7-day lifecycle cooldown per user              | Per-lead frequency cap, once-per-lead-per-automation                                |
| **Kill switch**          | Global (`EMAIL_ENABLED`, prod gate)            | Per-agency enablement + independent global kill                                     |
| **Failure blast radius** | Users miss a drip email                        | A customer's leads get spammed — or a webinar's confirmations silently vanish       |

The deepest difference is the first two rows. Platform automations are **code** —
five of them, written by us, changed by deploy. Customer automations are **user
data** — thousands of them, written by non-technical owners, changed at any
moment. A system designed for reviewed code (registry keys, in-repo templates,
priority tiers) structurally cannot host user-generated rules, and stretching it
to try would damage both.

## Responsibilities — who owns what

**Platform Emails owns:** everything about the SocialCRM↔user relationship —
verification, invitations, billing, trial lifecycle, onboarding drips,
announcements, platform-user suppression and cooldown, and the platform's sender
reputation on its primary address.

**Customer Automations owns:** everything in this specification — user-created
rules, lead-recipient resolution, per-business suppression and unsubscribe,
per-lead send-once and frequency caps, the activity log, business-facing failure
states, and the business's sending reputation.

**Neither may ever:** send to the other's recipient class, consult the other's
suppression list, honor the other's cooldown, or appear in the other's logs,
metrics, or user-facing surfaces.

## Code that must never be shared

- **The registry and its `Automation` type** (`lib/emailAutomations/registry.ts`,
  `types.ts`). Its recipient is a platform user and its automations are code.
  Extending this type with "lead mode" flags is the single most likely coupling
  accident and is forbidden.
- **Suppression and unsubscribe** (`unsubscribeToken.ts` and the userId-keyed
  suppression checks). The platform token is an HMAC over `userId`; a customer
  unsubscribe must be scoped to (business, lead). Sharing tokens or lists would
  let a lead's unsubscribe silence platform billing email — or worse, the
  reverse.
- **The lifecycle cooldown.** A platform-marketing courtesy rule. Applied to
  customer sends it would silently swallow webinar confirmations; its absence on
  platform sends would re-open drip spam. Different laws for different
  relationships.
- **Dispatch policy** (`dispatch.ts`). The gate→suppress→cooldown→claim pipeline
  encodes platform policy. Customer dispatch has its own pipeline (trigger →
  per-business suppression → send-once → frequency cap → render → send). The
  _pattern_ is worth imitating; the function is not worth importing.
- **The hourly cron and its worker.** Queues must be independent: a backlog of
  customer sends must never delay a verification email, and a platform incident
  must never pause customer confirmations.
- **The lifecycle-events emitter** (`lib/events/emit.ts`). Platform-user events
  go to platform marketing tooling. **Lead data must never be emitted there** —
  leads are the business's customer data, not SocialCRM's audience. This is a
  privacy boundary, not a style preference.

## Infrastructure that can safely be reused

- **The Resend account and client** (`config/resend.ts`) — with one condition:
  customer sends use a **separate sending identity** (at minimum a distinct
  subdomain) so a customer-content deliverability incident can never poison the
  reputation of `hello@getsocialcrm.com`, which carries verification and billing.
  Same provider, isolated reputation. (Ties to open question §12.2.)
- **The transport wrapper's design** — bounded transient retry with the
  `TRANSIENT_RESEND_STATUSES` taxonomy, no-silent-loss guard, structured logs.
  The current `sendEmail()` hardcodes the platform sender; the right shape is a
  dumb transport that takes an explicit `from`, which both domains call and
  neither owns. Transport is plumbing; policy stays upstairs in each domain.
- **React Email rendering** (`@react-email/*`) — pure functions, no policy,
  freely shared.
- **The claim-before-send idempotency pattern** — reuse the _pattern_ (claim →
  send → mark/release), never the storage or keys (platform keys by
  user+automation+period; customer keys by lead+automation).
- **Logging and error-copy conventions** — the honest-failure discipline
  (categorized errors, Hebrew user copy, raw provider errors never in UI) carries
  over as culture, with each domain writing its own copy.

The rule of thumb: **share what carries bytes; never share what makes
decisions.** Transport, rendering, and patterns are shareable. Policy — who may
receive, when, how often, from whom, and why not — is duplicated per domain on
purpose, because the policies are genuinely different.

## Naming conventions (binding for code and docs)

The phrase "email automations" is now ambiguous in this codebase and must be
retired from unqualified use.

- **The two canonical names:**
  - **Platform Emails** — everything SocialCRM sends its own users. In Hebrew
    product docs: מיילים מערכתיים. (Internal synonym "lifecycle emails" is
    acceptable in prose, but "Platform Emails" is the canonical term.)
  - **Customer Automations** — the feature in this document. In the product UI it
    appears simply as אוטומציות (the user never needs the qualifier; the entire
    user-facing surface is theirs).
  - **Customer Automation Engine** — the internal name for the execution
    machinery behind Customer Automations (see its own section below). Internal
    vocabulary only: code, architecture, and documents — never the UI.
- **Code namespaces:** new customer-facing work lives under an `automations`
  domain (with email as its first channel — anticipating the multi-channel
  surface in §10), never inside `lib/emailAutomations/`. The existing
  `lib/emailAutomations/` should be renamed toward `platformEmails` when it is
  next touched; until then, a header comment in that directory declaring "platform
  emails — SocialCRM→user only; customer automations live elsewhere" is the
  minimum.
- **Prefix discipline:** identifiers, event names, queue names, feature flags,
  and env vars carry their domain — `platform*` / `PLATFORM_*` vs `automation*` /
  `AUTOMATIONS_*`. No customer-automation config may reuse or extend
  `RESEND_FROM`, `EMAIL_ENABLED`, or the platform cron path.
- **Documentation rule:** any engineering or product document that says "email
  automation" without the Platform/Customer qualifier is wrong and should be
  fixed on sight. This document and the platform system's docs must
  cross-reference each other's existence and this boundary.
- **Review checklist addition:** any PR touching either domain answers one
  question — _"could this change make a platform email affect a lead, or a
  customer automation affect a platform user?"_ If the answer is not an obvious
  no, the boundary is being crossed.

---

# The Customer Automation Engine

**Email is not the product. Email is the first supported action.**

The product is a generic **Customer Automation Engine**: the machinery through
which every business automation — present and future — executes. This section is
the architectural stance that governs the rest of the document and every
automation feature that follows it.

## What the engine is

The engine is the customer-side execution layer: it receives trigger events,
applies the laws (send-once, frequency caps, suppression, channel legality),
executes actions, and writes the activity log. It lives entirely on the Customer
side of the §0 boundary — Platform Emails never route through it, and it never
touches platform recipients.

Everything user-facing in this specification — the gallery, the sentence, the
one-sheet creation flow, the activity log — is the **experience layer** over the
engine. The two evolve independently: the engine gains actions and channels; the
experience stays one thing the user already knows how to use.

## V1: one engine, one action

Version 1 supports exactly one action: **Send Email**. Sections 1–12 of this
document are therefore two things at once: the specification of that first
action, and the specification of the shared surface (gallery, grammar, laws,
log) that every future action inherits without redesign.

## Future actions (no UX change required)

Future versions may add, each as a new action plugged into the same engine:

- Send WhatsApp (arriving with its channel laws — 24-hour window, approved
  templates, human-always-wins — per §10)
- Send SMS
- Create Task (צור משימה)
- Change Lead Status (עדכן סטטוס)
- Assign Owner (שייך נציג)
- AI Actions (machine-composed content, always validator-gated, always entering
  through observation mode — §10)
- Internal Notifications (alerting the business's own team, governed by the
  care charter's proportionality laws, not by send laws)
- Future communication channels not yet named

Adding an action adds recipes to the gallery and rows to the activity log. It
never adds a new surface, a new builder, a new tab structure, or a new mental
model. If a proposed capability requires any of those, it is not an engine
action — it is a different product and must be argued for separately.

## The invariant

The engine's contract with the experience is the V1 grammar: **one trigger → one
action → one timing**, legible as one Hebrew sentence. The engine may grow
indefinitely behind that sentence; the sentence itself may not grow. Anything
inexpressible in the sentence (branching graphs, multi-audience broadcasts,
freeform workflows) is outside the engine's contract by design.

## What the user must never see

Users never think about "engines," "workflows," or "automation infrastructure."
They create an אוטומציה — that is the entire user-facing vocabulary. "Customer
Automation Engine" is internal language for code, architecture discussions, and
documents like this one. It never appears in the product UI, user-facing docs,
or marketing. The separation exists precisely so the platform can evolve without
the user ever needing to learn anything new.

---

# 1. Product Vision

## Why this feature exists

SocialCRM's promise is that no lead falls through the cracks. Today the system
catches leads (ingestion from Meta/WhatsApp), organizes them (the leads list), and
answers them in the moment (the WhatsApp Instant Response Engine). What it does not
do is **keep a promise on the business's behalf over time**: the confirmation the
lead expects after registering, the thank-you after closing, the follow-up three
days later. Owners do these by hand, late, or never.

Email Automations is the first channel where the system acts on a schedule in the
business's name: _when something happens to a lead, the right email goes out —
without the owner remembering._

## The customer problem it solves

- A lead registers for a webinar and hears nothing until the owner finds time —
  often after interest has cooled. Speed-to-touch is the whole game for this ICP.
- Every repeated email (welcome, confirmation, thank-you) is manual, inconsistent,
  and skipped under load — exactly when lead volume is highest.
- Existing tools that solve this (Mailchimp, ActiveCampaign, HubSpot) require
  audiences, lists, campaigns, and English-first builders. Our users do not adopt
  them; they copy-paste emails or send nothing.

## Why "Email Automations," not "Webinar Automation"

- **The engine is generic; the use case is a template.** A webinar confirmation is
  "when a lead arrives from source X → send this email." The identical mechanics
  serve welcome emails, deal-won thank-yous, and follow-ups. Building "webinars"
  would hard-code one customer's vocabulary into everyone's product.
- **The requesting customer still gets a webinar experience on day one** — as a
  ready-made recipe named "אישור הרשמה לוובינר" in the gallery, pre-filled and
  editable. Generic engine, specific recipes. This is how the tension resolves:
  we never say no to the webinar customer, and we never build a webinar silo.
- **One entity discipline.** SocialCRM has one entity: the Lead. A "webinar
  registrant" is a lead with a source. Naming the feature by use case would invite
  parallel entities ("registrants," "attendees") that the product constitution
  forbids.

---

# 2. User Personas

All personas below are variations of the same core SocialCRM user: a small business
owner or נציג who receives leads from social channels and closes deals personally.
The feature must serve them without segmentation UI or persona-specific modes.

| Persona                                               | Situation                                                  | What Email Automations does for them                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Webinar / event creator** (the requesting customer) | Runs registration campaigns; leads sign up via a Meta form | Instant registration confirmation; reminder before the event; post-event follow-up. The founding use case.                                              |
| **Course creator / coach**                            | Sells programs; onboarding is repetitive                   | Welcome email on signup; "what happens next" email; thank-you when a deal closes                                                                        |
| **Real estate agent**                                 | High lead volume, long cycles                              | Instant "received your inquiry" credibility email; follow-up nudge after status change                                                                  |
| **Insurance-adjacent / financial services rep**       | Trust-driven sales; leads compare providers                | Fast, professional first touch that signals reliability before the phone call. (Product terminology stays `לידים`/`נציג` — never insurance vocabulary.) |
| **Marketing agency managing a client's leads**        | Runs a SocialCRM account per client                        | Sets automations once per account; the client's leads get consistent touches without the agency doing manual sends                                      |
| **Generic SMB owner**                                 | Gets leads from ads at random hours                        | The 11pm lead gets an immediate professional email while the owner sleeps                                                                               |

What all personas share: **they will not build workflows.** They will turn on an
outcome, edit a message, and forget it. The feature is designed for the person who
has 40 seconds between customer calls — not for a marketing operations role, which
none of our customers employ.

---

# 3. Product Principles

1. **Adopt, don't build.** Users turn on ready-made recipes and edit the message.
   Nobody assembles triggers, conditions, and actions from parts. The vendor
   composes logic; the user owns content and timing.
2. **One automation = one sentence.** Every automation is expressible as a single
   Hebrew sentence: "כשליד חדש מגיע מפייסבוק — שלח אימייל 'ברוכים הבאים' אחרי 5
   דקות." If it cannot be said in one sentence, it does not belong in V1.
3. **Opinionated defaults, folded advanced.** Delay, frequency caps, and dedup
   ship pre-set to safe values. Advanced options exist behind "מתקדם" and are never
   required for activation.
4. **Under 60 seconds to active.** From gallery to live automation: pick recipe →
   edit message → activate. Measured, not aspirational — this is the feature's
   primary success metric alongside retention of active automations.
5. **Safe by default.** Send-once-per-lead semantics, per-lead daily frequency cap,
   mandatory unsubscribe, suppression honored forever, imports excluded from
   triggers by default. Safety is platform law, not per-automation configuration.
6. **Transparent execution.** Every send and every _skip_ is visible in an activity
   log with the lead's name and a human reason. Honest delivery language: "נשלח"
   never claims "נקרא." No vanity metrics.
7. **Recipient is always the triggering lead.** No audiences, no lists, no
   segments. The event decides who gets the email. (This deliberately deletes the
   "choose recipients" step — see §5.)
8. **One voice.** Emails and UI use the product's Hebrew terminology (`ליד`,
   `נציג`, `סטטוס`). No emoji in UI. Email content belongs to the business and may
   say whatever the owner writes.
9. **Channel-agnostic bones, email-only skin.** Every automation executes
   through the Customer Automation Engine (see its section above); triggers and
   management UX are designed so future actions — WhatsApp, SMS, internal —
   plug into the same surface (see §10). V1 exposes exactly one action: send an
   email.
10. **Care rules apply.** The feature never nags, never celebrates itself, never
    counts sends as engagement. It works, logs, and recedes.

---

# 4. User Experience

## Where the feature lives

**Primary home: הגדרות → אוטומציות** (admin-scoped), the automation surface already
specified for the product (the same home that absorbs the existing WhatsApp
auto-response page). Email Automations is the email shelf of that one surface —
**not** a separate "Email" section, and not a new main-nav item.

Why not main navigation: the daily loop is Today → Leads → Inbox. Automations are
configured rarely and checked occasionally. A nav slot would demand badges and
activity to justify itself — the exact noise the care charter forbids.

Why admin-scoped: automations send in the business's name. Owners configure; reps
see effects. This matches the existing admin/user settings split and touches no
permission logic.

## Contextual entry points (doors, not homes)

1. **Post-import moment.** After an Excel import completes, one quiet line:
   "רוצה שלידים חדשים יקבלו אימייל פתיחה אוטומטית?" → opens the welcome recipe.
   Import is the product's first-success moment; this rides it without blocking it.
2. **Lead-source moment.** When a Meta form connection is live and leads are
   flowing, the leads first-run / onboarding surface gains one tile (reusing
   `OnboardingActionCard`): "אימייל אוטומטי לליד חדש."
3. **Status-change moment (later, measured).** After a user manually closes a
   deal, a single dismissible line: "רוצה שכל ליד שנסגר יקבל אימייל תודה?" Shown
   at most once; dismissal is permanent. Ship only if entry points 1–2 prove
   insufficient — moment-of-action prompts are the most intrusion-prone pattern
   in this document.

Explicitly **not** entry points: lead row context menus (automations are business
policies, not per-lead actions — a per-lead intent is a task, an existing feature),
toasts, modals, or anything that interrupts the leads workflow.

## First-run experience inside אוטומציות

An empty automations page follows the empty-state law — what, why, next:

- **What:** "אין עדיין אוטומציות אימייל."
- **Why:** "אוטומציה שולחת אימייל לליד ברגע הנכון — גם כשאתה עסוק."
- **Next:** the recipe gallery itself is the empty state. No separate onboarding
  layer, no tour, no checklist. The first screen a user ever sees is the same
  gallery they will use forever — there is nothing to learn twice.

The gallery shows 4–6 recipe cards (see §5), each with a one-line outcome
description and an example preview. One tap opens the recipe pre-filled. The
"blank automation" path exists but is visually last — a quiet "אוטומציה חדשה
מאפס" card after the recipes, never the hero.

---

# 5. Creating an Email Automation

## Challenged: the proposed six-step wizard

The brief proposed: trigger → recipients → compose → delay → review → activate.
Two of those steps should not exist:

- **"Choose recipients" is deleted.** In an event-triggered automation the
  recipient is definitionally the lead that fired the event. An audience picker
  would import Mailchimp's list-management complexity for zero user value and
  reintroduce segment thinking we have deliberately excluded. If a future feature
  needs "email many leads at once," that is a **campaign/broadcast** — a different
  product with different consent stakes — and must not be smuggled in here.
- **"Review" is not a step; it is the state of the final screen.** A separate
  review page adds a click that teaches nothing the compose screen didn't show.

## The actual flow — one sheet, three decisions

The creation surface is a single focused sheet (existing dialog/sheet patterns,
no new layout), structured as the automation sentence with editable slots:

**Slot 1 — Trigger ("כש…")**
Closed dropdown of V1 triggers (§6), with an optional source filter where
relevant: "ליד חדש נוצר — מכל מקור / מפייסבוק / מוואטסאפ / מטופס ספציפי."
When entered from a recipe, this is pre-selected and most users never touch it.

**Slot 2 — The email ("שלח…")**
Subject + body editor (§7), pre-filled from the recipe with real, usable Hebrew
copy — not lorem ipsum. The user edits their business's voice into it. This is
where the 60 seconds are spent, by design: content is the only thing the user is
truly better at than the product.

**Slot 3 — Timing ("מתי…")**
Preset chips: "מיד" (default) / "אחרי שעה" / "אחרי יום" / "מותאם" (number +
hours/days). Nothing else. Quiet-hours and caps are platform defaults under
"מתקדם," pre-configured safely.

**Bottom of the same sheet — proof, then the button:**

- Live preview of the rendered email with a **real recent lead's name**
  substituted ("כך זה ייראה אצל דנה"), with an honest fallback preview when a
  variable would be empty (§7).
- "שלח אליי אימייל בדיקה" — one tap, sends the rendered email to the admin's own
  address. This is the trust step for email: content is fully user-authored and
  static, so a test-send proves everything there is to prove. (Observation/draft
  mode — running silently and logging would-have-sents — is reserved for
  automations with machine-composed content or uncertain timing; for a static
  email it would be ceremony without information. It returns in the roadmap with
  AI-composed emails, §10.)
- Primary button: **"הפעל אוטומציה"**. Secondary: "שמור כטיוטה."

## Activation semantics (must be explicit in UI copy)

- The automation fires **only on events that happen after activation**. It never
  reaches back into existing leads. This single sentence — "האוטומציה תפעל על
  לידים חדשים מרגע ההפעלה" — prevents the enrollment confusion that makes
  HubSpot workflows terrifying, and prevents the accidental 3,000-email blast.
- Activation produces one inline confirmation on the card ("האוטומציה פעילה"),
  no celebration, no tour of the analytics. Help, then recede.

## Time-to-active budget

Recipe path: tap recipe (5s) → edit message (30–40s) → activate (5s) ≈ **under one
minute**, honestly measured from gallery to active. The blank-automation path may
take two minutes; it is not the path we optimize.

---

# 6. Supported Triggers (V1)

## The V1 set — two triggers, one optional anchor

**1. ליד חדש נוצר** (optionally filtered by source / specific form)
The highest-value trigger by far: it powers webinar confirmations, welcome emails,
and the credibility-building instant first touch. It maps to an event the system
already understands deterministically (lead ingestion), requires no new user
concepts, and its recipes are self-explanatory.

**2. סטטוס ליד השתנה ל־[status]**
Powers deal-won thank-yous ("נסגר"), and follow-up nudges on intermediate
statuses. Status is the product's core verb — reps update it constantly — so this
trigger converts an action users already perform into automated follow-through.
Closed statuses double as the "client" concept (per the entity constraint), so
"thank the customer" needs no new entity.

**3. (Decision required — see §12) Event-date anchor for the webinar case.**
The requesting customer's actual need is a reminder **before the webinar** — a
fixed calendar moment, not an offset from registration. Trigger+delay alone
cannot express "24 hours before the event." The minimal generic solution: an
optional "תאריך האירוע" field on an automation, enabling timing presets "יום
לפני האירוע" / "שעה לפני האירוע." It is one field, not a scheduling system — but
it is scope, and it is the difference between shipping the feature and shipping
the feature _that solves the founding customer's problem_. My recommendation:
include it, precisely scoped to one date per automation, no recurrence.

## Deliberately excluded from V1 (and why)

| Excluded trigger                               | Reason                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lead inactive N days**                       | The most requested "follow-up" trigger — and the most dangerous first. It requires defining "activity" honestly (which channels count?), and mis-timed recovery emails read as spam. It also overlaps the assistant's recovery surface (Today), which must stay the primary "lead going cold" experience. Roadmap, not V1. |
| **Birthday / date field**                      | No birthday field exists on leads; adding fields for a trigger inverts priorities.                                                                                                                                                                                                                                         |
| **Appointment/calendar triggers**              | Calendar exists, but coupling automations to it multiplies scope (reschedules, cancellations, no-shows). Roadmap.                                                                                                                                                                                                          |
| **Email engagement triggers** (opened/clicked) | Requires tracking whose honesty is questionable (see §8 analytics) and invites loop complexity.                                                                                                                                                                                                                            |
| **Task triggers**                              | Internal automation territory — arrives with internal actions (§10), not with email.                                                                                                                                                                                                                                       |
| **Webhook/API triggers**                       | Our ICP will never configure one. Excluded until a paying customer asks twice.                                                                                                                                                                                                                                             |
| **Bulk import as a trigger**                   | Imports do **not** fire "ליד חדש נוצר" by default (§9). A per-import explicit opt-in checkbox may be offered at import time; silent triggering on import is forbidden.                                                                                                                                                     |

The discipline: V1 triggers must be states the system already knows
deterministically, phrased in words users already use. Two triggers that always
fire correctly beat eight that need explaining.

---

# 7. Email Editor

## Editing surface

- **Subject** — single line, variables allowed, ~78-character soft counter (what
  inboxes actually display), no gimmicks (no emoji injection, no "subject line
  score").
- **Body** — clean rich-text: paragraphs, bold, links, bullet list. **No
  block/drag-drop builder, no columns, no image galleries.** Mailchimp-grade
  design tooling is the single biggest complexity trap in this category; our
  users need a professional note, not a newsletter. RTL Hebrew rendering is
  first-class and the default; the editor must never produce LTR-scrambled
  Hebrew punctuation.
- **Branding** — an automatic, minimal header/footer: business name, and the
  legally required unsubscribe link (§9). Logo if the business has one
  configured. Zero layout decisions for the user.

## Variables

A **closed set**, mirroring the WhatsApp templates precedent (no free-form
variables, no field-mapping UI):

- `שם הליד` — with a defined fallback when empty (greeting degrades gracefully:
  "שלום דנה," → "שלום,"). Fallback behavior is shown in the preview, not
  discovered in production.
- `שם העסק`
- `שם הנציג` (the assigned rep, if any; falls back to business name)
- If the event-date anchor ships: `תאריך האירוע` / `שעת האירוע`

Variables are inserted from a visible chip row — never typed as `{{syntax}}` by
the user.

## Preview and test

- **Live preview** rendered with a real recent lead (name substituted), plus a
  one-tap "הצג עם ליד בלי שם" toggle to preview fallback behavior.
- **"שלח אליי אימייל בדיקה"** — delivers the real rendered email to the admin's
  address, marked "[בדיקה]" in the subject. This is the feature's honesty
  handshake: what you receive is exactly what leads will receive.

## Templates (starter content, not a template library)

Each gallery recipe carries one well-written Hebrew starter email (subject +
body) — genuinely usable copy the user lightly edits, not a placeholder. There is
**no browsable template marketplace** in V1: five excellent starters beat five
hundred choices (choice paralysis is a documented failure mode of this category —
§11). Launch starters:

1. אימייל פתיחה לליד חדש (welcome / "קיבלנו את הפנייה")
2. אישור הרשמה לוובינר (the founding customer's recipe, day one)
3. תזכורת לפני האירוע (ships only with the event-date anchor)
4. תודה על סגירת העסקה (status → closed)
5. אימייל מעקב לליד בטיפול (status → in-progress follow-up)

---

# 8. Managing Automations

Management is a trust surface wearing a CRUD costume. The user's real questions:
_Is it on? What did it send in my name? Why didn't it send when I expected?_

## The list

One page (inside אוטומציות), one card per automation:

- **Name** — the recipe/outcome name, user-editable.
- **The sentence** — "כשליד חדש מגיע מפייסבוק → 'ברוכים הבאים' → מיד," as one
  line of secondary text. The automation is always legible without opening it.
- **Status chip** — פעיל / מושהה / טיוטה / דורש טיפול. One chip, one state, per
  the one-state-at-a-time law.
- **One honest activity line** — "נשלחו 12 אימיילים השבוע" (server-backed count,
  or nothing if zero — never a meaningless "0 sent" stat row).
- **The toggle** — pause/resume in place, optimistic with rollback.

No search in V1 — a search box over a list of typically 2–6 items is noise that
implies scale the feature doesn't have. Revisit when real accounts exceed ~10
automations. No folders, no tags, no bulk actions.

## Actions

- **השהה / הפעל** — the primary lifecycle. Pausing keeps history and cancels any
  queued delayed sends (disable means _stop everything_, with the card stating
  it: "אימיילים שממתינים לשליחה בוטלו").
- **שכפל** — duplicates as a draft. Quietly powerful: duplicating a welcome
  email and changing the delay to "אחרי 3 ימים" is how users build sequences in
  V1 without a sequence builder existing.
- **ערוך** — edits apply to future sends; queued delayed sends use the content
  current at send time. One inline sentence states this on save.
- **מחק** — red, confirmed, names the object and consequence ("האוטומציה 'אימייל
  פתיחה' תימחק ותפסיק לפעול. ההיסטוריה תישמר."). History outlives the automation.

## History (the activity log — the heart of the feature)

Per automation, a chronological log where every entry is a lead-linked fact:

- **Sends** — timestamp, lead name (→ lead page), subject, delivery state.
- **Skips, in care language** — the system explains why it _didn't_ act:
  "לא נשלח — אין כתובת אימייל לליד" / "לא נשלח — הליד הוסר מרשימת התפוצה" /
  "לא נשלח — כבר נשלח לליד הזה" / "לא נשלח — הליד נמחק לפני מועד השליחה."
  Surfacing negative decisions is the product's proportionality made visible —
  the single most trust-building element in this spec, and one no competitor
  ships.
- **Failures** — "לא נשלח — תקלה זמנית, ננסה שוב" and terminal failures in
  plain Hebrew. Raw provider errors never reach the UI (the WhatsApp error-copy
  precedent).

## Analytics — honest and minimal

V1 shows: **נשלחו / נכשלו / הוסרו מהרשימה** (sent / failed / unsubscribed), as
counts on the automation detail, backed by real server data. Deliberately
excluded: open rates and click rates. Apple Mail Privacy Protection and image
blocking have made open tracking substantially fictional; showing a number we
know is wrong violates the product's data-honesty rules. If engagement metrics
ever ship, they ship labeled as estimates — an explicit §12 decision, not a
default. "Sent" language must mean _accepted for delivery_, mirroring the honest
delivery ladder already established for WhatsApp.

## Failure state

A systemic problem (provider outage, suspended sending) surfaces as the card
state **דורש טיפול** with actionable Hebrew — never a toast storm, never an
email-about-email. At most one calm line in Today if sends are actively failing
while leads arrive. Fixing the cause clears the state without ceremony.

---

# 9. Edge Cases

**Lead lifecycle**

- **Lead deleted before a delayed send** → cancel silently; log the skip with
  reason. Never send to a deleted lead; never error.
- **Lead has no email address** → skip, log "אין כתובת אימייל," and count it. If
  a meaningful share of triggers skip for this reason, the automation detail
  shows one actionable line ("ל־14 לידים לא נשלח — חסרה כתובת אימייל") linking to
  the filtered leads list. Recovery framing, never guilt.
- **Lead reaches terminal status (closed/lost) before a delayed send** → product
  decision per trigger: status-triggered sends respect the _target_ status only;
  a "new lead" welcome pending when the lead closes is dropped ("לא נשלח — הליד
  כבר טופל"). The principle: never send an email whose premise is no longer true.
- **Lead merged/deduplicated** → send-once keys follow the surviving lead;
  duplicates never cause double sends.

**Duplication and volume**

- **Duplicate sends** → platform law: **once per lead per automation, ever**, by
  default (the internal registry's send-once semantics, made user-visible). A
  status flapping A→B→A→B fires once. Re-send-on-repeat is a folded advanced
  option only if a real use case demands it (§12).
- **Multiple automations firing on the same event** → allowed (welcome + webinar
  confirmation can coexist), but governed by a **per-lead frequency cap**
  (default: max 2 automated emails per lead per day). Beyond the cap, later
  sends are skipped and logged honestly. Prevents the stacked-automations spam
  effect that gets businesses marked as junk.
- **Bulk import storm** — the defining edge case. Importing 500 leads must
  **not** fire 500 welcome emails by default. Imports are excluded from the
  "ליד חדש נוצר" trigger; at import time, an explicit unchecked opt-in may
  offer "שלח אימייל פתיחה ללידים המיובאים" with the exact count named. Silent
  mass-send on import is forbidden — it is the fastest way to burn a customer's
  sender reputation and their trust in one click.

**Consent and law**

- **Unsubscribe** — every automated email carries a working Hebrew unsubscribe
  link, non-negotiable, non-removable. Unsubscribing suppresses the lead from
  **all** automated emails of that business, forever, immediately, and is logged
  on the lead. Suppression is per-business (never global across tenants).
- **Israeli spam law (תיקון 40)** — marketing email requires consent. Leads who
  submitted a form arguably initiated contact; imported cold lists did not. The
  product cannot adjudicate consent per lead, but it must (a) never default
  imports into email automations, (b) always include unsubscribe, and (c) state
  responsibility plainly in the feature's terms. The consent stance needs an
  explicit product/legal decision before launch (§12).

**Time and infrastructure**

- **Time zones** — all delays, event-date anchors, and any send windows use the
  business timezone (`Asia/Jerusalem` precedent, single source of truth). Never
  the lead's device, never UTC arithmetic in the UI.
- **Provider failure / downtime** → quiet bounded retries; transient failures
  are invisible unless they become terminal; systemic failure → the דורש טיפול
  card state. Delayed sends missed during downtime send late with honest
  timestamps — or are dropped if their premise expired (see terminal-status
  rule). Never double-send on retry ambiguity: idempotency over completeness.
- **Hard bounces** → after a hard bounce, the address is marked undeliverable
  for automated email; subsequent triggers skip with "כתובת האימייל לא תקינה."
  Surfaced on the lead, framed as fixable data, not failure.
- **Rate limits** → provider-level caps are the platform's job; the user-visible
  contract is the per-lead frequency cap and honest skip logging. No user-facing
  throughput configuration.

**System integrity**

- **Loops** — structurally impossible in V1: email sends do not generate
  trigger events (no inbound email ingestion, no engagement triggers), and
  send-once semantics bound status-flap retriggering. This property — _actions
  must not silently become triggers_ — is a platform law that future channels
  (§10) must preserve explicitly.
- **Disabled automation with queued sends** → queued sends cancelled, stated on
  the card at pause time. Re-enabling does not resurrect cancelled sends.
- **Editing while queued** → queued sends render with content at send time; the
  edit surface says so in one sentence.
- **Sender identity and deliverability** — V1 sends from a SocialCRM-managed
  sending identity displaying the business name, with reply-to set to the
  business's real address; replies land in the owner's normal inbox (email is
  not an inbox channel in-product, and the feature must never imply it is).
  Custom sending domains are roadmap. If deliverability is weak, the entire
  feature reads as broken regardless of UX — this is a launch-gating concern
  (§12), even though its mechanics are out of scope for this document.

---

# 10. Future Roadmap

The V1 grammar — **one trigger → one action → one timing** — is the stable
architecture: the Customer Automation Engine's contract with the experience
layer (see the engine section after §0). Everything below is a new action or a
new law plugged into that engine — never a new paradigm, and never a change the
user has to relearn.

**Multi-step sequences.** A sequence is _presented_ as one thing but _is_ an
ordered set of single-rule automations sharing a trigger (V1 users already build
this via duplicate-and-change-delay). The future work is UI grouping — showing
related automations as one "מסע" card — not a new engine. The single-rule
invariant survives.

**WhatsApp automations.** The same trigger registry gains WhatsApp actions —
which arrive with their own channel laws (24-hour window honesty, approved
templates outside it, quiet hours, human-always-wins) inherited from the
existing Instant Response Engine. Email's V1 laws (send-once, frequency caps,
suppression, skip transparency) were designed to generalize precisely here: a
channel is a set of actions plus a set of laws, under one gallery.

**SMS.** Same shape: new action, channel-specific laws (cost visibility,
consent). No UI paradigm changes.

**AI-generated emails.** "ניסוח חכם" becomes a content mode on the compose slot
(the ai/fixed pattern from WhatsApp), always behind a deterministic validator,
never sent on validation failure — and **this** is where observation mode
(deferred in §5) enters email: machine-composed content is exactly the
uncertainty that earns a watch-first period.

**Internal actions.** "צור משימה," "שייך נציג," "עדכן סטטוס" as actions — the
cheapest, safest expansion (no external sends, no money, no consent). One law
must be written before internal actions ship: **an action that changes a status
does not fire status triggers** (or fires them under an explicit, bounded rule)
— preserving the no-loops property of §9.

**Conditions.** A single flat "רק אם" filter on a slot (e.g., "רק אם המקור הוא
פייסבוק" — which V1 already covers for source; future: assigned rep, has phone).
One condition, no AND/OR trees.

**Branching.** Deliberately last, and possibly never. Branching is where users
create automations they don't understand, which misfire, which destroy trust in
all automation. Before building if/else, exhaust the alternative: two simple
automations instead of one branched automation. The bar for branching is a
demonstrated, recurring customer need that duplication genuinely cannot serve —
not feature-list parity.

**Also on the horizon, in order of likely value:** event-date recurrence (weekly
webinars), calendar/appointment triggers, inactivity recovery triggers (in
coordination with the Today surface, which owns "lead going cold"), custom
sending domains, and estimate-labeled engagement metrics.

---

# 11. UX Mistakes To Avoid

Lessons from HubSpot, ActiveCampaign, Mailchimp — each mapped to what SocialCRM
does instead.

1. **The empty canvas (HubSpot).** "Create your first workflow" over a blank
   builder produces paralysis and abandonment. _Us:_ the gallery is the empty
   state; there is no blank canvas anywhere in the product.
2. **Enrollment-criteria complexity (HubSpot).** Users cannot predict who enters
   a workflow, so they fear activating anything. _Us:_ activation semantics are
   one sentence — fires only on events after activation, recipient is the
   triggering lead, once per lead. Predictability is the feature.
3. **List/audience management as a prerequisite (Mailchimp).** Forcing audience
   setup before the first email is configuration-before-value. _Us:_ no lists,
   no audiences, no recipients step — the event picks the recipient.
4. **Template-gallery paralysis (Mailchimp).** Five hundred designer templates
   turn a 60-second task into an hour of browsing. _Us:_ one excellent starter
   per recipe.
5. **The block editor tax (Mailchimp, ActiveCampaign).** Drag-drop email design
   produces broken layouts and eaten afternoons. Our users need a professional
   note, not a newsletter. _Us:_ clean rich text with automatic branding.
6. **Analytics theater (all three).** Open-rate dashboards presented as truth,
   post-MPP. _Us:_ honest minimal counts; no metric we know is fictional.
7. **Silent failures (HubSpot workflows are notorious).** An automation that
   stopped working and told no one destroys more trust than never automating.
   _Us:_ the דורש טיפול card state, skip logging, and honest failure copy.
8. **Jargon (all).** "Workflow," "enrollment," "trigger," "campaign" — even
   transliterated, they say "not for you" to our ICP. _Us:_ everything is
   כש/שלח/מתי, in the product's one voice.
9. **Notification spam about automation activity (ActiveCampaign).** Per-send
   notifications train users to ignore everything. _Us:_ activity lives in the
   log; the system never emails or toasts about its own emails.
10. **The forgotten automation.** Users forget what's running and get surprised
    months later — usually via an angry lead. _Us:_ every automation is legible
    as a sentence on its card; the list is short, flat, and always current; and
    sends are visible per lead in the activity log.
11. **Demo-optimized builders.** Flow canvases demo brilliantly and rot in
    production. _Us:_ we accept losing the 30-second demo to win the 30-day
    relationship — a trade the product's charter has already made in writing.

---

# 12. Open Product Questions

Decisions required before an implementation plan is written. Where I hold a
recommendation, it is stated — but these are genuinely open.

1. **The event-date anchor (§6).** Without it, the founding customer's "reminder
   before the webinar" need is unmet and V1 ships as a welcome-email feature.
   With it, V1 gains one field and two timing presets. _Recommendation: include,
   minimally scoped (one date, no recurrence)._ Decide.
2. **Sender identity and deliverability ownership.** Shared SocialCRM sending
   identity in V1 — acceptable? What business-name display, what reply-to
   guarantees, and who owns the spam-folder problem? This gates launch quality
   more than any UX choice in this document. Needs a deliberate decision with
   whoever owns infrastructure.
3. **Consent stance (Israeli spam law).** Is form-submission consent sufficient
   for automated email? Are imported leads ever eligible, even with per-import
   opt-in? This is a product/legal decision, not a UX one. Must be answered in
   writing before launch.
4. **Import opt-in.** Does the per-import "send welcome to imported leads"
   checkbox exist in V1, or are imports simply excluded entirely? _Recommendation:
   exclude entirely in V1; add the opt-in only on demand._ The checkbox is a
   loaded gun near the product's first-success moment.
5. **Plan gating.** Which subscription tiers get Email Automations, and is there
   a send-volume dimension to pricing? Care/commerce boundary applies: limits
   surface in billing surfaces, never as pressure inside the automation UX.
6. **Re-send semantics.** Is once-per-lead-ever correct for status triggers, or
   does a real case exist for once-per-status-entry? _Recommendation: once-ever
   in V1; revisit with evidence._
7. **Frequency cap default.** Max automated emails per lead per day — 1 or 2?
   _Recommendation: 2, revisit with data._
8. **Engagement metrics.** Do estimate-labeled opens ever ship, or does the
   product hold the honest-counts line permanently? Holding the line is a
   defensible brand position; decide it consciously rather than by default.
9. **Naming collision (§0).** Resolved in direction by the "Platform Emails vs
   Customer Automations" boundary contract (§0): canonical names, prefix
   discipline, and the rename path for `lib/emailAutomations/`. What remains
   open is timing — whether the platform directory rename happens before or
   alongside the customer feature's implementation.
10. **The deeper channel question — challenge to the premise.** Our users' leads
    live on WhatsApp; Israeli SMB email open rates are mediocre; WhatsApp
    template sends would likely outperform email for several launch recipes. Why
    email first? The honest answers: email is free (templates cost per-send),
    legally simpler inside the 24-hour-window regime, technically decoupled from
    Meta review cycles, and it is what the customer asked for. Email is the
    right _pilot channel_ for the automation surface — but the roadmap position
    that WhatsApp recipes may ultimately matter more should be held openly, and
    nothing in V1's UX may imply email is the product's primary outbound
    channel. If the team believes WhatsApp automation should leapfrog email
    entirely, that is a legitimate alternative direction — the gallery, laws,
    and management surface in this document transfer to it almost unchanged.
11. **Where "lead going cold" lives.** Inactivity triggers (roadmap) overlap the
    Today surface's recovery mission. Before they ship, decide the boundary:
    Today surfaces the cold lead to the human; automations may eventually act on
    it. Two systems recovering the same lead independently would double-touch
    leads and violate proportionality.

---

_End of specification. This document contains no implementation guidance by
design; the next step, once open questions are resolved, is an implementation
plan that maps this UX onto the existing product surfaces and automation
infrastructure._
