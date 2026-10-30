# AI cost controls (usage ledger + shadow budgets) — rollout

**Status: NOT deployed. Nothing below has been executed.** Every step that
touches production needs its own explicit approval at the time it is run.
Local tests passing is not evidence of production readiness: provider billing
reconciliation (§5, step 12) is the first real evidence, and it does not exist
yet.

**No AI flag may be enabled** (`AI_USAGE_LEDGER`, `AI_BUDGET_SHADOW`,
`AI_BUDGET_POLICY`) until `main` contains `77e57b36` **and** the later commit
on `fix/ai-pricing-gpt56-alias` that introduced this sentence (the expiry-sweep
deadlock fix and the bounded ledger write), and that build is deployed. Units 2
and 3 alone still carry pricing and settlement defects that unit 4 corrects.

## 1. What ships

Four review units, merged in order. **Merging to `main` deploys production**
(it is the Vercel production branch), so each merge is a deployment.

| #   | Branch                            | What it does                                                                                                                                  | Production behaviour change with flags absent                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `fix/stage0-quota-and-job-leases` | Platform-owner gate on manual Pro grants; bounded, exclusive auto-response job leases                                                         | **Yes, by design**: the auto-response worker dead-letters jobs at `maxAttempts`, renews leases while it works, and re-checks ownership before every WhatsApp send. `upgradeAgencyToPro` is platform-owner only; nothing calls it today                                                                                                                               |
| 2   | `feat/ai-usage-ledger-stacked`    | Write-only `ai_usage_events` ledger, one row per provider request                                                                             | None. Workers set an in-memory operation context; nothing is written                                                                                                                                                                                                                                                                                                 |
| 3   | `feat/ai-budget-shadow`           | Durable shadow reservations and counters                                                                                                      | None. No reservation, no counter, no expiry sweep                                                                                                                                                                                                                                                                                                                    |
| 4   | `fix/ai-pricing-gpt56-alias`      | Pricing, settlement recovery, run identity, observability, transcription, reservation constraints, bounded ledger write, deadlock-free expiry | **Two**: (a) `/api/ai/agent/transcribe` refuses, with the existing `too-large` (413), an upload whose container metadata declares more than 120 s (+2 s); (b) an auto-response job whose lease the heartbeat has seen lost makes no further model call, and is counted as `leaseLost` instead of `failed` in the worker summary. Everything else is behind the flags |

Nothing in any unit blocks, delays, changes or charges a request because of a
budget. There is no enforcement and no paid top-up.

**Questionnaire jobs** share `auto_response_jobs` and its 60 s reclaim but
have **no heartbeat** (the questionnaire drain was not changed). A
questionnaire turn longer than the lease can still be reclaimed, as before; with
unit 1, one reclaimed at `maxAttempts` now becomes `dead` instead of returning
to `pending` forever. Watch `dead` jobs by `reason`.

## 2. Flags (absence-blocks — unset means OFF)

| Flag               | Exact value that enables             | Unset (default)                                                                              |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `AI_USAGE_LEDGER`  | `1`                                  | No `ai_usage_events` rows, no `[ai-usage]` log lines                                         |
| `AI_BUDGET_SHADOW` | `1`                                  | No reservations, no counters, no expiry sweep, no `[ai-budget]` log lines, no lifecycle work |
| `AI_BUDGET_POLICY` | JSON (see `lib/ai/budget/policy.ts`) | Default policy: no limits                                                                    |

- **`AI_USAGE_LEDGER` alone cannot activate budget reservations or any
  enforcement.** The ledger is write-only; the only reader of
  `ai_usage_events` is the expiry sweep, which runs only when
  `AI_BUDGET_SHADOW=1`.
- **`AI_BUDGET_POLICY` alone does nothing.** It is read only inside the shadow
  path, after the `AI_BUDGET_SHADOW` check.
- There is no enforcement flag: shadow decisions are recorded, never acted on.
- The flags must be absent in **Preview as well as Production**. A branch push
  creates a Preview deployment against the shared Preview database, which has
  none of these tables.

**Both switches are GLOBAL.** Neither takes an agency list. "Agency 103 first"
(§5, step 11) therefore means one of:

- **(a)** enable globally — the ledger is write-only and changes no request —
  and reconcile agency 103's slice first, widening the reconciliation after; or
- **(b)** add an agency allowlist to the flag before rollout. That is a code
  change and needs its own review.

Decide which before step 11. Vercel environment changes take effect only on a
new deployment.

## 3. Migrations

Four, all additive, none applied anywhere:

| Order | File                                                   | Carried by | Creates                                                                | `down`                                |
| ----- | ------------------------------------------------------ | ---------- | ---------------------------------------------------------------------- | ------------------------------------- |
| 1     | `20261030120000_ai_usage_events.cjs`                   | unit 2     | `ai_usage_events`                                                      | **Drops the table** (all ledger rows) |
| 2     | `20261031120000_ai_budget_shadow.cjs`                  | unit 3     | `ai_budget_reservations`, `ai_budget_counters`                         | **Drops both tables**                 |
| 3     | `20261101120000_ai_budget_reservation_cost_basis.cjs`  | unit 4     | Nullable cost-basis and ledger-link columns; CHECK unknown ⇔ no amount | **Drops the columns** and their data  |
| 4     | `20261101130000_ai_budget_reservation_state_basis.cjs` | unit 4     | Three CHECKs (one `NOT VALID`)                                         | Drops the three constraints only      |

- Each migration is applied **before the merge that deploys the code which
  uses it** (deployment contract, `claude/release-deployment-workflow.md` §8b).
  Applying one ahead of its code is safe: each is additive, and the code
  already on `main` never reads the new tables or columns.
- The expiry sweep (unit 4) reads `ai_usage_events`, so migration 1 is
  required by unit 4 even when the ledger flag is off.
- **`npm run migrate:rollback` reverts the whole last batch.** Apply each
  migration on its own, so each is its own batch, and roll back with
  `migrate:down`, one at a time.
- **Never use `npm run db:migrate:prod`.** It is the legacy runner
  (`scripts/migrate.cjs`): it reads `db/migrations/*.sql` into a separate
  `_migrations` table and is not the authoritative system.

### Pinning the target database (before EVERY knex command)

`knexfile.cjs` falls back to `.env.local` when `DATABASE_URL` is not set in the
shell. So set it explicitly, in a fresh shell, to the production **direct**
connection string (not the `-pooler` host), taken from the Neon console by the
operator. Never paste it into a file, ticket or chat.

```
export DATABASE_URL='<production direct connection string>'
unset NODE_ENV
node -e "const u=new URL(process.env.DATABASE_URL);console.log('host',u.hostname,'db',u.pathname.slice(1))"
```

Stop unless the printed host is the production direct endpoint (no `-pooler`)
and the database name is the production one. Repeat this check before every
`migrate:*` command below. Do not rely on `.env.local`.

## 4. Monitoring (configured before any flag is enabled)

Vercel log retention is short, so drain logs to a retained destination and
alert from there. All events are single structured lines, `[ai-budget] {json}`
or `[ai-usage] {json}`, with identifiers and categories only, never message
content.

| Alert                         | Source                                                                                                                             | Threshold                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Reservation missing           | `[ai-budget]`, `evt = reservation_failed`                                                                                          | any with `reason = db_schema_missing` (page at once: a migration is missing or rolled back); otherwise more than a handful per hour     |
| Settlement left for the sweep | `[ai-budget]`, `evt = settlement_failed`                                                                                           | more than a handful per hour                                                                                                            |
| Expiry sweep failed           | `[ai-budget]`, `evt = expiry_sweep_failed` (the sweep as a whole) or `evt = expiry_failed` (one row; the next sweep retries it)    | any. This structured event replaces the old unstructured `[ai-budget] shadow expiry failed` line: alert on the events, not on that text |
| Missing run identity          | `[ai-budget]`, `evt = run_identity_missing`                                                                                        | any (a code path with no run identity)                                                                                                  |
| Ledger write failed           | `[ai-usage]`, `evt = ledger_write_failed`                                                                                          | more than a handful per hour (those rows are missing)                                                                                   |
| Ledger write slow             | `[ai-usage]`, `evt = ledger_write_delayed`                                                                                         | a sustained rate (the insert outlived its 250 ms wait; it continued in the background)                                                  |
| AI latency                    | p95 duration of `/api/ai/agent/stream`, `/api/ai/agent/transcribe`, `/api/cron/send-auto-responses` and the copilot server actions | compare with the 7 days before the ledger was enabled; investigate a sustained rise                                                     |

`[ai-budget]` `evt = expiry_swept` (info) carries the counts of each sweep:
stale, settled, failed.

Periodic query (daily, read-only), once shadow budgets are on:

```sql
BEGIN READ ONLY;
SELECT date_trunc('day', "reservedAt") AS day, state, "actualCostBasis",
       count(*) AS reservations, sum("chargedUsd") AS charged_usd
FROM ai_budget_reservations
WHERE "reservedAt" >= now() - interval '7 days'
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
ROLLBACK;
```

Watch the share of `expired` and `unknown_cost`. A rising `expired` share
means settlements are not completing; a rising `unknown_cost` share means
costs are not being priced.

## 5. Production checklist (do not execute without approval)

Read-only queries run inside `BEGIN READ ONLY; … ROLLBACK;` on the direct
(non-pooler) host. Never `SET SESSION CHARACTERISTICS` on the `-pooler` host.

**Before anything**

1. Confirm the three AI flags are absent in **both** Production and Preview
   (`vercel env ls production`, `vercel env ls preview`). Do not add them.
2. Configure the log drain and the alerts in §4.
3. Confirm access to the OpenAI, Anthropic and Google billing or usage pages
   for the reconciliation in step 12.
4. Run the deployment-contract check (§8b) once, with the target pinned (§3):

   ```sql
   SELECT 1 FROM knex_migrations WHERE name = '20240101000000_create_users.cjs';
   ```

   If it returns no row, stop and follow §8b before running any migration.

**Unit 1** (no migration)

5. Merge unit 1 (this deploys it). Confirm the deployment and watch the
   auto-response worker: `dead` jobs by `lastError`, and lease-loss warnings.

**Unit 2**

6. Pin and verify the target (§3), then confirm what is pending:

   ```
   npx knex --knexfile knexfile.cjs migrate:list
   ```

   Expect, among the pending, exactly these four AI migrations:
   `20261030120000_ai_usage_events.cjs`, `20261031120000_ai_budget_shadow.cjs`,
   `20261101120000_ai_budget_reservation_cost_basis.cjs`,
   `20261101130000_ai_budget_reservation_state_basis.cjs`, and nothing else
   unexpected. Anything else pending: stop.

7. Apply migration 1, alone, then record the result (re-pin and re-verify the
   target first):

   ```
   npx knex --knexfile knexfile.cjs migrate:up 20261030120000_ai_usage_events.cjs
   ```

   ```sql
   SELECT name, batch, migration_time FROM knex_migrations ORDER BY id DESC LIMIT 1;
   ```

   Then merge unit 2.

**Unit 3**

8. Re-pin, re-verify, apply `20261031120000_ai_budget_shadow.cjs` alone the
   same way, record it, then merge unit 3.

**Unit 4**

9. Re-pin, re-verify, apply `20261101120000_ai_budget_reservation_cost_basis.cjs`,
   record it; re-pin, re-verify, apply
   `20261101130000_ai_budget_reservation_state_basis.cjs`, record it. Then
   merge unit 4. Record all four migration rows and the deployed commit SHA in
   the deployment report.

**Confirm inert**

10. For at least one full cron cycle, with all flags still absent:
    - `SELECT count(*) FROM ai_usage_events;` and
      `SELECT count(*) FROM ai_budget_reservations;` both return 0;
    - no `[ai-budget]` or `[ai-usage]` lines in the logs;
    - WhatsApp auto-replies, `/agent`, voice input and the copilot behave as
      before; `send-auto-responses` returns 200.

**Ledger, then shadow**

11. Enable the ledger (`AI_USAGE_LEDGER=1`, per the §2 decision) and
    redeploy. Watch for 24 h: row counts, the `costBasis` mix (expect mostly
    `estimated`: OpenAI never reports cache-write counts, Anthropic no tier),
    `ledger_write_*` events and AI-route p95 latency (§4).
12. Reconcile for at least 7 days. Compare the ledger with each provider's
    billing or usage page for the same UTC days:

    ```sql
    BEGIN READ ONLY;
    SELECT date_trunc('day', "createdAt") AS day, provider, "costBasis",
           count(*) AS requests, sum("costUsd") AS usd,
           sum("inputTokens") AS input, sum("outputTokens") AS output
    FROM ai_usage_events
    WHERE "createdAt" >= now() - interval '7 days'
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
    ROLLBACK;
    ```

    Explain every gap above an agreed tolerance before going further. Known
    sources of gap:
    - unreported OpenAI cache writes: the ledger can understate by up to $6 per
      1M uncached `gpt-5.6-sol` tokens;
    - `unknown` rows (no amount);
    - **SDK-internal retries**: tasks without `providerMaxRetries`
      (`lead.summary`, `lead.classify`, `lead.followup`, `lead.nextStep`,
      `lead.askQuestion`, `pipeline.weekly`, `health.check`,
      `copilot.classifyIntent`, `conversation.analysis`) use the SDK default of
      2 retries, so one ledger row can stand for up to 3 provider requests;
    - ledger writes lost when a function stops before the delayed insert
      completes (preceded by `ledger_write_delayed`);
    - AI use outside the ledger (anything that bypasses `runStructured`, the
      Agent and transcription).

13. Enable shadow budgets (`AI_BUDGET_SHADOW=1`, optionally
    `AI_BUDGET_POLICY`) only after step 12 is signed off. Watch the §4 alerts
    and the periodic reservation query, and compare reservation totals with
    ledger sums for the same calls (`callId` for router and transcription;
    `invocationId` + step range for the Agent). Shadow decisions are
    simulations; nothing is enforced.

## 6. Rollback (newest first)

1. **Flags off**: remove `AI_BUDGET_SHADOW` and `AI_BUDGET_POLICY`, then
   `AI_USAGE_LEDGER`, from Production (and Preview, if ever set), and
   redeploy. This alone stops all writes.
2. **Export before any `down`**, if usage collection ever started: with the
   target pinned (§3), export the data that a `down` would destroy, and store
   the file with the same care as a database backup (it holds internal ids and
   costs, no message content):

   ```
   pg_dump --data-only -t ai_usage_events -t ai_budget_reservations -t ai_budget_counters "$DATABASE_URL" > ai-cost-controls-export.sql
   ```

3. **Code**: promote the last deployment before the unit being rolled back,
   or revert its merge on `main`. Code must be rolled back **before** the
   migration it depends on: with the columns gone, unit 4's code fails every
   reservation. The failures are swallowed and logged, but no shadow data is
   recorded.
4. **Migrations**, one at a time, newest first, only as far as needed,
   re-pinning and re-verifying the target before each:

   ```
   npx knex --knexfile knexfile.cjs migrate:down   # 20261101130000 — constraints only
   npx knex --knexfile knexfile.cjs migrate:down   # 20261101120000 — drops basis columns (data loss)
   npx knex --knexfile knexfile.cjs migrate:down   # 20261031120000 — drops budget tables (data loss)
   npx knex --knexfile knexfile.cjs migrate:down   # 20261030120000 — drops the ledger (data loss)
   ```

   Check `migrate:list` after each one. Never `migrate:rollback` across more
   than one of these.

Unit 1 has no flag and no migration; rolling it back is a code revert only.

## 7. Known limitations (shadow mode)

- Settlement is **recoverable, not guaranteed**: `after()` is bounded by each
  route's `maxDuration`; Agent reservations can only expire as unknown.
- The ledger write waits at most 250 ms on the AI request path, then continues
  under `after()` with a 10 s query timeout. A write still pending when the
  function stops is lost, and only its `ledger_write_delayed` event remains.
- No estimate is a guaranteed maximum: structured, Agent and transcription
  estimates are `partial`; unpriced models reserve a flat policy amount.
- Transcription duration cannot be verified when the container carries no
  usable duration (Chrome WebM, Safari fragmented MP4).
- Counters (`ai_budget_counters.spentUsd`) mix reported, estimated and
  estimate-charged amounts.
- Enforcement is a separate milestone with its own decision policy and review.
