# TASK: Fix shared DB integration test harness (repo-wide)

**Type:** engineering / test infrastructure · **Priority:** high · **Status:** OPEN
**Raised:** 2026-07-20, during Today rewrite Phase 2.

## Problem
`__tests__/setup.ts` resets the test schema with `DROP SCHEMA public CASCADE` +
`knex migrate.latest()`, but the base tables (`clients`, `tasks`, `agencies`,
`users`, inbox tables, …) are **Prisma-created** — no knex migration builds them.
So a from-scratch migrate fails with `relation "clients" does not exist`, and
**every DB-backed integration test fails repo-wide** (confirmed against
`briefing-readers.test.ts` and `lead-isolation.test.ts`).

## Fix
Seed the Prisma-managed baseline schema into `socialcrm_test` **before** running
knex migrations in `__tests__/setup.ts` (e.g. `prisma migrate deploy` / `prisma db
push` against the test DB, then `knex migrate.latest()` for the knex-owned deltas).

## Definition of done
1. `npm run test:integration` runs DB-backed suites without `relation … does not exist`.
2. **Rerun the full Today Phase 2 integration suite against the real DB** and treat
   it as validation of the already-shipped `db/today/*` implementation (facts, scope,
   terminal exclusion, C-2 human-outbound derivation, bounds). Author real seeded
   integration tests per the Today Test Strategy §3 regression matrix (A–H).
3. Also unblocks `briefing-readers.test.ts` and other DB suites.

## Context / non-negotiables
- The Today Phase 2 gate is **conditionally satisfied** via SQL-level construction
  tests + hygiene guards (the repo's existing precedent, e.g. `briefing-scope.test.ts`)
  — a **temporary infrastructure exception, not a lowered quality bar** and not a
  change to the Today spec or test strategy.
- Do NOT weaken the Today Behavioral Specification / Invariants / Test Strategy to
  accommodate the harness. Fix the harness; then validate against the real DB.
