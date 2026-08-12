# phase-0-mobile-audit.md — Mobile product audit & architecture map

**Status:** Phase 0 deliverable. **No code written. No schema touched. Nothing deployed.**
**Date:** 2026-08-12 · **Branch:** `feature/notification-infrastructure`
**Scope:** every authenticated screen, route, layout and workflow.
**Authority:** subordinate to `CLAUDE.md`, `do-not-touch.md`, `architecture-rules.md`,
`ux-guidelines.md`, `frontend-experience-guidelines.md`, `care-charter.md`.
**Evidence base:** [`docs/funnel/activation-funnel-audit.md`](../funnel/activation-funnel-audit.md) §10.

---

## 0. Executive summary — six findings that change the plan

The plan is sound and the core principle (**Desktop = MANAGE, Mobile = ACT**) is the right one.
Six things I found in the code change how it should be sequenced.

**1. There is nothing to "adapt". The authenticated app has essentially no responsive design.**
Across ~284 authenticated `.tsx` files there are **67 responsive utility usages total**.
`components/clientPage` (the lead detail): **0**. `modules/` (inbox + notifications): **0**.
`components/tasks`: **0**. This is not a responsive refactor — it is a **greenfield mobile
presentation layer over an already-healthy business-logic layer**. That is good news: it means
Phase 13's separation is achievable cleanly, because there is no responsive spaghetti to unpick.

**2. There is no Pipeline. No Kanban exists anywhere in the codebase.**
Phase 5 says *"Do NOT force the desktop multi-column Kanban into a narrow screen."* There is no
such view. `grep -ril "kanban|pipeline"` over `app/ components/ lib/ modules/ db/ actions/` returns
only AI prompt files. Lead stage is a plain `clients.status` string
(`'new' | 'contacted' | 'interested' | 'closed' | 'lost'`, `lib/calendar/outcomeStatusSuggestion.ts:23`).
**Phase 5 as written would ship a mobile-only feature with no desktop counterpart** — and the
proposed bottom nav puts it in slot #1. See §7.1 for the decision this needs.

**3. Removing the mobile redirect exposes the trial wall to mobile — and the trial wall is 5/5.**
`app/(app)/layout.tsx:46` redirects phones **before** the trial check at :132. Delete that line and
the very next thing a phone sees is `WorkspaceTeaser` + a **non-dismissible, focus-trapped**
`WelcomeTrialModal` that was designed for desktop and has a hard-coded `p-8`, a 2×2 benefit grid,
and `max-h-[90vh]`. `components/trial/WelcomeTrialModal.tsx:30` even documents the assumption being removed:
*"Reaching this surface at all now means the trial is startable."* **This is the single highest-risk
edit in the entire 20-phase plan**, because rule #6 says trial logic must not change and the funnel
data says trial conversion is currently 5/5. See §7.2.

**4. There is a breakpoint dead zone at 768–999px.**
`tailwind.config.ts` defines `mobile: 0–767px` and `desktop: ≥1000px`. **Nothing matches 768–999px.**
Every `desktop:` utility silently fails there and every `mobile:` utility silently fails there.
Phase 18's QA list includes **768px**. This is a live latent bug class, not a mobile-only concern.

**5. The PWA is already half-built — and `sw.js` has a hard constraint that Phase 14 must not break.**
`public/manifest.json` exists (standalone, RTL, `theme_color`, maskable icon) and is already wired
via `types/vars.ts:22`. `public/sw.js` exists for Web Push. Its header states a **HARD CONSTRAINT:
only `push` and `notificationclick`; NO fetch handler; NO caching; NO authenticated application
data** (notification spec §15.2/§20.7). Phase 14 must not add a fetch/caching handler to this file.

**6. Phase 13's `shared/` layer already exists — and `modules/inbox` is the in-repo precedent.**
`lib/leads/*` (11 pure modules, 626 lines), `lib/today/*` (12 modules, 517 lines), `db/briefing.ts`,
`db/worklist.ts`, `db/followUps.ts`, `lib/leads/outcomeRules.ts` are already pure, presentation-free
business logic. `modules/inbox/` already separates `queries.ts` / `actions.ts` / `filters.ts` from
`components/` and `client/`. **Adopt that existing shape rather than inventing `shared/desktop/mobile`
directories** — see §6.

---

## 1. Method

- Enumerated every `page.tsx` and `layout.tsx` under `app/`.
- Read the shell (`app/(app)/layout.tsx`, `WorkspaceGrid`, `Nav`, `Topbar`, `SettingsChrome`).
- Counted responsive utilities (`mobile: desktop: sm: md: lg:`) per component area.
- Read the design-system primitives (`lib/modals`, `lib/btns`, `lib/form`, `lib/table`, `components/ui`).
- Read the largest components by line count to locate data density.
- Verified the lead status vocabulary, the shared business-logic modules, and the PWA assets.

**54 authenticated routes**: 45 under `(app)`, 6 under `(support)`, 3 under `admin`.

---

## 2. Current shell architecture

```
app/layout.tsx                     html[lang=he dir=rtl] · Assistant font · MetaPixel · ToastMsg
└── app/(app)/layout.tsx           THE GATE
    ├─ :46  isMobileRequest()   → redirect('/activate')      ← the block to remove
    ├─ :48  !isOnboarded()      → redirect('/activate')      ← 15 agencies still stranded here
    ├─ trial state → NEVER_STARTED | TRIAL_EXPIRED           ← WorkspaceTeaser instead of children
    └─ WorkspaceGrid
       ├─ Topbar        (103 lines)
       ├─ Nav           (144 lines — has a `desktop:hidden` popover drawer already)
       ├─ <main>        page children
       └─ CopilotShell  (desktop AI panel)
```

`WorkspaceGrid` is `desktop:grid` with a `hidden desktop:block` rail — i.e. **below 1000px the grid
collapses to a plain flex column and the rail disappears**, but `Nav` still renders its full-height
dark sidebar plus a `popover` drawer. There is a partial mobile nav already (`lib/navs/Nav.tsx:52`,
`popover='auto' id='navPop'` + `desktop:hidden`). It is a hamburger drawer, not a bottom nav.

**Providers already mounted and reusable on mobile, no duplication needed:** `UserProvider`,
`PosProvider`, `CopilotProvider`, `CopilotContextStoreProvider`, `AwarenessProvider`,
`NotificationProvider`, `CrmSyncHealthProvider`, `ActivationCelebrationProvider`.

---

## 3. Screen inventory & classification

Legend — **C** = CORE MOBILE · **A** = ADAPTED MOBILE · **DO** = DESKTOP-OPTIMIZED (must not break)
· **D!** = DESKTOP-ONLY (explicit handoff).

### 3.1 Lead working — the mobile core

| Route | Component | Class | Density / mobile problem |
| --- | --- | --- | --- |
| `/leads` | `clientsTable.tsx` (**586 lines**) | **C** | Full `<table>` + column manager + `SelectSearch` + 5 modals + tab bar + footer. 8 `useState` for dialogs alone. Unusable on 360px. **Needs a separate mobile list — do not adapt this file.** |
| `/clients/[clientId]/summary` | summary page + `ClientHeader`/`ClientNav` | **C** | The mobile action center. `components/clientPage` has **0 responsive utilities**. Header + horizontal tab nav + intelligence card + follow-up + outcome + activity + tasks stacked. |
| `/clients` | `clientsTable.tsx` (shared) | **DO** | Duplicate of `/leads` with `metadata.title = 'נתוני לקוחות'` — **violates the Entity Constraint** (`CLAUDE.md`, `ux-guidelines.md` §6). Do not propagate `לקוח` to mobile. |
| `/clients/[clientId]/tasks` `/tasks/[taskId]` | `components/tasks` (0 responsive) | **A** | Task list + stepper. |
| `/clients/[clientId]/files` | `components/files` | **A** | File table + Drive picker. |
| `/dashboard` (`היום`) | `components/home/*` (387 lines) | **C** | Already card-shaped (`RecommendedLeads`, `LeadQuickActions`, `QuickLinks`). **Closest thing to mobile-ready in the app.** `FollowupsTable` is the one table. |
| `/tasks` | tasks table | **A** | |
| `/inbox` | `modules/inbox` (**0 responsive**) | **A** | Three-pane: conversation list + thread + intelligence card. Classic mobile master/detail split. |
| `/inbox/comments` | `modules/facebookComments` | **A** | |
| `/notifications` | `NotificationCenter` + filters | **C** | Already a paginated row list with cursor. Server-rendered first page. Least work of any CORE screen. |

### 3.2 Configuration & administration

| Route(s) | Class | Note |
| --- | --- | --- |
| `/settings/integrations`, `/settings/facebook` | **A** | Phase 10. Status cards. `components/settings` has 27 responsive utils — the most of any area. |
| `/settings/self_edit`, `/update_user_details`, `/update_security` | **A** | Simple forms. |
| `/settings/update_payment` | **DO** | Rule #7: billing does not change. Read-only on mobile. |
| `/settings/edit_users`, `/edit_teams`, `/edit_tmplts`, `/edit_promotions` | **D!** | Admin tables + `TaskTmpltStepper` (298 lines). |
| `/settings/auto-response`, `/automations`, `/automation-templates`, `/automations-pilot`, `/quote-templates`, `/connections`, `/ai-inspector` | **D!** | `AutomationSheet` 346 lines, `AutoResponseSettingsForm` 322, `ai-inspector/page.tsx` 351. Configuration surfaces. |
| `/settings/update_agency`, `/update_default` | **DO** | |
| `/settings/calendar` | **A** | |

### 3.3 Reporting, billing, sales

| Route(s) | Class | Note |
| --- | --- | --- |
| `/sum_sales` + `/agents` `/companies` `/months` `/teams` | **D!** | Pure reporting. Rule: desktop handoff, not horizontal scroll. |
| `/deals` | **D!** | `SalesTable` 307 lines. |
| `/clients/[clientId]/billing` + `/new` + `/[invoiceId]` | **D!** | `InvoiceNewEditor` 322, `InvoiceDraftEditor` 368, `LeadPicker` 245. Legal/financial issuance — **rule #7**. |
| `/billing/success` | **DO** | Must render on mobile (payment returns land here). |
| `/files` | **A** | |
| `/calendar` | **D!** | `CalendarView` 486 lines, FullCalendar. |
| `/promotion`, `/promotion/[id]` | **DO** | |

### 3.4 Support, admin, activation

| Route(s) | Class | Note |
| --- | --- | --- |
| `/support`, `/support/new`, `/requests`, `/guides` | **C** | **Already mobile-reachable and already renders at 390px** — it is deliberately outside the `(app)` gate (`MobileHandoff` links to it). Existing proof the pattern works. |
| `/admin`, `/admin/support/*` | **D!** | Platform-owner only. |
| `/activate` | **C** | Becomes the mobile-registration landing; `MobileHandoff` is retired *only* once §7.2 is resolved. |

**Totals:** CORE 6 areas · ADAPTED 9 · DESKTOP-OPTIMIZED 6 · DESKTOP-ONLY 12.

---

## 4. Data density — where the real work is

| Component | Lines | Why it resists mobile |
| --- | --- | --- |
| `components/clients/clientsTable.tsx` | **586** | 8 dialog `useState`s, column manager, tab bar, sort mode, bulk delete, 5 `ModalPop`s, 1 `ConfirmPop`. Already **over the 350-line hard limit** in `architecture-rules.md` §1. |
| `components/calendar/CalendarView.tsx` | 486 | FullCalendar; desktop-only. |
| `components/billing/InvoiceDraftEditor.tsx` | 368 | Named in `architecture-rules.md` §2 as the controller-monster example. |
| `components/settings/automations/AutomationSheet.tsx` | 346 | |
| `lib/form/index.tsx` | 335 | Shared form primitives — the mobile form base. |
| `lib/table/index.tsx` + `THead`/`TBody`/`TableFooter`/`ShowColumns`/`Search` | — | The desktop table system. **Mobile must not consume it.** |

---

## 5. Design-system inventory

### 5.1 Exists and reusable as-is

| Need | Existing primitive |
| --- | --- |
| Buttons | `lib/btns/Btn.tsx`, `SubmitBtn`, `CopyBtn` (`variant`, `size='large'`, `icon`) |
| Forms | `lib/form/index.tsx`, `SelectSearch`, `MultiSelectSearch` |
| Cards | `components/ui/card.tsx`, `components/clients/OnboardingActionCard.tsx` (registry-canonical) |
| Status chips | `lib/StatusBadge.tsx` (5 semantic roles, CSS-var tokens) + `LeadStatusCell.STATUS_STYLES` |
| Brand marks | `components/ui/MetaLeadAdsBadge.tsx` (registry-canonical) |
| Loading | `components/ui/Loading.tsx` |
| Toasts | `lib/toast` |
| Confirm | `lib/modals/ConfirmPop.tsx` |
| Icons | `lib/Icon.tsx` (3757 lines, font-based — no new icon set needed) |
| Avatars | `components/ui/lead-avatar.tsx` |
| Segmented control | `components/ui/toggle-group.tsx` — real Radix component (`@radix-ui/react-toggle-group` is already a dependency). **Currently used only by `components/ui/pricing-card.tsx` (marketing); a mobile stage selector would be its first app-side use.** |

### 5.2 Missing — must be built (extend, never fork)

| Need | Gap | Recommended approach |
| --- | --- | --- |
| **Bottom sheet** | `ModalPop` has `pos: 'top' \| 'middle'` only, hard-coded `p-8`, `max-h-[90vh]`, **no body scroll lock**, no safe-area | **Extend `ModalPop` with `pos='bottom'`** + padding prop + scroll lock. It already has the portal, focus trap, Escape, and focus restore — do not write a second dialog. |
| **Bottom navigation** | none | New `components/mobile/MobileTabBar.tsx`, server-gated |
| **Mobile header** | `Topbar` is desktop | New, reusing `Topbar`'s data |
| **Sticky action bar** | none | New; precedent exists in `InvoiceActionBar` |
| **List row** | none | New; derive spacing from `OnboardingActionCard` |
| **Skeletons** | ad-hoc (`LeadIntelligenceCardSkeleton`) | Content-shaped per `frontend-experience-guidelines.md` §3 |
| **Safe areas** | only `MobileHandoff` uses `env(safe-area-inset-*)` | Promote that pattern into the shell |
| **44px touch targets** | not enforced | Add to the a11y suite (`__tests__/a11y/`) |

### 5.3 The breakpoint problem (Finding 4)

```ts
screens: { mobile: {min:'0px', max:'767px'}, desktop: {min:'1000px'}, '3xl': {...} }
```

**768–999px matches neither.** Recommended in Phase 1: introduce a `tablet` screen or lower
`desktop` to `768px` — but only with a full desktop-regression pass, since every existing
`desktop:` utility would start applying 232px earlier.

---

## 6. Proposed architecture — adopt the existing `modules/` shape

Phase 13 proposes `shared/ desktop/ mobile/`. The repo already has a better, proven version of
this in `modules/inbox`. Recommendation: **do not introduce a new top-level directory convention.**

```
lib/leads/*          ← ALREADY pure business logic (outcomeRules, dueWorklist,
lib/today/*             bucketDashboardLeads, recommend, upcomingFollowUps,
db/{briefing,worklist,   leadSourceLabel, normalizeContact, duplicateMatch)
   followUps,clients}.ts
actions/*            ← ALREADY the single authorization boundary
                        (requireProductAccess / requireAgencyUser / getPerms)

modules/leads/                        ← NEW, mirrors modules/inbox exactly
  queries.ts        (re-export/compose db/clients — no new data layer)
  filters.ts        (URL <-> filter state, shared by both presentations)
  components/       desktop presentation (moves later, not now)
  mobile/           mobile presentation
    LeadListMobile.tsx
    LeadCardMobile.tsx
    LeadFiltersSheet.tsx
    LeadDetailMobile.tsx
```

**Device selection happens once, on the server, in the layout — never with `if (isMobile)` inside
business logic.** `lib/device.ts:20 isMobileRequest()` is the single source of truth and is already
used by both the layout and `/activate`. This satisfies `architecture-rules.md` §9 (gate mobile-only
UI by *absence*, never CSS-hide) — the rule that governs this entire project.

**Authorization is untouched.** Every server action already calls `requireProductAccess()` /
`requireAgencyUser()` / `getPerms(user)`. Mobile presentation calls the *same* actions. No new
API routes, no client-side permission logic. This is what makes Phase 19 tractable rather than a
re-audit.

---

## 7. Conflicts with the plan as written — decisions needed before Phase 1

### 7.1 Phase 5 (Pipeline) — the feature does not exist

`clients.status` is a free-text column with a five-value convention. There is no Kanban, no stage
ranking table, no drag-and-drop, no counts view. Options:

| Option | What it means | Trade-off |
| --- | --- | --- |
| **A. Reframe as "Leads by status" (recommended)** | A `toggle-group` segmented control over `new/contacted/interested/closed/lost` with counts, filtering the existing mobile lead list | Zero new backend. Uses an existing primitive. Honest about what the product has. Not a new entity. |
| B. Build a real pipeline, desktop first | Desktop Kanban, then mobile | Large scope, contradicts "no broad desktop redesign" (rule #12) |
| C. Drop Phase 5; make **Follow-ups** (Phase 6) bottom-nav slot #1 | Follow-ups already have real backend (`db/followUps.ts`, `lib/leads/upcomingFollowUps.ts`, `dueWorklist.ts`) | Loses the word "pipeline"; strictly closer to "Mobile = ACT" |

**Recommendation: A for the tab, and reorder the bottom nav to `Today · Leads · Notifications · More`**,
because `/dashboard` (`היום`) is already card-shaped, already has `RecommendedLeads` +
`LeadQuickActions`, and is the product's own answer to "what should I do next" — which is exactly
the mobile job. A "Pipeline" tab that is really a status filter should not outrank it.

### 7.2 Removing the gate collides with the trial wall — sequence this carefully

Order in `app/(app)/layout.tsx`: mobile redirect (:46) → onboarding (:48) → trial → children (:132).
Deleting :46 means a phone's **first** authenticated render is `WorkspaceTeaser` +
`WelcomeTrialModal` — non-dismissible, focus-trapped, `p-8`, 2×2 grid, `max-h-[90vh]`, never once
tested below 1000px. If the CTA is unreachable at 360px, the user is **hard-locked out of the
product with no escape**, and trial conversion (currently 5/5) breaks.

**Recommendation:** make `WelcomeTrialModal` + `WorkspaceTeaser` mobile-safe **in Phase 1, before
Phase 2 touches the redirect** — presentation only, no change to `startTrial()`, `db/trial.ts`, or
the `NEVER_STARTED` condition. Verify at 360px that the CTA is reachable and the focus trap
releases. Rule #6 is preserved because trial *logic* is untouched; only its rendering changes.

### 7.3 Phase 14 (PWA) is ~70% done, and `sw.js` is constrained

`manifest.json` exists and is wired. Remaining: apple-touch icons, PNG icons (only an SVG today),
`viewport-fit=cover`, theme-color meta. **Do not add a `fetch` handler or caching to `public/sw.js`** —
its header documents that as a hard security constraint of the notification spec. If offline
caching is ever wanted it needs a second, separately-scoped worker and its own review.

### 7.4 Phase 15 analytics — three of the four events are already specified

`mobile_workspace_viewed`, `mobile_lead_opened`, `mobile_lead_action_taken`,
`mobile_first_value_reached` all fit `analytics_events.props` with **no migration** (rule #11 holds).
Note the overlap with the funnel audit's Tier 1: `lead_action_taken` and `mobile_lead_action_taken`
should be **one event with a `surface: 'mobile' | 'desktop'` prop**, not two — otherwise desktop
activation stays unmeasurable and the Activation KPI can't be computed across both.

### 7.5 `/(app)/clients` propagates forbidden terminology

`metadata.title = 'נתוני לקוחות'`. `CLAUDE.md` Entity Constraint and `ux-guidelines.md` §6 forbid
`לקוח`. Pre-existing; **must not be carried into any mobile screen**. Flagged, not fixed.

---

## 8. Risk register

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| R1 | Trial wall unreachable on mobile → hard lockout, 5/5 conversion breaks | **CRITICAL** | §7.2 — fix presentation in Phase 1, before Phase 2. Coverage already exists: `__tests__/a11y/modalPop.test.tsx` + `mobileHandoff.test.tsx` |
| R2 | Removing `isMobileRequest()` changes what renders for *existing desktop* users | HIGH | Gate by absence server-side; desktop branch byte-identical |
| R3 | 15 agencies still stranded at `/activate` (`onboardingCompletedAt IS NULL`) | HIGH | Resolve before retiring `MobileHandoff`; they are real, non-exempt |
| R4 | 768–999px dead zone | MEDIUM | §5.3; full desktop regression if `desktop` moves |
| R5 | `clientsTable.tsx` already exceeds the 350-line hard limit | MEDIUM | Do not touch it; build mobile alongside |
| R6 | Bundle: desktop-only modules (FullCalendar, jspdf, pdf-lib, xlsx, react-pdf) shipping to mobile | MEDIUM | Phase 16 — `next/dynamic`, already used for `TestimonialsSection` |
| R7 | Adding caching to `sw.js` breaks the notification security constraint | MEDIUM | §7.3 |
| R8 | Copilot panel (33 components) ported to mobile increases complexity | LOW | Phase 11 — lead-scoped actions only |

---

## 9. Recommended revision to phase order

| Plan | Recommended | Why |
| --- | --- | --- |
| 1 Design system | 1 Design system **+ trial-wall/teaser mobile safety** | R1 must be closed before the gate opens |
| 2 Shell (remove block) | 2 unchanged, but **behind a flag + agency allowlist** | Matches `feedback_feature_rollout_standard`; Phase 20 wants 5–10 users first |
| 3 Leads list | 3 unchanged | |
| 4 Lead detail | 4 unchanged | Highest value per §0.1 |
| 5 Pipeline | **defer** — decide §7.1 first | Feature does not exist |
| 6 Follow-ups | **promote to 5** | Real backend exists today |
| 15 Analytics | **promote to run alongside 2–4** | Otherwise Phase 20 has nothing to observe |

---

## 10. What I need decided before Phase 1

1. **Phase 5** — option A, B, or C from §7.1? (A recommended.)
2. **Bottom nav slots** — `Today · Leads · Notifications · More` (recommended) or the original
   `Pipeline · Leads · Notifications · More`?
3. **Breakpoint dead zone** — fix the 768–999px gap now (desktop regression pass required) or
   accept it and target `mobile:` only?
4. **Rollout flag** — new `MOBILE_WORKSPACE_ENABLED` + agency allowlist, matching the notifications
   pattern? (Recommended; Phase 20 requires it.)
5. **`mobile_lead_action_taken`** — merge with the funnel audit's `lead_action_taken` under a
   `surface` prop (recommended), or keep two events?

Nothing is implemented. On your answers I will produce the Phase 1 design-system plan, then
implement phase-by-phase with typecheck + `test:a11y` + desktop-regression verification between
each, per `feedback_phased_refactor_protocol`.
