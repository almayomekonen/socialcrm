# Notification P1 — pre-implementation test baseline

**Recorded:** 2026-08-11, on `feature/notification-infrastructure` at spec commit `7738e5af`,
**before** the first line of notification implementation code.

Required by `docs/notification-infrastructure-spec.md` §22.5: `test:integration` cannot pass
for a pre-existing reason, so "green" is defined as *the known-failure set does not grow*.
That comparison is only possible against a recorded baseline. This is that record.

---

## Baseline results

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **clean**, exit 0, no output |
| Accessibility | `npm run test:a11y` | **17 files passed, 126 tests passed** |
| Unit | `npm run test:unit` | **60 passed / 1 skipped (61 files); 629 passed / 12 skipped** |
| Runtime | `npm run test:runtime` | **10 files passed, 55 tests passed** |
| Integration | `npm run test:integration` | **305 of 305 files FAILED; "Tests: no tests"** |

Three of the five gates are fully green and must stay that way. The integration suite is the
known failure.

### A second pre-existing failure, found while working

`test:catalog` (`__tests__/automations`, not one of the five required gates) fails
**2 files / 13 tests** — `2 failed | 50 passed (52)`, `13 failed | 942 passed (955)`:

- `__tests__/automations/actionIndependence.test.ts` — 11 tests fail with
  `TypeError: deps.isOptedOut is not a function`. The test's mock `WorkerDeps` has drifted
  from what `lib/automations/worker.ts` now reads.
- `__tests__/automations/templates.test.tsx` — 2 tests fail. Both scan files for the word
  "template": six fixed automation engine/store files, and `components/settings/automations/`.

Verified pre-existing, not merely assumed: with all notification wiring stashed, the counts
are identical (2 files / 13 tests). Neither test reads any file the notification work touches.
Recorded here so it is not mistaken later for notification fallout.

## The integration failure, root cause verified

Every one of the 305 files fails in `__tests__/setup.ts`, before a single test executes
("Tests  no tests"). The reported errors are all the same collision:

```
error: create table "knex_migrations_lock" … duplicate key value violates unique constraint
MigrationLocked: Migration table is already locked          (__tests__/setup.ts:72)
error: select max("batch") … relation "knex_migrations" does not exist
error: DROP SCHEMA IF EXISTS public CASCADE - deadlock detected
```

`__tests__/setup.ts` runs `DROP SCHEMA public CASCADE` → `CREATE SCHEMA public` →
`migrate.latest()` per test file, so parallel files fight over one database and deadlock on
the migration lock.

**Underneath that, the cause named in spec §22.4 was independently confirmed.** Running
`migrate.latest()` once, sequentially, on a clean schema still fails:

```
migration file "20260323000001_clients_lead_source_unique.cjs" failed
CREATE UNIQUE INDEX clients_lead_source_unique ON clients ("leadSource") …
  - relation "clients" does not exist
```

Base tables (`clients`, `users`, `users_info`) are Prisma-era and are **not** created by any
knex migration, so knex alone cannot construct a complete schema. No notification work can
fix this, and no notification work should try.

## Consequences accepted for P1

1. **Notification tests must be DB-free.** They run under `VITEST_NO_DB=1`, following the
   existing `test:catalog` / `test:support` convention, and are exposed as
   `npm run test:notifications`. Note `test:unit` is scoped to `__tests__/ai` in this repo,
   so it is not the right home.
2. **Migration validity is proved directly**, not through the broken harness: the six
   migrations were applied to an isolated scratch schema, re-run for idempotency, and rolled
   back in reverse dependency order. They have no FK to any base table, which is what makes
   that isolation possible.
3. **The comparison rule.** After each notification commit, `test:integration` must still
   fail with exactly this signature — 305 files, zero tests, setup/migration-lock errors. A
   different count or a different cause is a blocking condition, not a known failure.
   The file count rises as notification test files are added; the *cause* must not change.
