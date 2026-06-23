# Recovery Engine — Production QA Plan & Release Sign-Off

**Feature:** Recovery Engine + Recovery Center
**Date:** 2026-06-23
**Status:** Ready for QA → sign-off
**Owner:** _________  **QA:** _________  **Sign-off:** _________

> **How to use this document.** Execute the suites in §3–§9 against a migrated
> staging env with `CRON_SECRET` set. Record pass/fail in §11. The automated
> chain in `scripts/e2e/recovery-engine.e2e.ts` covers the happy-path of every
> stage in one command — run it first, then work the manual edge cases here.
> Release requires the §10.1 gate (0 blocker fails). Companion artifacts:
> `docs/automation/recovery-alerts.n8n.json` (workflow), `scripts/e2e/recovery-engine.e2e.ts` (harness).

---

## 0. Scope & Components Under Test

| # | Component | Source of truth |
|---|---|---|
| 1 | Inbox / WhatsApp ingestion (denormalized conversation columns) | `db/inboxConversations.ts` (`bumpConversationOnInbound/Outbound`) |
| 2 | Recovery Engine detection (read-only sensor) | `services/automation/recoveryEngine.ts` |
| 3 | `GET /api/automation/recovery-leads` | `app/api/automation/recovery-leads/route.ts` |
| 4 | n8n workflow (Schedule → GET → Split → POST) | external (config in `docs/automation/`) |
| 5 | `POST /api/automation/create-recovery-alert` | `app/api/automation/create-recovery-alert/route.ts` + `db/recoveryAlerts.ts` |
| 6 | Recovery Center page | `app/(app)/recovery-alerts/page.tsx`, `components/recoveryAlerts/RecoveryAlertsTable.tsx` |
| 7 | Auto-resolve on outbound reply | `lib/inbox/persistOutboundWhatsapp.ts` → `resolveOpenRecoveryAlerts` |

### Implementation invariants the whole plan depends on

- **Detection predicate (engine + create-snapshot):** `inbox_conversations.state = 'open'` AND `lastDirection = 'inbound'` AND `lastInboundAt IS NOT NULL` AND lead `status NOT IN ('closed','lost')` (NULL status allowed).
- **Threshold is applied at DETECTION only** (`GET`, param `minutes`, default 30, clamped `[1,1440]`). **`POST` does NOT re-check the threshold** — it trusts the orchestrator's lead selection and creates an alert for any lead that is *currently waiting* regardless of elapsed minutes. This is by design; QA must test it explicitly (API-08).
- **Duplicate prevention is a DB partial unique index:** `recovery_alerts_one_open_per_lead = UNIQUE("leadId") WHERE status='open'`. One open alert per lead, race-proof.
- **Dedup & resolve are keyed by `leadId` (not conversationId).** A lead with multiple open WhatsApp conversations still yields **one** alert, and a reply on **any** of its conversations resolves it.
- **`waitingMinutes` is frozen at creation** (snapshot), not recomputed on page load.
- **Ownership is derived at read time** from `clients.userId` (so reassignment/transferSales moves alert visibility with the lead). Admins (`ADMIN`,`GM`) bypass; `MNGR`/`AGNT` are scoped by `getPerms().gotPermIds`.
- **Secret precedence:** `AUTOMATION_API_KEY ?? CRON_SECRET`. Accepted headers: `Authorization: Bearer <s>`, `x-automation-key: <s>`, `x-cron-secret: <s>`.
- **Channel:** only `'whatsapp'` exists today.

---

## 1. Test Environments

| Env | DB | Purpose |
|---|---|---|
| Local | dev DB (`.env.local`) | developer smoke + this plan's dry run |
| Staging | staging DB (migrated, isolated) | full matrix execution + sign-off |
| Production | prod DB | post-deploy smoke (read-only + 1 synthetic lead) |

**Pre-req:** migration `20260623000001_create_recovery_alerts` applied (`npx knex migrate:status`); `CRON_SECRET` set in the target env; n8n credential `SocialCRM Cron` points at the env's secret.

---

## 2. Test Data Setup (deterministic fixtures)

Create an isolated agency `QA_AGENCY` with users covering each role, and leads with controlled conversation state. Tear down after each suite.

| Fixture | Lead status | Conversation state | lastDirection | lastInboundAt | Expected in detection |
|---|---|---|---|---|---|
| `L_WAIT` | new | open | inbound | now − 60m | **YES** |
| `L_FRESH` | new | open | inbound | now − 5m | only if `minutes ≤ 5` |
| `L_REPLIED` | new | open | outbound | now − 60m | NO |
| `L_CLOSED` | closed | open | inbound | now − 60m | NO |
| `L_LOST` | lost | open | inbound | now − 60m | NO |
| `L_ARCHIVED` | new | archived | inbound | now − 60m | NO |
| `L_MULTI_MSG` | new | open | inbound (3 msgs) | now − 60m | YES (once) |
| `L_MULTI_CONV` | new | 2× open | inbound | now − 60m | appears per-conversation in GET; **one** alert |

> "Internal conversation" = a thread with no inbound customer message (`lastDirection` never `inbound`, e.g. business-initiated only). Modeled by `L_REPLIED`-style `lastDirection='outbound'`.

---

## 3. Detection Tests (Component 2 — `recoveryEngine.ts`)

Pass criterion: GET result set matches the "Expected" column exactly; no false positives, no false negatives.

| ID | Scenario | Precondition | Expected | P/F |
|---|---|---|---|---|
| DET-01 | Customer message, no reply, threshold exceeded | `L_WAIT`, `minutes=30` | lead present, `waitingMinutes ≈ 60` | |
| DET-02 | Threshold NOT exceeded | `L_FRESH`, `minutes=30` | lead **absent** | |
| DET-03 | Threshold boundary | `L_FRESH` waited 30m, `minutes=30` | absent at exactly 30m (`<` cutoff is strict), present at 31m | |
| DET-04 | Multiple customer messages, one conversation | `L_MULTI_MSG` | appears **once** | |
| DET-05 | Closed lead excluded | `L_CLOSED` | absent | |
| DET-06 | Lost lead excluded | `L_LOST` | absent | |
| DET-07 | Archived conversation excluded | `L_ARCHIVED` | absent | |
| DET-08 | Internal / no inbound excluded | `lastDirection='outbound'` | absent | |
| DET-09 | Already replied excluded | `L_REPLIED` | absent | |
| DET-10 | NULL lead status included | `L_WAIT` with `status=NULL` | present | |
| DET-11 | Result ordering | several waiting leads | ascending `lastInboundAt` (oldest first) | |
| DET-12 | Result cap | >500 waiting | exactly 500 rows returned (cap), oldest first | |
| DET-13 | Multiple conversations per lead | `L_MULTI_CONV` | GET returns 2 rows (same `leadId`); downstream dedups to 1 alert (see API-02) | |
| DET-14 | Tenancy filter | `agencyId` param set | only that agency's leads | |

---

## 4. API Tests

### 4.1 `GET /api/automation/recovery-leads` (Component 3)

| ID | Case | Request | Expected status | Expected body | P/F |
|---|---|---|---|---|---|
| API-G01 | Valid secret | header `x-cron-secret` correct | 200 | JSON array of `{leadId,leadName,conversationId,agencyId,waitingMinutes,lastCustomerMessage,lastCustomerMessageAt}` | |
| API-G02 | Missing secret | no auth header | 403 | `{"error":"Forbidden"}` | |
| API-G03 | Invalid secret | wrong value | 403 | `{"error":"Forbidden"}` | |
| API-G04 | Secret unset on server | env var removed | 500 | `{"error":"Server not configured"}` + server `console.error` | |
| API-G05 | Empty results | no waiting leads | 200 | `[]` | |
| API-G06 | Multiple results | N waiting | 200 | N items, oldest first | |
| API-G07 | Large result set | >500 waiting | 200 | 500 items (capped) | |
| API-G08 | `minutes` clamp | `?minutes=0` and `?minutes=99999` | 200 | treated as 1 and 1440 respectively | |
| API-G09 | `minutes` non-numeric | `?minutes=abc` | 200 | falls back to default 30 | |
| API-G10 | All three auth headers | Bearer / x-automation-key / x-cron-secret | 200 each | equivalent | |

### 4.2 `POST /api/automation/create-recovery-alert` (Component 5)

| ID | Case | Body | Expected status | Expected body | P/F |
|---|---|---|---|---|---|
| API-01 | Valid waiting lead | `{"leadId":<L_WAIT>}` | 201 | `{"created":true,"alertId":<n>}` | |
| API-02 | Duplicate (open exists) | same lead again | 200 | `{"created":false,"reason":"duplicate"}` | |
| API-03 | Non-waiting lead (exists, replied/closed) | `{"leadId":<L_REPLIED>}` | 200 | `{"created":false,"reason":"not_waiting"}` | |
| API-04 | Non-existent leadId | `{"leadId":999999999}` | 200 | `{"created":false,"reason":"not_waiting"}` (no FK error — no insert) | |
| API-05 | Invalid leadId type | `{"leadId":"abc"}` | 400 | `{"error":"leadId must be a positive integer"}` | |
| API-06 | leadId ≤ 0 | `{"leadId":0}` / `-5` | 400 | `{"error":"leadId must be a positive integer"}` | |
| API-07 | Missing leadId | `{}` | 400 | same as API-05 | |
| API-08 | Below-threshold but waiting | `{"leadId":<L_FRESH>}` (waited 5m) | 201 | `{"created":true,...}` — **POST ignores threshold by design** | |
| API-09 | Invalid JSON | `not-json` | 400 | `{"error":"Invalid JSON"}` | |
| API-10 | Unauthorized | no/!bad secret | 403 | `{"error":"Forbidden"}` | |
| API-11 | Secret unset on server | env removed | 500 | `{"error":"Server not configured"}` | |
| API-12 | Re-create after resolve | resolve L_WAIT's alert, POST again | 201 | new alert created (partial index frees on resolve) | |

---

## 5. n8n Workflow Tests (Component 4)

Pass criterion: workflow completes without aborting; every waiting lead gets exactly one POST; no run leaves the system inconsistent.

| ID | Scenario | Expected | P/F |
|---|---|---|---|
| N8N-01 | Scheduled execution | fires on cadence (10m); GET→Split→POST chain runs | |
| N8N-02 | Manual "Execute Workflow" | same as scheduled | |
| N8N-03 | Multiple waiting leads | one POST per lead; mix of 201/200 responses, all 2xx | |
| N8N-04 | Empty waiting list | GET `[]` → Split yields 0 items → 0 POSTs → run succeeds | |
| N8N-05 | Duplicate workflow executions (overlap) | second run's POSTs all return `200 duplicate`; no extra alerts | |
| N8N-06 | Network failure on GET | run fails fast; no POSTs; next schedule recovers (idempotent) | |
| N8N-07 | API timeout on POST | with `Continue On Fail` + `neverError`, that item logs and run continues | |
| N8N-08 | Partial failures (1 of N POST errors) | other leads still processed; failed lead retried next cycle | |
| N8N-09 | Wrong/expired credential | every POST 403; run visibly fails auth (alerting trigger) | |

---

## 6. Recovery Center Tests (Component 6)

| ID | Scenario | Role / setup | Expected | P/F |
|---|---|---|---|---|
| RC-01 | Admin view | `ADMIN`/`GM` | sees **all** agency open alerts (ownership bypass) | |
| RC-02 | Manager view | `MNGR` | sees alerts for leads in `getPerms().gotPermIds` (self + team) | |
| RC-03 | Agent view | `AGNT` | sees only own-lead alerts | |
| RC-04 | Ownership filtering | alert on a lead owned by another agent | hidden from non-owning agent; visible to admin | |
| RC-05 | Reassignment | reassign lead to agent B | alert visibility follows to B (derived at read) | |
| RC-06 | Open alerts | default page | only `status='open'` | |
| RC-07 | Resolved alerts | `{status:'resolved'}` query | resolved rows render with `טופל`; not on default page | |
| RC-08 | Sorting | mixed | open-first then `createdAt DESC` | |
| RC-09 | Columns | any alert | ליד, דקות המתנה, הודעה אחרונה מהליד, נוצר (formatDateTime), סטטוס | |
| RC-10 | Empty state | no open alerts | calm message "אין התראות פתוחות — הכול תחת שליטה" (no error, no blank table) | |
| RC-11 | Row action | click row | navigates to `/leads?clientId=<leadId>` | |
| RC-12 | Name fallback | lead missing first/last name | renders "ליד" | |
| RC-13 | Page cap | >100 open | 100 rows (page limit; clamp ≤500) | |
| RC-14 | OFFICE role | `OFFICE` | nav link hidden (`notOffice` gate); direct URL returns no unauthorized data leak | |

---

## 7. Auto-Resolve Tests (Component 7)

Pass criterion: a rep reply resolves the lead's open alert atomically; **no orphan open alerts** remain after a reply.

| ID | Scenario | Expected | P/F |
|---|---|---|---|
| AR-01 | Agent replies (single open alert) | alert → `resolved`, `resolvedAt` set, same txn as the reply | |
| AR-02 | Resolved alert removed from open list | disappears from `/recovery-alerts` default view | |
| AR-03 | Reply when no open alert | no-op, 0 rows updated, no error | |
| AR-04 | Multiple open alerts across leads | only the replied lead's alert resolves; others untouched | |
| AR-05 | Lead with multiple conversations | reply on **any** conversation resolves the lead's single alert | |
| AR-06 | Reply rolls back (txn failure) | alert stays `open` (atomicity — resolution never commits without the reply) | |
| AR-07 | Orphan sweep | after a batch of replies, `SELECT count(*) FROM recovery_alerts a JOIN inbox_conversations cv ON cv."leadId"=a."leadId" WHERE a.status='open' AND cv."lastDirection"='outbound'` → **0** | |

---

## 8. Concurrency Tests

Pass criterion: invariant "≤1 open alert per lead" holds; no deadlocks; consistent final state.

| ID | Scenario | Method | Expected | P/F |
|---|---|---|---|---|
| CON-01 | Two workflow runs simultaneously | trigger 2 overlapping n8n executions | exactly one alert per lead; losers get `200 duplicate` | |
| CON-02 | Two POSTs for same lead simultaneously | parallel curl ×2 | one `201`, one `200 duplicate`; one DB row (partial unique index resolves the race) | |
| CON-03 | Two agent replies simultaneously | parallel `persistOutboundWhatsapp` | both succeed; alert resolved once; second update affects 0 rows; no orphan | |
| CON-04 | POST + reply race | create and resolve interleaved | end state deterministic: either no open alert (reply won) or one open then resolved; never two open | |
| CON-05 | Index contention | N parallel POSTs distinct leads | all succeed; no deadlock; latency within SLO | |

---

## 9. Performance Tests

Measure p50/p95/p99. Use `EXPLAIN ANALYZE` for query plans.

| ID | Load | Metric | Target (SLO) | P/F |
|---|---|---|---|---|
| PERF-01 | 10 open alerts | Recovery Center TTFB | p95 < 400ms | |
| PERF-02 | 100 open alerts | page render + GET latency | page p95 < 600ms; GET p95 < 300ms | |
| PERF-03 | 1,000 open alerts | page (capped 100) + getRecoveryAlerts query | query p95 < 250ms (index `recovery_alerts_agency_status_created_idx`) | |
| PERF-04 | 10,000 waiting leads | GET detection query | p95 < 800ms; returns ≤500 capped | |
| PERF-05 | POST latency | single create | p95 < 150ms | |
| PERF-06 | n8n run, 100 leads | full workflow duration | < 60s (sequential POSTs) | |
| PERF-07 | n8n run, 1,000 leads | full workflow duration | < 10m, or enable POST concurrency/batching | |

**Known query-plan risk to confirm:** the detection query filters `state, lastDirection, lastInboundAt` and (platform-wide) without `agencyId`. There is **no composite index** on `(state, lastDirection, lastInboundAt)` today. At 10k+ conversations PERF-04 must verify the planner isn't doing a costly seq scan. If p95 misses target → propose a follow-up partial index in a **separate** migration (out of scope for this release; do not add schema here).

---

## 10. Production Readiness Checklist

### 10.1 Pass/Fail criteria (release gate)

- **BLOCKER (must pass 100%):** all Detection (DET-*), API auth (API-G02/03/04/10, API-10/11), dedup (API-02, CON-01/02), auto-resolve correctness + no-orphans (AR-01/02/07, CON-03), ownership isolation (RC-01..05, RC-14).
- **MAJOR (≤0 open defects):** n8n stability (N8N-04..08), empty state (RC-10), boundary/threshold (DET-03, API-08), performance SLOs PERF-01..05.
- **MINOR (tracked, non-blocking):** PERF-06/07 tuning, sorting/columns cosmetics.

Sign-off requires: 0 BLOCKER fails, 0 open MAJOR defects, all MINORs triaged with owners.

### 10.2 Expected outcomes summary

| Surface | Healthy signal |
|---|---|
| GET | 200 + array (or `[]`); 403 on bad secret; 500 only when env unset |
| POST | 201 created / 200 duplicate|not_waiting / 400 validation / 403 auth |
| Index | one open alert per lead at all times |
| Auto-resolve | 0 rows where alert open but conversation last reply outbound |
| Page | exactly one state shown; ownership respected |

### 10.3 Rollback plan

Feature is **additive and reversible**; rollback is graduated — pick the least-invasive level that stops the bleeding.

1. **Disable intake (fastest, no deploy):** turn off the n8n Schedule Trigger. New alerts stop immediately; existing data and pages remain functional. Auto-resolve keeps working.
2. **Hide the surface:** feature-flag/remove the nav link + route `/recovery-alerts` (UI-only revert). Backend untouched.
3. **Neutralize endpoints:** unset `CRON_SECRET`/`AUTOMATION_API_KEY` in the env → both automation routes fail closed with 500; or revert the route commits. No data loss.
4. **Full revert:** `git revert` the 5 feature commits (`69d85f9..d913fde`) — this removes the routes, page, auto-resolve hook, and shared auth. The auto-resolve line in `persistOutboundWhatsapp.ts` is reverted with it; the inbox send path returns to prior behavior.
5. **Schema rollback (last resort):** `npx knex migrate:rollback` drops `recovery_alerts` (the migration `down()` is clean: `DROP TABLE IF EXISTS`). **Data loss:** all alert history is discarded. Only do this if the table itself is implicated. Because the table is additive with FKs `ON DELETE CASCADE/SET NULL`, dropping it cannot corrupt `clients` or `inbox_conversations`.

Rollback verification after any level: `GET /recovery-leads` (engine read-only) still returns sane data; inbox send/receive unaffected; no 500s in app routes.

### 10.4 Monitoring recommendations

- **Endpoint health:** alert on `5xx rate > 0` for `/api/automation/*`; a spike in `500 Server not configured` means the secret was lost in deploy.
- **Auth anomalies:** alert on sustained `403` from the n8n source IP (expired/rotated credential).
- **n8n:** alert on workflow execution failure and on **execution-not-seen** within 2× the schedule interval (silent scheduler death).
- **Invariant monitor (canary query, every 15m):** count orphan open alerts (AR-07 query) → page if `> 0`.
- **Volume canary:** open-alert count trending to 0 with non-zero waiting leads ⇒ intake broken; open-alert count exploding ⇒ resolve broken. Track both.
- **Latency:** dashboard p95 for GET/POST and the page query against §9 SLOs.

### 10.5 Logging recommendations

Already emitted (keep): `console.error('[create-recovery-alert] failed', {leadId, reason})`, `console.error('[recovery-leads] ... not set')`. Recommended additions (non-blocking, can ship later):

- POST success line: `[create-recovery-alert] leadId=<id> result=created|duplicate|not_waiting ms=<n>` for funnel observability (mirrors the `[AUTH]` route logging style already in the codebase).
- Auto-resolve count: `[recovery] auto-resolved leadId=<id> alerts=<n>` inside the outbound path (only when `n>0`, to stay quiet).
- Correlation: include `agencyId` on each line for per-tenant triage.
- **Privacy:** do **not** log `lastCustomerMessage` contents; log lengths/ids only.

---

## 11. Execution Log & Sign-Off

| Suite | Total | Pass | Fail | Blockers | Notes |
|---|---|---|---|---|---|
| Detection | 14 | | | | |
| API GET | 10 | | | | |
| API POST | 12 | | | | |
| n8n | 9 | | | | |
| Recovery Center | 14 | | | | |
| Auto-Resolve | 7 | | | | |
| Concurrency | 5 | | | | |
| Performance | 7 | | | | |

**Release decision:** ☐ GO ☐ NO-GO  **Approver:** ___________ **Date:** _______

---

### Appendix A — Verified during build (2026-06-23, dev env)

These were executed against the running dev app and serve as the baseline expected values:

- POST: 403 (no secret) / 201 `{created:true}` / 200 `{duplicate}` / 200 `{not_waiting}` / 400 `{leadId must be...}` / 400 `{Invalid JSON}`.
- DB index: 2nd concurrent open insert `ignored`; resolve frees the constraint; re-insert succeeds.
- `getRecoveryAlerts(open)` returns the created alert (page data source).
- `persistOutboundWhatsapp` (real reply path) flips the alert to `resolved` and removes it from the open list; QA fixture restored.
</content>
