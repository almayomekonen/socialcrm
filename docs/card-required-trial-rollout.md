# Card-required trial (Grow card tokens) — rollout

**Status: NOT production-ready.** Provider verification, charge dispatch and
reconciliation are disabled until Grow sandbox evidence exists, and the customer
terms are not approved. See "Launch requirements" below.

## 1. What it does

A new agency saves a credit card on Grow's hosted page before its 7-day trial
starts. Nothing is charged at that moment. The trial starts only when Grow's
server-to-server callback has been verified with Grow itself. At the end of the
trial the saved token is charged ₪89, and monthly after that, unless the
customer cancelled.

Agencies without a confirmed card — every existing customer, every legacy
(`trialExempt`) agency, every Payment-Link subscriber — behave exactly as before.

## 2. Flags (absence-blocks — unset means OFF)

| Flag | `'true'` enables | Unset (default) |
|---|---|---|
| `CARD_REQUIRED_TRIAL_ENABLED` | The welcome modal asks for a card; the trial write point requires an active card; `startTrial()` refuses | Click-to-start trial, exactly as today |
| `SUBSCRIPTION_CHARGES_ENABLED` | The cron pass schedules and (when dispatch is established) charges; the pre-charge reminder has an audience | No charge is ever attempted, no reminder is sent |

Both flags are read at request time — no deploy is needed to turn them off.

## 3. Environment variables (server-only, per Vercel environment)

| Variable | Meaning |
|---|---|
| `GROW_MODE` | `sandbox` or `production` — picks the Grow base URL in code |
| `GROW_USER_ID` | Grow business identifier (per environment) |
| `GROW_PAGE_CODE_TOKEN` | Grow page code for "Get Token Only" |
| `GROW_SANDBOX_ISOLATED_DATA` | `true` only on a staging deployment whose database is NOT production. Required for any sandbox Grow call |
| `APP_HOST` | Public host used for the Grow success/cancel/notify URLs (never localhost) |
| `CRON_SECRET` | Authorizes `/api/cron/subscription-charges` |

`assertGrowRuntime()` refuses every other combination: production mode only on
the Vercel production deployment, sandbox mode never on it.

## 4. Provider-evidence gates (`lib/payments/grow/providerEvidence.ts`)

Three behaviours depend on Grow specifics the documentation does not establish.
Each stays disabled until sandbox evidence is recorded and referenced there:

| Gate | While closed |
|---|---|
| `tokenSaveVerification` | A callback is recorded; no card is activated and no trial starts |
| `tokenChargeDispatch` | Charges are persisted and scheduled; nothing is sent to Grow |
| `tokenChargeReconciliation` | An unknown outcome stays unknown; nothing is retried on a guess |

Never open a gate from a local mock or a documentation example.

## 5. Enable locally

Card setup needs a public callback URL, so a full local run is not possible;
the flows are exercised by the test suites (`__tests__/payments/**`).

```bash
CARD_REQUIRED_TRIAL_ENABLED=true SUBSCRIPTION_CHARGES_ENABLED=true npm run dev
```

## 6. Production rollout (order matters)

1. Approve the customer terms (section 9) and publish them on `/terms`.
2. Obtain Grow production `userId` / `pageCode` after Grow's integration review.
3. Apply the migrations manually, before deploying: `npm run migrate`.
4. Give Grow the notify URL: `https://<APP_HOST>/api/payments/grow/notify`.
5. Add the cron entry to `vercel.json` (deliberately absent today):
   `{ "path": "/api/cron/subscription-charges", "schedule": "*/5 * * * *" }`.
6. Record sandbox evidence and open the provider-evidence gates.
7. Turn on `CARD_REQUIRED_TRIAL_ENABLED`, watch new signups, then
   `SUBSCRIPTION_CHARGES_ENABLED`.

## 7. Disable safely

Unset `SUBSCRIPTION_CHARGES_ENABLED` to stop all charging (pending attempts stay
pending; an attempt that waits more than 24 hours is cancelled as
`stale_undispatched` rather than charged late — the customer recovers by
confirming a card, which reopens that period). Unset
`CARD_REQUIRED_TRIAL_ENABLED` to return new signups to click-to-start.
Confirmed cards and their subscriptions are untouched by either.

## 8. Monitoring

```sql
-- setups stuck pending > 1h (abandoned, or a callback that never arrived)
SELECT id, "agencyId", "createdAt", "lastVerificationError"
  FROM billing_payment_methods WHERE status = 'pending' AND "createdAt" < now() - interval '1 hour';

-- cards refused on verification (e.g. Grow reported something other than a clean token save)
SELECT id, "agencyId", "invalidReason" FROM billing_payment_methods WHERE status = 'needs_review';

-- charges by outcome, last 7 days
SELECT status, kind, count(*) FROM billing_charges WHERE "createdAt" > now() - interval '7 days' GROUP BY 1, 2;

-- unknown outcomes: each needs reconciliation before anything is retried
SELECT id, "agencyId", "updatedAt", "errorClass" FROM billing_charges WHERE status = 'unknown';

-- periods stopped because they waited too long; recoverable with a new card
SELECT id, "agencyId", "periodKey" FROM billing_charges WHERE status = 'cancelled' AND "errorClass" = 'stale_undispatched';

-- possible double charge (must be empty)
SELECT * FROM billing_charges WHERE "errorClass" = 'duplicate_period_success';
```

Card-trial funnel (exclude internal/seed agencies):

```sql
WITH e AS (
  SELECT "agencyId",
    min("createdAt") FILTER (WHERE event = 'welcome_modal_shown' AND (props->>'cardRequired')::boolean) AS shown,
    min("createdAt") FILTER (WHERE event = 'card_setup_started')                                        AS setup_started,
    min("createdAt") FILTER (WHERE event = 'card_setup_failed')                                         AS setup_failed,
    min("createdAt") FILTER (WHERE event = 'trial_started' AND (props->>'cardRequired')::boolean)       AS trial_started,
    min("createdAt") FILTER (WHERE event IN ('leads_imported','lead_created_manual','activation_first_real_lead','lead_action_taken')) AS first_value,
    min("createdAt") FILTER (WHERE event = 'subscription_charge_succeeded' AND props->>'kind' = 'trial_conversion') AS first_charge,
    min("createdAt") FILTER (WHERE event = 'subscription_cancel_requested' AND props->>'billing' = 'card_token')    AS cancelled
  FROM analytics_events GROUP BY "agencyId"
)
SELECT count(shown) AS shown, count(setup_started) AS setup_started, count(setup_failed) AS setup_failed,
       count(trial_started) AS trial_started,
       count(first_value) FILTER (WHERE first_value >= trial_started) AS reached_value,
       count(first_charge) AS paid, count(cancelled) AS cancelled
FROM e WHERE shown IS NOT NULL;
```

Log prefixes: `[GrowNotify]`, `[CardSetup]`, `[SubscriptionCharge]`,
`[subscription-charges]`. No token, card number or credential is ever logged.

## 9. Launch requirements still open

1. **Grow sandbox evidence** for the three gates in section 4.
2. **Grow's written answers** (₪1 check never captured and when it is released;
   duplicate-identifier behaviour; reconciliation after a lost response).
3. **Customer terms**: `/terms` has no subscription, automatic-billing,
   cancellation or refund clauses. Proposed wording awaits owner approval; the
   consent checkbox links there, so this blocks launch, not development.
4. **Refund policy** for a charge that succeeds after a cancellation (owner
   decision). Today the paid period stands, renewal stops, nothing is refunded
   automatically and no refund is promised anywhere.
5. **Grow production identifiers** (`GROW_USER_ID`, `GROW_PAGE_CODE_TOKEN` for
   `GROW_MODE=production`). The `vercel.json` cron entry is in place.

## 10. Known limits (v1)

Monthly only; no decline-notification email; card digits and brand are stored
only as Grow reports them; tokens are deleted on our side only (Grow documents
no deletion API); mobile signups start the trial on desktop (phones are
redirected to `/activate`).

## 11. Sandbox staging environment

Grow's callbacks are registered against a staging deployment, never production.

| | |
| --- | --- |
| Callback URL | `https://socialcrm-git-feat-card-required-trial-almayos-projects.vercel.app/api/payments/grow/notify` |
| Deployment | the Vercel preview alias for `feat/card-required-trial` (stable across redeploys) |
| Database | a **separate Neon project** (`card-trial-staging`), provisioned empty — not a branch or clone of production, and not another feature's database |

Staging configuration is branch-scoped to `feat/card-required-trial` so nothing
leaks into other previews: `APP_ENV=staging`, `GROW_MODE=sandbox`, `APP_HOST` =
the alias, `GROW_SANDBOX_ISOLATED_DATA=true`, a staging-only `DATABASE_URL`,
`SECRETS_ENC_KEY` and `CRON_SECRET`, and `CARD_REQUIRED_TRIAL_ENABLED`,
`SUBSCRIPTION_CHARGES_ENABLED`, `EMAIL_AUTOMATIONS_ENABLED`,
`WELCOME_EMAIL_ENABLED` all `false`.

Two notes on what that does and does not prove:

- `GROW_SANDBOX_ISOLATED_DATA` is an **operator assertion**, not evidence. It
  lets `assertGrowRuntime()` proceed; it does not check where `DATABASE_URL`
  points. Isolation was established separately — a distinct Neon project id and
  endpoint, distinct credentials, an empty schema, and the fact that
  `config/db.ts` and `knexfile.cjs` are the only runtime readers of
  `DATABASE_URL` (the inherited `DATABASE_URL_UNPOOLED` / `POSTGRES_*` variables
  still point at production but nothing reads them). Re-verify those facts, not
  the flag, whenever the staging target changes.
- The schema was built with the repository's own baseline and migration chain.
  `scripts/bootstrap-schema.cjs` refuses any `neon.tech` URL with no override —
  a deliberate guard that was **not** modified; its exported `readBaseline` /
  `assertDatabaseEmpty` / `bootstrap` were driven directly against the verified
  empty, verified non-production target instead.

A 503 from the callback means the runtime guard refused (staging misconfigured),
not that Grow sent something invalid. Do not "fix" it by relaxing the guard.
Grow resends an unacknowledged update up to 5 more times and then stops, so a
sustained 503 window loses callbacks — it bounds the loss, it does not
prevent it.
