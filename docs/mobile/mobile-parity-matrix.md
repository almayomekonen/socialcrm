# mobile-parity-matrix.md — Every desktop capability, tiered for mobile

**Status:** audit deliverable. **No code changed.**
**Date:** 2026-08-13 · **Branch:** `feature/notification-infrastructure`
**Governing principle:** *"Don't make Desktop responsive. Make Mobile operational."*
**Companions:** [`phase-0-mobile-audit.md`](./phase-0-mobile-audit.md) (route inventory, design-system
gaps) · [`../funnel/activation-funnel-audit.md`](../funnel/activation-funnel-audit.md) (why mobile
matters commercially).

---

## 0. How to read this

**GREEN — Mobile first.** Fully operable from a phone. A rep should never need a laptop for it.
**YELLOW — Mobile lite.** View + common/simple operations. Complex editing stays on desktop.
**RED — Desktop preferred.** Never a compressed desktop UI. Status/summary where useful, explicit
handoff where editing genuinely needs a big screen.

**Existing backend** names the modules that already exist and must be reused. An empty *Mobile UX
required* means the desktop component is already usable as-is on a phone (rare — see §5).

**54 authenticated routes** audited: 45 under `(app)`, 6 under `(support)`, 3 under `admin`.

---

## 1. Lead working — the core loop

| Route | Desktop capability | Tier | Existing backend | Mobile UX required | Handoff | Dependencies | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/dashboard` | Today: recommended, due worklist, meetings, progress | **GREEN** | `modules/today/queries`, `lib/today/*`, `db/worklist`, `db/meetings` | **Done (Phase 2)** | no | — | ✅ 2 |
| `/leads` | Lead table: 15+ columns, column manager, tabs, sort, bulk delete, 5 dialogs | **GREEN** | `db/clients` (`getLeadsTable`, `getLeadLists`, `getLeadColumnAvailability`), `db/filter` | `LeadListMobile` (cards, not table) + search + status filter sheet | no | Phase 1 primitives; `modules/leads/` | **A** |
| `/clients/[id]/summary` | Lead detail: identity, status, follow-up, outcome, AI card, activity, tasks, inbound context | **GREEN** | `db/clients.getFullLead`, `db/tasks`, `actions/leadFollowUp`, `actions/leadOutcome` | Dedicated mobile detail + sticky actions | no | Phase A leads | **A** |
| — (action) | Status change | **GREEN** | `actions/clients.updateLead` / `upsertLead` | BottomSheet selector over the 5 existing statuses | no | BottomSheet | **A** |
| — (action) | Follow-up set/clear | **GREEN** | `actions/leadFollowUp.{setLeadFollowUp,clearLeadFollowUp}` | Sheet: today / tomorrow / custom / note | no | BottomSheet | **A** |
| — (action) | Call | **GREEN** | none (`tel:`) | One-tap `tel:` anchor — **shipped in Phase 2** | no | — | ✅ 2 |
| — (action) | WhatsApp | **GREEN** | `modules/inbox/client/openLeadWhatsapp`, `actions/whatsapp/sendWhatsappReply` | One-tap alongside Call | no | inbox routing | **A** |
| — (action) | Outcome logging | **GREEN** | `actions/leadOutcome.logLeadOutcome`, `lib/leads/outcomeRules` | Sheet from the detail sticky bar | no | — | **A** |
| — (action) | Assign to rep | **YELLOW** | `actions/clients.transferLeadToRep` | Sheet with rep list | no | `db/usersNTeams` | **A** |
| `/clients` | Duplicate of `/leads` titled `נתוני לקוחות` | **RED** | same as `/leads` | none — **do not build.** Violates the Entity Constraint (`לקוח`) | n/a | — | — |
| `/clients/[id]/tasks`, `/tasks/[taskId]` | Per-lead tasks + stepper | **YELLOW** | `db/tasks` | List rows + complete action | editing → desktop | — | B |
| `/clients/[id]/files` | Per-lead files + Drive picker | **YELLOW** | `db/files`, `db/leadDriveFiles` | List + view/download | upload → desktop | Drive OAuth | C |
| `/tasks` | All-tasks table | **YELLOW** | `db/tasks` | List + filters sheet | bulk → desktop | — | B |

**Note on `/clients`:** it is a second lead table under forbidden terminology. It is deliberately
tiered RED with *no* mobile build — the mobile workspace should not carry a second lead surface into
existence. Flagged for desktop cleanup separately.

---

## 2. Work management & communication

| Route | Desktop capability | Tier | Existing backend | Mobile UX required | Handoff | Dependencies | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| (new) Follow-ups | Currently only the dashboard's `FollowupsTable` | **GREEN** | `db/followUps`, `lib/leads/{dueWorklist,upcomingFollowUps}`, `db/worklist` | Now / today / overdue / upcoming list, each with one action | no | Phase A actions | **B** |
| `/notifications` | Notification centre: cursor list, filter chips, deep links | **GREEN** | `db/notifications/feed`, `modules/notifications/center` | Keep primary filter visible; **advanced filters → BottomSheet** | no | **must not touch infra** | **B** |
| `/inbox` | Three-pane: conversation list + thread + intelligence | **GREEN** | `modules/inbox/{queries,actions,filters}` | Master/detail: list → thread, back to list | no | Phase A detail patterns | C |
| `/inbox/comments` | Facebook comment triage | **YELLOW** | `modules/facebookComments` | List + convert action | no | inbox mobile | C |
| `/calendar` | FullCalendar month/week/day + meeting dialogs | **RED** | `db/meetings`, `db/googleCalendarConnections` | **Agenda list view** (not FullCalendar) | complex editing → desktop | Google Calendar | D |

---

## 3. Data in and out

| Route | Desktop capability | Tier | Existing backend | Mobile UX required | Handoff | Dependencies | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/leads` → import | Excel + CSV import with preview, validation, quota | **GREEN** | `actions/clients.{uploadLeadData,addLeads,importLeadsFromCsv}` | File picker → preview → validation summary → import | no | **extract to `modules/leads/import.ts` first** | **C** |
| `/leads` → export | Client-side table export | **YELLOW** | `lib/table/export` | Sheet: filtered / all × Excel / CSV | no | export refactor | C |
| `/files` | Agency file table | **YELLOW** | `db/files` | List + view/download | upload → desktop | — | D |

**Import is the one GREEN item with a hard prerequisite.** `actions/clients.ts` is **933 lines** —
already past the 350-line hard limit — and the import path is ~200 of them. The extraction to
`modules/leads/import.ts` is required by the directive *and* by `architecture-rules.md` §8, and it
must be behaviour-preserving (same quota lock, same dedup, same return shapes).

---

## 4. Configuration, money, people

| Route | Desktop capability | Tier | Existing backend | Mobile UX required | Handoff | Dependencies | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/settings/integrations` | Lead sources + connected tools, connect/disconnect | **YELLOW** | `db/facebook`, `db/whatsapp`, `db/googleCalendarConnections`, `db/googleDriveConnections` | Status rows: Connected / Not connected + Connect / Manage | deep config → desktop | **no OAuth changes** | **C** |
| `/settings/facebook` | Facebook page detail | **YELLOW** | `db/facebook` | Fold into integrations detail | reconnect flows OK on mobile | — | C |
| `/settings/self_edit` | Own profile | **YELLOW** | `db/usersNTeams` | Simple form | no | — | E |
| `/settings/update_user_details` | Rep details | **YELLOW** | `db/usersNTeams` | Simple form | no | — | E |
| `/settings/update_agency` | Business profile | **YELLOW** | `db/agencies` | Simple form | logo/art → desktop | — | E |
| `/settings/update_security` | Login history (`IpsTable`) + session timeout | **YELLOW** | `db/loginActivity` | List rows, not a table | no | — | E |
| `/settings/update_payment` | Plan, usage, upgrade, billing history | **YELLOW** | `lib/quota`, `db/billing`, `lib/payments/link` | Plan card, status, invoice list, view/download | **no payment logic changes** | Grow | E |
| `/settings/edit_users` | Users table + invitations | **YELLOW** | `db/usersNTeams`, `db/invitations` | User list, role summary, status | create/permissions → desktop | — | E |
| `/settings/edit_teams` | Team cards + membership | **YELLOW** | `db/usersNTeams` | Team list | editing → desktop | — | E |
| `/settings/update_default` | System defaults | **YELLOW** | `db/usersNTeams` | Simple form | no | — | E |
| `/settings/calendar` | Google Calendar connect | **YELLOW** | `db/googleCalendarConnections` | Status + connect | no | — | C |
| `/support`, `/support/new`, `/requests`, `/requests/[id]`, `/guides`, `/guides/[slug]` | First-party support | **GREEN** | `db/support` | **Already mobile-usable** — verify only | no | — | ✅ (verify) |
| `/billing/success` | Payment return | **YELLOW** | payments | Must render on a phone (payments return here) | no | — | E |

---

## 5. Desktop-preferred (RED)

| Route | Desktop capability | Existing backend | Mobile treatment | Phase |
| --- | --- | --- | --- | --- |
| `/settings/automations`, `/automation-templates`, `/automations-pilot` | Automation builder + template editor (`AutomationSheet` 346L, `AutomationTemplatesSection` 189L) | `db/automations`, `lib/automations/*` | **Lite:** name, active/inactive, last activity. Editing → desktop handoff | F |
| `/settings/auto-response` | Auto-response config (322L form) | `db/autoResponseSettings` | Lite: on/off + mode summary | F |
| `/settings/quote-templates` | Quote template editor | `db/quotes` | Handoff | G |
| `/settings/edit_tmplts`, `/[tmpltTaskId]` | Task template stepper (298L) | `db/tasks` | Handoff | G |
| `/settings/edit_promotions`, `/promotion`, `/promotion/[id]` | Promotions | `db/promos` | Handoff | G |
| `/settings/connections` | Connection registry / secrets | `db/automations` | Handoff | G |
| `/settings/ai-inspector` | AI decision inspector (351L) | `db/aiInspector` | **Lite:** read-only recent runs. ADMIN + flag only | F |
| `/clients/[id]/billing`, `/new`, `/[invoiceId]` | Invoice editors (`InvoiceNewEditor` 322L, `InvoiceDraftEditor` 368L, `LeadPicker` 245L) | `db/billing` | **Lite:** invoice list, status chips, **view/download PDF**. Issuing/editing → desktop | E |
| `/deals` | Sales table (307L) | `db/salesTbl` | Summary only | G |
| `/sum_sales` + `/agents`, `/companies`, `/months`, `/teams` | Cross-tab reporting | `db/sumSales`, `db/sum_pie` | Headline numbers only; full reports → desktop | G |
| `/admin`, `/admin/support/[id]` | Platform-owner console | `db/trial`, `db/support` | **None.** Owner-only, desktop-only | — |
| `/activate` | Legacy activation FSM | `lib/activation/*` | Already mobile (`MobileHandoff`) | ✅ |

---

## 6. AI

| Capability | Tier | Existing backend | Mobile UX | Phase |
| --- | --- | --- | --- | --- |
| Lead intelligence card | **GREEN** | `actions/ai/leadIntelligenceRefresh`, `db/aiSummaries` | Inline in mobile lead detail | **A** (render) |
| "What should I do next?" | **GREEN** | `actions/ai/leadAskQuestion` | Contextual action in lead detail | F |
| Summarize lead | **GREEN** | `db/aiSummaries`, `lib/ai/prompts/leadIntelligence` | Contextual action | F |
| Draft WhatsApp reply | **GREEN** | `actions/ai/whatsappReplyDraft` | Draft → user sends (never auto-send) | F |
| Copilot panel (33 components) | **RED** | `lib/copilot/*` | Not ported. Lead-scoped actions instead | F |
| General mode / daily briefing | **YELLOW** | `actions/ai/{askGeneralQuestion,getDailyBriefing}` | Deferred | G |

**Entitlements unchanged.** `isCopilotEnabledForUser`, `isGeneralModeEnabled` and the AI flags gate
mobile exactly as they gate desktop.

---

## 7. Tier summary

| Tier | Capabilities | Notes |
| --- | --- | --- |
| **GREEN** | 18 | 3 already shipped (Today, Call, Support). 9 are Phase A. |
| **YELLOW** | 19 | Mostly forms and lists over existing reads |
| **RED** | 14 | 11 get a lite/summary surface; 3 get no mobile surface at all |

---

## 8. Ordered roadmap

| Phase | Scope | Gate to start |
| --- | --- | --- |
| ✅ 1 | Design system, bottom sheet, shell primitives, flag, analytics | done |
| ✅ 2 | Mobile shell + Today + handoffs | done |
| **A** | **Leads list, Lead Details, status, follow-up, WhatsApp, outcome, assign, search, filters** | **approved — next** |
| B | Follow-ups screen · Notifications mobile presentation · tasks | A merged |
| C | `modules/leads/import.ts` extraction → mobile import/export · Integrations · Inbox | B |
| D | Calendar agenda · files | C |
| E | Billing/subscription lite · invoice view+download · team/users/profile/security · More hub sections | C |
| F | AI lead actions · automations lite · auto-response lite · AI inspector lite | E |
| G | Reports/deals summaries · remaining RED handoffs | F |
| H | PWA polish · perf · a11y sweep · allowlisted beta expansion | G |

---

## 9. Findings that shape Phase A

1. **`modules/leads/` does not exist yet.** `/leads` calls `db/clients` directly from the page.
   Phase A creates `modules/leads/{queries,filters}.ts` mirroring `modules/today/`, and the desktop
   page keeps calling the same functions — one resolver, two presentations.
2. **Filter state is not in the URL today.** `/leads` reads `searchParams` but `ClientsTable` holds
   tabs, sort and column state in `useState`. Mobile filters must be URL-backed (deep links, back
   button, refresh — all in the quality bar). Do **not** retrofit desktop's client state in Phase A.
3. **`actions/clients.ts` is 933 lines.** Phase A adds no lines to it; Phase C extracts import.
4. **Status vocabulary is `new | contacted | interested | closed | lost`**
   (`lib/calendar/outcomeStatusSuggestion.ts:23`). No pipeline entity, no new statuses.
5. **`/notifications` is linked from the tab bar but still not viewport-verified.** It is the one
   Phase 2 surface without measured QA — Phase B owns it, and it gates the beta.
6. **WhatsApp on mobile routes through the inbox** (`openLeadWhatsappInInbox`). The mobile inbox is
   Phase C, so Phase A's WhatsApp action needs a decision: route to the existing inbox route (which
   has no mobile presentation yet) or open the native WhatsApp app via `wa.me`. **Recommendation:
   native `wa.me` for Phase A** — it is one tap, needs no new surface, and matches how reps already
   work; in-app threads arrive with the Phase C inbox.

---

## 10. Explicitly not built

Native app · backend rewrite · second data model · Pipeline entity · forced-responsive desktop ·
tables squeezed into phones · trial/billing/Meta-OAuth/notification-infrastructure changes ·
autonomous AI · mobile automation editing · a mobile surface for `/clients` (duplicate lead table
under forbidden terminology).
