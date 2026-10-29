# AI cost controls (usage ledger + shadow budgets) — rollout

**Status: NOT deployed. Nothing below has been executed.** Every step that
touches production needs its own explicit approval at the time it is run.
Local tests passing is not evidence of production readiness: provider billing
reconciliation (§6) is the first real evidence, and it does not exist yet.

## 1. What ships

Four review units, merged in order:

| # | Branch | What it does | Production behaviour change with flags absent |
|---|---|---|---|
| 1 | `fix/stage0-quota-and-job-leases` | Platform-owner gate on manual Pro grants; bounded, exclusive auto-response job leases | **Yes, by design**: the auto-response worker dead-letters jobs at `maxAttempts`, renews leases while working, and re-checks ownership before every WhatsApp send. `upgradeAgencyToPro` is platform-owner only (it has no importer today) |
| 2 | `feat/ai-usage-ledger-stacked` | Write-only `ai_usage_events` ledger, one row per provider request | None. Workers set an in-memory operation context; nothing is written |
| 3 | `feat/ai-budget-shadow` | Durable shadow reservations and counters | None. No reservation, no counter, no expiry sweep |
| 4 | `fix/ai-pricing-gpt56-alias` | Pricing, settlement recovery, run identity, observability, transcription, reservation constraints | **One**: `/api/ai/agent/transcribe` refuses (existing `too-large`, 413) an upload whose container metadata declares more than 120 s (+2 s). Everything else is behind the flags |

Nothing in any unit blocks, delays, changes or charges a request because of a
budget. There is no enforcement and no paid top-up.

## 2. Flags (absence-blocks — unset means OFF)

| Flag | Exact value that enables | Unset (default) |
|---|---|---|
| `AI_USAGE_LEDGER` | `1` | No `ai_usage_events` rows |
| `AI_BUDGET_SHADOW` | `1` | No reservations, no counters, no expiry sweep, no `[ai-budget]` log lines |
| `AI_BUDGET_POLICY` | JSON (see `lib/ai/budget/policy.ts`) | Default policy: no limits. Only read when shadow is on |

**Both switches are GLOBAL.** Neither takes an agency list. "Agency 103 first"
(§6, §7) therefore means one of:

- **(a)** enable globally — the ledger is write-only and changes no request —
  and reconcile agency 103's slice first, widening the reconciliation after; or
- **(b)** add an agency allowlist to the flag before rollout. That is a code
  change and needs its own review.

Decide which before step 6. Vercel environment changes take effect only on a
new deployment.

## 3. Migrations

Four, all additive, none applied anywhere:

| Order | File | Creates | `down` |
|---|---|---|---|
| 1 | `20261030120000_ai_usage_events.cjs` | `ai_usage_events` | **Drops the table** (all ledger rows) |
| 2 | `20261031120000_ai_budget_shadow.cjs` | `ai_budget_reservations`, `ai_budget_counters` | **Drops both tables** |
| 3 | `20261101120000_ai_budget_reservation_cost_basis.cjs` | Nullable cost-basis and ledger-link columns; CHECK unknown ⇔ no amount | **Drops the columns** and their data |
| 4 | `20261101130000_ai_budget_reservation_state_basis.cjs` | Three CHECKs (one `NOT VALID`) | Drops the three constraints only |

The expiry sweep (unit 4) reads `ai_usage_events`, so migration 1 is required
by unit 4 even when the ledger flag is off.

**`npm run migrate:rollback` reverts the whole last batch.** Apply each
migration on its own (step 4) so each is its own batch, and roll back with
`migrate:down`, one at a time.

## 4. Production checklist (do not execute without approval)

Read-only queries run inside `BEGIN READ ONLY; … ROLLBACK;` on the direct
(non-pooler) host. Never `SET SESSION CHARACTERISTICS` on the `-pooler` host.

1. **Merge** units 1 → 2 → 3 → 4 into `main`, each after review, with the
   `schema` CI job green on the PRs that touch `migrations/`.
2. **Deployment-contract check** (`claude/release-deployment-workflow.md` §8b):

   ```sql
   SELECT 1 FROM knex_migrations WHERE name = '20240101000000_create_users.cjs';
   ```

   If it returns no row, stop and follow §8b before running any migration.
3. **Pending migrations**:

   ```
   npx knex --knexfile knexfile.cjs migrate:list
   ```

   Expect exactly these four pending, and nothing else:
   `20261030120000_ai_usage_events.cjs`, `20261031120000_ai_budget_shadow.cjs`,
   `20261101120000_ai_budget_reservation_cost_basis.cjs`,
   `20261101130000_ai_budget_reservation_state_basis.cjs`.
   Anything else pending: stop.
4. **Apply each migration individually**, in order, before deploying:

   ```
   npx knex --knexfile knexfile.cjs migrate:up 20261030120000_ai_usage_events.cjs
   npx knex --knexfile knexfile.cjs migrate:up 20261031120000_ai_budget_shadow.cjs
   npx knex --knexfile knexfile.cjs migrate:up 20261101120000_ai_budget_reservation_cost_basis.cjs
   npx knex --knexfile knexfile.cjs migrate:up 20261101130000_ai_budget_reservation_state_basis.cjs
   ```

   After each one, record its name, batch and time:

   ```sql
   SELECT name, batch, migration_time FROM knex_migrations ORDER BY id DESC LIMIT 4;
   ```

   Record the four rows and the deployed commit SHA in the deployment report.
5. **Deploy** `main` with `AI_USAGE_LEDGER`, `AI_BUDGET_SHADOW` and
   `AI_BUDGET_POLICY` absent from Production (confirm with `vercel env ls`).
6. **Confirm inert** for at least one full cron cycle:
   - `SELECT count(*) FROM ai_usage_events;` and
     `SELECT count(*) FROM ai_budget_reservations;` both return 0;
   - no `[ai-budget]` lines in the logs;
   - WhatsApp auto-replies, `/agent`, voice input and the copilot behave as
     before; `send-auto-responses` returns 200;
   - Stage 0 is live by design: watch for unexpected `dead` auto-response jobs.
7. **Log drain and alerts**, configured before any flag is enabled (Vercel log
   retention is short). Drain lines tagged `[ai-budget]` and alert on:
   - `evt = reservation_failed` with `reason = db_schema_missing`: page at once
     (a migration is missing or rolled back);
   - `evt = reservation_failed` or `settlement_failed`: more than a handful per
     hour;
   - `evt = run_identity_missing`: any occurrence (a code path without a run
     identity).

   The lines carry identifiers and categories only, never message content.
8. **Enable the ledger** (`AI_USAGE_LEDGER=1`, per the §2 decision) and
   redeploy. Watch for 24 h: row counts and `costBasis` mix (expect mostly
   `estimated` — OpenAI never reports cache-write counts, Anthropic no tier).
9. **Reconcile** for at least 7 days. Compare the ledger with each provider's
   billing or usage page for the same UTC days:

   ```sql
   SELECT date_trunc('day', "createdAt") AS day, provider, "costBasis",
          count(*) AS requests, sum("costUsd") AS usd,
          sum("inputTokens") AS input, sum("outputTokens") AS output
   FROM ai_usage_events
   WHERE "createdAt" >= now() - interval '7 days'
   GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
   ```

   Explain every gap above an agreed tolerance before going further. Known
   sources of gap: unreported OpenAI cache writes (the ledger can understate by
   up to $6 per 1M uncached `gpt-5.6-sol` tokens), `unknown` rows (no amount),
   SDK-internal retries (one row each), and calls outside the ledger (any AI use
   that bypasses `runStructured`, the Agent and transcription).
10. **Enable shadow budgets** (`AI_BUDGET_SHADOW=1`, optionally
    `AI_BUDGET_POLICY`) only after step 9 is signed off. Watch:
    - `state` mix in `ai_budget_reservations` (`expired`, `unknown_cost`);
    - reservation totals against ledger sums for the same calls (`callId` for
      router and transcription; `invocationId` + step range for the Agent);
    - `reservation_failed` / `settlement_failed` alert volume.

    Shadow decisions are simulations; nothing is enforced.

## 5. Rollback (newest first)

1. **Flags off**: remove `AI_BUDGET_SHADOW` and `AI_BUDGET_POLICY`, then
   `AI_USAGE_LEDGER`, from Production, and redeploy. This alone stops all writes.
2. **Code**: promote the last deployment before the unit being rolled back,
   or revert its merge on `main`. Code must be rolled back **before** the
   migration it depends on; with the columns gone, unit 4's code fails every
   reservation. The failures are swallowed and logged, but no shadow data is
   recorded.
3. **Migrations**, one at a time, newest first, only as far as needed:

   ```
   npx knex --knexfile knexfile.cjs migrate:down   # 20261101130000 — constraints only
   npx knex --knexfile knexfile.cjs migrate:down   # 20261101120000 — drops basis columns (data loss)
   npx knex --knexfile knexfile.cjs migrate:down   # 20261031120000 — drops budget tables (data loss)
   npx knex --knexfile knexfile.cjs migrate:down   # 20261030120000 — drops the ledger (data loss)
   ```

   Check `migrate:list` after each one. Never `migrate:rollback` across more
   than one of these.

Stage 0 (unit 1) has no flag and no migration; rolling it back is a code
revert only.

## 6. Known limitations (shadow mode)

- Settlement is **recoverable, not guaranteed**: `after()` is bounded by each
  route's `maxDuration`; Agent reservations can only expire as unknown.
- No estimate is a guaranteed maximum: structured, Agent and transcription
  estimates are `partial`; unpriced models reserve a flat policy amount.
- Transcription duration cannot be verified when the container carries no
  usable duration (Chrome WebM, Safari fragmented MP4).
- Counters (`ai_budget_counters.spentUsd`) mix reported, estimated and
  estimate-charged amounts.
- Enforcement is a separate milestone with its own decision policy and review.
