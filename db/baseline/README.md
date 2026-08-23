# Schema baseline

The starting point the knex migration chain runs from.

## Why this exists

This repository's knex chain cannot build a database from zero, and was never
designed to. It was retrofitted in 2026-03 onto a database that already existed:
first built by Prisma (2024-07 → 2025-01), then hand-edited for ~14 months with
no migration system at all. **21 of the 25 tables the application queries** —
`clients`, `agencies`, `tasks`, `user_perms`, the `_sales`/`_teams` views and the
rest — are created by nothing in this repository.

So `knex migrate:latest` on an empty database dies on its first real migration:

```
CREATE UNIQUE INDEX clients_lead_source_unique ON clients ("leadSource") …
  → relation "clients" does not exist
```

That is why DB-backed tests could not run, and why a SQL-level defect (the
`conversation_ai_state` CHECK constraint that omitted `'closed'`) survived ~40
test assertions and reached review unexercised.

Full history: `claude/research/engineering/migration-chain-drift-decision.md`.

## What these files are

| File | Contents |
| --- | --- |
| `schema-baseline.sql` | `pg_dump --schema-only` of the development database. Tables, views, enums, sequences, generated columns, indexes, constraints, defaults, trigger functions. **No data.** |
| `baseline.json` | Provenance, plus `stampedMigrations` — the migrations the baseline already contains |

## What this is NOT

**Not migration history, and it has no authority over it.** It is a snapshot of
where the chain starts. Everything after it belongs to knex, in `migrations/`,
forever. Never fold an ordinary schema change into the baseline: write a
migration, exactly as before.

## How it is used

`scripts/bootstrap-schema.cjs` loads the SQL and stamps `stampedMigrations` into
`knex_migrations` as batch 1, so `migrate:latest` applies only what came after —
against a real schema. Runs automatically in `__tests__/globalSetup.ts`.

```
DROP SCHEMA public CASCADE; CREATE SCHEMA public;   ← empty database
node scripts/bootstrap-schema.cjs                    ← baseline + stamp
npm run migrate                                      ← everything after it
```

## Regenerating

Only when the manually-owned base schema changes — which should be rare, and
ideally never again now that knex owns everything forward.

```
node scripts/regenerate-baseline.cjs [--url <postgres-url>] [--pg-dump <path>]
```

**Always machine-generated, never hand-written.** A hand-written baseline is a
guess, and the details a human skips — generated columns, sequence ownership,
enum member order, partial-index predicates, view bodies — are exactly the ones
that decide whether a migration behaves the same in CI as in production.

The regenerator refuses if the dump contains data statements, or if the source
database has migrations recorded that are not on disk (knex will not run in that
state).

### After regenerating

Confirm a fresh database still builds:

```
createdb socialcrm_baseline_check
node scripts/bootstrap-schema.cjs --url postgres://…/socialcrm_baseline_check
DATABASE_URL=postgres://…/socialcrm_baseline_check npm run migrate
dropdb socialcrm_baseline_check
```

CI does this on every PR that touches `migrations/` or `db/baseline/`.

## Safety

`scripts/bootstrap-schema.cjs` creates 91 tables. It refuses unless **all** hold:

1. the URL matches no hosted-provider pattern (`neon.tech`, `rds.amazonaws.com`, `production`, …);
2. the host is local, unless `BOOTSTRAP_ALLOW_REMOTE=1`;
3. the database name contains `test`, unless `BOOTSTRAP_CONFIRM_DB` names it exactly;
4. **the target contains zero tables** — the rule that actually protects data.

Every refusal states which rule failed and what to do about it.
