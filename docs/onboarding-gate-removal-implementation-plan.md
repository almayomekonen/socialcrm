# onboarding-gate-removal-implementation-plan.md

**Status:** architecture + migration plan. **No code written. No PR. Nothing implemented.**
**Scope:** make Facebook connection recommended rather than mandatory for product entry.
**Authority:** subordinate to `CLAUDE.md`, `do-not-touch.md`, `architecture-rules.md`,
`care-charter.md`, `release-deployment-workflow.md`.

Every claim below was verified against the code, not assumed. Files and line numbers are cited.

---

## 0. Executive summary

Three findings determine the whole plan:

1. **The gate is already generic.** `isOnboarded()` reads one column and deliberately never
   queries any integration table. Only its _writers_ are Facebook-specific. This is a routing
   change, not an architectural one.
2. **The destination already works.** `/dashboard` already redirects to `/leads` when the agency
   has no leads, and `/leads` already renders `LeadsFirstRun` — which already has a
   fully-designed `metaConnected={false}` branch. **A user released from the gate today lands on
   a correct, finished screen with zero new UI.**
3. **No data migration is required.** Migration `20260630000001` backfilled _every_ pre-existing
   agency to onboarded. No current paying customer is gated. Only agencies created after
   2026-06-30 can be NULL.

The recommended path is a **flag-gated skip control on `/activate`** that calls the _existing_
`completeOnboarding()` server action, leaving the layout gate byte-for-byte untouched. That is a
~30-line diff to two components, is per-agency irreversible in the safe direction (rollback never
locks anyone out), and requires no schema change.

Two things must happen **before** it: analytics that can see non-Facebook activation, and a fix
for a latent trial bug that this change makes newly reachable (§9, EC-16).

---

## 1. Current Architecture

### 1.1 There is no middleware

`middleware.ts` does not exist. **The entire gate is four lines in one Server Component**
(`app/(app)/layout.tsx`), evaluated per request inside a `Suspense` boundary. There is no edge
gate, no route matcher, no auth middleware. This is the single most important architectural fact
for risk assessment: the blast radius is one file.

### 1.2 Complete flow, registration → dashboard

```
/auth/register  (app/(auth)/auth/register/page.tsx)
  → <AddAgencyForm>
  → actions/agencies.ts :: addAgency()
       db.transaction: INSERT agencies → INSERT users (role ADMIN)
                       → users_info → default_settings
       createCookie(userId)                    [db/auth.ts]
       after(): track 'registration_completed' {device}
       after(): dispatchLifecycleEvent 'user.registered'   → WelcomeEmail (CTA → /dashboard)
       after(): emitLifecycleEvent 'user.registered'
       redirect('/activate?welcome=1')                      ← actions/agencies.ts:80
  ↓
/activate  (app/activate/page.tsx)
       getUser() → null ? redirect('/auth')                            :10
       isMobileRequest()                                    [lib/device.ts]
       !mobile && isOnboarded(agencyId) ? redirect('/dashboard')       :12
       renders <RegistrationPixel userId> + <ActivationExperience/>
  ↓
<RegistrationPixel>  fires Meta Pixel 'CompleteRegistration' ONLY when ?welcome is present,
                     deduped in localStorage, then strips the param
  ↓
<ActivationExperience>  → useActivationController()  [lib/activation/useActivationController.ts]
       FSM: waitingForActivation → oauthPending → selectingPage → subscribingPage
                                → activationCompleted | failed     [activationState.ts]
       CTA → GET /api/auth/facebook?origin=activation
  ↓
GET /api/auth/facebook            sets fb_oauth_state cookie (10m), origin prefix in state
       scopes: pages_show_list, pages_manage_metadata, leads_retrieval
  ↓
Meta OAuth dialog
  ↓
GET /api/auth/facebook/callback   exchanges code, discovers Pages, verifies leads_retrieval,
                                  encrypts pages into `fb_pages` cookie (10m),
                                  tracks facebook_oauth_completed / facebook_page_discovered
                                  → redirect '/activate?activation=select'   (origin=activation)
                                  → redirect '/settings/facebook?select=1'   (origin=settings)
  ↓
controller: getActivationData() reads fb_pages cookie + facebook_pages row
            deriveReturnEvent() → 1 page: auto-subscribe; N pages: SelectPageScreen
  ↓
POST /api/auth/facebook/connect
       cross-tenant guard on page_id (409 resource_claimed)
       POST graph /{pageId}/subscribed_apps  (leadgen)  ← BEFORE any DB write
       verify subscription
       upsert facebook_pages ON CONFLICT (page_id)
       delete fb_pages cookie
       track facebook_webhook_subscribed / facebook_page_selected /
             facebook_connected_operational
       after(): emitLifecycleEvent 'user.meta_connected'
       after(): sendFacebookConnectedLeadOnce()   ← the Meta CAPI 'Lead' conversion
  ↓
controller: await completeOnboarding()            ← useActivationController.ts:79
            → actions/activation.ts::completeOnboarding
            → lib/activation/onboarding.ts::completeOnboarding
            → UPDATE agencies SET onboardingCompletedAt = now() WHERE id=? AND ... IS NULL
       SUBSCRIBE_OK → activationCompleted
  ↓
<ActivationExperience> effect (desktop only, ≥1000px):
       await completeOnboarding()  again (idempotent)  ← ActivationExperience.tsx:41
       setTimeout 1300ms → router.push('/dashboard')   ← :42
  ↓
app/(app)/layout.tsx :: LayoutContent — IN THIS ORDER
       :36  !user                → redirect('/api/auth/clear')
       :38  user.suspended       → redirect('/api/auth/clear')
       :40  isMobileRequest()    → redirect('/activate')          ← THE MOBILE GATE
       :42  !isOnboarded()       → redirect('/activate')          ← THE ONBOARDING GATE
       then: getAgencyById, getAgencyTrial → getTrialState,
             platformOwner + preview_paywall cookie, getTrialPreviewLeads if expired,
             copilot/generalMode flags, inbox unread, delta-sync flag
       renders: providers → Topbar / Nav / main / CopilotShell
       :102 trialExpired               → <TrialExpiredScreen/>
       :103 trialStatus NEVER_STARTED  → <WelcomeTrialModal/>   (NON-DISMISSIBLE)
  ↓
/dashboard  → components/home/DashboardPage.tsx
       :23  !hasAnyLeads → redirect('/leads')          ← ALREADY HANDLES THE EMPTY CASE
       else Today Brief v2 (flagged) or the legacy dashboard
  ↓
/leads  → app/(app)/leads/page.tsx
       :64  hasLeads ? <ClientsTable/>
       :76               : <LeadsFirstRun metaConnected={…} whatsappConnected={…}/>
```

### 1.3 Every file involved

| File                                                           | Role                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `app/(app)/layout.tsx`                                         | **The gate.** Lines 36–42. Also mounts trial modal + expired screen                 |
| `app/activate/page.tsx`                                        | Gate destination; mobile-aware bounce-back guard                                    |
| `lib/activation/onboarding.ts`                                 | `isOnboarded()` (fails open) / `completeOnboarding()` (idempotent)                  |
| `actions/activation.ts`                                        | Server actions: `trackActivation`, `getActivationData`, `completeOnboarding`        |
| `lib/activation/useActivationController.ts`                    | Client FSM driver; calls `completeOnboarding()` at :79                              |
| `lib/activation/activationState.ts`                            | Pure FSM: 6 states, 6 events, `screenKindFor`, `activationProgress`                 |
| `lib/activation/activationCopy.ts`                             | `copyFor(status, ctx)` — all Hebrew strings                                         |
| `components/activation/ActivationExperience.tsx`               | Layout shell; desktop completion effect (:36–44)                                    |
| `components/activation/ActivationScreen.tsx`                   | Pure renderer, switch on `screenKindFor`                                            |
| `components/activation/screens/*.tsx`                          | 5 screens: Waiting, Working, SelectPage, Completed, Retry                           |
| `components/activation/RegistrationPixel.tsx`                  | Meta Pixel `CompleteRegistration`, gated on `?welcome`                              |
| `actions/agencies.ts`                                          | `addAgency()` → the only `redirect('/activate?welcome=1')` (:80)                    |
| `app/api/auth/facebook/route.ts`                               | OAuth start; `origin` prefix in CSRF state                                          |
| `app/api/auth/facebook/callback/route.ts`                      | Token exchange, Page discovery, `fb_pages` cookie                                   |
| `app/api/auth/facebook/connect/route.ts`                       | Subscribe → upsert → funnel events → **CAPI Lead**                                  |
| `lib/facebook/metaLeadConversion.ts` / `conversionsApi.ts`     | The conversion + its idempotency                                                    |
| `lib/device.ts`                                                | `isMobileRequest()` — UA `device.type === 'mobile'` (**phones only**; tablets pass) |
| `db/trial.ts`, `lib/trial/index.ts`                            | Trial persistence + the pure state machine                                          |
| `actions/trial.ts`                                             | `startTrial()`, `trackWelcomeModalSeen()`                                           |
| `components/trial/WelcomeTrialModal.tsx`                       | Non-dismissible; the only trial-start trigger                                       |
| `lib/quota/index.ts` + `constants.ts`                          | `getEffectiveLeadPlan`; `FREE_LEAD_LIMIT = 50`                                      |
| `components/home/DashboardPage.tsx`                            | `hasAnyLeads` → `/leads` redirect at :23                                            |
| `app/(app)/leads/page.tsx`                                     | State-driven render; passes real connection state at :76                            |
| `components/clients/LeadsFirstRun.tsx`                         | **The already-built non-Facebook onboarding**                                       |
| `db/facebook.ts`, `db/whatsapp.ts`                             | `get*ConnectionState(userId)` — **per-user, not per-agency**                        |
| `migrations/20260630000001_agency_onboarding_completed_at.cjs` | Column + full backfill                                                              |
| `lib/analytics/track.ts`                                       | `AnalyticsEventName` union + `trackFirstRealLeadOnce`                               |
| `lib/emailAutomations/registry.ts`                             | `welcome` automation, CTA → `/dashboard`                                            |

### 1.4 Dependency graph of the gate

```
(app)/layout.tsx :42
  └─ isOnboarded(agencyId)        [lib/activation/onboarding.ts]
       └─ agencies.onboardingCompletedAt          ← the ONLY input
            ↑ written by exactly two call sites, both client-side, both after FB connect:
                 useActivationController.ts:79        (after POST /connect returns ok)
                 ActivationExperience.tsx:41          (desktop completion effect)
              both route through actions/activation.ts::completeOnboarding
              (server action, resolves user from cookie, idempotent whereNull)
```

**Nothing else reads or writes the column.** Verified by repo-wide grep: only
`types/db/tables.ts` (type), the layout, `/activate`, the two client call sites, the action,
and the lib module.

---

## 2. Impact Analysis

### 2.1 Expected improvements

| Improvement                                                       | Mechanism                                                                                                                             | Certainty |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Registered agencies can reach the product without a Facebook Page | Gate no longer terminal                                                                                                               | Certain   |
| **Trial becomes reachable for non-Meta businesses**               | `WelcomeTrialModal` mounts in `(app)/layout`, which is behind the gate — so today no Page means no trial and no possible subscription | Certain   |
| Excel import + manual lead become reachable at onboarding         | `LeadsFirstRun` already offers both                                                                                                   | Certain   |
| Dead-end states become escapable                                  | `no_pages`, `resource_claimed`, repeated `subscription_failed` currently only offer Retry → OAuth loop                                | Certain   |
| Time-to-first-value drops for import-first users                  | Import delivers leads immediately; a fresh Page subscription delivers only _future_ leads                                             | High      |
| Support load shifts from "I can't get in" to "how do I add leads" | —                                                                                                                                     | Medium    |

### 2.2 Possible regressions

| Regression                                                                        | Mechanism                                                                     | Severity                                                               |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Facebook connect rate falls** (as % of registrations)                           | Denominator grows; the forcing function is gone                               | High likelihood, expected, not a defect                                |
| **Trial-to-paid rate falls**                                                      | Wider, less-qualified trial population                                        | High likelihood, expected                                              |
| Absolute FB connections could fall if the skip is too prominent                   | Users defer indefinitely                                                      | Medium — controlled by making skip secondary, never primary            |
| Empty-CRM churn                                                                   | Users enter, add nothing, never return                                        | Medium — the genuine product risk                                      |
| CAPI `Lead` events arrive later, some outside the 7-day click window              | Connection moves later in the lifecycle                                       | Medium — reported conversions may drop while actual connections do not |
| Burst of `trial_started` on flag-on, then a burst of `trial_expired` 7 days later | Previously-stuck agencies all enter at once and hit the non-dismissible modal | Medium — operational, mitigated by percentage ramp                     |

### 2.3 Hidden coupling (found by inspection, not assumed)

**HC-1 — `/activate` is dual-purpose.** It is both the onboarding gate destination _and_ the
permanent mobile experience (`layout.tsx:40` redirects every phone there regardless of onboarding
state, and `activate/page.tsx:12` deliberately does not bounce mobile back). **`/activate` cannot
be deleted or repurposed** by this work. Any skip control must be hidden on mobile or it produces
a redirect loop (§9 EC-3).

**HC-2 — two `completeOnboarding()` call sites, not one.** `useActivationController.ts:79` and
`ActivationExperience.tsx:41`. Both must keep working. The duplication is deliberate (the comment
at :77 explains it prevents the desktop `/dashboard` push from bouncing off the gate).

**HC-3 — `RegistrationPixel` depends on `?welcome=1`, which only `actions/agencies.ts:80`
produces.** If registration's redirect target is ever changed, the Meta `CompleteRegistration`
Pixel silently stops firing. **Phase 1 must not touch that redirect.** This is the single
easiest way to silently break Meta attribution.

**HC-4 — connection state is read per-USER, not per-agency.**
`getFacebookConnectionState(user.id)` and `getWhatsappConnectionState(user.id)` filter on
`user_id`, while `facebook_pages` also carries `agency_id` and the CAPI dedup is per-agency. An
invited teammate in a fully-connected agency sees `metaConnected=false` and is offered "connect
Facebook" in `LeadsFirstRun`. Pre-existing; becomes far more visible once more users reach the
product. **Do not fix in this change** — it is a data-shape decision touching a tenancy boundary.

**HC-5 — `hasAnyLeads` hides over-quota leads for free plans** (`db/clients.ts:61–66`). A
`NEVER_STARTED` or expired agency whose leads are all `overQuota=true` returns `false` → the
dashboard redirects to `/leads` → `LeadsFirstRun` claims "no leads" while the agency has 60.
Pre-existing; more reachable post-change.

**HC-6 — the trial starts on product entry, not on intent.** `WelcomeTrialModal` is
non-dismissible by design; the CTA is the only way through. Releasing the gate therefore starts
the 7-day clock for every registrant, including pure evaluators who will not act for a week.
**This is a real product consequence of this change, and it is out of scope to fix here** —
trial click-to-start is a settled decision. It must be named in the rollout report, not silently
absorbed.

**HC-7 — the welcome email CTA points at `/dashboard`** (`registry.ts`, `welcome` automation).
Today that bounces a NULL agency to `/activate`. After the change it resolves to `/dashboard` →
`/leads` → `LeadsFirstRun`. Correct with no change — but it means the email's behaviour changes
without the email changing.

**HC-8 — the CAPI conversion is independent of the gate.** It fires in
`app/api/auth/facebook/connect/route.ts` at the `facebook_pages` upsert, in `after()`. It does not
read `onboardingCompletedAt`. **No change required, and none should be made.**

**HC-9 — `fb_pages` cookie survives a skip** (10-minute TTL, read directly by
`app/(app)/settings/(user_settings)/facebook/page.tsx`). A user who OAuths, sees the Page picker,
skips, then navigates to settings within 10 minutes will find their pending Pages waiting. That is
desirable, and it is free.

### 2.4 Technical risks

| #   | Risk                                                                     | Assessment                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1 | Redirect loop between `(app)/layout` and `/activate`                     | **The main correctness risk.** Both files must be reasoned about together; mobile is the trap (EC-3)                                                                                                                 |
| T-2 | `isOnboarded` fails open on DB error                                     | Already true and already correct — it errs toward letting people in, the same direction as this change                                                                                                               |
| T-3 | Concurrent skip + connect                                                | Safe. `whereNull` guard makes the write idempotent; returns true exactly once                                                                                                                                        |
| T-4 | Flag evaluated in a Server Component                                     | Compatible; the repo already does this (`isTodayBriefEnabledForAgency` in `DashboardPage`)                                                                                                                           |
| T-5 | Breaking the frozen a11y suite                                           | Low. `__tests__/a11y/` contains no activation/onboarding coverage — verified. New UI must still meet the standard                                                                                                    |
| T-6 | Breaking `__tests__/activation/*`                                        | Low. All three files test pure functions (`copyFor`, `screenKindFor`, `reducer`, `activationProgress`); none test the gate. Adding a state/event to the FSM would touch them; a skip that bypasses the FSM would not |
| T-7 | Copy tests forbid `לקוח` / `סוכן` / `החשבון שלך מוכן` in activation copy | Any new skip copy must comply (`__tests__/activation/activationCopy.test.ts:38–47`)                                                                                                                                  |

### 2.5 Product risks

- **Empty CRM.** The single genuine one. Mitigated by `LeadsFirstRun` already leading with import
  and manual-add, and by tracking "% agencies with 0 leads at day 7" as a named guardrail.
- **Deferred connection.** Some businesses that should connect Facebook will not. Mitigated by
  keeping skip visually secondary (`ux-guidelines.md` §5 — one primary action) and by the
  permanent connect cards in `LeadsFirstRun` and `/settings/facebook`.
- **Trial burned during evaluation** (HC-6). Named, not fixed here.
- **Charter compliance improves.** `care-charter.md` §9 forbids "a configuration step before the
  user has received value." The current flow violates it; this change resolves the violation.

---

## 3. Existing Components

### 3.1 Does `LeadsFirstRun` already solve the onboarding? — **Yes, ~90% of it.**

`components/clients/LeadsFirstRun.tsx` takes `metaConnected` and `whatsappConnected` and renders
two complete branches:

- **`metaConnected === false`** — heading **חבר את העסק שלך**, four `OnboardingActionCard`s in a
  2-column grid: WhatsApp (badge מומלץ), Facebook/Instagram (`MetaLeadAdsBadge`), הוסף ליד ראשון,
  ייבוא מאקסל. Mounts `ClientFormPop` and `UploadClientData` in `ModalPop`s.
- **`metaConnected === true`** — heading **אין עדיין לידים**, 2+1 grid: הוסף ליד, WhatsApp (if
  unconnected), ייבוא מאקסל.

It is already wired with real state at `app/(app)/leads/page.tsx:76`, and `/dashboard` already
routes empty agencies to it (`DashboardPage.tsx:23`). **The post-gate destination is finished. No
new screen, no new component, no new layout is required for Phase 1.**

The remaining ~10%: the entry copy assumes the user arrived by navigation, not by skipping an
onboarding step. That is a copy question, not a component question.

### 3.2 Reusable components already in place

| Component                                              | Reuse                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `components/clients/OnboardingActionCard.tsx`          | Canonical action tile — mandated by `architecture-rules.md` §10         |
| `components/ui/MetaLeadAdsBadge.tsx`                   | Canonical Meta/WhatsApp brand mark — same rule                          |
| `components/settings/UploadClientData.tsx`             | Excel + CSV import, with quota paywall handling                         |
| `components/clients/ClientFormPop.tsx`                 | Manual lead create, with duplicate detection + quota                    |
| `components/activation/ActivationCtaButton.tsx`        | Existing CTA with loading state                                         |
| `components/settings/ConnectionNotice.tsx` (untracked) | Tone-based connection notice — useful for the deferred-connection nudge |
| `lib/today/rollout.ts`                                 | The rollout-config pattern to copy verbatim                             |

### 3.3 Dead / stale code that becomes relevant

| Item                                                                      | State                                                             | Disposition                                                                                                     |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `trackStartTrial`, `trackSubscribe` (`lib/facebook/pixelEvents.ts:22,24`) | **Defined, called from nowhere.** Verified repo-wide              | Wire them. Independent of this change; do it in Phase 0                                                         |
| `activationProgress()` (`activationState.ts:91`)                          | Referenced only by its own test                                   | Leave. Harmless                                                                                                 |
| `copyFor().progressLabel` (`'שלב 2 מתוך 2'`)                              | Returned but never rendered — `ActivationScreen` does not pass it | Leave, or remove in a separate cleanup. **Do not** surface it: `care-charter.md` §9 forbids progress indicators |
| `MobileActivationGate` reference in `db/facebook.ts` comment              | Component no longer exists                                        | Stale comment. Fix opportunistically                                                                            |

---

## 4. Production Safety Classification

| Change                                                  | Class           | Why                                                                                                               |
| ------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| Add new `AnalyticsEventName` union members              | **Safe**        | Additive to a TS union; `track()` is fully swallowed and `ON CONFLICT DO NOTHING`                                 |
| Emit new events at existing call sites                  | **Safe**        | `track()` never throws; no control flow depends on it                                                             |
| Widen `trackFirstRealLeadOnce` integration param        | **Safe**        | Additive union widening; existing callers unchanged                                                               |
| Wire `trackStartTrial` / `trackSubscribe`               | **Safe**        | `trackPixelEvent` no-ops without `window.fbq`                                                                     |
| New rollout flag module (pure decision + env loader)    | **Safe**        | Defaults to OFF; unreferenced until used                                                                          |
| Skip control on `/activate` (flag-gated, desktop-only)  | **Medium Risk** | New user-visible path; calls an existing idempotent action; the mobile interaction is the trap (EC-3)             |
| Fix `WelcomeTrialModal` narrow-desktop hole (EC-16)     | **Medium Risk** | Touches trial activation — a revenue path — but the current behaviour is a live defect this change amplifies      |
| Ramping the flag 0 → 100                                | **Medium Risk** | Behaviour change for real users; reversible for un-entered agencies only                                          |
| Changing `actions/agencies.ts:80` registration redirect | **High Risk**   | Breaks `RegistrationPixel` (HC-3) and Meta attribution if the pixel is not moved with it. **Phase 3, separately** |
| Adding a state/event to the activation FSM              | **High Risk**   | Touches the tested reducer and every screen mapping. **Avoid — bypass the FSM instead**                           |
| Removing the `(app)/layout.tsx:42` gate outright        | **High Risk**   | Removes the seam entirely, forfeits the flag and the rollback path                                                |
| Touching the mobile gate at `:40`                       | **High Risk**   | Separate product decision; entangles two changes. **Out of scope**                                                |
| Touching `metaLeadConversion.ts` / `conversionsApi.ts`  | **High Risk**   | Paid-conversion reporting correctness. **Do not touch — no change is needed**                                     |
| Changing per-user → per-agency connection reads (HC-4)  | **High Risk**   | Tenancy boundary. **Out of scope**                                                                                |
| Any schema change                                       | **N/A**         | **None is required**                                                                                              |

---

## 5. Existing Users

### 5.1 Is a data migration required? — **No. Confirmed.**

`migrations/20260630000001_agency_onboarding_completed_at.cjs`:

```sql
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" timestamptz;
UPDATE agencies SET "onboardingCompletedAt" = now() WHERE "onboardingCompletedAt" IS NULL;
```

Its own docblock: _"Backfill: EVERY existing agency is marked onboarded (now()), so no current
customer is ever gated."_ The change is additive and reversible, and **no schema or data
migration is needed for this work.**

### 5.2 Effect per population

| Population                                                   | Today                                                   | After the change                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Agencies created before 2026-06-30**                       | `onboardingCompletedAt` backfilled → never gated        | **Zero change.** They never see `/activate`                                       |
| **Paying customers (`plan='pro'`)**                          | Onboarded; `PAID` → no welcome modal, no expired screen | **Zero change**                                                                   |
| **Legacy / `trialExempt` agencies**                          | `LEGACY` → full access, no modal                        | **Zero change**                                                                   |
| **Active trial users**                                       | `TRIAL_ACTIVE`, onboarded                               | **Zero change**                                                                   |
| **Agencies onboarded via Facebook post-migration**           | Column set → pass the gate                              | **Zero change**                                                                   |
| **Currently stuck (registered post-migration, NULL column)** | Cannot enter. No trial. Cannot pay                      | **Released.** Enter → non-dismissible `WelcomeTrialModal` → trial starts that day |

### 5.3 The one operational consequence

The stuck cohort enters _all at once_ when the flag is enabled for them. Each gets a `trial_started`
on the day of the flip and a `trial_expired` + `TrialExpiredScreen` exactly 7 days later —
regardless of how long ago they registered. Expect a spike, then an echo spike one week later, and
a corresponding support/billing contact wave.

**This alone justifies a percentage ramp rather than a single flip.** It is not a correctness
problem; it is a load and expectation-management problem.

### 5.4 Returning users

A returning user with a session cookie hits `(app)/layout` on any route. Order is fixed: session →
suspended → mobile → onboarding. Nothing about the change alters the first two. An un-onboarded
returning user is redirected to `/activate` today; after skipping once, never again.

**Deep links are lost on redirect** — `redirect('/activate')` carries no `next` parameter, so a
user who clicks a link to `/clients/123` while un-onboarded lands on `/dashboard` after
completing. Pre-existing; noted, not fixed here.

---

## 6. Analytics

### 6.1 Events that become inaccurate or change meaning

| Event                                                                                       | Problem                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activation_abandoned`                                                                      | Currently emitted only on an OAuth _error_ return (`useActivationController.ts:125`). A deliberate skip must **not** reuse it — the two are opposite intents. Needs its own event |
| `activation_started` / `oauth_completed` / `subscription_completed` / `subscription_failed` | Denominators change; per-registration rates break at the cutover. Values remain individually valid                                                                                |
| `desktop_first_access`, `welcome_modal_shown`                                               | Fire on `(app)/layout` mount. Today's population is "Facebook-connected agencies"; after, it is "all entering agencies." **Historical comparison across the cutover is invalid**  |
| `trial_started`                                                                             | Same population break. Absolute count rises; per-registration rate changes definition                                                                                             |
| `subscription_activated`                                                                    | Trial→paid rate falls by construction with a wider funnel. Not a regression                                                                                                       |
| `facebook_connected_operational`                                                            | Still accurate per-event; its rate vs. registrations breaks                                                                                                                       |
| `meta_capi_lead_sent`                                                                       | Timing shifts later. Absolute may rise; per-registration falls; some fall outside the 7-day click window                                                                          |
| `activation_first_real_lead`                                                                | **Structurally incapable of representing the new reality** — `trackFirstRealLeadOnce` is typed `integration: 'facebook' \| 'whatsapp'`. Non-integration value cannot be recorded  |
| `registration_completed` → any downstream                                                   | Every funnel ratio anchored on registration changes definition at the cutover                                                                                                     |

**Mitigation:** annotate the cutover date in every dashboard and compare cohorts, never
time-series across the boundary.

### 6.2 New events required BEFORE the behaviour change

| Event                                               | Fires at                                     | Why required                                                                                             |
| --------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `activation_skipped`                                | Skip control click, with `{ fromState }`     | Distinguishes deliberate skip from OAuth failure. Without it, `activation_abandoned` becomes meaningless |
| `dashboard_first_viewed`                            | First `(app)/layout` render per agency       | The denominator for every in-product metric. Currently unmeasurable because entry is gated               |
| `lead_created_manual`                               | `upsertLead` success, new lead               | One of the four core actions (`product.md` §6); currently invisible                                      |
| `leads_imported` `{ count, source: 'xlsx'\|'csv' }` | `addLeads` / `importLeadsFromCsv` success    | The company's own first success moment (`product.md` §7) is untracked                                    |
| `lead_action_taken` `{ kind }`                      | Status change / follow-up / outbound message | **The activation milestone.** Nothing else can serve as North Star input                                 |
| `connection_deferred`                               | Skip, and dismissal of any connect nudge     | Separates "chose not to connect" from "never saw the option" — the key post-change diagnostic            |

**Also required:** widen `trackFirstRealLeadOnce`'s `integration` parameter to include `'manual'`
and `'import'`, or add a parallel source-agnostic first-value event. As written, the type system
enforces the assumption being removed.

**Sequencing is a hard constraint.** These ship and bake for ~2 weeks _before_ any behaviour
change, or there is no baseline and no way to distinguish "the change worked" from "we started
measuring different things."

---

## 7. Rollout Strategy

**Recommendation: phased, behind an env-driven agency flag, with a percentage ramp.**
Not immediate. Not a single flip.

### Why not immediate

Three independent reasons: the trial-burst effect (§5.3); the metrics-definition break (§6.1)
which needs a bake period to interpret; and the empty-CRM guardrail, which cannot be measured
without a partial cohort to compare against.

### Why a flag, and which one

The repo already has the pattern — copy `lib/today/rollout.ts` verbatim in shape:

```
enabled (global)  +  killSwitch (hard off)  +  allowlist (agency ids | 'all')  +  percentage (0–100)
```

with the **decision as a pure, unit-tested function** and only the loader reading `process.env`.
`isTemplatesEnabledForAgency` and `isCopilotEnabledForUser` follow the same shape. Using anything
else fragments an established convention.

The percentage bucket must be a **deterministic hash of `agencyId`**, exactly as
`lib/today/rollout.ts` does, so an agency never oscillates between gated and ungated across
requests.

### The critical rollback property — state it explicitly

With the recommended design (a **skip control that writes `onboardingCompletedAt`**, leaving
`layout.tsx:42` untouched):

- Turning the flag **off** removes the skip control for agencies that have not used it.
- It does **not** re-gate agencies that already skipped — their column is set, permanently.

**Rollback is therefore partial and one-way per agency, and that is the correct trade.**
`do-not-touch.md` §7 and the fail-open design of `isOnboarded` both point the same direction:
never lock a user out of a workspace they have already entered. The alternative — flagging the
layout gate itself — is fully reversible but would eject working users back to `/activate` on
rollback. That is worse.

### Phases

| Phase                                                | Content                                                                                                         | Gate to proceed                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **0 — Instrumentation**                              | §6.2 events; widen `trackFirstRealLeadOnce`; wire `trackStartTrial`/`trackSubscribe`. **Zero behaviour change** | ~2 weeks of clean baseline data      |
| **0.5 — Fix EC-16**                                  | `WelcomeTrialModal` narrow-desktop hole (§9). Live defect today; this change makes it common                    | Verified on a <1000px desktop window |
| **1 — Skip control, flag OFF**                       | Ship the control behind the flag, allowlist empty. Dark launch. Verify on an internal agency                    | Manual verification of EC-1…EC-8     |
| **2 — Allowlist ramp**                               | 2–3 known agencies, then 10% → 25% → 50% → 100%, min ~3 days per step                                           | Guardrails green at each step        |
| **3 — Registration routing + segmentation question** | Change `actions/agencies.ts:80`; move `RegistrationPixel` with it (HC-3)                                        | Separate plan, separate approval     |
| **4 — Mobile gate**                                  | Entirely separate product decision                                                                              | Separate plan                        |

### Guardrails at every ramp step

1. **% of agencies with 0 leads at day 7** — must not climb materially. If it does, the empty-CRM
   risk is real and the answer is a better import path, not a restored gate.
2. **Absolute weekly Facebook connections** — must not fall. The _rate_ will; the count must not.
3. **`activation_skipped` / `dashboard_first_viewed` ratio** — how many entrants skip vs. connect.
4. **Error rate on `/activate` and `(app)/layout`** — catches any redirect loop immediately.

**Write the expected direction of every metric down before Phase 2.** Two headline rates fall by
construction (§6.1); without a written pre-commitment, a successful change reads as a failure
within three weeks.

---

## 8. File-by-file Plan

**No code below. Intent, rationale, and risk only.**

### Phase 0 — Instrumentation (all Safe)

| File                                     | Why                                    | What                                                                                                                     | Risk                                             |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `lib/analytics/track.ts`                 | Cannot measure non-Facebook activation | Add 6 event names to the union; widen `trackFirstRealLeadOnce` integration param to include `'manual' \| 'import'`       | Safe                                             |
| `actions/clients.ts`                     | Manual + import value is invisible     | Emit `lead_created_manual` on new-lead success; `leads_imported {count, source}` after `addLeads` / `importLeadsFromCsv` | Safe — `track()` never throws                    |
| Lead status / follow-up action sites     | The activation milestone has no event  | Emit `lead_action_taken {kind}`                                                                                          | Safe                                             |
| `app/(app)/layout.tsx`                   | Need the in-product denominator        | Emit `dashboard_first_viewed` (once per agency, same existence-check idiom as `trackFirstRealLeadOnce`)                  | Safe — additive, in the existing `track` pattern |
| `components/trial/WelcomeTrialModal.tsx` | Meta has no revenue-proximate signal   | Call `trackStartTrial()` on successful start                                                                             | Safe — no-ops without `fbq`                      |
| Subscription success path                | Same                                   | Call `trackSubscribe()` with a value param                                                                               | Safe                                             |

### Phase 0.5 — Trial reachability fix (Medium Risk)

| File                                     | Why                                                                                                                                                                          | What                                                                                                | Risk                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `components/trial/WelcomeTrialModal.tsx` | EC-16: a <1000px desktop window passes the layout gate but fails the modal's own `isDesktop` check → the trial can never start and the agency is silently capped at 50 leads | Ensure a `NEVER_STARTED` agency that reaches `(app)` always has a reachable path to start the trial | **Medium** — revenue path. Needs its own verification |

### Phase 1 — Skip control (Medium Risk)

| File                                              | Why                                                                                                                            | What                                                                                                                                                                                                                            | Risk                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `lib/activation/skipRollout.ts` _(new)_           | Controlled exposure                                                                                                            | Pure decision fn + env loader, mirroring `lib/today/rollout.ts` (enabled / kill / allowlist / deterministic-hash percentage)                                                                                                    | Safe — defaults OFF                                                      |
| `app/activate/page.tsx`                           | The flag must be evaluated server-side; the control must never render on mobile (EC-3)                                         | Resolve `skipEnabled = flag(agencyId) && !mobile`; pass down as a prop                                                                                                                                                          | **Medium** — touches the gate destination                                |
| `components/activation/ActivationExperience.tsx`  | Host for the control; must not appear on the mobile stacked branch                                                             | Accept `skipEnabled`; render the control in the desktop panel only, and only for `waiting` / `retry` states (never `working` / `completed`)                                                                                     | **Medium**                                                               |
| `components/activation/screens/WaitingScreen.tsx` | Primary skip surface                                                                                                           | Optional secondary control below the CTA + trust list. Visually secondary — `ux-guidelines.md` §5                                                                                                                               | **Medium** — must not compete with the primary CTA                       |
| `components/activation/screens/RetryScreen.tsx`   | **The dead-end fix.** `no_pages` / `resource_claimed` / repeated `subscription_failed` currently only offer Retry → OAuth loop | Same optional secondary control                                                                                                                                                                                                 | **Medium** — highest user value in the phase                             |
| `lib/activation/activationCopy.ts`                | Copy lives here by convention                                                                                                  | Skip label + any helper text. Must avoid `לקוח` / `סוכן` / `החשבון שלך מוכן` (`__tests__/activation/activationCopy.test.ts:38–47`)                                                                                              | Safe                                                                     |
| `lib/activation/useActivationController.ts`       | Needs a skip handler                                                                                                           | Add a handler: `trackActivation('activation_skipped')` → `completeOnboarding()` → navigate `/dashboard`. **Do not add an FSM state or event** — bypass the reducer entirely so `activationState.ts` and its tests are untouched | **Medium** — the FSM boundary is the discipline that keeps this low-risk |
| `__tests__/activation/*` _(new file)_             | Coverage for the new decision                                                                                                  | Unit-test the rollout decision fn (deterministic bucketing, kill switch, allowlist)                                                                                                                                             | Safe                                                                     |

**Explicitly unchanged in Phase 1:**
`app/(app)/layout.tsx` gate lines · `lib/activation/onboarding.ts` · `actions/activation.ts` ·
`lib/activation/activationState.ts` · `actions/agencies.ts:80` · every `/api/auth/facebook/*`
route · `lib/facebook/metaLeadConversion.ts` · `conversionsApi.ts` · `LeadsFirstRun.tsx` · any
schema.

### Phase 3+ — deferred, separate approval

`actions/agencies.ts` (redirect target) · `components/activation/RegistrationPixel.tsx` (must move
with it — HC-3) · the segmentation question · `app/(app)/layout.tsx:40` (mobile).

---

## 9. Edge Cases

| #     | Case                                                            | Current behaviour                                                                                                                                                                                  | Expected after                                                                                                                                                                 | Migration risk                                            |
| ----- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| EC-1  | Skip, then connect FB later from settings                       | N/A                                                                                                                                                                                                | Column already set; `/connect` route unchanged; CAPI fires normally (HC-8)                                                                                                     | **Low**                                                   |
| EC-2  | Skip, then connect via `/activate` again                        | N/A                                                                                                                                                                                                | `activate/page.tsx:12` redirects onboarded desktop users to `/dashboard` — they never see the screen again. Connect must be reachable at `/settings/facebook`                  | **Low** — but verify the settings path is discoverable    |
| EC-3  | **Mobile user + skip control**                                  | Phones always redirect to `/activate` (`layout.tsx:40`), independent of onboarding                                                                                                                 | Skipping would set the column and still bounce to `/activate` — a broken promise, perceived as a loop. **The control MUST be server-gated off for mobile**                     | **HIGH — the single most likely defect**                  |
| EC-4  | Tablet                                                          | `device.type === 'tablet'` → **not** mobile → passes the gate, gets the desktop app                                                                                                                | Unchanged. Skip control shows. Correct                                                                                                                                         | **Low**                                                   |
| EC-5  | Narrow desktop window (<1000px), UA not mobile                  | Passes `layout.tsx:40`; `WelcomeTrialModal`'s `isDesktop` is false → **modal never shows → trial never starts**                                                                                    | Same, but far more reachable. See EC-16                                                                                                                                        | **Medium**                                                |
| EC-6  | FB account with **zero Pages** (`no_pages`)                     | `failed` → `RetryScreen` → only Retry → OAuth → `no_pages` again. **Permanent dead end**                                                                                                           | Skip available on `RetryScreen`. This is the highest-value fix in the phase                                                                                                    | **Low** — pure improvement                                |
| EC-7  | Page already claimed by another agency (409 `resource_claimed`) | `SUBSCRIBE_FAILED` → `failed` → Retry loop forever                                                                                                                                                 | Skip available                                                                                                                                                                 | **Low**                                                   |
| EC-8  | User declines `leads_retrieval` scope                           | Callback fails → `failed` → Retry loop                                                                                                                                                             | Skip available                                                                                                                                                                 | **Low**                                                   |
| EC-9  | Concurrent skip + connect (two tabs)                            | N/A                                                                                                                                                                                                | `completeOnboarding` is `whereNull`-guarded and idempotent; returns true exactly once                                                                                          | **Low** — already safe                                    |
| EC-10 | `fb_pages` cookie live when the user skips                      | N/A                                                                                                                                                                                                | Cookie survives 10 min; the settings page reads it directly → pending Pages still selectable (HC-9)                                                                            | **Low** — a free win                                      |
| EC-11 | Invited teammate in an onboarded agency                         | Agency column set → never sees `/activate`                                                                                                                                                         | Unchanged. **But** `getFacebookConnectionState(user.id)` is per-user → they see `metaConnected=false` and are offered "connect Facebook" though the agency is connected (HC-4) | **Medium** — pre-existing, more visible. Out of scope     |
| EC-12 | Suspended user                                                  | Cleared at `layout.tsx:38`, before the gate                                                                                                                                                        | Unchanged                                                                                                                                                                      | **None**                                                  |
| EC-13 | Stale session cookie (deleted user)                             | `getUser()` → null → `/api/auth/clear`                                                                                                                                                             | Unchanged                                                                                                                                                                      | **None**                                                  |
| EC-14 | Pre-2026-06-30 agency                                           | Backfilled onboarded                                                                                                                                                                               | Unchanged — never sees any of this                                                                                                                                             | **None**                                                  |
| EC-15 | Long-stuck agency released by the flag                          | Cannot enter                                                                                                                                                                                       | Enters; trial starts that day; expires 7 days later. Burst effect (§5.3)                                                                                                       | **Medium** — operational                                  |
| EC-16 | **`NEVER_STARTED` agency that never sees the modal**            | Reachable only post-FB-connect today. Result: `getEffectiveLeadPlan` → `'free'` → capped at `FREE_LEAD_LIMIT = 50`, `hasAnyLeads` hides over-quota leads, no explanation, no path to start a trial | Becomes commonly reachable. **Must be fixed in Phase 0.5, before the ramp**                                                                                                    | **HIGH**                                                  |
| EC-17 | Free agency with >50 leads, all over quota                      | `hasAnyLeads` → false → `/dashboard` → `/leads` → `LeadsFirstRun` claims "no leads" (HC-5)                                                                                                         | Same; more reachable                                                                                                                                                           | **Medium** — pre-existing                                 |
| EC-18 | Deep link while un-onboarded (`/clients/123`)                   | Redirected to `/activate`; destination lost (no `next` param)                                                                                                                                      | Same — after skip, lands on `/dashboard`, not the deep link                                                                                                                    | **Low** — pre-existing                                    |
| EC-19 | Welcome email CTA (`/dashboard`) clicked by a NULL agency       | Bounces to `/activate`                                                                                                                                                                             | Resolves to `/dashboard` → `/leads` → `LeadsFirstRun`. Correct with no email change (HC-7)                                                                                     | **Low**                                                   |
| EC-20 | Browser Back after skip                                         | N/A                                                                                                                                                                                                | `/activate` → onboarded → `redirect('/dashboard')`. No loop                                                                                                                    | **Low** — verify                                          |
| EC-21 | Skip with JS disabled / hydration failure                       | N/A                                                                                                                                                                                                | The control is client-side; a server-action form fallback is preferable. Otherwise the user is stuck exactly as today — no regression                                          | **Low**                                                   |
| EC-22 | `isOnboarded` DB read fails                                     | Fails **open** → user enters (`onboarding.ts:21–24`)                                                                                                                                               | Unchanged; same direction as this change                                                                                                                                       | **None**                                                  |
| EC-23 | Platform owner / dev-bypass account created post-migration      | Gated like anyone (owner exemption covers trial expiry only)                                                                                                                                       | Released by the flag like anyone                                                                                                                                               | **Low**                                                   |
| EC-24 | `?welcome=1` present when the user skips                        | `RegistrationPixel` fires `CompleteRegistration` on mount before any skip; localStorage-deduped                                                                                                    | Unchanged — **provided `actions/agencies.ts:80` is not touched** (HC-3)                                                                                                        | **Low in Phase 1, HIGH in Phase 3**                       |
| EC-25 | Two users register into the same agency (invite flow)           | Column is per-agency; whoever completes first releases both                                                                                                                                        | Unchanged; skip likewise releases the agency, not the user                                                                                                                     | **Low** — correct, but worth stating                      |
| EC-26 | `activation_abandoned` vs. skip                                 | Emitted on OAuth error return only                                                                                                                                                                 | Must **not** be emitted on skip; needs `activation_skipped` (§6.2)                                                                                                             | **Medium** if conflated — corrupts the funnel permanently |

---

## 10. Final Recommendation

### **YES.** Ship it — phased, flagged, instrumented first.

**Reasoning:**

1. **The architecture already anticipated this.** `isOnboarded()` was deliberately written to be
   integration-agnostic, and its docblock says so. The migration backfilled every existing agency
   specifically so no customer could be gated. Someone built this seam on purpose. Using it is
   the intended path, not a workaround.

2. **The destination is finished.** `/dashboard` already redirects empty agencies to `/leads`;
   `/leads` already renders `LeadsFirstRun`; `LeadsFirstRun` already has a complete non-Facebook
   branch wired to real connection state. **The main cost of this kind of change — designing and
   building the post-gate experience — has already been paid.**

3. **The gate blocks revenue, not just access.** `WelcomeTrialModal` mounts inside `(app)/layout`,
   behind the gate. No Facebook Page means no trial, which means no subscription. That is not an
   onboarding preference; it is a structural cap on who can pay.

4. **It fixes real dead ends.** A user with a Facebook account and no Page, or whose Page is
   claimed by another agency, currently has _no way out_ — `RetryScreen` offers only Retry, which
   loops back to the same failure. That is a defect regardless of the strategy question.

5. **It resolves a charter violation.** `care-charter.md` §9 forbids a configuration step before
   the user has received value. The current flow is in breach.

6. **The blast radius is genuinely small.** No middleware, no schema change, no data migration,
   no change to auth, permissions, `transferSales`, DB joins, or the CAPI conversion. Phase 1
   touches one route, three components, one copy module, one controller, plus a new flag file.

**Conditions — these are not optional:**

- **Instrumentation ships first** and bakes ~2 weeks (§6.2). Without it the change is unmeasurable
  and `activation_first_real_lead` literally cannot represent non-integration value.
- **EC-16 is fixed before the ramp.** A latent trial-activation hole becomes commonly reachable.
- **EC-3 is handled at the server.** The skip control must not render for mobile UAs — per
  `architecture-rules.md` §9, gate by absence, never by CSS.
- **The FSM is not modified.** Bypass the reducer; keep `activationState.ts` and its tests intact.
- **`actions/agencies.ts:80` is not touched in Phase 1** (HC-3 / EC-24).
- **Expected metric directions are written down before Phase 2** (§7). Two headline rates fall by
  construction.

**Confidence:**

| Claim                                                              | Confidence                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| No schema or data migration is required                            | **Very high** — read the migration directly                                                                                          |
| The post-gate destination already works with no new UI             | **Very high** — traced `DashboardPage:23` → `leads/page:76` → `LeadsFirstRun`                                                        |
| Phase 1 as scoped is Medium Risk, not High                         | **High**                                                                                                                             |
| EC-3 (mobile skip) is the most likely defect                       | **High**                                                                                                                             |
| EC-16 (trial unreachable on narrow desktop) is a live defect today | **Medium-high** — reasoned from `layout.tsx:40` + `WelcomeTrialModal`'s `isDesktop`; worth an explicit manual repro before Phase 0.5 |
| The change increases absolute paying customers                     | **Medium-high** — depends on the empty-CRM guardrail holding                                                                         |
| Absolute Facebook connections will not fall                        | **Medium** — the main thing the ramp exists to measure                                                                               |
| Overall: this is the right change                                  | **High**                                                                                                                             |

**What I am explicitly _not_ recommending in this plan:** removing the mobile gate, changing trial
timing, changing registration routing, adding the segmentation question, or fixing the per-user
connection reads (HC-4). Each is a separate decision with its own plan. Bundling any of them into
this change would convert a Medium Risk migration into a High Risk one.

---

**Awaiting explicit approval before any code is written.**
