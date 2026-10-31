# AI budget — shadow measurement and proposed policy (WS1a)

Status: proposal. Nothing here is configured in Production, and no budget is enforced.

## 1. What is covered today

Every provider request goes through one of three call sites, and all three open
a durable shadow reservation when `AI_BUDGET_SHADOW=1`:

| path | file | covers |
| --- | --- | --- |
| router | `lib/ai/router.ts` (`generateObject`) | every task kind: lead summary, classify, follow-up, next step, pipeline, health, copilot, conversation analysis, auto-reply |
| Agent | `lib/agent/run.ts` (`generateText`) | web Agent, WhatsApp assistant, autonomous investigations — one reservation per model call, both phases |
| voice | `lib/agent/voice/transcribe.ts` | Agent voice transcription |

No other file imports a provider SDK or calls `generateText`/`generateObject`.

A reservation records the agency, operation (kind + id: job / investigation /
invocation), conversation and hashed contact, feature, provider, model, the
estimate with its basis (`bounded` / `partial` / `unbounded`), and on settlement
the actual with its cost basis, price versions, response models and ledger step
range. **It has no `userId` column**: user attribution comes from the usage
ledger (`ai_usage_events`), joined on `callId` / `invocationId`. No schema change
is proposed for this.

## 2. Behaviour that is already safe

- Shadow off (`AI_BUDGET_SHADOW` unset — Production today): `startShadow` returns a no-op; nothing is written.
- Shadow on: the reservation is NOT awaited before the provider call; settlement is awaited at most 250 ms after it (`SETTLE_WAIT_MS`), then continues under `after()`. A WhatsApp answer makes 1–3 model calls, so at most ~0.75 s is added to an answer, and never before the call.
- Duplicates: unique index on `callId`; reserving twice counts once; settling twice settles once (pinned, including across two server instances: `__tests__/ai/budget/crossInstance.db.test.ts`).
- Recovery: unsettled reservations are expired by `expireStaleShadowReservations`, which settles from the ledger row when one exists and otherwise charges the estimate.

## 3. Gaps found

1. **The expiry sweep piggybacks on `/api/cron/send-auto-responses`**, after the auto-reply worker. It runs every minute today, but a change to that cron silently stops budget recovery. Move it to its own cron entry before enforcement.
2. **Two price tables disagree.** `lib/ai/tasks.ts` `estimateCostUsd` prices `gpt-5.6` at $5 / $30 per M tokens with no cached-input discount; the ledger and the budget use `lib/ai/usage/pricing.ts` ($4 input, $0.40 cached, $20 output). On 2026-10-31 the same 11 WhatsApp jobs cost $1.18 by `wa_assistant_jobs.costUsd` and $0.41 in the ledger (~2.9×). The in-memory cap and the WhatsApp $2/day cap use the higher figure, so they are stricter than their dollar value suggests (the $2 WhatsApp cap ≈ $0.70 of ledger cost). Not changed here (it would change spend behaviour); align in its own PR.
3. **Limits per plan are not expressible.** `BudgetPolicy` has global limits and per-agency overrides only; paid vs trial needs a tier map (WS1c).
4. **The in-memory guard is per instance.** N instances allow N × `AI_DAILY_USD_CAP` ($20 default in Production).
5. **The global breaker applies to every feature**, including customer-facing auto-replies — tripping it would silence auto-replies platform-wide, not only the Agent.

## 4. Measured usage (Production, read-only aggregates)

`ai_runs` has no rows in 30 days; the ledger started 2026-10-31 12:29 UTC.

| measure | value |
| --- | --- |
| ledger rows / cost | 34 rows, $0.42 (19 WhatsApp Agent calls in 11 jobs, 15 lead summaries), one agency |
| agency daily max | $0.42 |
| agency hourly max | $0.11 |
| per run (WhatsApp job) | avg $0.037, p95 $0.071, max $0.076 |
| per run (job-recorded, old prices) | max $0.17 |
| auto-reply | no ledgered calls in the window — **not calibrated** |
| local evaluation runs (old prices) | ~$0.08 per WhatsApp question; ~$0.12 per web revenue question |

The window is one day and one internal agency. It can rule values out, not prove
them.

## 5. The proposed starting values, evaluated

The shadow store compares **reservations (estimates)**, not actuals. The Agent's
estimate scales with `maxSteps` and `maxOutputTokens`, so one investigation can
reserve several times what it spends. Each limit must be read against the
would-deny rate it produces in shadow, not against ledger actuals alone.

| limit | proposed | against measured | assessment |
| --- | --- | --- | --- |
| per run | $0.25 | max actual $0.076 | headroom on actuals; the multi-step estimate may exceed $0.25 for ordinary questions — confirm in shadow before enforcing |
| paid hourly | $0.50 | max $0.11 | a heavy WhatsApp session (20 questions/hour × ~$0.04) ≈ $0.80 would be denied — **raise to $1.00** |
| paid daily | $2.00 | max $0.42 | fine for the Agent alone, but it also counts auto-replies, which are not yet measured — **start shadow at $3.00** and review |
| global daily | $20.00 | $0.42 platform-wide today | fine now; at general availability 40 active agencies × $0.50 ≈ $20 would trip it and stop auto-replies for everyone — **start at $50 with an alert at 50%** |
| WhatsApp | $2/day (existing) | — | unchanged |

**Trial accounts** (to be expressible after WS1c): daily $1.00, hourly $0.50,
per run $0.25 — about a third of paid, enough for ~20 Agent questions a day.

**Proposed shadow policy for WS1a** (for `AI_BUDGET_POLICY`, once approved; global, since tiers need WS1c):

```json
{ "version": "shadow-2026-11-a",
  "perRunUsd": 0.25, "agencyHourlyUsd": 1.0, "agencyDailyUsd": 3.0,
  "globalDailyUsd": 50, "warnAtFraction": 0.5 }
```

Run it for at least seven days after the AI-usage measurement ends (2026-11-07)
and report: would-deny rate per scope and feature, the estimate/actual ratio per
feature, and which agencies would have been denied.

## 6. Database failure: recommendation

**Fail open, with the in-memory cap kept as the backstop and every failure alerted.**

- The budget store lives in the same database the request needs anyway. When that database is down the Agent's tools cannot read, the auto-reply worker cannot claim a job, and the WhatsApp worker cannot resolve an identity — so very few AI calls can happen at all, and the cost exposure of failing open is the in-memory cap per instance for the minutes of an outage.
- Failing closed protects almost nothing in a real outage, but it turns *partial* failures — a slow budget table, lock contention on one agency's counters, a timeout — into refused AI calls, including customer-facing auto-replies.
- Exception to consider: an explicit `would_deny` from a reachable store is always enforced; only an *unreachable* store fails open. A reservation timeout should be short (≤ 300 ms) and counted (`reservation_failed` already exists as an event).
