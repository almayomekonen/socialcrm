# Fixture entitlement — what the benchmark needs, and who must decide it

**Status: UNRESOLVED. Tenant B is not evaluable. Tenants A and D expire 2026-09-11.**

This file records a decision that is an operator's to make, not code's. Nothing
in this repository changes the data described below, and the runner refuses to
start until someone does.

## The problem

The agent is gated by product access (`lib/ai/access.ts` → `lib/access/productAccess.ts`
→ `lib/trial`). An agency whose trial has expired is refused with
`subscription-required` **before the agent runs**, so its cases produce no
measurement at all — they are `UNEVALUABLE` under `scoring@1.1.0`.

The benchmark's four tenants hold their access three different ways, and three of
the four are on a clock:

| tenant | agency | how it currently has access | expires |
| --- | --- | --- | --- |
| A urgent | 56 | `TRIAL_ACTIVE` | **2026-09-11** |
| B healthy | 49 | `TRIAL_EXPIRED` — **already gone** | expired 2026-09-07 |
| C opportunity | 41 | `PAID` — `plan='pro'`, `planReason='manual'` (admin grant, no expiry) | never |
| D mixed | 51 | `TRIAL_ACTIVE` | **2026-09-11** |

B's trial ended on 2026-09-07, one day before the 2026-09-08 run — which is
exactly why that run scored 30/40 and why the baseline runs before it did not.

**This is not a B problem. It is a fixture-design problem.** On 2026-09-12 the
same failure takes A and D, and the benchmark drops to 10 evaluable cases out of
40 — leaving only the comped tenant. Restoring B alone buys three days.

## The smallest correct change

Make the four evaluation tenants **`trialExempt`**, which resolves them to
`LEGACY` in the state machine (`lib/trial/index.ts` `getTrialState`, precedence
`PAID → LEGACY → …`) and therefore to `hasAccess: true`, permanently.

It is the minimum on every axis that matters:

- **One boolean column, on four rows.** No `subscriptions` row, no `plan` change,
  no date arithmetic, nothing that decays.
- **It asserts nothing false.** `trialExempt` means "outside the trial
  lifecycle", which is exactly true of a permanent evaluation fixture. Granting
  `plan='pro'` instead (the way tenant C holds access) would state that these
  agencies pay, which they do not, and would pollute any revenue query that
  counts pro agencies.
- **It is the durable fix, not a renewal.** Extending `trialEndsAt` restores the
  benchmark and re-breaks it on a date nobody will be watching for.

### The exact statement

```sql
-- Evaluation fixtures for socialcrm-agent-40. Local development database ONLY.
UPDATE agencies SET "trialExempt" = true WHERE id IN (56, 49, 41, 51);
```

`fixtures/grant-evaluation-entitlement.sql` holds this verbatim, with its
guards, so the change is reviewed as code and applied deliberately.

## Why this repository does not apply it

Entitlement is the server-authoritative revenue and access boundary
(`claude/do-not-touch.md` §1, §4). A benchmark that grants itself product access
whenever it finds a gate closed is not measuring a gated product — and an
evaluation harness that writes to shared data to make its own numbers go up is
the precise failure this benchmark was rebuilt to prevent.

So the decision is left where it belongs.

## What is required of an operator

1. Confirm this is acceptable on the **local development database** (agencies 56,
   49, 41, 51 are development fixtures, not customer records — verify before
   running).
2. Apply `fixtures/grant-evaluation-entitlement.sql`.
3. Record the date and who applied it in the table at the bottom of this file.
4. Re-run preflight to confirm all four admit:
   `npx tsx --tsconfig …/tsconfig.eval.json …/run.ts A1` — it aborts on any
   blocked tenant.

Until step 2 happens, `run.ts` refuses to start. `EVAL_ALLOW_UNEVALUABLE=1`
overrides that for a deliberate diagnostic run, and forces the verdict to
INCOMPLETE regardless of how the evaluated cases score.

**This must never be applied to production.** No production agency is an
evaluation fixture, and `trialExempt` on a real one hands out the product for free.

## Applied

| date | by | note |
| --- | --- | --- |
| — | — | not yet applied |
