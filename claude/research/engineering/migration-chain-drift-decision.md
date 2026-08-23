---
domain: engineering
status: proposed
last_updated: 2026-08-23
related: [engineering/whatsapp-agent-human-presence-checkpoint.md, claude/do-not-touch.md, claude/release-deployment-workflow.md, claude/architecture-rules.md]
---

# Migration-Chain Drift — Decision Document (R1)

**Question:** why does `knex migrate:latest` fail with `relation "clients" does not
exist`, what actually owns the production schema, and what migration contract
should this repository have?

**Objective (restated):** not a green `migrate:latest`. A **reproducible schema
contract**, so a SQL-level defect cannot escape review again because the harness
is structurally disconnected from the real schema.

**Nothing was changed.** Read-only investigation: git history, migration sources,
config, and a local *test* database. **Production was never queried** — every
production claim below comes from a schema dump committed to this repo on
2025-08-05, from migration sources, or from git history, and is cited as such.

---

## 1. Current schema ownership model

Production schema is a **hybrid with a manually-owned base**. Three eras:

| Era | Dates | Owner | Evidence |
| --- | --- | --- | --- |
| **1. Prisma Migrate** | 2024-07-15 → 2025-01-15 | `prisma/migrations/*/migration.sql`, `prisma/schema/{base,sales}.prisma` | 40 migration dirs at the `init` commit. Created PascalCase insurance tables: `Agnt`, `AgntsGroup`, `Client`, `CmsnRules`, `DeletedSale`, `FavSales`, `FavoriteSales`, `Prem`, `Promo`, `Sale`, `SaleCalc`, `StickySales` + join tables |
| **2. Unmanaged (manual)** | 2025-01-15 → 2026-03-17 | **Nothing. Hand-applied SQL** | Prisma deleted in `dec17d67` ("אחרי שפריסמה נמחק לגמרי…"). ~14 months with no migration system. Tables were renamed PascalCase→snake_case (`Client`→`clients`, `Agnt`→`users`, `Sale`→`sales`) and restructured. `agencies` first appears 2025-09-01 (`b4737757` "agency part 1"). Commit `93bfcf45` (2025-08-05) carries `db/scripts/backup/{prod,dev}-schema.sql` and a 552-line `gemini_mig.ts` — the manual migration apparatus, since deleted |
| **3. Knex patch stream** | 2026-03-17 → today | `migrations/*.cjs` (86 files), `knexfile.cjs`, `knex_migrations` | Retrofitted onto the era-2 database. **Never able to build a database from zero — and was never designed to** |

Plus a **fourth, dead runner**: `scripts/migrate.cjs` + `db/migrations/*.sql`
(2 files, tracking table `_migrations`). Both its tables (`facebook_pages`,
`whatsapp_connections`) `REFERENCES users(id)`, so even it assumes the era-2 base.

### Ownership, counted

Cross-referencing the code's own table registry (`types/db/knex.d.ts`, 25 entries)
against what each migration system creates:

| Owner | Tables |
| --- | --- |
| **Knex chain** | `users` *(stub only — see §2)*, `analytics_events`, `email_automation_sends`, `email_suppressions` |
| **`db/migrations/*.sql`** | `facebook_pages`, `whatsapp_connections` *(neither is in the registry)* |
| **Assumed, never created — 21 of 25** | `agencies`, `clients`, `clients_info`, `teams`, `sales`, `cmsn_rules`, `deleted_sales`, `promo`, `client_lists`, `contracts`, `contract_prdcts`, `task_tmplts`, `tasks`, `sale_users`, `default_settings`, `user_perms`, `user_teams`, and the views `_flat_sales`, `_teams`, `_sales`, `_trial_status` |

The knex chain creates 67 *feature* tables (inbox, billing, automations,
notifications, AI runtime…) — all of which hang off a base it does not own.

**Verdict: production is era-2 manual base + era-3 knex patches.** Neither
Prisma nor Knex is a complete authority today.

---

## 2. Exact reason the chain assumes `clients`

Ordering is the whole story:

```
20240101000000_create_users.cjs              ← backdated to sort first; added 2026-03-17
20260323000001_clients_lead_source_unique.cjs ← FIRST REAL MIGRATION. Fails here.
```

`20260323000001` executes:

```sql
CREATE UNIQUE INDEX clients_lead_source_unique ON clients ("leadSource") WHERE "leadSource" IS NOT NULL
```

`clients` is never created by anything in this repository. It was created by
Prisma as `Client` (era 1) and renamed to `clients` by hand (era 2). The knex
chain's first substantive act is to **index a table it inherited**.

Confirmed empirically against the local test database after a failed run:

```
tables:              knex_migrations, knex_migrations_lock, users
applied migrations:  20240101000000_create_users.cjs
```

Exactly one migration applied, then the chain dies.

### The `users` stub is a second, quieter defect

`20240101000000_create_users.cjs` makes the chain *look* self-bootstrapping. It
is not. It creates:

```
id, email, name, created_at, updated_at
```

The real production `users` (from the committed 2025-08-05 dump) has **25
columns** — `firstName`, `lastName`, `role public."Role"`, `gglSub`, `gavePerm`,
`gotPerm`, `tblPref`, `savedFilters`, `otp`, a `GENERATED ALWAYS AS` name column,
and `DEFAULT nextval('public.users_seq')` rather than `increments`.

**So even if the chain completed, the resulting database would not run the
application.** Different column names (`created_at` vs `createdAt`), no
`agencyId`, no role enum, no sequence. This is the most misleading artifact in
the repository: it converts "this chain does not bootstrap" into "this chain
bootstraps wrongly."

---

## 3. Intentional or broken?

**Both, at different layers — and the distinction matters for the fix.**

**Intentional:** the chain was deliberately retrofitted onto a live database.
The accommodations are explicit and deliberate, not accidents:

- `20260328000001_create_whatsapp_connections.cjs` opens with
  `hasTable('whatsapp_connections')` → `if (exists) return` — written *because*
  `db/migrations/whatsapp_connections.sql` may already have created it.
- 15 of 86 migrations carry `hasTable`/`hasColumn` guards.
- `20260325000001_drop_insurance_tables.cjs` was **emptied to a no-op** (`up` and
  `down` both `{}`) — a chain repair by neutering, after it presumably failed on
  tables that were no longer there.
- `20260323000003_facebook_pages_health.cjs` `ALTER`s `facebook_pages`, a table
  only the *other* runner creates. The two systems are interdependent.

**Broken:** three things are defects, not design.

1. **No baseline exists.** A retrofitted chain is legitimate *only if* the base
   it assumes is captured somewhere reproducible. It is not — the only snapshot
   this repo ever had (`db/scripts/backup/prod-schema.sql`) was deleted.
2. **The `users` stub actively lies** about bootstrap capability (§2).
3. **Nothing enforces the contract.** No deploy step, no CI check, no test that
   the chain applies. `vercel.json` has no build override; `build` is plain
   `next build`; `prebuild`/`postinstall` only copy a PDF worker. **No migration
   runs on deploy** — every migration is applied by hand, unverified.

The consequence is the one already paid for: `conversation_ai_state`'s CHECK
constraint omitted `'closed'` for the entire life of the feature, survived ~40
test assertions (all of which mock the writer), and was invisible because no test
can reach real DDL.

---

## 4. Which system should be authoritative

**Knex — `migrations/*.cjs` + `knex_migrations`.** Not close:

- 86 migrations vs 2; the only chain under active development.
- `knexfile.cjs` is wired; `types/db/knex.d.ts` types the query builder against it;
  `__tests__/setup.ts` already calls `k.migrate.latest()`.
- Prisma's removal was deliberate and complete (`dec17d67`). Reintroducing it
  would mean re-adopting a tool for a schema it no longer describes.
- `scripts/migrate.cjs` is dead: its `_migrations` table does not exist even in
  the test database, and both its tables are already covered (one guarded in
  knex, one recoverable from a baseline).

The gap is not "wrong tool." It is that **Knex has no defined starting point.**

---

## 5. Risks of changing the migration chain

| # | Risk | Severity | Note |
| --- | --- | --- | --- |
| **RM1** | Editing an already-applied migration's `up()` | **Critical** | Environments that ran it will not re-run it → silent divergence. Historical migrations are immutable |
| **RM2** | Deleting a migration file recorded in `knex_migrations` | **Critical** | Knex 3 errors on a migration present in the DB but missing from the directory. Every environment breaks at once |
| **RM3** | A baseline that runs where the base already exists | **Critical** | `CREATE TABLE clients …` against production. Must be guarded on absence, and guarded again by a `NODE_ENV`/explicit-opt-in check |
| **RM4** | Baseline drifting from real production DDL | **High** | A hand-written baseline is a guess. It must be generated by `pg_dump`, never authored |
| **RM5** | Auto-migrating on Vercel build | **High** | Concurrent builds → concurrent migrations. `knex_migrations_lock` mitigates but does not make it safe. Not recommended |
| **RM6** | Retiring `db/migrations/` before `facebook_pages` is covered | Medium | `20260323000003` `ALTER`s it unguarded; a fresh DB without it fails |
| **RM7** | Touching `sale_users` / `sales` / `user_perms` while reconstructing | **Critical** | `do-not-touch.md`: transferSales and permissions. Read-only, always |
| **RM8** | Baseline capture leaking production data | High | Schema only. `--schema-only --no-owner --no-privileges`, never `--data` |

---

## 6. Remediation options, ranked

### ✅ Option A — Baseline from a production schema dump, absence-guarded *(recommended)*

Capture today's production schema with `pg_dump --schema-only`, commit it, and
have a first-position migration load it **only when the base is absent**. On
production and every existing environment it no-ops. On a fresh database it
produces a schema identical to production, after which the knex chain continues
normally.

*Why:* it is the standard retrofit pattern, obtainable today, zero production
risk, and it makes DB-backed tests runnable — which is the actual objective.
*Cost:* one `pg_dump` against production (read-only) and a committed ~2k-line SQL
file that must be regenerated whenever the manual base changes (rare, and
ideally never again).

### 🟡 Option B — Keep SQL-level assertions as the contract *(interim only)*

What exists today: assert on emitted SQL (`aiStateConstraint.test.ts`), split
query builders from executors so readers are testable (`db/today/facts.ts`).

*Why not sufficient:* it verifies statements in isolation, never their
interaction with a real schema. It is what we had when the `closed` defect
escaped. **Correct as a stopgap, wrong as the destination.**

### 🟠 Option C — Reconstruct the base as new CREATE TABLE migrations

Hand-author the 21 missing tables and 4 views into the chain.

*Why not:* the DDL would be a reconstruction of a schema shaped by 14 months of
manual edits — a guess, diverging from production in exactly the ways that matter
(generated columns, sequences, enums, view definitions). It also means writing
DDL for `sale_users`/`user_perms`, which `do-not-touch.md` protects. High effort,
high risk, worse fidelity than a dump.

### 🔴 Option D — Adopt a different tool (Prisma again, Atlas, sqitch)

*Why not:* churn against 86 working migrations; Prisma's removal was deliberate;
none of it addresses the actual gap, which is a missing baseline rather than a
missing tool.

---

## 7. What must NOT be changed

**Frozen by instruction:**
- Human Presence: `humanPresence.ts`, `agentSendGuard.ts`, `humanPresenceWatch.ts`,
  `db/conversationHumanPresence.ts`, `lib/inbox/humanTakeover.ts`,
  `modules/inbox/client/useComposerTypingSignal.ts`
- `migrations/20260823120000_conversation_ai_state_human_presence.cjs`
- `migrations/20260823130000_conversation_ai_state_allow_closed.cjs`
- `lib/inbox/autoresponse/qualifyWorker.ts`, `lib/inbox/autoresponse/worker.ts`

**Frozen by correctness:**
- Any migration's `up()`/`down()` that has been applied anywhere (RM1).
- Any migration **file** recorded in `knex_migrations` — never delete (RM2).
- Production base DDL for `users`, `clients`, `agencies` — the baseline records
  them, it does not redefine them.

**Frozen by `do-not-touch.md`:**
- `sale_users`, `sales`, `sales_tbl`, transferSales logic, `user_perms`,
  `user_teams`, auth. The baseline captures them verbatim from `pg_dump` and
  nothing else touches them.

**Explicitly not to reintroduce:** Prisma.

---

## 8. Implementation plan — Option A

Six steps. Steps 1–2 are prerequisites requiring a human with production access.
Nothing here is authorised by this document.

**Step 1 — Capture the baseline (human, read-only, one command).**
```
pg_dump "$PROD_DATABASE_URL" --schema-only --no-owner --no-privileges \
  --exclude-table=knex_migrations --exclude-table=knex_migrations_lock \
  --exclude-table=_migrations \
  > migrations/baseline/production-schema.sql
```
Schema only — never `--data` (RM8). Review the diff for anything sensitive before
committing.

**Step 2 — Reconcile the baseline against the chain.**
The dump already contains everything the 86 migrations produced, so a fresh
database must not replay them on top. Bootstrap therefore = load baseline, then
**stamp** every existing migration as applied (insert its filename into
`knex_migrations` at batch 1). Only migrations added *after* the baseline execute.
Record the stamp cutoff in the baseline file's header.

**Step 3 — Bootstrap entry point.**
A `scripts/bootstrap-schema.cjs` (a script, **not** a migration — a migration
cannot safely stamp its own siblings), which:
- refuses unless the target database is demonstrably empty (`to_regclass('clients') IS NULL`) **and** the URL passes the same `DANGEROUS`-pattern + `must contain "test"` guards `__tests__/setup.ts` already enforces;
- loads the baseline inside one transaction;
- stamps the migration list;
- then hands over to `knex migrate:latest`.

Production never runs it. Its only callers are the test harness and a developer
creating a local database.

**Step 4 — Wire the test harness.**
`__tests__/setup.ts` currently does `DROP SCHEMA` → `CREATE SCHEMA` →
`migrate.latest()`. Insert bootstrap between schema creation and `migrate.latest()`.
**This is the step that pays for everything else:** ~23 DB-backed test files start
running, and new migrations execute against a real schema in CI.

**Step 5 — Neutralize the `users` stub (do not delete — RM2).**
Guard `20240101000000_create_users.cjs`'s `up` with
`if (await knex.schema.hasTable('users')) return`, and add a header explaining it
is a historical artifact that must never define `users`. The file stays so
`knex_migrations` stays consistent.

**Step 6 — Retire the dead runner and write the contract down.**
Once the baseline covers `facebook_pages` and `whatsapp_connections` (it will —
they are in production): delete `scripts/migrate.cjs`, `db/migrations/`, and the
`db:migrate` / `db:migrate:prod` scripts. Then add to
`claude/release-deployment-workflow.md`:

- Knex is the sole authority; `migrations/` is append-only; applied migrations are
  immutable.
- Migrations are applied **manually, before deploy**, with the SHA recorded in the
  deployment report. Not on Vercel build (RM5).
- A CI job runs bootstrap + `migrate:latest` on a scratch database for every PR
  touching `migrations/`. **A migration that cannot apply from zero does not merge.**
- Any change to the manual base regenerates the baseline in the same PR.

### Ordering and independent value

Steps 1–4 are the fix; 5–6 are hygiene. Step 4 delivers the objective on its own:
once tests run against a real schema, a missing CHECK constraint fails CI instead
of reaching production. Steps 5–6 can follow separately.

### Success criterion

Not "`migrate:latest` is green." It is: **a migration that would fail against the
real schema fails in CI, on the PR that introduces it.** The `closed`-state defect
is the regression case — with this in place, `markClosed()` would have thrown in
CI the first time a close-lifecycle test ran.

---

## 9. Limitations of this investigation

- **Production was not queried.** No credentials were used and none should be.
  Every production claim derives from the 2025-08-05 dump committed in `93bfcf45`,
  from migration sources, or from git history, and is cited above.
- That dump is **~12 months stale** (13 tables; production has since gained
  `agencies` and the 67 knex-created feature tables). It establishes *ownership*,
  not the current shape. Step 1 exists precisely to obtain the current shape.
- Whether `20240101000000_create_users.cjs` is recorded in production's
  `knex_migrations` is **unverified**. It is recorded in the local test database.
  Step 5's guard-don't-delete approach is safe under either answer.
