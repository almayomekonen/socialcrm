# customer-automation-engine-implementation-plan.md — Engineering Execution Plan

**Status:** engineering planning document. No code, no schemas, no migrations are
defined here — this plan sequences the work, names the files, and gates the
decisions. It implements the product specification in
[`email-automations-plan.md`](./email-automations-plan.md) (the spec), including
its §0 boundary contract and the Customer Automation Engine stance.

**Authority:** subordinate to `CLAUDE.md`, `claude/do-not-touch.md`,
`claude/architecture-rules.md`, `claude/release-deployment-workflow.md`, and the
spec. Two rules from `do-not-touch.md` bind this plan directly:

- **DB schema changes require an explicitly approved migration plan.** This plan
  names the new tables conceptually and marks the approval gate; it does not
  design them.
- **Core server actions are a protected area.** Every phase that touches
  `actions/clients.ts` or `actions/leadOutcome.ts` is flagged, minimized, and
  additive-only.

**Branch reality:** the current local branch (`security/remediation-phase-1`) is
divergent from `origin/main`. All implementation work starts from a **fresh
worktree off current `origin/main`** (release-workflow §1/§4). Nothing in this
plan is built on the current working branch.

---

## 1. Codebase analysis — what exists and where the engine must attach

### 1.1 Lead creation — five paths, no single choke point

| Path                | Entry                                                              | Transactional?       | Fires V1 trigger?                                                        |
| ------------------- | ------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------ |
| Facebook webhook    | `lib/system/createClientFromWebhook.ts` → `insertLeadSystem`       | **No**               | Yes (`lead_created`, source facebook)                                    |
| WhatsApp webhook    | `lib/system/createLeadFromWhatsappWebhook.ts` → `insertLeadSystem` | **No**               | Yes (`lead_created`, source whatsapp)                                    |
| Manual single lead  | `actions/clients.ts` `upsertLead` (insert branch)                  | Yes (quota-lock trx) | Yes (`lead_created`, origin manual) — RESOLVED per ADR-004               |
| Excel bulk import   | `actions/clients.ts` `addLeads`                                    | Yes (quota-lock trx) | **Never** (spec §9 import-storm law)                                     |
| CSV import          | `actions/clients.ts` `importLeadsFromCsv` → per-row `upsertLead`   | Per-row              | **Never** — but note: it _reuses `upsertLead`_, see §7 (debt)            |
| Legacy sales upload | `actions/uploadSales.ts`                                           | Mixed                | Never                                                                    |

Two structural facts every later phase depends on:

1. **`insertLeadSystem` is non-transactional and swallows errors** (returns
   `null` on failure). The webhook paths therefore offer no transaction to
   attach an in-transaction enqueue to (the pattern `enqueueAutoResponse` uses).
2. **`importLeadsFromCsv` calls `upsertLead` internally.** A trigger hook placed
   naively inside `upsertLead` would make CSV imports fire "new lead"
   automations — a direct violation of the spec's import-exclusion law. Trigger
   emission MUST carry an explicit **origin** (`webhook_facebook` /
   `webhook_whatsapp` / `manual` / `import`) supplied by the call site, never
   inferred.

### 1.2 Status change — two writers

- `actions/clients.ts` `updateLead` — generic allowlisted field update; sets
  `statusChangedAt` when status present; side effects today: `revalidatePath`,
  `scheduleLeadIntelWarm`.
- `actions/leadOutcome.ts` `logLeadOutcome` — outcome-driven status resolution
  via `lib/leads/outcomeRules.ts`.

Both must emit `status_changed`, or the trigger silently misses half the
product's status writes (outcome controls, meeting outcomes). Neither is fully
transactional today.

### 1.3 Proven infrastructure to clone (not import)

- **Job queue pattern** — `db/autoResponseJobs.ts` (`enqueue` taking a trx with
  `ON CONFLICT DO NOTHING`, `claim` via `FOR UPDATE SKIP LOCKED`, lease
  `reclaim`, `complete`/`skip`/`fail` with retry backoff and dead-letter) and
  its sibling `db/conversationIntelligence.ts`. This is the engine's execution
  substrate, cloned into the `automations` namespace.
- **Worker + drain pattern** — `lib/inbox/autoresponse/worker.ts`: post-commit
  `after()` kick from the event source as primary, an unscheduled backstop
  route, plus (for the engine, which has delayed sends) a **scheduled** cron
  drain — the piece IRE deliberately lacks.
- **Skip-reason taxonomy + Hebrew error copy** — `lib/inbox/autoresponse/eligibility.ts`
  and `lib/inbox/whatsappErrorCopy.ts` as the model for the engine's law
  results and activity-log copy.
- **Per-agency flag pattern** — `lib/whatsapp/templates/flag.ts` /
  `lib/ai/env.ts` `parseAgencyAllowlist`; richest variant `lib/today/rollout.ts`
  (allowlist + kill switch).
- **Claim-before-send idempotency** — `db/emailAutomationSends.ts` (pattern
  only; platform-keyed storage stays platform's).
- **Business timezone** — `lib/time/businessDay.ts` (`BUSINESS_TZ`) for all
  delay/anchor arithmetic.
- **Settings surface pattern** — `app/(app)/settings/(admin_settings)/auto-response/`
  - `components/settings/autoResponse/` + `actions/autoResponse/updateSettings.ts`
    as the page/form/action template; nav registration in
    `app/(app)/settings/layout.tsx` (admin block, lines ~18–35).
- **Rendering** — `@react-email/*` (pure, freely shared per spec §0).
- **Transport** — `lib/email/sender.ts` `sendEmail()` (retry taxonomy,
  no-silent-loss guard) — reusable **only after** the `from` parameterization in
  Phase 0 (it currently hardcodes the platform sender).

### 1.4 What must remain isolated (spec §0, restated as engineering constraints)

Never imported, extended, or written to by engine code:

- `lib/emailAutomations/**` — platform registry, `Automation` type, dispatch
  pipeline, lifecycle cooldown, `unsubscribeToken.ts`.
- `db/emailAutomationSends.ts`, `db/emailSuppressions.ts` — platform send
  claims and userId-keyed suppression.
- `app/api/email/unsubscribe/route.ts` — platform unsubscribe (userId-scoped).
  The engine gets its own route with a (business, lead)-scoped token.
- `app/api/cron/email-automations` — platform cron. The engine gets its own.
- `lib/events/emit.ts` — Resend audience emitter. **Lead PII never flows here.**
- Platform envs `RESEND_FROM`, `EMAIL_ENABLED` — engine config is `AUTOMATIONS_*`.

Boundary enforcement is itself a deliverable (Phase 0): a lint-style guard (an
ESLint `no-restricted-imports` rule or an import-boundary test) that fails CI if
`lib/automations/**` imports from `lib/emailAutomations/**` or vice versa.

---

## 2. New surface map (all phases, consolidated)

Created (namespace per spec §0 — `automations`, `AUTOMATIONS_*`):

- `lib/automations/` — engine core: trigger/action type definitions (closed
  enums), laws (pure decision functions), origin taxonomy, recipe catalog
  (starter content), flag module, unsubscribe token (lead-scoped).
- `db/automations/` — definitions store, job queue (cloned autoResponseJobs
  shape), send/skip log, lead suppression. **Requires the migration approval
  gate (§6.3).**
- `actions/automations/` — create/update/pause/duplicate/delete/test-send
  server actions.
- `app/api/cron/automations-dispatch/route.ts` — scheduled drain (new
  `vercel.json` entry).
- `app/api/automations/unsubscribe/route.ts` — lead unsubscribe.
- `app/api/automations/email-events/route.ts` — Resend delivery-events webhook
  (engine sends only; platform events ignored — Phase 5).
- `app/(app)/settings/(admin_settings)/automations/` — the אוטומציות page.
- `components/settings/automations/` — gallery, sheet, list, activity log.
- `__tests__/automations/` — laws (pure), queue SQL (`.toSQL()` pattern),
  boundary test, action tests.

Modified (each is a minimal, additive diff):

- `lib/email/sender.ts` + `lib/email/config.ts` — optional explicit `from`
  (default unchanged → platform callers unaffected).
- `lib/system/createClientFromWebhook.ts`, `lib/system/createLeadFromWhatsappWebhook.ts`
  — post-insert trigger emission (origin-tagged).
- `actions/clients.ts` (`upsertLead` insert branch), `actions/leadOutcome.ts`,
  and the `updateLead` status branch — trigger emission. **Protected files —
  smallest possible diffs.**
- `app/(app)/settings/layout.tsx` — one nav entry.
- `vercel.json` — one cron entry.
- `lib/emailAutomations/` — a boundary header comment only (no behavior).

---

## 3. Phases

Ordering principle: **build the engine dark (flags off, log-only), attach it to
real events last, and let no customer email leave before suppression exists.**
Each phase is independently shippable to `main` with zero user-visible or
behavioral change until Phase 7 flips a flag for one agency.

---

### Phase 0 — Pre-implementation gates, debt paydown, and safe groundwork

**Goal:** every irreversible decision validated (§6), blocking debt resolved
(§7), and the two shared-infrastructure changes landed as standalone,
zero-behavior-change commits.

**Scope:**

- Resolve the §6 decision gates in writing (spec §12 answers required from
  product/legal/infra).
- Create the implementation worktree from `origin/main`.
- Parameterize transport: `sendEmail()` accepts an optional explicit `from`
  (and reply-to already exists); default remains `getEmailFrom()`. Platform
  callers untouched.
- Add the §0 boundary header comment to `lib/emailAutomations/` and the
  import-boundary guard (lint rule or test) between the two domains.
- Decide the test-harness stance (§7.1) and document it in the test README.

**Files likely to change:** `lib/email/sender.ts`, `lib/email/config.ts`,
`lib/emailAutomations/registry.ts` (comment only), ESLint config or
`__tests__/automations/boundary.test.ts`.

**Dependencies:** spec §12 decisions #1 (event-date anchor), #2 (sender
identity), #3 (consent) — see §6.

**Risks:** the transport change touches the platform's lifeline path.
Mitigated by: optional parameter with unchanged default, plus running the full
existing email test surface (`__tests__/emailAutomations/`,
`trial-start-email.test.ts`) before and after.

**Acceptance criteria:** `npx tsc --noEmit` clean; `npm run test:integration`
result identical before/after the transport commit; boundary guard demonstrably
fails on a deliberate cross-import, then passes; a written record of §6
decisions exists in this document (updated in place).

**Rollback:** revert the transport commit (self-contained); everything else in
this phase is documentation/guard-only.

**Definition of Done:**

- ADR-001 through ADR-008 exist in `docs/adr/`; decisions owned outside
  engineering carry status _Proposed_ with the owning role named.
- Transport parameterization and boundary guard live on the implementation
  branch as separate, independently revertable commits.
- Validation recorded before and after the transport change (`tsc`, integration,
  a11y) with identical results.
- The test-harness stance is recorded in §5.1 as a decision, not an open item.
- The `origin/main` worktree exists and is the only tree carrying engine code.

---

### Phase 1 — Engine core as pure logic (no DB, no I/O)

**Goal:** the engine's decision surface exists as pure, fully unit-tested
functions — the analogue of `decideEligibility`/`validateAutoResponse` in IRE.

**Scope:**

- Closed trigger enum (`lead_created`, `status_changed`) and origin taxonomy
  (`webhook_facebook`, `webhook_whatsapp`, `manual`, `import`) as types.
- The laws as pure functions returning allow/skip-with-reason: import
  exclusion, send-once key derivation (lead + automation), per-lead daily
  frequency cap decision, **engine-level daily send ceiling** (the IRE
  `dailyCap` concept, per agency — round-2 addition: Phase 7 depends on it),
  suppression decision, hard-bounce/undeliverable-address decision,
  terminal-lead premise-expiry decision, send-window (quiet hours) decision,
  and timing resolution — all in `BUSINESS_TZ`. Timing is **delay presets
  only**: the event-date anchor is excluded from V1 per ADR-007 (no anchor
  field, no anchor-passed law, no anchor variables; the reminder starter
  recipe is held back with it).
- Skip-reason taxonomy with the spec §8 Hebrew copy as the single copy map.
- The lead-scoped unsubscribe token signer/verifier (HMAC over
  business + lead, new secret env `AUTOMATIONS_UNSUBSCRIBE_SECRET`).
- Recipe catalog as static content (spec §7 starters) — data, not UI.

**Files likely to change:** new `lib/automations/*` only; new
`__tests__/automations/laws.test.ts`, `unsubscribeToken.test.ts` (pure — run
under `VITEST_NO_DB=1`).

**Dependencies:** Phase 0 (types for origin depend on the §6.1 manual-creation
decision; timing depends on §6 anchor decision).

**Risks:** minimal — nothing is wired. Main risk is design drift from the spec;
mitigated by acceptance criteria referencing spec sections explicitly.

**Acceptance criteria:** every law has tests for allow and each skip reason;
import-origin events are provably inert regardless of other inputs (the CSV
footgun test: origin `import` → skip, always); token verifier rejects
cross-business and cross-lead tokens; all tests pass DB-less.

**Rollback:** delete the new directory; nothing references it yet.

**Definition of Done:**

- Every law is a pure function with allow + per-skip-reason tests, green under
  `VITEST_NO_DB=1`.
- Skip-reason Hebrew copy matches the spec §8 strings verbatim (single copy map).
- Recipe catalog content reviewed against spec §7 starters.
- `lib/automations/` imports nothing outside itself and shared pure utilities;
  boundary guard green.

---

### Phase 2 — Persistence layer (approval-gated)

**Goal:** the engine's storage exists: automation definitions (user data),
the job queue, the send/skip activity log, and lead suppression — cloned from
the `autoResponseJobs`/`conversationIntelligence` shape.

**Scope:**

- **GATE: migration plan approval per `do-not-touch.md` §2** — a separate,
  explicit migration document naming the four conceptual stores (definitions,
  jobs, activity log, lead suppression), additive-only, no changes to any
  existing table. This plan does not proceed past this gate without sign-off.
- `db/automations/` modules exposing the queue verbs (`enqueue` — trx-taking
  with conflict-ignore, `claim` — SKIP LOCKED, `reclaimStale`, `complete`,
  `skip`, `fail` with retry/dead-letter), definition CRUD, activity log
  writers/readers, suppression read/write.
- Tests in the `.toSQL()` pattern (`__tests__/today/facts.sql.test.ts` is the
  model) for every query shape, per §7.1.

**Files likely to change:** new `db/automations/*`, new `migrations/*` (content
defined in the gated migration plan, not here), `types/db/tables.ts` additions,
`__tests__/automations/*.sql.test.ts`.

**Dependencies:** Phase 1 (key derivation and skip taxonomy define the
queue/log vocabulary); the migration approval gate.

**Risks:** schema decisions have long half-lives (definition versioning,
send-once keys — §6.4/§6.5). Mitigated by the gate. Zero runtime risk: nothing
reads these tables yet.

**Acceptance criteria:** migrations apply cleanly on a fresh test DB
(`npm run test:db:create` + migrate); `.toSQL()` suites pass; no existing table
touched (diff of `migrations/` shows additive files only).

**Rollback:** additive-only tables with no readers — a revert removes the code;
tables, if already applied in prod, remain as inert empty tables until a
follow-up down-migration (never a hot drop).

**Definition of Done:**

- The migration plan document is approved **in writing before merge** (the
  `do-not-touch.md` gate) and ADR-008 is flipped to _Accepted_.
- Migrations apply cleanly on a fresh test DB; `.toSQL()` suites green.
- `migrations/` diff shows additive files only; no existing table touched.
- Each `db/automations/` module documents its queue-verb API in its header.

---

### Phase 3 — Trigger emission from real events (dark)

**Goal:** lead-created and status-changed events enqueue engine jobs — with
the global kill OFF, so enqueue is a no-op in production. The riskiest phase;
it touches protected files.

**Scope:**

- A single emission helper in `lib/automations/` (gate-checked: global env
  kill + per-agency allowlist + active-definitions existence; returns
  immediately when off — the `enqueueAutoResponse` SQL-gate philosophy).
- Call-site wiring, origin-tagged, additive lines only:
  - `createClientFromWebhook.ts`, `createLeadFromWhatsappWebhook.ts`
    (post-insert, after the existing task-creation side effects; failure is
    swallowed-with-log, never breaking lead ingestion — mirroring how
    `insertLeadSystem` treats its own failures).
  - `upsertLead` insert branch (origin `manual`) — inside the existing
    quota-lock transaction via the trx-taking enqueue. `importLeadsFromCsv`'s
    reuse of `upsertLead` is handled by the origin parameter (§1.1 fact 2):
    the import path passes origin `import`, which Phase 1 laws make inert.
  - `updateLead` status branch and `logLeadOutcome` (origin-tagged
    `status_changed` with old/new status).
- `addLeads` (bulk import) gets **no** call site at all.

**Files likely to change:** `lib/system/createClientFromWebhook.ts`,
`lib/system/createLeadFromWhatsappWebhook.ts`, `actions/clients.ts`,
`actions/leadOutcome.ts` (all protected — minimal diffs), new
`lib/automations/emit.ts`, `__tests__/automations/emission.test.ts`.

**Dependencies:** Phases 1–2.

**Risks:** highest of the plan. (a) Regression in lead ingestion or status
updates — mitigated by additive-only placement after existing writes, swallow-
and-log failure handling, and the kill switch defaulting OFF; (b) the
`upsertLead`/CSV coupling — covered by a dedicated regression test asserting a
CSV import enqueues nothing; (c) double-emission on retried webhooks — covered
by the queue's conflict-ignore dedup from Phase 2.

**Acceptance criteria:** with kill OFF: zero rows enqueued across all paths
(webhook fixture test, manual create, CSV import, bulk import). With kill ON in
test: exactly one job per event, correctly origin-tagged; CSV/bulk import still
enqueue nothing. Full existing suites green (`test:integration`, `test:a11y`);
the lead-quota and lead-isolation tests specifically re-run.

**Rollback:** env kill OFF restores exact pre-phase behavior instantly (no
deploy); full rollback = revert the call-site commits (each call site is its
own commit for surgical reverts).

**Definition of Done:**

- Each protected-file call site is its own commit, reviewed line-by-line as
  additive-only.
- Kill switch verified OFF in the production environment configuration.
- CSV-import and bulk-import inertness tests are in the permanent suite.
- Full suites green, with `lead-quota-access` and `lead-isolation` explicitly
  re-run and recorded.

---### Phase 4 — Engine worker and the email action (log-only mode)

**Goal:** the full dispatch pipeline runs — claim → laws → render → **log
without sending** — proving the engine end-to-end before any email exists.

**Scope:**

- Worker in `lib/automations/` composing Phase 1 laws with Phase 2 storage:
  claim jobs, evaluate laws (suppression, send-once claim, frequency cap,
  premise expiry), resolve content (subject/body + closed variable set with
  fallbacks), render via `@react-email`, then — in this phase — write the
  activity-log entry as `would_send` and complete the job. The send call
  exists behind a mode gate (`AUTOMATIONS_SEND_MODE=log|live`, default `log`).
- The delayed-send path: jobs carry `notBefore`; the cron drain route
  (`app/api/cron/automations-dispatch`, `CRON_SECRET`-authed, `maxDuration`
  per existing cron conventions) claims due jobs; a post-commit `after()` kick
  at emission covers the immediate case (IRE's architecture).
- `vercel.json` gains the cron entry (schedule decided here: every 5 minutes
  is the starting point for delay accuracy; revisit against Vercel plan
  limits).
- Live-send branch: transport call with the Phase 0 `from` parameter using the
  §6.2-decided customer sending identity, reply-to the business address,
  unsubscribe link from the Phase 1 token in the auto-branding footer.

**Files likely to change:** new `lib/automations/worker.ts` (+ content
rendering module), new `app/api/cron/automations-dispatch/route.ts`,
`vercel.json`, `__tests__/automations/worker.test.ts` (law composition with
injected deps — the `dispatchAutomationEmail` injected-deps testing style).

**Dependencies:** Phases 1–3; §6.2 (sender identity) resolved and the sending
subdomain verified in Resend before the live branch is ever enabled.

**Risks:** double-send on retry ambiguity — the claim-before-send order from
the platform pattern is mandatory (claim, then send, release on failure);
cron cadence vs delay accuracy — acceptable drift documented in the page copy
("תוך מספר דקות"). Zero user-visible risk while mode=log.

**Acceptance criteria:** in log mode with a seeded definition: an event
produces exactly one `would_send` log row with fully rendered content; each
law failure produces the correct skip row; a delayed job is claimed only after
`notBefore`; re-running the worker never duplicates. Resend is provably never
called in log mode (spy/injected transport).

**Rollback:** `AUTOMATIONS_SEND_MODE=log` (instant, no deploy); cron entry
removal reverts drain; worker has no callers outside the cron and kick.

**Definition of Done:**

- Cron registered in `vercel.json`, authed, and observed firing in preview.
- Worker idempotency proven by a re-run test; log-mode transport-spy proof
  recorded (Resend never called).
- Live-send branch is code-complete but unreachable: `AUTOMATIONS_SEND_MODE`
  verified `log` (or unset) in production configuration.
- Delay-accuracy expectation documented in the UI copy source.

---

### Phase 5 — Lead unsubscribe, suppression, and delivery events (blocking gate for live sends)

**Goal:** the legally required path and the honesty path both exist: every
rendered email's unsubscribe link resolves to a working route that suppresses
the (business, lead) pair forever, and delivery outcomes (delivered, bounced,
failed) flow back into the activity log. **No live send is permitted before
this phase completes.**

**Scope:**

- `app/api/automations/unsubscribe/route.ts` — **GET renders a confirmation
  page; POST performs the suppression** (ADR-003 amendment: GET must not
  mutate, or corporate link scanners silently and permanently unsubscribe
  leads who never clicked). Both verify the Phase 1 lead-scoped token; the
  email's URL is unchanged; the page is minimal Hebrew with no app shell.
- Suppression wired into the worker's law evaluation (already a Phase 1 law;
  this phase closes the loop with real storage and a route test).
- Log entry on the lead per spec §9.
- **Delivery-events ingestion (round-2 review addition — the plan previously
  had no source for delivery state):**
  `app/api/automations/email-events/route.ts` — Resend event webhook
  (signature-verified). Updates the engine send log's delivery state
  (delivered/bounced/complained/failed) and, on hard bounce, marks the lead's
  address undeliverable so the Phase 1 bounce law skips future sends
  (`כתובת האימייל לא תקינה`, spec §9). **Shared-account partitioning:** Resend
  webhooks are account-level, so this endpoint will also receive platform-email
  events — it must resolve each event's email id against engine send records
  and silently ignore everything else (never write to platform stores; §0
  boundary applies inside the route). No existing Resend event webhook exists
  in the codebase; this is net-new and engine-owned.

**Files likely to change:** new unsubscribe route file, new
`app/api/automations/email-events/route.ts`, `lib/automations/worker.ts`
(law already present — wiring check), `__tests__/automations/unsubscribe.test.ts`,
`__tests__/automations/emailEvents.test.ts`.

**Dependencies:** Phases 1, 2, 4.

**Risks:** token leakage across tenants — covered by Phase 1 cross-business
token tests; enumeration — tokens are HMAC-signed, invalid = generic response.

**Acceptance criteria:** unsubscribe link from a rendered email suppresses the
lead; subsequent matching events log `לא נשלח — הליד הוסר מרשימת התפוצה`; a
platform-user unsubscribe (existing route) and a lead unsubscribe provably do
not interact (cross-domain test per §0); a delivery event for an engine send
updates exactly that send's log row; a delivery event for a platform email is
ignored with no writes; a hard bounce marks the address and subsequent sends
skip with the bounce reason.

**Rollback:** route removal — but note: once any live email has shipped, the
unsubscribe route is permanent (links in the wild). That is why this phase
precedes live sends, not follows them. The events route is safely removable
(delivery states degrade to "sent" honesty, never to wrong claims).

**Definition of Done:**

- Unsubscribe exercised end-to-end from a rendered email in staging.
- Delivery-events webhook registered in Resend and observed ingesting engine
  events while ignoring platform events.
- Cross-domain non-interaction tests (unsubscribe and events) in the permanent
  suite.
- Bounce-suppression path verified with a forced bounce.

---

### Phase 6 — Admin UI: the אוטומציות page

**Goal:** the spec §4–§8 surface: gallery, one-sheet create/edit, list with
status chips, activity log, test-send — behind the per-agency allowlist.

**Scope:**

- Nav entry in `app/(app)/settings/layout.tsx` (admin block, `SettingsLink`
  pattern, title אוטומציות) — flag-gated visibility like the `ai-inspector`
  precedent.
- Page under `app/(app)/settings/(admin_settings)/automations/` following the
  auto-response page shape (RSC page + client form components).
- `components/settings/automations/` — gallery cards (recipes from Phase 1
  catalog), creation sheet (three slots + preview + test-send), list cards,
  activity log view. Reuse existing card/dialog/form primitives per the
  no-UI-invention rule; every file within `architecture-rules.md` size limits.
- `actions/automations/` server actions: create/update (draft), activate,
  pause, duplicate, delete, send-test (test-send uses the live transport to
  the admin's own address regardless of send mode — it is not a customer
  send).
- Frontend-experience checklist applies (loading, empty state per spec §4,
  optimistic toggle with rollback, Hebrew error states).

**Files likely to change:** `app/(app)/settings/layout.tsx` (one entry), new
page/components/actions listed above, `__tests__/automations/` action tests

- an a11y spec extension in `__tests__/a11y/` (extend, never weaken, per
  release-workflow §9).

**Dependencies:** Phases 1–5, **plus §6.2 (sender identity) resolved with the
sending subdomain verified in Resend** — round-2 addition: test-send is a real
email leaving from the customer identity (it must show admins exactly what
leads will receive), so it cannot ship on an unverified sender even while
customer sends are still in log mode. UI otherwise ships while
`AUTOMATIONS_SEND_MODE=log` — admins on the allowlist can create automations
and see `would_send` activity before anything real sends (this is the spec's
observation story, delivered by sequencing rather than a separate mode).

**Deferred from this phase (conscious exclusions, not omissions):** the spec
§4 contextual entry points (post-import nudge, `OnboardingActionCard` tile,
status-change prompt) ship after the pilot proves the core surface — they are
discovery optimizations, and the pilot agency is hand-onboarded. Tracked for a
post-pilot increment.

**Risks:** scope creep toward the Automation Center consolidation (absorbing
the auto-response page). **Explicitly out of scope** — the existing
auto-response page is untouched in this plan; consolidation is its own future
plan. UI risk otherwise low: additive page behind a flag.

**Acceptance criteria:** allowlisted admin: full create→test-send→activate
flow works; non-allowlisted agency sees no nav entry and gets no page; reps
(non-admin) blocked by the existing `(admin_settings)` layout guard; a11y
suite green; `npx tsc --noEmit` clean.

**Rollback:** remove agency from allowlist (instant). Full revert: the page
and nav entry are self-contained commits.

**Definition of Done:**

- Full create → test-send → activate flow demoed on an allowlisted staging
  agency and recorded.
- A11y suite extended (never weakened) and green; frontend-experience PR
  checklist answered yes on every applicable item.
- Every new component within `architecture-rules.md` size limits.
- Nav/page invisibility verified for non-allowlisted agencies and non-admins.

---

### Phase 7 — Pilot: first live agency

**Goal:** the requesting customer (webinar use case) live end-to-end; the
engine's first real sends under observation.

**Scope:**

- Verify the sending subdomain's DNS/DKIM state and a deliverability smoke
  test (test-sends to major Hebrew-market inbox providers) — gate on §6.2.
- Add the pilot agency to `AUTOMATIONS_AGENCY_ALLOWLIST`; walk the customer
  through recipe adoption (their webinar confirmation).
- Flip `AUTOMATIONS_SEND_MODE=live` **for the engine globally** only after
  the pilot's `would_send` log has been reviewed with the customer (the spec's
  trust bridge, §5).
- Kill-switch drill before go-live: rehearse allowlist removal and mode
  flip-back; measure time-to-silent.
- Observation window: activity log reviewed daily; success metrics per spec
  §3.4 (time-to-active, sends, skip distribution, zero platform-email
  incidents).

**Files likely to change:** env configuration only (Vercel), plus any
copy fixes surfaced by the pilot.

**Dependencies:** all prior phases; §6.2/§6.3 formally closed.

**Risks:** deliverability (spam-foldering) is the launch-quality risk the spec
names — surfaced early by the smoke test; consent posture — gated by §6.3;
volume runaway — bounded by per-lead caps + send-once + the daily engine-level
ceiling (a global sends-per-day guard, cloned from IRE's `dailyCap` concept,
belongs in the Phase 1 laws and is verified here under real traffic).

**Acceptance criteria:** pilot's webinar confirmation delivers to real leads'
inboxes (not spam) with working unsubscribe; activity log matches reality
(sends + skips reconciled against Resend's dashboard for the pilot window);
zero regressions in platform email during the window; kill drill executed with
documented time-to-silent.

**Rollback:** three independent levers, fastest first: remove agency from
allowlist; `AUTOMATIONS_SEND_MODE=log`; disable the cron. All are env-level,
no deploy.

**Definition of Done:**

- Deliverability smoke test documented per major Hebrew-market inbox provider
  (inbox vs spam placement).
- Kill drill executed before go-live with recorded time-to-silent.
- Pilot window closed with the activity log reconciled against the Resend
  dashboard; discrepancies explained or fixed.
- §6.2 and §6.3 sign-offs on file (ADR-002, ADR-006 flipped to _Accepted_).
- A written go/no-go review for expanding beyond the pilot agency.

---

## 4. Safest implementation order — summary and rationale

```
0 gates+transport → 1 pure core → 2 storage (gated) → 3 emission (dark)
→ 4 worker (log-only) → 5 unsubscribe → 6 UI (log-mode) → 7 pilot (live)
```

- **Inside-out:** pure logic before storage before wiring before UI. Every
  phase lands on `main` with zero behavior change (flags off / log mode),
  keeping the release cadence normal and diffs reviewable.
- **Protected files are touched exactly once** (Phase 3), with the smallest
  possible additive diffs, per-call-site commits, and an instant env rollback.
- **No live send is reachable** until suppression (5), UI review (6), and the
  §6 gates are all closed — enforced by the mode flag defaulting to `log`.
- **The pilot is the observation mode:** the spec's trust bridge maps to the
  log-mode window (Phases 4–6) reviewed with the customer before `live`.

## 5. Technical debt to address BEFORE implementation

1. **DB test harness — DECIDED (Phase 0).** DB-backed integration tests fail
   repo-wide (Prisma-era base tables vs `knex migrate` mismatch). **Decision:**
   the engine adopts the `.toSQL()` pattern
   (`__tests__/today/facts.sql.test.ts` is the model) for query-shape coverage
   plus injected-deps unit tests for worker logic (the
   `dispatchAutomationEmail` style) — the harness fix is tracked as its own
   chore and is NOT a blocker for Phases 1–6. The one place a live DB remains
   mandatory is Phase 2's migration-apply verification (`npm run
test:db:create` + migrate on a fresh DB), which does not depend on the
   broken harness. The engine's spec quality bar is never lowered to fit the
   harness.
2. **`insertLeadSystem` error-swallowing (accepted, documented).** The webhook
   insert path returns `null` on failure and is non-transactional. Fixing it
   is out of scope (protected area, high blast radius); the engine adapts via
   post-insert emission with swallow-and-log. Documented here so nobody
   "improves" it mid-implementation.
3. **Status writes lack a single choke point (accepted for V1).** Two writers
   (`updateLead`, `logLeadOutcome`) each get an emission call. Consolidating
   status writes into one helper is the correct long-term refactor but touches
   protected actions for no V1 gain — deferred, tracked.
4. **`importLeadsFromCsv` → `upsertLead` coupling (must be neutralized in
   design, Phase 1/3).** Origin must be an explicit call-site parameter.
   This is debt converted into a design requirement plus a permanent
   regression test.
5. **Platform naming collision (minimal fix now).** Spec §0's rename of
   `lib/emailAutomations` → platform naming is deferred; the boundary comment
   - import guard (Phase 0) is the minimum that prevents accidental coupling
     during this build. The rename is its own later chore.
6. **Stale local branch.** Not code debt but process debt: all work from a
   clean `origin/main` worktree (header note).

## 6. Irreversible decisions — validate BEFORE coding

Each of these is expensive or impossible to reverse once real data or real
emails exist. All must be closed in Phase 0.

**Each decision has an Architecture Decision Record in [`docs/adr/`](./adr/);
the ADR statuses are authoritative.** Mapping: §6.1 → ADR-004 (origin
taxonomy, manual sub-decision), §6.2 → ADR-002 (sender identity), §6.3 →
ADR-008 (definition storage & versioning), §6.4 → ADR-005 (send-once), §6.5 →
ADR-003 (unsubscribe), §6.6 → ADR-006 (consent), §6.7 → ADR-007 (event-date
anchor), §6.8 → ADR-001 (the engine itself).

1. **Manual-creation trigger semantics (spec micro-decision).** Does
   `upsertLead` (manual add) fire `lead_created`? Recommendation: yes, as its
   own origin, so the welcome recipe works for manually added leads — but it
   must be decided before the origin taxonomy freezes in Phase 1.
2. **Customer sending identity (spec §12.2).** The subdomain choice, DKIM
   setup, and display-name format are semi-permanent (sender reputation
   accrues to the domain; changing it later resets deliverability). Requires
   the infra owner. **Blocks Phase 4's live branch and Phase 7.**
3. **Storage shapes (spec-adjacent, `do-not-touch` gate).** Definition
   versioning strategy (stored automations must survive future engine
   versions — the closed trigger/action enums are persisted data from day
   one), send-once key structure, and activity-log grain. Wrong choices here
   are data migrations later. Closed inside the Phase 2 migration plan
   approval.
4. **Send-once semantics (spec §12.6).** Once-per-lead-ever vs
   per-status-entry is baked into dedup keys retroactively — recorded sends
   under one semantic cannot be reinterpreted under another.
5. **Unsubscribe token format (Phase 1).** Tokens ship inside emails and live
   in inboxes forever; the verifier must honor every token ever sent. The
   (business, lead) HMAC scheme and its secret rotation story are frozen at
   first live send.
6. **Consent stance / Israeli spam law (spec §12.3).** Product/legal, in
   writing, before Phase 7. Determines whether imported leads are ever
   eligible and what the feature's terms say.
7. **Event-date anchor in/out of V1 (spec §12.1).** Changes the definition
   model and the timing laws (Phase 1) and the creation sheet (Phase 6).
   Cheap to include now, disruptive to retrofit.
8. **Laws live in the engine, not in actions (spec: engine section).**
   Send-once, caps, suppression, and origin exclusion are enforced in the
   worker's pipeline — never delegated to individual actions — so every
   future action (WhatsApp, SMS) inherits them. This is an architecture
   commitment reviewers must hold in every engine PR.

## 7. Standing constraints for every phase

- Validation pipeline green before any merge: `npx tsc --noEmit`,
  `npm run test:a11y`, `npm run test:integration` (release-workflow §2).
- Scope verification against `origin/main` before every deploy
  (release-workflow §3).
- Hebrew product copy per spec; no emoji; terminology `לידים`/`נציג`.
- File-size limits and single-responsibility per `architecture-rules.md`
  (soft 250 / hard 350) — the component inventory in Phase 6 is sized for
  this.
- No modification to auth, permissions, `transferSales`, or any existing
  table (do-not-touch).
- Commits per task with surgical revertability; protected-file changes
  isolated one call site per commit (Phase 3).

---

_Next step after this plan: close the §6 gates, then execute Phase 0. Each
phase should be run as its own reviewed increment (subagent-per-task or
inline batch execution) — chosen when implementation is green-lit._

---

## Revision log

- **Round 4 (pre-Phase-6 design review, 2026-08-02):** ADR-013 (customer email
  identity model) accepted; ADR-003 amended after an objective re-review of
  the unsubscribe flow — **GET no longer mutates**, because corporate link
  scanners (Defender Safe Links, Proofpoint, Mimecast) fetch emailed links
  unattended and would silently, permanently suppress leads who never
  clicked. Phase 5's route becomes GET-confirm → POST-suppress at the cost of
  one click; the emailed URL is unchanged. RFC 8058 `List-Unsubscribe` headers
  evaluated and deferred to Phase 7 deliverability.

- **Round 3 (decision ratification, 2026-08-02):** ADR-004 (origin taxonomy +
  manual fires `lead_created`), ADR-005 (once per lead per automation), and
  ADR-007 (event-date anchor **excluded** from V1 — delay-based timing only)
  accepted by product; ADR-006 deliberately held Proposed with a blocking note
  (no production rollout without written product + legal approval). Plan
  synced: §1.1 manual row resolved; Phase 1 timing scope narrowed to delay
  presets; V1 recipe catalog is four starters (the pre-event reminder is held
  back with the anchor).

- **Round 2 (pre-implementation review, 2026-08-02):** added a Definition of
  Done to every phase; closed the delivery-events gap (Phase 5 now owns the
  Resend event webhook with shared-account partitioning — the plan previously
  had no source for delivery state, bounce suppression, or honest failure
  counts); added the engine daily ceiling, quiet-hours, bounce, and
  anchor-passed laws to Phase 1 (resolving an inconsistency with Phase 7);
  made Phase 6's dependency on §6.2 explicit (test-send is a live send);
  recorded the test-harness decision in §5.1; cross-referenced every §6
  decision to its ADR in `docs/adr/`.
