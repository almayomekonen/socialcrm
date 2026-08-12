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

---

## Post-P2.4 comparison

Re-run at the end of P2.4 (`/notifications` center, cursor pagination, unread/category filters,
seen stamping for loaded rows, shared `NotificationRow`).

| Gate                 | After P2.3                      | After floating-menu fix         | After P2.4                      | Verdict            |
| -------------------- | ------------------------------- | ------------------------------- | ------------------------------- | ------------------ |
| `npx tsc --noEmit`   | clean                           | clean                           | **clean**                       | unchanged          |
| `test:a11y`          | 19 files / 149 tests            | 19 / 149                        | **20 files / 152 tests passed** | +1 file, +3        |
| `test:unit`          | 60+1skip / 629+12skip           | 60+1skip / 629+12skip           | **60+1skip / 629+12skip**       | unchanged          |
| `test:runtime`       | 10 / 55                         | 10 / 55                         | **10 / 55 passed**              | unchanged          |
| `test:notifications` | 17 files / 346 tests            | 18 / 356                        | **20 files / 401 tests passed** | +2 files, +45      |
| `test:integration`   | 324 files failed, no tests      | 325 files failed, no tests      | **328 files failed, no tests**  | known failure, +3  |
| `npm run build`      | succeeds                        | succeeds                        | **succeeds** (`◐ /notifications`) | unchanged       |

The two new notification test files are `center` (pure filter/pagination/seen rules) and
`notificationCenter` (center list + filter chip behaviour). The one new a11y file is
`notificationCenter` (3). The floating-menu fix earlier added `floatingMenu` (+10) under
`test:notifications`.

The integration delta of +3 is exactly those three new files. The signature is unchanged:
setup fails before any test executes ("Tests: no tests"), with the knex schema / migration
lock / deadlock failure, and no notification-specific integration failure.

---

## Post-P3.0 comparison

Re-run at the end of P3.0 (real `user_presence` lookup in the notification worker —
`p1Presence` removed; batched SELECT-only presence before WEB_PUSH).

| Gate                 | After P2.4                      | After P3.0                      | Verdict           |
| -------------------- | ------------------------------- | ------------------------------- | ----------------- |
| `npx tsc --noEmit`   | clean                           | **clean**                       | unchanged         |
| `test:a11y`          | 20 files / 152 tests            | **20 files / 152 tests passed** | unchanged         |
| `test:unit`          | 60+1skip / 629+12skip           | **60+1skip / 629+12skip**       | unchanged         |
| `test:runtime`       | 10 / 55                         | **10 / 55 passed**              | unchanged         |
| `test:notifications` | 20 files / 401 tests            | **21 files / 418 tests passed** | +1 file, +17      |
| `test:integration`   | 328 files failed, no tests      | **329 files failed, no tests**  | known failure, +1 |
| `npm run build`      | succeeds                        | **succeeds**                    | unchanged         |

The one new notification test file is `presenceLookup` (17): ONLINE / IDLE / OFFLINE /
missing row / stale / boundary timestamps / future clock-skew / batch target collection /
SELECT-only SQL shape / no `p1Presence` / worker path never writes `user_presence` or
`users_info`.

The integration delta of +1 is exactly that file. The signature is unchanged: raised in
`__tests__/setup.ts` before any test executes ("Tests: no tests"), with
`knex_migrations_lock` duplicate / already-exists, `knex_migrations` missing, and
`DROP SCHEMA … deadlock detected`, and no notification-specific integration failure.
All 418 notification tests pass under `VITEST_NO_DB=1`.

No test was skipped, deleted, weakened, or rewritten to reach this state.

---

## Post-P3.1 comparison

Re-run at the end of P3.1 (Web Push **subscription** lifecycle only — no delivery,
WEB_PUSH still disabled).

| Gate                 | After P3.0                      | After P3.1                      | Verdict           |
| -------------------- | ------------------------------- | ------------------------------- | ----------------- |
| `npx tsc --noEmit`   | clean                           | **clean**                       | unchanged         |
| `test:a11y`          | 20 files / 152 tests            | **20 files / 152 tests passed** | unchanged         |
| `test:unit`          | 60+1skip / 629+12skip           | **60+1skip / 629+12skip**       | unchanged         |
| `test:runtime`       | 10 / 55                         | **10 / 55 passed**              | unchanged         |
| `test:notifications` | 21 files / 418 tests            | **25 files / 452 tests passed** | +4 files, +34     |
| `test:integration`   | 329 files failed, no tests      | **333 files failed, no tests**  | known failure, +4 |
| `npm run build`      | succeeds                        | **succeeds**                    | unchanged         |

The four new notification test files are `vapid`, `subscriptions.sql`, `pushRoutes`, and
`serviceWorker`. They pin session-scoped binding, endpoint reassignment SQL, malformed
payload rejection, arbitrary-field stripping, SW fetch-handler absence, `/sw.js` auth
bypass in `proxy.ts`, and that no P3.1 module imports `web-push` / sends a notification.

The integration delta of +4 is exactly those files. Signature unchanged: setup fails before
any test executes ("Tests: no tests"), knex lock / missing migrations / deadlock — no
notification-specific integration failure.

**Confirmed:** no push notification was delivered; `NOTIFICATIONS_PUSH_ENABLED` remains off;
`processJob` still uses `IN_APP_ONLY_CAPABILITIES`.

No test was skipped, deleted, weakened, or rewritten to reach this state.

---

## Post-P3.2 comparison

Re-run at the end of P3.2 (actual WEB_PUSH delivery behind `NOTIFICATIONS_PUSH_ENABLED`,
default OFF).

| Gate                 | After P3.1                      | After P3.2                      | Verdict           |
| -------------------- | ------------------------------- | ------------------------------- | ----------------- |
| `npx tsc --noEmit`   | clean                           | **clean**                       | unchanged         |
| `test:a11y`          | 20 files / 152 tests            | **20 files / 152 tests passed** | unchanged         |
| `test:unit`          | 60+1skip / 629+12skip           | **60+1skip / 629+12skip**       | unchanged         |
| `test:runtime`       | 10 / 55                         | **10 / 55 passed**              | unchanged         |
| `test:notifications` | 25 files / 452 tests            | **27 files / 476 tests passed** | +2 files, +24     |
| `test:integration`   | 333 files failed, no tests      | **335 files failed, no tests**  | known failure, +2 |
| `npm run build`      | succeeds                        | **succeeds**                    | unchanged         |

The two new notification test files are `webPushDelivery` and `processJob.push`. They pin
policy/capability gating, payload shape, multi-device send, cross-tenant skip, 410 cleanup,
transient retain, flag-off suppression, duplicate terminal skip, and unchanged IN_APP
recording.

**Confirmed:** `NOTIFICATIONS_PUSH_ENABLED` is not set in this commit or in local `.env.local`;
production push remains disabled. Real browser push was not manually verified (no VAPID keys
in the local env).

No test was skipped, deleted, weakened, or rewritten to reach this state.

---

## Post-P3.3 (`message.inbound` only) comparison

Re-run after wiring WhatsApp ingest → `notifyEvent(message.inbound)` with
`inbox_messages.id` as the event-key discriminator. No lead.assigned / integration /
grouping / digest / escalation / email / SLA in this commit.

| Gate                 | After P3.2                      | After P3.3 message.inbound      | Verdict           |
| -------------------- | ------------------------------- | ------------------------------- | ----------------- |
| `npx tsc --noEmit`   | clean                           | **clean**                       | unchanged         |
| `test:a11y`          | 20 files / 152 tests            | **20 files / 152 tests passed** | unchanged         |
| `test:unit`          | 60+1skip / 629+12skip           | **60+1skip / 629+12skip**       | unchanged         |
| `test:runtime`       | 10 / 55                         | **10 / 55 passed**              | unchanged         |
| `test:notifications` | 27 files / 476 tests            | **28 files / 489 tests passed** | +1 file, +13      |
| `test:integration`   | 335 files failed, no tests      | **336 files failed, no tests**  | known failure, +1 |
| `npm run build`      | succeeds                        | **succeeds**                    | unchanged         |

The new notification test file is `messageInbound.emit`. It pins ingest emit-on-insert,
retry silence, per-message identity, recipient/tenant isolation via payload.leadId,
Awareness toast suppression coexistence, and unchanged push policy. Harness note: runs
DB-free under `VITEST_NO_DB=1` with the real `ingestWhatsappInbound` and mocked accessors
(no live Postgres insert path in this suite).

**Confirmed:** Awareness still owns the live message toast; notification rows remain for
Bell/Center; engine architecture, push flag, and AwarenessProvider are unchanged.

No test was skipped, deleted, weakened, or rewritten to reach this state.

---

## Post-P3.3 (`lead.assigned` only) comparison

Re-run after wiring `transferLeadToRep` → `notifyEvent(lead.assigned)` with
`userId`+`handlerId` alignment and `to:{assignedUserId}` event identity.
No integration / grouping / digest / escalation / email / SLA in this commit.
No `message.inbound` changes.

| Gate                 | After P3.3 message.inbound      | After P3.3 lead.assigned        | Verdict           |
| -------------------- | ------------------------------- | ------------------------------- | ----------------- |
| `npx tsc --noEmit`   | clean                           | **clean**                       | unchanged         |
| `test:a11y`          | 20 files / 152 tests            | **20 files / 152 tests passed** | unchanged         |
| `test:unit`          | 60+1skip / 629+12skip           | **60+1skip / 629+12skip**       | unchanged         |
| `test:runtime`       | 10 / 55                         | **10 / 55 passed**              | unchanged         |
| `test:notifications` | 28 files / 489 tests            | **29 files / 502 tests passed** | +1 file, +13      |
| `test:integration`   | 336 files failed, no tests      | **337 files failed, no tests**  | known failure, +1 |
| `npm run build`      | succeeds                        | **succeeds**                    | unchanged         |

The new notification test file is `leadAssigned.emit`. It pins transfer persist
alignment (`userId`+`handlerId`), emit-on-change, same-assignee no-op, trx
coupling / rollback silence, assignee event identity, recipient=new handler,
actor self-drop, and tenant isolation. Harness note: DB-free under `VITEST_NO_DB=1`
with the real `transferLeadToRep` and mocked transaction accessors.

**Confirmed:** registry / policy / Bell / Center / Push / presence unchanged;
previous handler is not a recipient after persist; actor===assignee is skipped
by existing `planNotification`.

No test was skipped, deleted, weakened, or rewritten to reach this state.

---

## Post-P3.3 (`integration.disconnected` + `integration.ingestion_failed` only) comparison

Re-run after wiring real Facebook disconnect / ingestion-failure paths (and WhatsApp
create-null) → `notifyEvent`. No Bell/Center/Toast/Push/presence/Awareness changes.
No grouping / digest / escalation / email / SLA. No `lead.assigned` or
`message.inbound` changes. Registry still has no `isResolved` for these types.

| Gate                 | After P3.3 lead.assigned        | After P3.3 integration          | Verdict           |
| -------------------- | ------------------------------- | ------------------------------- | ----------------- |
| `npx tsc --noEmit`   | clean                           | **clean**                       | unchanged         |
| `test:a11y`          | 20 files / 152 tests            | **20 files / 152 tests passed** | unchanged         |
| `test:unit`          | 60+1skip / 629+12skip           | **60+1skip / 629+12skip**       | unchanged         |
| `test:runtime`       | 10 / 55                         | **10 / 55 passed**              | unchanged         |
| `test:notifications` | 29 files / 502 tests            | **30 files / 517 tests passed** | +1 file, +15      |
| `test:integration`   | 337 files failed, no tests      | **338 files failed, no tests**  | known failure, +1 |
| `npm run build`      | succeeds                        | **succeeds**                    | unchanged         |

The new notification test file is `integration.emit`. It pins disconnect
transition emit, already-expired silence, reconnect→disconnect new episode,
ingestion failure emit (FB + WA), externalLeadId identity, admin_only recipients,
agency isolation, system-actor planning, and the honest no-`isResolved` recovery
contract. Harness note: DB-free under `VITEST_NO_DB=1` with real helpers and
mocked `db` / `notifyEvent`.

**Confirmed:** emit only on real actionable Facebook token expiry transitions and
non-auth leadgen persist failures (plus WhatsApp create-null); status polling
while already expired does not spam; recovery does not invent resolve machinery.

No test was skipped, deleted, weakened, or rewritten to reach this state.
