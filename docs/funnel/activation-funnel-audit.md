# activation-funnel-audit.md — Where marketing-acquired users are lost

**Status:** diagnostic audit. No code changed, no schema touched, no features built.
**Date:** 2026-08-12 · **Branch:** `feature/notification-infrastructure`
**Companion:** [`activation-funnel-queries.sql`](./activation-funnel-queries.sql) — 9 read-only
probes, all executed successfully against the live schema.
**Authority:** subordinate to `CLAUDE.md`, `do-not-touch.md`, `care-charter.md`.

Every claim below was read out of the code and cited by file and line. Where the code and an
earlier document disagree, the code wins — `docs/onboarding-activation-strategy.md` was written
before the Facebook gate was neutralised and is now partly historical (§9).

---

## 0. The answer in one paragraph

The funnel has **three walls, not one**, and only the third is the one anyone talks about. Wall 1
is a **device gate**: `app/(app)/layout.tsx:46` redirects every phone User-Agent out of the
product, permanently, before any other check — and Meta ad traffic arrives on phones. Wall 2 is a
**trial wall**: a new desktop agency is served an inert teaser plus a non-dismissible modal, so the
CRM does not exist until the user clicks *הפעל את ה-Pro שלי*. Wall 3 is the **empty workspace**:
past both walls, the user lands on `LeadsFirstRun` with four equal cards and no lead data, and
whether they ever act is **completely uninstrumented** — Excel import, status changes, assignment
and messaging emit nothing at all. Wall 1 and Wall 2 are measurable **today** with the queries in
the companion file. Wall 3 is not measurable at any price without new events, which is precisely
why "why do users register but fail to activate?" is currently unanswerable. The good news:
the event pipeline (`analytics_events` + `lib/analytics/track.ts`) is well-built, 42 events already
flow through it, and closing the diagnostic gap is roughly **nine one-line `track()` calls and zero
schema changes**.

---

## 1. The funnel as actually implemented

| # | Step | Where it lives | What it really is |
| --- | --- | --- | --- |
| 1 | Landing page | `app/(marketing)/*` (12 pages, `/` re-exports `/crm`) | All CTAs point to `/auth`. Meta Pixel `PageView` only. |
| 2 | Signup | `/auth` → `/auth/register` → `actions/agencies.ts:14` `addAgency()` | Google ID token or magic link → agency + user in one transaction. |
| 3 | Onboarding completion | — | **Does not exist.** See §1.1. |
| 4 | **Device gate** | `app/(app)/layout.tsx:46` | **Undocumented step. Every phone leaves the product here.** §1.2 |
| 5 | **Trial wall** | `app/(app)/layout.tsx:132` + `WelcomeTrialModal` | The workspace is not rendered until the trial is started. §1.3 |
| 6 | First-run workspace | `/leads` → `components/clients/LeadsFirstRun.tsx` | Four equal cards: WhatsApp, Facebook/IG, add lead, import Excel. |
| 7 | Meta connection | `/settings/integrations?section=facebook` → `/api/auth/facebook` | OAuth → page discovery → subscribe → upsert. §1.4 |
| 8 | Page selection | `/api/auth/facebook/connect` (POST) | Webhook subscribe **first**, then DB write. §1.5 |
| 9 | Lead ingestion | `/api/webhooks/facebook` → `lib/system/createClientFromWebhook.ts` | Dedup → Graph fetch → insert → `activation_first_real_lead`. |
| 10 | First CRM action | `actions/clients.ts`, `leadFollowUp.ts`, `leadOutcome.ts` | **Almost entirely dark.** §1.6 |
| 11 | Trial activation | `actions/trial.ts` → `db/trial.ts:startTrialForAgency` | 7 days, guarded UPDATE, idempotent. |
| 12 | Return visit | — | **No login, session, or page-view event exists.** §1.7 |
| 13 | Subscription | `/api/payments/upgrade` → Grow → `/api/payments/grow` | `upgrade_clicked` → `subscription_activated`. |

### 1.1 There is no onboarding step

`actions/agencies.ts:30` stamps `onboardingCompletedAt: trx.fn.now()` **inside the registration
transaction**. `isOnboarded()` (`lib/activation/onboarding.ts:19`) reads only that column, so it is
true for every agency created today. The `/activate` gate at `app/(app)/layout.tsx:48` can now only
fire for legacy agencies whose column is still NULL.

**Consequence — a whole funnel went quiet.** The activation FSM (`ActivationExperience`,
`useActivationController.ts`) is unreachable for newly-created agencies, so five declared events
are dying off: `activation_started`, `oauth_completed`, `subscription_completed`,
`subscription_failed`, `activation_abandoned`. Any dashboard reading them will misreport the
decline as a collapse in activation.

> **Corrected against production (§10).** These events are *not* fully dead. `agencies` still holds
> **15 non-exempt agencies with `onboardingCompletedAt IS NULL`** — created between the 2026-06-30
> backfill and the 2026-08-05 cutover — and every one of them is **still gated to `/activate`
> today** and must complete the Facebook FSM to enter the product. Post-cutover the FSM shows
> `activation_started` ×2 from 1 agency (vs. 63 pre-cutover). So: mostly dead, plus a live stranded
> cohort of 15 that no one is counting.

### 1.2 Wall 1 — the device gate (the largest and least-discussed loss)

```
app/(app)/layout.tsx:46   if (await isMobileRequest()) redirect('/activate')
```

This runs **before** the onboarding check, on every request, for every user, forever — including
users who already connected Meta and including paying customers. `/activate` then renders
`MobileHandoff`: a headline (*SocialCRM עובד במיטבו במחשב*), a copy-link button, and a link to
support. There is no path into the product from a phone.

The registration redirect at `actions/agencies.ts:104` is consistent with it — phones go to
`/activate?welcome=`, desktops to `/leads?welcome=`.

Why this dominates the marketing funnel: a Meta ad is tapped inside the Facebook or Instagram
in-app browser, on a phone. That user can read the landing page, can sign up, is charged to your
CAC — and is then told to come back on a computer. **Cross-device return is a hard, uncounted
requirement.** This is measurable today: **Q2**.

> **Measurement caveat, and it matters.** The redirect uses `isMobileRequest()` — server-side
> **User-Agent**, `device.type === 'mobile'` (`lib/device.ts:20`). The analytics `device` prop uses
> `window.matchMedia('(min-width: 1000px)')` — client-side **viewport**
> (`components/agencies/AddAgencyForm.tsx:31`). These disagree: a tablet is UA-`tablet` (not
> redirected) but usually reports viewport `mobile`; a narrow desktop window reports `mobile` and
> is not redirected. So `registration_completed.props.device` **overstates** the redirected
> population. Fixing this is one line and is the single highest-leverage instrumentation change in
> this document.

### 1.3 Wall 2 — the trial wall

For `trialStatus === 'NEVER_STARTED'`, `app/(app)/layout.tsx:132` renders `<WorkspaceTeaser/>`
**instead of** `{children}` — the CRM is never server-rendered — plus a non-dismissible
`WelcomeTrialModal` whose only exit is the CTA (`components/trial/WelcomeTrialModal.tsx:103`).

On mount it emits `desktop_first_access` and `welcome_modal_shown` (`db/trial.ts:74`), both deduped
once-per-agency by a partial unique index. The CTA calls `startTrial()` → `trial_started`.

Two facts follow. First, **the product is inaccessible before trial activation**, so
`trial_started` is not a billing metric here — it is the gate to first use. Second, `welcome_modal_shown`
→ `trial_started` is a clean, already-instrumented conversion, and anyone shown the modal who never
started is a total loss with zero product exposure. Measurable today: **Q3**.

### 1.4–1.5 Meta connection and page selection

`/api/auth/facebook` (`route.ts`) sets CSRF state and redirects to the OAuth dialog. **It emits
nothing.** `facebook_connect_started` is declared in `lib/analytics/track.ts:36` and never emitted
anywhere — so the OAuth funnel has **no denominator** and dialog abandonment is invisible.

The callback (`callback/route.ts`) is genuinely well-instrumented: it verifies `leads_retrieval` was
actually granted, emits `facebook_oauth_completed` (:123), `facebook_page_discovered` with a count
(:156), and on every failure path emits `facebook_connect_failed` with `{reason, stage}` across five
stages (`oauth`, `permissions`, `discover`, `subscribe`, `ownership`). That taxonomy is the best
diagnostic asset in the codebase — **Q6** reads it directly.

`connect/route.ts` subscribes the page to `leadgen`+`feed` **before** the DB write, then emits
`facebook_webhook_subscribed` (:76), `facebook_page_selected` (:104) and
`facebook_connected_operational` (:105).

> **Precision defect:** all three fire at the same moment, *after* subscription succeeds. So
> `facebook_page_selected` does not mean "the user chose a page" — it means "the chosen page was
> successfully wired". A user who picks a page and hits a subscription failure emits
> `facebook_connect_failed`, never `page_selected`. The two are recoverable in combination, but the
> step named "page selection" in the brief has no clean event of its own.

### 1.6 Wall 3 — the first meaningful CRM action is almost entirely dark

Exactly three product-value events exist, and all three fire only on one narrow path — the
**manual** first lead created from `LeadsFirstRun`:

- `first_manual_lead_created` — `LeadsFirstRun.tsx:122`
- `first_lead_opened` — `FirstLeadCallout.tsx:68`
- `first_follow_up_set` — `FirstLeadCallout.tsx:79`

Verified by grep across `actions/`, `app/`, `lib/`, `components/`, `db/`: **zero `track()` calls** in
`actions/clients.ts` (`addLeads`, `importLeadsFromCsv`, `upsertLead`, `updateLead`,
`transferLeadToRep`, `deleteLead`), `actions/leadFollowUp.ts`, `actions/leadOutcome.ts`,
`actions/tasks.ts`.

Therefore **Excel import emits nothing** — the act that `product.md` §7 names as the product's own
first success moment ("within 60 seconds they can see all their leads organized in one place") is
completely invisible. So are status changes, assignment, notes and outbound messages. A user who
imports 300 leads and works them for a week produces the same analytics trace as a user who logged
in once and left.

Compounding this, `trackFirstRealLeadOnce()` is typed `integration: 'facebook' | 'whatsapp'`
(`lib/analytics/track.ts:106`) — **first delivered value is type-level impossible without an
integration.**

### 1.7 Retention has no real signal

There is no login event, no session event, no page-view event. The only proxy is `users_info.ips` —
a rolling array capped at 10 entries, written by `recordLoginActivity` (`db/loginActivity.ts:12`)
from `createCookie`. Because the session cookie has a **30-day TTL** (`db/auth.ts:19`), a user
returning inside 30 days does not re-mint a token and therefore **leaves no trace**. This proxy
systematically undercounts exactly the returning users you most want to see. `user_presence` exists
but its writer is the notification feed poll, gated behind `NOTIFICATIONS_ENABLED` plus an agency
allowlist, so it covers only allowlisted agencies. **Q9** uses the proxy with these limits stated.

---

## 2. Every event/metric we can already measure

`analytics_events` (`agencyId`, `userId`, `event`, `props` jsonb, `createdAt`) with a partial unique
index deduping five once-per-agency funnel events. 50 event names are declared; **42 are emitted**.

### Live and useful for this funnel

| Event | Emitted at | Useful props |
| --- | --- | --- |
| `registration_completed` | `actions/agencies.ts:66` | `device` (viewport-derived — see §1.2) |
| `desktop_first_access` | `db/trial.ts:74` | first desktop arrival, pre-trial only |
| `welcome_modal_shown` | `db/trial.ts:75` | trial-wall denominator |
| `trial_started` | `db/trial.ts:59` | — |
| `trial_expired` | `app/(app)/layout.tsx:77` | — |
| `upgrade_clicked` | `app/api/payments/upgrade/route.ts:89` | `source`, `period` |
| `subscription_activated` | `app/api/payments/grow/route.ts:218` | `transactionId`, `fromState`, `period` |
| `facebook_oauth_completed` | `callback/route.ts:123` | — |
| `facebook_page_discovered` | `callback/route.ts:156` | `count` |
| `facebook_page_selected` / `_webhook_subscribed` / `_connected_operational` | `connect/route.ts:76,104,105` | — |
| `facebook_connect_failed` | 4 sites | **`reason`, `stage`** — the best diagnostic in the repo |
| `whatsapp_webhook_subscribed` / `_messaging_ready` / `_connected_operational` / `_connect_failed` | whatsapp routes | `reason`, `stage` |
| `activation_first_real_lead` | `track.ts:114` via webhook creators | `integration` (fb/wa only) |
| `meta_capi_lead_sent` | `metaLeadConversion.ts:111` | CAPI marker + idempotency key |
| `first_manual_lead_created` / `first_lead_opened` / `first_follow_up_set` | first-run path only | — |

### Non-event data assets already available

- `agencies` — `trialStartedAt`, `trialEndsAt`, `plan`, `planReason`, `onboardingCompletedAt`
- `_trial_status` **view** — derived trial status per agency in one SELECT (mirrors `getTrialState`)
- `clients` — `createdAt`, `leadSource` (`facebook:<leadId>`, WhatsApp equivalents) → source-split TTV
- `webhook_failures` — `error_type` ∈ `fetch_error|timeout|graph_api_error|db_error|unhandled_error`
- `facebook_pages`, `whatsapp_connections`, `subscriptions`, `pending_upgrades`, `payments`
- `users_info.ips` — weak login proxy (§1.7)

### Declared but never emitted — dead entries in the union

`facebook_connect_started` · `whatsapp_connect_started` · `whatsapp_signup_completed` ·
`whatsapp_phone_discovered` · `support_request_created` · `support_request_replied` ·
`support_notification_failed`

The first four remove the denominator from both connect funnels. Wiring them is one line each.

### Client-side / Meta

`lib/facebook/MetaPixel.tsx` fires `PageView` on load and on every route change, gated on
`NEXT_PUBLIC_META_PIXEL_ID`. `CompleteRegistration` fires from `WelcomeToast` (desktop) and
`RegistrationPixel` (mobile), both localStorage-deduped. Server-side CAPI sends `Lead` once per
agency at the Facebook connect.

**`trackStartTrial()` and `trackSubscribe()` are defined in `lib/facebook/pixelEvents.ts:22-24` and
called from nowhere.** Meta therefore optimises toward *registration* — the cheapest, noisiest
signal in the funnel — and has never been told which registrations trial or pay.

---

## 3. Drop-off points identifiable from existing data — run these now

All nine queries in the companion file executed successfully against the live schema (9 passed, 0
failed). They are read-only. The local dev database has 2 agencies, so **the numbers must come from
production** — no figures are quoted here, because inventing them would be worse than having none.

| Q | Question it answers | Why it matters |
| --- | --- | --- |
| **Q1** | Master funnel by registration-week cohort | The one table to look at weekly |
| **Q2** | **% of mobile registrants who ever reach a desktop** | **Run this first.** Sizes Wall 1 — likely the largest single loss in the company |
| **Q3** | Shown the trial modal but never started | Sizes Wall 2; every one is a total loss with zero product exposure |
| **Q4** | Trials that never got a single lead | The empty-CRM population — "registered but never activated" made concrete |
| **Q5** | Meta connect funnel, stage by stage | Where connection attempts die (missing its true first stage) |
| **Q6** | `facebook_connect_failed` by `{stage, reason}` | Exact failure taxonomy — no permission grants "no pages" vs. genuinely no page |
| **Q7** | Registration → first lead, p50/p90, % within 1h/24h | The TTV baseline |
| **Q8** | trial → `upgrade_clicked` → `subscription_activated` | Whether the loss is intent or checkout |
| **Q9** | Return-visit distribution (with stated limits) | The best retention read available today |

**Suggested reading order:** Q2 → Q3 → Q4. Those three, in that sequence, localise the loss to a
wall before a single line of new code is written.

### What existing data can *not* tell you

- **Landing → signup.** No server-side page analytics and no join key. Pixel `PageView` lives in
  Ads Manager and cannot be tied to an `agencyId`.
- **Attribution.** Zero UTM / `fbclid` / `gclid` / referrer capture anywhere — verified by grep
  across `app/`, `components/`, `lib/`, `actions/`, `db/`. **No campaign, ad set, or creative can be
  tied to any registration, trial, or payment.** Every funnel number is a blended average.
- **Mobile handoff behaviour.** `ContinueOnDesktop` emits nothing — you cannot tell a phone user
  who tried to cross over from one who gave up on sight.
- **Meta OAuth abandonment** (no `facebook_connect_started`).
- **Excel import** — the product's own first success moment.
- **Any CRM action** beyond the three narrow first-run events.
- **Whether the connect cards were ever seen** — "chose not to connect" is indistinguishable from
  "never scrolled to it".

---

## 4. Recommended Activation KPI

Three layers are being conflated under one word. Separating them makes the KPI obvious.

| Layer | Definition | Predicts |
| --- | --- | --- |
| **Setup** | Any lead source established — connection **or** import **or** first manual lead | Whether activation is *possible* |
| **Activation** | ≥1 lead in the system **and** ≥1 action taken on a lead, within 7 days of registration | Retention. **This is the KPI.** |
| **Habit** | Lead actions on ≥3 distinct days in a 7-day window | Payment |

> **Primary Activation KPI — 7-Day Activation Rate**
> The share of registered agencies that, within 7 days of `registration_completed`, have **≥1 lead
> in `clients`** *and* **≥1 recorded lead action** (status change, follow-up set, assignment, or
> outbound message).
> **Always reported segmented by registration device** — a blended number will hide Wall 1.

Why this and not the alternatives: a Facebook connection measures *"does this business run Meta
Lead Ads"*, not whether it is getting value. A lead nobody touches is a row in a table. Trial start
is, in this architecture, a door — not an outcome. Registration and dashboard visits are costs, not
outcomes. This definition is source-agnostic by construction, so a Meta advertiser and an
accountant with a spreadsheet count identically. It is also consistent with the milestone already
reasoned out in `docs/onboarding-activation-strategy.md` §3.

**Interim KPI, computable this week with zero code** — use it until `lead_action_taken` ships:

> **Provisional activation** = `trial_started` **and** ≥1 row in `clients` within 7 days. (Q4.)

It is a floor, not the real thing — it cannot see whether anyone *worked* the leads — but it
unblocks the diagnosis immediately and its bias is known and one-directional (it over-counts).

**Supporting metric (North Star candidate):** *Weekly Active Lead-Working Agencies* — agencies with
≥3 lead actions in the last 7 days. Source-agnostic, value-true, and it cannot be inflated by the
engagement tactics `care-charter.md` §13.1 has already committed in writing not to pursue.

---

## 5. Recommended Time-to-Value KPI

> **TTV — median minutes from `registration_completed` to the first lead visible in the agency's
> workspace**, i.e. `min(clients."createdAt")` for that agency.
> Reported as **p50 and p90**, with companions **% within 1 hour** and **% within 24 hours**,
> **segmented by registration device and by entry path** (manual / import / facebook / whatsapp).

Rationale: `product.md` §7 defines the first success moment as *"they import their Excel file, and
within 60 seconds they can see all their leads organized in one place."* The KPI should measure
that literal claim. Target: **p50 ≤ 60 seconds on the import path**; the whole-funnel p50 will be far
higher and that gap is itself the diagnosis.

Three honesty constraints, all of which belong in the metric definition:

1. **The clock starts at registration, not at the ad click** — there is no attribution to start it
   earlier (§3). Do not present it as "time from ad to value".
2. **Per-path segmentation needs `leads_imported`** (§6). Aggregate TTV is available today (Q7);
   per-path is not.
3. **Report the denominator alongside it.** A TTV computed only over agencies that reached value is
   a survivor metric — it improves when weak users churn faster. Always publish
   *"% who ever reach value"* next to it.

---

## 6. Minimum instrumentation to answer "why do users register but fail to activate?"

Scoped to the minimum. Everything below uses the **existing** `track()` helper and the **existing**
`analytics_events.props` jsonb column. **No schema change. No migration. No new dependency. No
architectural change.**

### Tier 0 — this week, zero code

Run Q2 → Q3 → Q4 against production. Localise the loss to a wall before writing anything.

### Tier 1 — the minimum viable diagnostic set (9 events, 2 fixes)

| # | Event | Emit at | Answers |
| --- | --- | --- | --- |
| 1 | *(fix)* align `registration_completed.props.device` to `isMobileRequest()` | `actions/agencies.ts:62` | Makes Wall 1 measurable *correctly* — today it is measurable but skewed (§1.2) |
| 2 | `mobile_handoff_shown` | `app/activate/page.tsx` mobile branch | True denominator for the device cliff, incl. returning users |
| 3 | `mobile_handoff_link_copied` `{method:'copy'\|'share'}` | `ContinueOnDesktop.tsx` | Tried to cross over vs. gave up on sight |
| 4 | `workspace_first_viewed` | `app/(app)/layout.tsx` non-teaser branch | The denominator for every in-product metric. `desktop_first_access` dies after trial start and cannot serve |
| 5 | `leads_imported` `{count, format:'excel'\|'csv'}` | `actions/clients.ts` `addLeads` / `importLeadsFromCsv` | `product.md`'s own first success moment, currently invisible |
| 6 | `lead_created_manual` | `actions/clients.ts` `upsertLead` (origin `manual`) | Beyond the single first-run lead |
| 7 | **`lead_action_taken`** `{action:'status'\|'follow_up'\|'assign'\|'message'\|'note'}` | `upsertLead`/`updateLead`, `leadFollowUp`, `transferLeadToRep`, WhatsApp send | **The activation milestone itself.** Nothing else can serve |
| 8 | `connection_offered` / `connection_deferred` | `LeadsFirstRun.tsx` render / navigation away | Separates "chose not to connect" from "never saw it" — the top diagnostic after Wall 1 |
| 9 | `facebook_connect_started`, `whatsapp_connect_started` | `/api/auth/facebook`, WhatsApp entry | **Already declared, never wired.** One line each; restores both OAuth denominators |

**Two accompanying fixes:**

- **Widen `trackFirstRealLeadOnce()`** from `'facebook' | 'whatsapp'` to include `'manual' | 'import'`
  (`lib/analytics/track.ts:106`). As written, the type system enforces the very assumption the
  funnel needs to drop.
- **Wire `trackStartTrial()` and `trackSubscribe()`** (`lib/facebook/pixelEvents.ts`) — they exist
  and are called from nowhere. Until they fire, Meta optimises toward registration rather than
  revenue, which makes every campaign decision downstream of a bad signal.

### Tier 2 — attribution (the one real gap Tier 1 does not close)

Without this, no funnel number can be attributed to a campaign, ad set, or creative.

Capture `utm_*` / `fbclid` / `gclid` / `referrer` from the landing querystring into a short-lived
cookie, and merge them into **`registration_completed`'s existing `props` jsonb**. That is
`analytics_events`-only — **no column, no table, no migration**, which is what keeps it inside
`do-not-touch.md` §2. Every query in the companion file then splits by campaign with one added
`props->>'utm_campaign'`.

### Sequencing — the one hard constraint

Ship Tier 1 **before** changing anything about the walls, and hold a **two-week baseline** under the
current regime. Otherwise there is no way to distinguish "the fix worked" from "we started measuring
different things" — which is exactly what happened when the Facebook gate was neutralised and five
events silently flatlined (§1.1).

---

## 7. What I would do first, in order

1. **Run Q2.** If mobile registrants rarely reach a desktop, the acquisition strategy and the
   product's device policy are in direct contradiction, and no amount of onboarding polish inside
   the product will touch it. Everything else is secondary until this number is known.
2. **Run Q3 and Q4.** Sizes the trial wall and the empty-workspace population.
3. **Ship Tier 1 event #1 and #9** (one-line changes: correct device prop, wire the two declared-but-dead
   `*_connect_started` events). Highest measurement return per line in the whole audit.
4. **Ship Tier 1 events #5 and #7** (`leads_imported`, `lead_action_taken`). These two alone convert
   the Activation KPI from undefined to computable.
5. **Wire the trial/subscribe pixels.** Meta cannot optimise toward a signal it has never received.
6. **Then, and only then,** decide what to change about the walls — with a baseline to judge it by.

---

## 8. Open questions for you

1. **Is the desktop-only policy a product decision you want to keep?** The audit does not challenge
   it — but if Meta ads are the acquisition channel, Wall 1 is being paid for on every click.
   Q2 turns that from an argument into a number.
2. **Should the trial wall precede any product exposure?** Today the CRM is not rendered at all
   before trial activation. That is defensible; it is also a conversion point with zero prior value
   delivered.
3. **Is anyone currently reading the five dead activation-FSM events?** If a dashboard or report
   consumes them, it has been showing a flatline since the gate was neutralised.

---

## 9. Correction to the prior strategy document

`docs/onboarding-activation-strategy.md` argues the Facebook gate should be removed and states the
gate is live. **It is no longer live** — `addAgency` stamps `onboardingCompletedAt` at creation, so
the gate is neutralised for all new agencies, and `docs/onboarding-gate-removal-implementation-plan.md`
still reads *"No code written. No PR."* The outcome was reached by a different route than either
document planned.

What survives from that document, and is confirmed here: the **mobile gate is the bigger gate**
(§1.2 of both); the **instrumentation still cannot see non-integration activation** (§1.6); and its
recommended activation milestone still holds (§4). What is now obsolete: the Facebook gate analysis
itself, and the claim that trial and revenue sit behind a Facebook Page — they now sit behind a
**desktop browser**.

---

## 10. Production results — Q2 / Q3 / Q4 (read-only, 2026-08-12)

**Connection:** `.env.production.local` → Neon `neondb`. Every statement ran inside
`BEGIN; SET TRANSACTION READ ONLY; … ROLLBACK;` — verified by `SHOW transaction_read_only` → `on`.
Aggregates and internal ids only; no names, emails or phone numbers were selected. Nothing written.

### 10.0 The window, and the regime change inside it

| | |
| --- | --- |
| `analytics_events` span | **2026-07-17 12:49 → 2026-08-12 11:34** (1,069 rows) |
| `registration_completed` span | **2026-07-19 10:27 → 2026-08-10 19:44** |
| Registered agencies in window | **10** |
| `agencies` rows total | **64** (28 `trialExempt` legacy, 5 `plan='pro'`) |
| Agencies with a `registration_completed` event | **10 of 64** |

**The window straddles commit `9ef30e9f` (2026-08-05)** — *"enter the product without connecting
Facebook, and make mobile a destination"*. That commit both neutralised the onboarding gate and
replaced the mobile activation FSM with `MobileHandoff`. **Q2 must be read on each side of it**;
the blended number mixes two different products.

**n = 10 registrations. Every percentage below is a small-sample observation, not a rate.**

### 10.1 Q2 — the device cliff

Verbatim query, whole window:

| registered_on | registrations | ever_reached_desktop | pct_crossed_over |
| --- | --- | --- | --- |
| mobile | **7** | **1** | **14.3%** |
| desktop | 3 | 3 | 100.0% |

Split at the 2026-08-05 cutover — this is the number that matters:

| regime | registered_on | registrations | reached desktop | pct |
| --- | --- | --- | --- | --- |
| **pre-cutover** | **mobile** | **6** | **0** | **0.0%** |
| pre-cutover | desktop | 2 | 2 | 100.0% |
| post-cutover | mobile | 1 | 1 | 100.0% |
| post-cutover | desktop | 1 | 1 | 100.0% |

**70% of all registrations arrived on mobile. Pre-cutover, zero of six ever entered the product.**

What those six did after registering (`analytics_events`, per agency):

| agency | events after registration | what happened |
| --- | --- | --- |
| 107 | 15 | `activation_started` → `facebook_oauth_completed` → `facebook_page_selected` → **`facebook_connected_operational`** → `subscription_completed` → `meta_capi_lead_sent` |
| 109 | 41 | `activation_started` → `facebook_oauth_completed` → `facebook_connect_failed` → `activation_abandoned`, repeatedly |
| 111 | 5 | same failure loop |
| 110 | 1 | `activation_started` only |
| 112 | 1 | `activation_started` only |
| 113 | 1 | `activation_started` only |

**All six tapped "connect".** This was not disinterest. Agency **107 completed the entire Facebook
connection on a phone** — the hardest step in the funnel, webhook subscribed, CAPI `Lead` fired —
**and still never reached the product, never started a trial, and has 0 leads**, because
`app/(app)/layout.tsx:46` redirects the phone regardless of connection state.

Post-cutover mobile is **n = 1** (agency 115, 2026-08-10) and it did cross over and start a trial.
That is one data point. It is not evidence the handoff works.

### 10.2 Q3 — the trial wall

Verbatim query, whole window:

| modal_shown | trial_started | shown_but_never_started | pct_lost_at_modal |
| --- | --- | --- | --- |
| **5** | **5** | **0** | **0.0%** |

**Conversion 5/5 = 100%.** The trial wall leaks nothing. Caveat: everyone who reaches it is already
a self-selected survivor of Wall 1, and the trial cohort includes agency **74**, which has no
`registration_completed` event (it predates the event), so Q3's denominator is not a subset of Q2's.

### 10.3 Q4 — leads after trial

Verbatim query (**lifetime**, as written in the .sql file):

| trials | zero_leads_ever | leads_1_to_4 | leads_5_plus | pct_empty_crm |
| --- | --- | --- | --- | --- |
| **5** | **3** | 1 | 1 | **60.0%** |

**7-day window** (what was actually asked for). Only trials old enough for the window to have
closed are scored, so an agency that started its trial two days ago is not counted as a failure:

| trials_total | window_closed | got_lead_within_7d | zero_leads_within_7d | **provisional activation** |
| --- | --- | --- | --- | --- |
| 5 | **3** | **2** | 3 | **66.7%** (2 of 3) |

Per-agency trial outcomes:

| agency | trial started | expired | upgrade_clicked | subscribed | leads total | leads in first 7d |
| --- | --- | --- | --- | --- | --- | --- |
| 106 | 2026-07-19 | no | no | no | 0 | 0 |
| 74 | 2026-07-26 | yes | yes | **no** | 1 | 1 |
| 108 | 2026-07-31 | no | no | no | 22 | 12 |
| 114 | 2026-08-06 | no | yes | **no** | 0 | 0 |
| 115 | 2026-08-10 | no | no | no | 0 | 0 |

**0 of 5 trial agencies converted to paid**, despite 2 reaching `upgrade_clicked`. (The 2
`subscription_activated` rows in the database are from 2026-07-21 and belong to agencies outside
this cohort.)

### 10.4 Why Meta connections fail — the whole taxonomy

| stage | reason | failures | agencies |
| --- | --- | --- | --- |
| discover | **`NO_PAGES`** | **21** | **4** |
| oauth | `ACCESS_DENIED` | 2 | 2 |
| subscribe | `SUBSCRIBED_APPS_FAILED` | 1 | 1 |

`NO_PAGES` is only reported when `pages_show_list` **was** granted and `/me/accounts` still came
back empty (`callback/route.ts`). So these users authorised everything and **genuinely administer
no Facebook Page**. Four of the seven agencies that completed OAuth hit this. That is an
**acquisition-targeting mismatch, not a product bug** — the ads are buying people who do not have
the asset the product's headline integration requires.

### 10.5 Caveats on these numbers — read before quoting any of them

1. **n = 10 registrations, 5 trials, 3 closed 7-day windows.** These are observations. A single
   additional user moves any percentage by 10–33 points. Do not put them in a deck as rates.
2. **The window straddles a product change** (2026-08-05). Blended Q2 is misleading; use the split.
3. **Different denominators.** Q2 is the 10 agencies with a `registration_completed` event. Q3/Q4
   are keyed on `welcome_modal_shown` / `trial_started` and include agency 74, which has no
   registration event. The three queries do **not** describe one cohort.
4. **54 of 64 agencies are invisible here** — they predate `analytics_events` (2026-07-17) or were
   created by paths that do not emit `registration_completed` (e.g. invitations).
5. **The `device` prop is viewport-derived, the redirect is UA-derived** (§1.2). "mobile" in Q2 is
   not exactly the set that got redirected.
6. **Q4 counts lead existence, not lead work.** A row in `clients` is not activation under §4's
   definition. The real milestone stays unmeasurable until `lead_action_taken` ships — across the
   entire production dataset, `first_follow_up_set` has fired for **exactly one agency, once**.
7. **`clients` has 345 rows across 9 agencies**, mostly legacy agencies outside this window;
   `scripts/seed_prod_demo.ts` exists, so some rows may be demo data. Q4 is scoped to trial
   agencies, which limits but does not fully eliminate the exposure.
