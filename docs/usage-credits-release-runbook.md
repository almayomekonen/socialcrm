# Usage credits: measurement-only release runbook

**Status:** prepared, not executed. Branch `feat/usage-credits`. Every step that touches Production needs explicit owner approval first.

## 1. What ships

Every agency gets 50 free agent requests per calendar month (Asia/Jerusalem). After that, requests need purchased credits, debited at actual provider cost. Customers never see cost.

**A counted request** is one unique owner message or question that reaches the AI agent: a WhatsApp assistant job about to run the Agent, or a web Agent question. Retries, tool calls and provider fallbacks of that request are the same request.

**Not counted, not charged:** duplicate webhooks, button decisions, deterministic replies (reminder create, list, cancel), reminder delivery, auto-replies, conversation analysis, generated summaries, and Copilot or lead-action AI (measured internally only).

| Tier | Meaning | Effect |
|---|---|---|
| `free` | Within the 50 | Runs. No debit |
| `paid` | Past the 50, purchased credits cover the hold | Runs. Debited actual cost once, capped at the hold |
| `blocked` | Past the 50, not enough credits, enforced | Does not run. WhatsApp notice with the link |
| `unmetered` | Past the 50, not enforced (no flag, or Pro) | Runs. No debit |
| `exempt` | Agency 103 + user 332 | Runs. Zero, real cost recorded |
| `void` | No AI call was made | Does not count |

## 2. Environment variables

All absent in Production on 2026-11-08. **Absence blocks.**

| Variable | Default | Measurement-only value | Effect |
|---|---|---|---|
| `CREDITS_METERING` | unset | `1` | Records requests and settles. Blocks nothing by itself |
| `CREDITS_UI_AGENCY_IDS` | unset | `103` | Shows the section to those agencies |
| `CREDITS_ENFORCEMENT_AGENCY_IDS` | unset | **leave unset** | ENFORCES: refuses requests past the allowance without credits |
| `CREDITS_ENFORCE_ON_PRO` | unset | **leave unset** | Lets a listed Pro agency be enforced. Requires a changed Pro promise |
| `CREDITS_PURCHASES_AGENCY_IDS` | unset | **leave unset** | SELLS: real card charges, only for an enforced agency |
| `CREDITS_LINK_SECRET` | unset | leave unset | Signs purchase links. Unset: the plain session-scoped page |
| `CREDITS_AUTOMATION_MONTHLY_USD_ALERT` | unset | optional | Logs a warning. Never blocks |
| `CREDITS_MONTHLY_ALLOWANCE` | 50 | leave unset | Free requests per month |
| `CREDITS_PAID_REQUEST_HOLD` | 3 | leave unset | Credits needed to start a paid request, and its maximum debit |
| `CREDITS_AI_USD_PER_CREDIT` | 0.03 | leave unset | Internal weighting |
| `CREDITS_LOW_BALANCE_PERCENT` | 20 | leave unset | Low-allowance warning |
| `CREDITS_PACK_{200,500}_{CREDITS,PRICE_ILS}` | 200/49, 500/99 | leave unset | Pack definition (unvalidated prices, VAT included) |

An agency being enforced must also be in `CREDITS_PURCHASES_AGENCY_IDS`, or the WhatsApp link leads to a page with nothing to buy. Agency lists take explicit ids only; `all` is ignored, so a new agency is not covered until it is added. **Dependencies already set in Production:** `AI_USAGE_LEDGER`, `CRON_SECRET`. Enforcing without `AI_USAGE_LEDGER=1` would leave paid requests undebited.

## 3. Migration, then deploy

Follow `claude/release-deployment-workflow.md` §8b. Migrations run manually, before the deploy.

1. `git fetch origin --prune`; confirm `git log --oneline origin/main..<branch>` holds only this work.
2. Validate: typecheck, `next build`, credit suites.
3. On the Production **direct host (not `-pooler`)**: `npx knex --knexfile knexfile.cjs migrate:list`. Expect exactly one pending file, `20261110120000_usage_credits.cjs`. Stop on anything else.
4. `npm run migrate`. Record the batch and commit SHA.
5. Run the schema checks in section 5.
6. Merge to `main`. The cron `/api/cron/usage-credits` (every 10 minutes) ships with it and exits immediately while metering is unset.
7. Confirm `getsocialcrm.com` serves the new build. Set no `CREDITS_*` variable in this step.

The migration creates `agency_credit_ledger` and `agent_requests`, and widens two CHECK constraints on `billing_charges`. No existing row changes. After step 4 the file is immutable.

## 4. Measurement-only activation

1. Set `CREDITS_METERING=1` and `CREDITS_UI_AGENCY_IDS=103` in Vercel **Production only**.
2. Redeploy. Env changes need a new deployment.
3. Run section 5 after 1 hour and 24 hours. Confirm reminders still send for agency 103.
4. Observe at least 7 days.

## 5. Verification (read only)

```sql
-- Before migrating: 0 rows and NULL
SELECT count(*) FROM knex_migrations WHERE name = '20261110120000_usage_credits.cjs';
SELECT to_regclass('agency_credit_ledger');

-- After migrating
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'billing_charges'::regclass AND pg_get_constraintdef(oid) LIKE '%credits_200%';

-- Measurement mode: all must be 0
SELECT count(*) FROM agency_credit_ledger WHERE enforced;
SELECT count(*) FROM agent_requests WHERE enforced OR tier IN ('paid', 'blocked');
SELECT count(*) FROM billing_charges WHERE kind IN ('credits_200', 'credits_500');

-- Requests per agency this month
SELECT "agencyId", "periodKey", tier, count(*), sum("costMicros") / 1e6 AS usd FROM agent_requests
 GROUP BY 1, 2, 3 ORDER BY 2 DESC, 1, 3;

-- Founder: only exempt, for 103 / 332
SELECT tier, count(*) FROM agent_requests WHERE "agencyId" = 103 AND "userId" = 332 GROUP BY 1;

-- Every AI kind this month, with missing cost
SELECT "operationKind", count(*) AS calls, sum("costUsd") AS usd,
       count(*) FILTER (WHERE status = 'success' AND "costUsd" IS NULL) AS unknown_cost
  FROM ai_usage_events WHERE "createdAt" >= date_trunc('month', now()) GROUP BY 1 ORDER BY 3 DESC NULLS LAST;

-- Meta delivery at the rate card (upper bound: the free tier is not applied)
SELECT "agencyId", count(*), sum("reservedMicros") / 1e6 AS usd FROM owner_personal_reminders
 WHERE "dispatchedAt" >= date_trunc('month', now()) AND "costReleasedAt" IS NULL
   AND status IN ('sent', 'dispatching', 'unknown') GROUP BY 1;
```

Logs: `[credits:report]` appears hourly with all four categories. `reliable: false`, or `measurement incomplete`, means cost is missing or a kind is unclassified.

## 6. Rollback

Use the smallest step that fixes the problem.

1. **Stop measuring:** remove `CREDITS_METERING` and `CREDITS_UI_AGENCY_IDS`, redeploy. The ledger stays; nothing reads it.
2. **Revert the code:** promote the previous Production deployment. The migration can stay: it is additive.
3. **Revert the schema, only after step 2 and only if needed:** run the migration's `down`. It refuses if any pack charge exists, and it deletes the ledger.

## 7. Enabling locally

In `.env.local`: `CREDITS_METERING=1`, `CREDITS_UI_AGENCY_IDS=<id>`, and `AI_USAGE_LEDGER=1`. Remove them to disable. Tests: `NODE_ENV=test npx vitest run --no-file-parallelism __tests__/credits`.

## 8. Before enforcement or sales

- **Pro:** the plan promises unlimited AI (fast and smart modes). Pro agencies stay unenforced until that changes and `CREDITS_ENFORCE_ON_PRO=1` is set.
- **Grow documents:** no receipt or tax document exists for any Grow token charge. Confirm with Grow and the accountant.
- **Refunds:** there is no refund path or process.
- **Grow confirmation:** the Production dispatch and lookup evidence are recorded in `lib/payments/grow/providerEvidence.ts`. An uncertain charge is resolved by the existing reconcile job; one it cannot determine stays open and blocks further purchases for that agency.
- **Prices:** 200/₪49 and 500/₪99 are not validated against the AI-cost model.
- **Automation:** measurement and an alert exist, but no hard spend cap. Enforced today: each agency's auto-reply daily count and `AI_ENABLED`. `AI_DAILY_USD_CAP` is per server instance and in memory.
