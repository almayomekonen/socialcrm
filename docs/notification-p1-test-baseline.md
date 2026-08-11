# Notification P1 — pre-implementation test baseline

**Recorded:** 2026-08-11, on `feature/notification-infrastructure` at spec commit `7738e5af`,
**before** the first line of notification implementation code.

Required by `docs/notification-infrastructure-spec.md` §22.5: `test:integration` cannot pass
for a pre-existing reason, so "green" is defined as _the known-failure set does not grow_.
That comparison is only possible against a recorded baseline. This is that record.

---

## Baseline results

| Gate          | Command                    | Result                                                        |
| ------------- | -------------------------- | ------------------------------------------------------------- |
| Typecheck     | `npx tsc --noEmit`         | **clean**, exit 0, no output                                  |
| Accessibility | `npm run test:a11y`        | **17 files passed, 126 tests passed**                         |
| Unit          | `npm run test:unit`        | **60 passed / 1 skipped (61 files); 629 passed / 12 skipped** |
| Runtime       | `npm run test:runtime`     | **10 files passed, 55 tests passed**                          |
| Integration   | `npm run test:integration` | **305 of 305 files FAILED; "Tests: no tests"**                |

Four of the five gates — typecheck, accessibility, unit and runtime — are fully green and must
stay that way. Integration is the one known failure.

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
("Tests no tests"). The reported errors are all the same collision:

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
3. **The comparison rule — the invariant is the signature, not the count.** The file count is
   expected to rise as notification test files are added, because every file under `__tests__/`
   is collected by this suite. A changed count is therefore not by itself a regression, and
   this document does not require it to stay at 305.

   What must hold after each notification commit is the failure _signature_:

   - the failure occurs in `__tests__/setup.ts`, before any test executes ("Tests: no tests");
   - the reported errors are knex migration lock / deadlock and missing `knex_migrations*`
     relations;
   - the underlying cause is still that Prisma-era base tables (`clients`, `users`,
     `users_info`) are unavailable to knex;
   - **no failure is specific to notification code** — no notification assertion fails, and
     the same files pass in full under `VITEST_NO_DB=1`.

   Any failure that does not fit that signature — in particular a notification-specific one,
   or a test that runs and then fails — is a blocking condition, not a known failure.

---

## Post-P1 comparison

Re-run at the end of P1, on the same branch, for comparison against the table above.

| Gate                 | Baseline                   | After P1                       | Verdict           |
| -------------------- | -------------------------- | ------------------------------ | ----------------- |
| `npx tsc --noEmit`   | clean                      | **clean**                      | unchanged         |
| `test:a11y`          | 17 files / 126 tests       | **17 / 126 passed**            | unchanged         |
| `test:unit`          | 60+1skip / 629+12skip      | **60+1skip / 629+12skip**      | unchanged         |
| `test:runtime`       | 10 files / 55 tests        | **10 / 55 passed**             | unchanged         |
| `test:notifications` | did not exist              | **5 files / 122 tests passed** | new               |
| `test:integration`   | 305 files failed, no tests | **310 files failed, no tests** | known failure, +5 |

The 122 notification tests are `emit` 20, `plan` 24, `policy` 20, `queries.sql` 32 and
`registry` 26. (`queries.sql` gained two after the post-audit hardening amendment, which pins
the reconciliation window and the cron cadence to the figures §14.3 and §23.3 fix.)

The integration delta of +5 is exactly the five new `__tests__/notifications/*` files, which
this suite collects like every other file under `__tests__/`. That growth is expected and is
not a regression. They fail in `__tests__/setup.ts` for the identical pre-existing reason as
the other 305 — the harness cannot build a schema — and not for any reason of their own: the
same five files pass 122/122 under `VITEST_NO_DB=1`. No notification-specific failure appears
anywhere in the run. The signature is unchanged, which is the condition §22.5 requires.

No test was skipped, deleted, weakened, or rewritten to reach this state.

---

## Post-P2.1 comparison

Re-run at the end of P2.1 (`/api/notifications/feed`, the feed query layer, presence
stamping and the persisted away boundary).

| Gate                 | Baseline                   | After P1                 | After P2.1                     | Verdict            |
| -------------------- | -------------------------- | ------------------------ | ------------------------------ | ------------------ |
| `npx tsc --noEmit`   | clean                      | clean                    | **clean**                      | unchanged          |
| `test:a11y`          | 17 files / 126 tests       | 17 / 126                 | **17 / 126 passed**            | unchanged          |
| `test:unit`          | 60+1skip / 629+12skip      | 60+1skip / 629+12skip    | **60+1skip / 629+12skip**      | unchanged          |
| `test:runtime`       | 10 files / 55 tests        | 10 / 55                  | **10 / 55 passed**             | unchanged          |
| `test:notifications` | did not exist              | 5 files / 122 tests      | **8 files / 187 tests passed** | +3 files, +65      |
| `test:integration`   | 305 files failed, no tests | 310 files failed         | **313 files failed, no tests** | known failure, +3  |
| `npm run build`      | not previously recorded    | not recorded             | **succeeds**                   | new evidence       |

The three new notification test files are `presence` (13), `feed.sql` (21) and `feedRoute`
(31), taking the suite from 122 to 187.

The integration delta of +3 is exactly those three files. The signature is unchanged and
still matches §22.4 in every respect: the failure is raised in `__tests__/setup.ts` before
any test executes ("Tests: no tests"), the reported errors are
`relation "knex_migrations" already exists` and a duplicate-key violation creating
`knex_migrations_lock`, and no failure anywhere in the run is specific to notification code.
All 187 notification tests pass under `VITEST_NO_DB=1`.

`npm run build` was added as a gate for P2.1 because it is the only check that can prove the
feed is uncacheable, and it earned its place immediately: it rejected
`export const dynamic = 'force-dynamic'` under `cacheComponents` (see the route header), which
no other gate caught — `tsc` and every test suite passed with the offending line present. The
build now lists `ƒ /api/notifications/feed`, i.e. dynamic, server-rendered on demand.

No test was skipped, deleted, weakened, or rewritten to reach this state.

---

## Post-P2.2 comparison

Re-run at the end of P2.2 (`NotificationContext`, feed polling, toast surfacing, `seenAt`
stamping, mark-read).

| Gate                 | Baseline                   | After P2.1                 | After P2.2                      | Verdict           |
| -------------------- | -------------------------- | -------------------------- | ------------------------------- | ----------------- |
| `npx tsc --noEmit`   | clean                      | clean                      | **clean**                       | unchanged         |
| `test:a11y`          | 17 files / 126 tests       | 17 / 126                   | **18 files / 132 tests passed** | +1 file, +6       |
| `test:unit`          | 60+1skip / 629+12skip      | 60+1skip / 629+12skip      | **60+1skip / 629+12skip**       | unchanged         |
| `test:runtime`       | 10 files / 55 tests        | 10 / 55                    | **10 / 55 passed**              | unchanged         |
| `test:notifications` | did not exist              | 8 files / 187 tests        | **14 files / 284 tests passed** | +6 files, +97     |
| `test:integration`   | 305 files failed, no tests | 313 files failed, no tests | **320 files failed, no tests**  | known failure, +7 |
| `npm run build`      | not recorded               | succeeds                   | **succeeds**                    | unchanged         |

The six new notification test files are `surface` (17), `notificationContext` (30),
`readRoutes` (16), `reads.sql` (13), `toastEligibility` (9) and `awarenessCoexistence` (8);
`feedRoute` grew 31 → 35 with the toast-eligibility block. The one new a11y file is
`notificationToast` (6), which uses the REAL `lib/toast` rather than a mock, so it would fail
if P2.2 had introduced a parallel toast implementation.

The integration delta of +7 is exactly those seven files (six notification, one a11y), which
this suite collects like every other file under `__tests__/`. The signature is unchanged and
still matches §22.4: raised in `__tests__/setup.ts` before any test executes
("Tests: no tests"), with `relation "knex_migrations" already exists` and
`relation "knex_migrations_lock" does not exist`, and no failure anywhere in the run specific
to notification code. All 284 notification tests pass under `VITEST_NO_DB=1`.

`npm run build` now lists `ƒ /api/notifications/feed`, `ƒ /api/notifications/read` and
`ƒ /api/notifications/seen` — all three dynamic, none prerendered.

**The dedup guarantees were mutation-tested, not merely asserted.** Because "does not toast
twice" is the kind of property a test suite can appear to cover while proving nothing, each
gate was temporarily removed and the suite re-run:

| Mutation                                            | Tests that failed                        |
| --------------------------------------------------- | ---------------------------------------- |
| session `alreadyToasted` gate deleted               | 5, incl. "does NOT re-toast … later polls" |
| `seenAt` stamped for `data.items` instead of surfaced | 1, "stamps seenAt for exactly the rows it toasted" |
| `seenAt` stamped on every feed return               | 3, incl. "does NOT stamp … merely because the feed returned" |
| `AWARENESS_OWNED_CATEGORIES` emptied                | 7, incl. the whole coexistence suite     |
| clock-skew correction forced to zero                | 2, both browser-clock cases              |

All mutations were reverted; the numbers above are from the unmutated tree.

No test was skipped, deleted, weakened, or rewritten to reach this state.

---

## Post-P2.3 comparison

Re-run at the end of P2.3 (bell, badge, dropdown, While-you-were-away section, deep-link click).

| Gate                 | Baseline                   | After P2.2                 | After P2.3                      | Verdict           |
| -------------------- | -------------------------- | -------------------------- | ------------------------------- | ----------------- |
| `npx tsc --noEmit`   | clean                      | clean                      | **clean**                       | unchanged         |
| `test:a11y`          | 17 files / 126 tests       | 18 files / 132 tests       | **19 files / 149 tests passed** | +1 file, +17      |
| `test:unit`          | 60+1skip / 629+12skip      | 60+1skip / 629+12skip      | **60+1skip / 629+12skip**       | unchanged         |
| `test:runtime`       | 10 files / 55 tests        | 10 / 55                    | **10 / 55 passed**              | unchanged         |
| `test:notifications` | did not exist              | 14 files / 284 tests       | **17 files / 346 tests passed** | +3 files, +62     |
| `test:integration`   | 305 files failed, no tests | 320 files failed, no tests | **324 files failed, no tests**  | known failure, +4 |
| `npm run build`      | not recorded               | succeeds                   | **succeeds**                    | unchanged         |

The three new notification test files are `dropdown` (22, the pure render/seen boundary rules),
`notificationBell` (33, bell and panel behaviour through the real context) and
`navBadgeNonRegression` (10); `awarenessCoexistence` grew 8 → 9 with the case proving the
`messages` suppression removes a duplicate toast without hiding the record. The one new a11y file
is `notificationBell` (17).

`navBadgeNonRegression` exists because P2.3 moved `NavBadge` out of `Nav.tsx` into
`lib/navs/NavBadge.tsx` so the bell could reuse it rather than ship a second 99+ cap. It pins the
markup byte-for-byte, the cap at both boundaries, and that OFFICE still has no inbox link and
therefore no conversation badge.

The integration delta of +4 is exactly those four files, which this suite collects like every
other file under `__tests__/`. The signature is unchanged and still matches §22.4: raised in
`__tests__/setup.ts` before any test executes ("Tests: no tests"), with
`relation "knex_migrations" does not exist` and
`relation "knex_migrations_lock" does not exist`, and no failure anywhere in the run specific to
notification code. All 346 notification tests pass under `VITEST_NO_DB=1`.

**The seen-boundary and focus guarantees were mutation-tested.** "Only the rendered rows get
stamped" is precisely the property a suite can look like it covers while proving nothing:

| Mutation                                          | Tests that failed                                    |
| ------------------------------------------------- | ---------------------------------------------------- |
| stamp `idsToStampSeen(items)` — the whole feed page | 1, "stamps exactly the rendered rows … not the whole page" |
| focus restore removed from `close()`              | 2, both "returns focus to the bell" cases            |

Both were reverted; the numbers above are from the unmutated tree.

No test was skipped, deleted, weakened, or rewritten to reach this state. The pre-existing
`navLandmarks` a11y test broke once when the bell called `useRouter()` unconditionally inside a
Topbar that the test renders with a partial `next/navigation` mock. It was fixed by splitting the
bell into a flag gate plus an implementation component, so nothing but the flag check mounts when
notifications are off — the test itself was not touched.
