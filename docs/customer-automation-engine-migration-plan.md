# customer-automation-engine-migration-plan.md — Storage & Migration Gate (Phase 2)

**Status:** approval document. This is the migration planning gate required by
`do-not-touch.md` §2 and the implementation plan's Phase 2 before ANY schema
work. It contains no SQL, no Prisma, no migration code — it defines the
database evolution strategy those artifacts must satisfy. Approval of this
document (flipping ADR-008 to Accepted) is what unlocks writing the migration.

**Inputs:** the product spec (`email-automations-plan.md`, esp. §0/§8/§9), the
implementation plan Phase 2, ADR-001/003/004/005/007/008, and the Phase 1 code
(`lib/automations/` — whose types are the vocabulary these stores persist).

**Repo conventions this plan binds itself to (verified on `origin/main`):**
knex `.cjs` migrations, timestamped serially; idempotent guards
(`hasTable`/`hasColumn`/`IF NOT EXISTS`); doc-comment headers stating intent;
deliberate partial indexes; down-migrations present (`migrate:rollback`);
prod migration via `db:migrate:prod` — schema changes and Vercel deploys are
**independent operations**, so compatibility across that gap is mandatory.

---

## 1. Storage philosophy

### 1.0 The refinement this review produced: four stores become six

The implementation plan named four conceptual stores (definitions, jobs,
activity log, suppression). Working the lifecycles through Phase 1's actual
laws splits two of them:

- **Send-once claims split out of the activity log.** The log is append-heavy
  narrative; the claim is a tiny permanent uniqueness fact with
  claim-before-send semantics (`claim → send → mark/release`). Fusing them
  would make once-ever enforcement depend on log retention and log-mode
  entries — both wrong (see §3.2). The platform codebase already made this
  exact split (`email_automation_sends` vs nothing-in-log), which is the
  precedent.
- **Consent suppression split from deliverability blocks.** An unsubscribe is
  a permanent, lead-scoped legal fact. A hard bounce is an address-scoped
  operational fact: if the business corrects the lead's email address, sends
  should resume — so the block must key on the **address value**, not the
  lead. Different keys, different lifecycles, different laws (`suppressed` vs
  `address_undeliverable`) → different stores.

### 1.1 The six stores

All names carry the engine prefix (`automation_*` — spec §0 prefix
discipline); every row is tenant-scoped by `agencyId` (codebase convention).

| Store | Why it exists | Mutability | Lifecycle | Retention |
| --- | --- | --- | --- | --- |
| **automation_definitions** | The user's automations — user DATA, not code (ADR-001). One row = one adopted single-rule automation. | Mutable (edited in place; spec §8) | draft → active ⇄ paused → soft-deleted | Forever (soft delete; history references it) |
| **automation_jobs** | Execution queue: one row per trigger occurrence that passed the emission gates; carries `notBefore` for delays. | Mutable (status machine) | pending → processing → done / skipped / failed → dead | Terminal rows pruned after an operational window (§4.4) — the log is the record, the queue is plumbing |
| **automation_send_claims** | The once-per-lead-per-automation memory (ADR-005). Claim-before-send idempotency. | Insert-once (+ release on send failure) | claimed → confirmed; released rows deleted | Forever — this IS "ever" |
| **automation_activity** | The user-facing truth: every send, would-send, skip, and failure, with snapshot content (ADR-008 rule 3). | Append-only content; ONE monotonic delivery-state field updated in place (the `inbox_messages` ladder precedent) | append → delivery-state ladder → terminal | No pruning in V1 (§4.3); revisit with data |
| **automation_lead_suppressions** | Consent: the lead unsubscribed from this business's automated email (ADR-003). | Insert-only | permanent | Forever (legal) |
| **automation_email_blocks** | Deliverability: this address hard-bounced for this business. | Insert-only | permanent (a corrected lead address simply no longer matches) | Forever (small) |

### 1.2 Ownership boundaries

- All six stores are owned exclusively by the Customer Automation Engine
  (`db/automations/` modules). No platform-email code reads or writes them;
  no engine code reads or writes `email_automation_sends`,
  `email_suppressions`, or any platform store (spec §0; enforced by the
  boundary guard).
- **No existing table is modified. Zero.** No columns on `clients`, no
  changes to `agencies` — the undeliverable mark lives in
  `automation_email_blocks` precisely so `clients` stays untouched
  (`do-not-touch.md` §2).
- The stores reference leads and agencies **by id, without cascading
  foreign keys** (§3.3).

### 1.3 Lifecycle notes that drive the model

- A definition is never hard-deleted: the activity log and claims reference
  `automationId` forever, and the spec promises "ההיסטוריה תישמר." Delete is
  a status.
- A job is disposable; an activity row is not. Anything the user might ever
  ask "what happened?" about must be answerable from `automation_activity`
  alone, with jobs long pruned.
- Claims are consumed by **evaluation**, not by transport: a `would_send` in
  log mode consumes the lead's once-ever allowance exactly as a live send
  does (§3.2 — flagged for explicit approval).

---

## 2. Migration strategy

### 2.1 Exact order and dependency graph

**One additive migration file, creating all six stores.**

Dependency graph (conceptual, engine-internal):

```
automation_definitions ──┬─→ automation_jobs
                         ├─→ automation_send_claims
                         └─→ automation_activity
automation_lead_suppressions   (independent)
automation_email_blocks        (independent)
```

Within the single file, creation order follows the graph (definitions first).
Why one file and not six: the stores ship as one unit with no readers until
the same release's code (behind kill switches); partial creation has no
deployable value; and one file gives one atomic knex bookkeeping entry and
one rollback surface. Granular files would buy finer rollback of things that
can only be used together.

### 2.2 Forward-only considerations

- **Pre-live (Phases 2–6, log mode):** the migration keeps a real down-path
  (drop the six engine tables) per repo convention — data in them is test and
  observation data, and a full revert is legitimate.
- **From the first live send (Phase 7):** the engine flips to **forward-only
  policy**: claims, suppressions, and activity are then legal/behavioral
  memory; the down-migration is never run in production again. Rollback of
  behavior is flags (`kill`, `SEND_MODE=log`), never schema. This boundary is
  written into the migration's header comment.

### 2.3 Zero-downtime compatibility

- The migration is **pure CREATE** (tables + indexes on new, empty tables).
  It touches no existing table, takes no lock any running query can contend
  on, and rewrites nothing. It is safe to run under full production traffic.
- Deploy order: policy is migrate-then-deploy (via `db:migrate:prod`), but
  the design tolerates either order — engine code ships dark
  (`AUTOMATIONS_ENABLED` off), and the emission gate returns before any
  engine-table query, so code-before-migration cannot error in production.
- Every future engine schema change inherits this contract: additive,
  guard-wrapped, compatible with the previous app version running against
  the new schema during the deploy gap.

### 2.4 Rollback strategy (schema-level)

| Scenario | Response |
| --- | --- |
| Migration fails mid-apply | Guards (`hasTable`/`IF NOT EXISTS`) make re-run idempotent; fix and re-apply. knex records the migration only on success. |
| Applied, engine misbehaving, pre-live | Flags first (kill switch — instant). Schema revert via the down-path only if abandoning Phase 2 entirely. |
| Applied, post-live | Flags only. Tables are permanent (§2.2). |
| Wrong shape discovered later | New additive migration; never in-place mutation of engine tables under data. |

### 2.5 The test-harness reality (named, not hidden)

The repo's DB harness is broken (base tables Prisma-created; `migrate.latest()`
fails from scratch — implementation plan §5.1). The engine migration must be
verified two ways: (a) applies cleanly on the production-lineage chain (where
`knex_migrations` bookkeeping is already consistent — how every recent
migration shipped), and (b) its table shapes are exercised by `.toSQL()`
suites regardless of harness state. Verification step (a) against a
prod-lineage copy is a Phase 2 acceptance item; the harness fix remains a
separate tracked chore.

---

## 3. Data model decisions

### 3.1 Versioning strategy (ADR-008 rules made concrete)

- **Definitions are hybrid rows:** engine-queried facts as first-class
  columns (`agencyId`, lifecycle status, trigger type, target status, source
  filter, enabled/mode fields, lifecycle timestamps, `createdByUserId`);
  content the engine merely renders (subject, body, timing) as a structured
  JSON document carrying an explicit **`schemaVersion`**. Rationale: the
  worker filters and joins on the columns; content is an opaque render input
  whose shape will evolve (future channels) — JSON + version lets it evolve
  additively. This is a deliberate rejection of both extremes: all-columns
  (every content evolution becomes DDL) and all-JSON (engine queries against
  unindexable blobs).
- **Closed enums persist as text** (`trigger`, `origin`, `action`, skip
  reasons — the Phase 1 vocabularies). Append-only; renames are migrations;
  unknown value ⇒ the automation is held inert and surfaced דורש טיפול
  (ADR-008 rule 1).
- Activity rows record the `schemaVersion` and engine vocabulary values that
  were true at write time — never re-interpreted.

### 3.2 Immutable vs mutable — and the claim-consumption decision

- Immutable (insert-only): claims, suppressions, email blocks, activity
  **content**.
- Mutable: definitions (user edits), jobs (status machine), and exactly one
  field on activity rows — the delivery state, updated monotonically
  (sent → delivered/bounced/failed, never backwards), following the
  `inbox_messages` one-way-ladder precedent. A separate delivery-events
  table was considered and rejected: it doubles storage and read complexity
  to preserve a purity the ladder precedent already handles safely.
- **⚠️ Decision requiring explicit approval — claims are mode-agnostic:** a
  `would_send` (observation/log mode) consumes the same once-ever claim a
  live send would, recorded with which mode consumed it. Consequences: the
  observation log shows exactly what live behavior would be (no duplicate
  would-sends on status flaps), and flipping to live does NOT retroactively
  email leads already evaluated in log mode — which matches the spec's
  activation semantics ("fires only on events after activation"). The
  rejected alternative (claims only on live sends) makes observation mode
  dishonest and creates a late-blast risk at flip time. This defines what
  "ever" means; it is irreversible once observation data exists.

### 3.3 Referential integrity and deletion behavior

- **No cascading foreign keys from engine stores to `clients` or
  `agencies`.** A lead hard-delete must never destroy or mutate history
  (spec: the log outlives everything; the skip copy "הליד נמחק" presumes the
  log survives the lead). Leads are referenced by scoped id; **activity rows
  snapshot the lead's display name at write time** so history renders after
  lead deletion; the lead link resolves live and degrades gracefully.
- Engine-internal references (`jobs/claims/activity → definitions`) rely on
  the soft-delete guarantee (a referenced definition row always exists);
  restrictive FKs here are acceptable but optional — the invariant is
  enforced by the soft-delete policy, not by cascade behavior. No engine FK
  ever cascades a delete.

### 3.4 Soft delete policy

Exactly one store has soft delete: `automation_definitions` (deleted = a
lifecycle status; the card disappears, history remains, the key is never
reused). Everything else is either insert-only permanent or prunable
plumbing. There is no user-facing "delete history" operation in V1.

### 3.5 Audit strategy

`automation_activity` IS the audit surface (sends, would-sends, skips with
reasons, failures — the spec's trust feature). Definition lifecycle
transitions are audited lightly via timestamps + `createdByUserId` on the
definition row; a full lifecycle-event audit (who paused, when, from where)
is deliberately deferred — YAGNI until a real dispute needs it (listed as an
unresolved question with a recommendation of "not in V1").

---

## 4. Performance considerations

### 4.1 Expected read/write patterns

- **Writes are small and bounded by design:** bulk import — the one true
  spike source — never reaches the engine (ADR-004). Webhook-driven lead
  creation for SMBs is tens-to-hundreds of events/day/agency; the engine
  ceiling caps sends at 200/day/agency (Phase 1 law).
- **Hot reads:** the worker's claim query (due pending jobs — by status +
  `notBefore`); per-automation activity list (newest first); per-lead
  suppression/block/claim point-lookups; the two daily-cap counts (per lead
  per day, per agency per day).

### 4.2 Index strategy (conceptual only)

- Jobs: a **partial index on pending jobs by due time** (the
  `clients_agency_next_followup_idx` partial-index precedent) — the worker
  scans only the small live set, never terminal rows. Plus the dedup
  uniqueness the enqueue's conflict-ignore relies on (per definition + lead +
  occurrence identity).
- Claims: the unique key IS the table's purpose (definition + lead +
  semantics component per ADR-005) — one unique index, point lookups only.
- Activity: (automation, time) for the log view; (agency, lead, time) for
  the lead timeline; (agency, day) coverage for the agency cap count. The
  per-lead daily cap count uses (agency, lead, day) — served by the lead
  timeline index.
- Suppressions / blocks: single unique keys — (agency, lead) and
  (agency, normalized address) respectively.

### 4.3 Growth math (why no V1 pruning of activity)

Worst case is ceiling-bounded: 200 sends/day/agency ≈ 73k activity rows/
agency/year; skips add a comparable order. Even at 100 active agencies this
is single-digit millions of narrow rows per year — years of headroom for
indexed Postgres reads. Decision: **no activity retention window in V1**;
measure real growth and revisit with data (unresolved question §8.1 records
the recommendation). Designing retention now would be tuning against
imagined load.

### 4.4 Queue and claims growth

- Jobs: terminal rows (done/skipped/dead) pruned after an operational window
  — recommendation **90 days** — via the existing daily-cron pattern (the
  prune belongs to the Phase 4 drain cron, not a new scheduler).
- Claims: rows ≤ (adopted automations × leads); permanent by definition;
  negligible size.

---

## 5. Operational risks

| Risk | Assessment & mitigation |
| --- | --- |
| **Locking during migration** | Pure CREATE of new tables — no locks on existing relations, no rewrites, no downtime window needed. The riskiest thing this migration could do is something it structurally cannot do (it alters nothing). |
| **Migration safety / idempotency** | Repo-convention guards make re-runs safe; single file = single bookkeeping entry; verified against a prod-lineage chain before production (§2.5). |
| **Partial deployment (schema/code skew)** | Tolerated by design in both directions: dark code no-ops without tables; tables without code are inert. Kill switch is the contract, not deploy choreography. |
| **Rollback scenarios** | §2.4 table. The sharp edge is post-live schema rollback — prohibited by policy; behavior rollback is flags, which the plan already drills (Phase 7 kill drill). |
| **Failure recovery (worker crashes mid-send)** | A storage property, so named here: claim-before-send + lease-reclaim (the `auto_response_jobs` pattern) means a crash between claim and send leaves a claimed row and a leased job; recovery re-runs the job, sees the claim unconfirmed, and resolves per the Phase 4 worker contract — never a double send (idempotency over completeness, spec §9). |
| **Clock/timezone drift** | Day-bucketed counts (caps) must bucket in `BUSINESS_TZ`, consistent with Phase 1's laws — a query-shape requirement on the cap counts, pinned by `.toSQL()` tests. |

---

## 6. Architecture review — decisions challenged

Every storage decision above was attacked before being kept:

1. **"Fold claims into the activity log's unique index."** Rejected: ties
   legal/behavioral memory to log retention; breaks under mode-agnostic
   claim consumption; claim release-on-failure would mean deleting log rows
   (violating append-only). The split is the platform's own proven shape.
2. **"One suppression table with a `kind` column."** Rejected: consent is
   lead-keyed and permanent; deliverability is address-keyed and
   self-healing on address change. One table with two key shapes is two
   tables wearing one name.
3. **"All-JSONB definitions"** (maximum flexibility). Rejected: the worker
   must filter by trigger/status per event with index support; ADR-008
   already rejected freeform logic storage. **"All-columns"** rejected
   symmetrically (content evolution would be endless DDL). Hybrid wins.
4. **"Immutable versioned definition copies per edit."** Re-examined and
   re-rejected (ADR-008 alt 3): the spec's semantic is edits-apply-forward
   with render-at-send-time; the activity snapshot provides the audit;
   copies would add a version-chain for no user-visible behavior.
5. **"FK cascades for tidiness."** Rejected: cascade from `clients` destroys
   history the product promises to keep. Snapshot-plus-soft-reference is the
   design, matching the log-outlives-everything rule.
6. **"Event-source everything"** (definitions and lifecycle as event
   streams). Rejected as over-engineering: six small stores with plain rows
   are reviewable by a tired human at 6pm; the event-sourced version is not,
   and no requirement needs replay.
7. **"Reuse `email_suppressions` with a nullable `leadId`."** Forbidden
   outright by the §0 boundary — noted because it is the single most tempting
   shortcut in Phase 2, and it must not survive review if proposed.

No superior alternative model was found; the six-store shape stands as the
proposal.

---

## 7. Summary of architectural decisions

1. Six engine-owned stores (refined from the plan's four): definitions,
   jobs, send-claims, activity, lead-suppressions, email-blocks — all
   `automation_*`, all agency-scoped, zero existing-table changes.
2. One additive, guard-wrapped, zero-downtime migration; down-path valid
   only pre-live; forward-only from first live send.
3. Hybrid definition rows: queried facts as columns, rendered content as
   versioned JSON; closed enums as append-only text; unknown ⇒ inert.
4. Claims are separate, permanent, and **mode-agnostic** (would_send
   consumes the once-ever allowance).
5. Activity is append-only with one monotonic delivery-state ladder and
   lead-name snapshots; no cascading FKs anywhere; definitions soft-delete
   only.
6. No V1 activity retention; 90-day terminal-job pruning via the Phase 4
   cron; caps bucketed in `BUSINESS_TZ`.

## 8. Unresolved questions

1. **Activity retention** — recommendation: none in V1, revisit with real
   growth data. Needs a yes to "unbounded until revisited."
2. **Terminal-job prune window** — recommendation: 90 days. Any value
   30–180 is operationally fine.
3. **Definition lifecycle audit events** (who paused/edited, beyond
   timestamps) — recommendation: not in V1.
4. **Address-block clearing** — no mechanism in V1 (a corrected address
   simply doesn't match the block). Confirm no admin "unblock" tool is
   expected at launch.
5. **Prod-lineage verification environment** for §2.5(a) — who provides the
   prod-copy DB to verify the migration chain against (infra owner).

## 9. Irreversible storage decisions requiring explicit approval

- **The six-store shape and their names** — persisted vocabulary from day
  one; renames are migrations forever after.
- **Mode-agnostic claim consumption (§3.2)** — defines the meaning of "once
  ever" the moment observation mode runs; cannot be reinterpreted later.
- **Send-once key structure including the explicit semantics component**
  (ADR-005, already in Phase 1 code as `sendOnceKey`).
- **No-cascade + name-snapshot history policy** — once history exists, it
  can never be retroactively made dependent on live lead rows.
- **Hybrid definition model with content `schemaVersion`** — the version
  contract every future engine reads against.
- **Forward-only-after-first-live-send** — the policy boundary between
  schema rollback and flag rollback.

Approving this document flips **ADR-008 to Accepted** and authorizes writing
the Phase 2 migration and `db/automations/` modules against it.

---

*Stopped. No migration, schema, or code will be written until this document
is approved.*
