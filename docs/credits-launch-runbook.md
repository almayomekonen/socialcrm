# Subscription + AI credits — launch for every agency

**Status:** code complete on `feat/credits-ga`; **not deployed, nothing enabled in
Production.** Every Production step below needs the owner (or an authorized
operator with Production access) — this runbook was written without Production
access.

Sits on top of [`usage-credits-release-runbook.md`](./usage-credits-release-runbook.md)
(measurement-only release). This document is the launch step: enforcement for
every agency.

---

## 1. The business model this implements (owner decision, 2026-11-14)

1. ₪89/month subscription; card required; 7-day trial; charged automatically after.
2. The subscription INCLUDES a monthly allowance of AI requests
   (`CREDITS_MONTHLY_ALLOWANCE`, default **50** — the existing configured value;
   no new quantity was invented).
3. Past the allowance, purchased packs: **₪49 = 200 credits, ₪99 = 500 credits**
   (unchanged). 1 credit = $0.03 of actual provider cost.
4. ONE agency balance for: Copilot, the web Agent, WhatsApp reply drafts, the
   owner's WhatsApp assistant, **and the customer-facing WhatsApp AI agent**
   (one customer turn = one request), plus the owner's agent previews.
5. Nothing left: paid AI stops, with a purchase path. CRM, inbox, leads and human
   replies are never blocked.

## 2. What changed in code (no migrations)

| Area | Change | Files |
|---|---|---|
| Every agency | `CREDITS_ENFORCEMENT=all` enforces every agency, current and future, **Pro included**; every enforced agency may buy packs (admins only) and sees its balance. The pilot lists keep working unchanged. | `lib/credits/config.ts` |
| Customer-facing agent | Each auto-response job that will call a model is admitted against the balance before any model runs. Refused → job skipped `credits_exhausted`, no message, no model; the inbound message stays in the inbox; no follow-up turn; owner emailed once per credit month. Fixed replies and the questionnaire are never metered. | `lib/credits/customerAgentRequest.ts`, `lib/inbox/autoresponse/worker.ts`, `lib/inbox/autoresponse/followUpTurn.ts` |
| Failed requests | A request that delivered nothing consumes neither allowance nor credits: released immediately (WhatsApp assistant, web Agent, Copilot, previews, skipped auto-replies) and, as a backstop, at settlement from the operation's own outcome (`failed`/`expired` assistant job, `skipped`/`dead` auto-reply, `failed` investigation). Jobs still running or awaiting a retry are not settled early. Provider cost stays recorded (`ai_usage_events`, and `costMicros` on the voided row). | `db/credits/agentRequests.ts`, `lib/waAssistant/worker.ts`, `actions/ai/askAgent.ts`, `lib/credits/copilotRequest.ts` |
| Reporting | New category `customer_agent` (auto-response job + preview), reported as `customerAgent` apart from `agent` and `automation`. | `lib/credits/aiCategories.ts`, `db/credits/report.ts` |
| Owner notice | Email `credits_exhausted` (transactional, once per agency per credit month). | `lib/emailAutomations/creditsExhausted.ts` |
| Previews | Agent preview: admins with product access only (unchanged), **plus** durable per-user rate limit (20/hour — the WhatsApp assistant's per-sender limit), admitted against the balance, released when nothing was delivered. | `lib/credits/previewRequest.ts`, `actions/autoResponse/previewAgent.ts` |
| Spend protection | `AI_DAILY_USD_CAP` now also reads today's spend from the durable usage ledger, so it holds across server instances and restarts. Ledger unreadable/off → in-memory guard only (logged). | `db/ai/dailySpend.ts`, `lib/ai/gate.ts` |
| One price table | `estimateCostUsd` reads the ledger's versioned table (was a second table that priced gpt-5.6 at $5/$30 vs $4/$20). | `lib/ai/tasks.ts`, `lib/ai/usage/pricing.ts` |
| Packs | An `unknown` pack charge is reconciled by the usage-credits cron itself (lookup only, credits granted once), no longer only by the subscription pass gated by `SUBSCRIPTION_CHARGES_ENABLED`. | `app/api/cron/usage-credits/route.ts`, `lib/payments/charges/reconcileUnknown.ts`, `db/payments/charges.ts` |

SmartBee is untouched (`lib/flags/smartbeeFlags.ts`, agency 167).

## 3. Preflight — read only (authorized operator)

1. **Deployed commit:** Vercel → Project → Deployments → Production: note the SHA.
2. **Migrations:** the credits tables must exist (`20261110120000_usage_credits.cjs`):
   ```sql
   BEGIN READ ONLY;
   SELECT name FROM knex_migrations WHERE name LIKE '20261110120000%';
   SELECT to_regclass('agent_requests'), to_regclass('agency_credit_ledger'), to_regclass('ai_usage_events');
   ROLLBACK;
   ```
   This branch adds **no** migration.
3. **Grow:** production website review approved and production credentials
   issued (Grow merchant account). `lib/payments/grow/providerEvidence.ts`
   still records `websiteReview: 'pending'` / `productionCredentials: 'pending'`
   (2026-09-17) — confirm and update that record in its own PR if stale.
4. **Environment (names/presence only, never print values)** in Vercel →
   Settings → Environment Variables → Production:
   `GROW_USER_ID`, `GROW_PAGE_CODE_TOKEN`, `CARD_REQUIRED_TRIAL_ENABLED`,
   `SUBSCRIPTION_CHARGES_ENABLED`, `CRON_SECRET`, `RESEND`,
   `EMAIL_AUTOMATIONS_ENABLED`, `AI_ENABLED`, `AI_AGENCY_ALLOWLIST`,
   `AI_USAGE_LEDGER`, `CREDITS_METERING`, `CREDITS_ENFORCEMENT`.
5. **Payers today** (exclude internal agencies 2, 6, 103):
   ```sql
   BEGIN READ ONLY;
   SELECT count(*) FROM agencies a JOIN subscriptions s ON s."agencyId" = a.id
    WHERE a.plan = 'pro' AND a."planReason" LIKE 'grow:%' AND s."expiresAt" > now();
   SELECT count(*) FROM subscriptions WHERE "growDirectDebitId" IS NOT NULL;
   ROLLBACK;
   ```

## 4. Activation order

Env changes on Vercel take effect on the **next deployment** — redeploy after each step.

| Step | Set | Effect | Gate before the next step |
|---|---|---|---|
| A. Measure | `AI_USAGE_LEDGER=1`, `CREDITS_METERING=1` | Ledger + request rows; nothing refused | 1–2 weeks of data; §5 queries look right |
| B. Open AI to everyone | `AI_ENABLED=true`, `AI_AGENCY_ALLOWLIST=all` (+ per-feature audiences, e.g. `AGENT_AUDIENCE=all`, `WA_ASSISTANT_AUDIENCE=all`, `IRE_CONVERSATIONAL_AGENCY_IDS=all` — each is a separate product decision) | AI available to every agency with product access | Durable daily cap verified in logs |
| C. Enforce | `CREDITS_ENFORCEMENT=all` | Every agency: allowance → credits → refused | Customers told (Pro previously promised "unlimited AI") |
| D. Billing | `CARD_REQUIRED_TRIAL_ENABLED=1`, `SUBSCRIPTION_CHARGES_ENABLED=true` | Trials need a card; ₪89 charged at trial end, then monthly | **Real money.** Owner sign-off + one end-to-end run on an owner-controlled test agency and card |

## 5. Verification (read only)

```sql
BEGIN READ ONLY;
-- Decisions this month
SELECT "operationKind", tier, count(*) FROM agent_requests
 WHERE "periodKey" = to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM') GROUP BY 1, 2 ORDER BY 1, 2;
-- Customer-facing turns refused for credits
SELECT count(*) FROM auto_response_jobs WHERE "skipReason" = 'credits_exhausted' AND "createdAt" > now() - interval '1 day';
-- Packs: succeeded charges vs grants (must match one-to-one)
SELECT (SELECT count(*) FROM billing_charges WHERE kind IN ('credits_200','credits_500') AND status = 'succeeded') AS paid,
       (SELECT count(*) FROM agency_credit_ledger WHERE "entryType" = 'purchase_grant') AS granted;
-- Unresolved pack outcomes
SELECT count(*) FROM billing_charges WHERE kind IN ('credits_200','credits_500') AND status = 'unknown';
ROLLBACK;
```
Logs: `[credits:report]` hourly (now includes `customerAgent`), `[ai:spend]` if the
durable spend read fails, `[usage-credits][cron] pack reconciliation failed`.

## 6. Rollback

- Stop refusing: remove `CREDITS_ENFORCEMENT` (or set anything but `all`) and redeploy. Requests run `unmetered`; nothing is lost.
- Stop metering: remove `CREDITS_METERING`. Purchased balances are preserved in the ledger.
- Code: revert the merge commit; no schema to roll back. The ledger is append-only and is never edited by rollback.

## 7. Decisions still open (not chosen in code)

1. **Allowance size for the launch.** 50 requests/month is the existing configured value. With the customer-facing agent now drawing on it (1 turn = 1 request), an agency answering ~2 customer turns a day exhausts it in under a month. Calibrate from step A data (`ai_usage_events` per `auto_response_job`) before step C.
2. **Pro subscribers' "unlimited AI" promise** (`lib/plans.ts` copy "AI ללא הגבלה…") must be changed and communicated before step C.
3. **Allowance period** is the calendar month (Asia/Jerusalem), not the subscription's billing anniversary. Idempotent and unchanged; switching to billing periods is a separate decision.
4. **Background AI** (lead summaries, conversation analysis, weekly pipeline) is not charged to customers; it is bounded by the durable daily USD cap. Whether it should also stop when the balance is exhausted is open.
