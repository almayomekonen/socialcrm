# socialcrm-agent-40 — the pinned Agent regression

**Benchmark version:** `socialcrm-agent-40@1.0.0` · **Scoring version:** `scoring@1.1.0`

Forty cases: ten broad business-judgement questions asked of four tenants.
Case ids are `A1`–`A10`, `B1`–`B10`, `C1`–`C10`, `D1`–`D10`.

---

## 1. Why this directory exists

The forty were run repeatedly during Phase 2.5.1, Phase 3a and the Action
Runtime work, and their results are quoted in the commit messages of
`6b5ff1fc`, `98e6ba49`, `9240c628`, `f601495a`, `9ca1505e` and `aa1aab64`.

The harness that produced those numbers was never committed. It was a throwaway
script (`scripts/_ph3a.ts`, later `scripts/_eval.ts`) written into the worktree,
run, and deleted in the same session. So every quoted result was, until now,
**unreproducible**: the claims existed, the instrument did not.

This directory is the instrument, committed.

## 2. Provenance — what was recovered, and from where

The questions, tenants and case-id scheme were recovered **verbatim** from two
independent revisions of the deleted harness, preserved in local Claude Code
session transcripts (`~/.claude/projects/-Users-User-Documents-social-crm/
4aec9f19-….jsonl`). The two revisions were written days apart, for different
phases, and their question arrays are **byte-identical** — which is the
cross-check that makes "recovered" a stronger claim than "reconstructed".

| Element | Status | Source |
| --- | --- | --- |
| The 10 questions, and their order | **Recovered exactly** | `_ph3a.ts` and `_eval.ts`, identical |
| The 4 tenants (agency + user ids) | **Recovered exactly** | both revisions |
| Case ids `A1`–`D10`, tenant-major order | **Recovered exactly** | `` `${label}${i+1}` `` in both |
| Scope resolution (role/plan read from the DB) | **Recovered exactly** | `scopeFor()` in both |
| CRM mutation firewall (tasks / follow-ups / meetings / agent_actions) | **Recovered exactly** | `_eval.ts` `counts()` |
| Spurious proposal + spurious batch counting | **Recovered exactly** | `_eval.ts` |
| Per-case failure diagnostics (rejection, `RULE_nn`, dropped, stripped, steps, evidence, investigation id) | **Recovered exactly** | `_eval.ts` failure branch |
| Deadline (40 s) and step ceiling | **Recovered** — unchanged product config | `lib/ai/tasks.ts`, `lib/agent/budget.ts` |
| `agent_action_approvals` in the firewall | **Added here** | required by the current phase brief |
| "Today-only broad" and "structural tool" **definitions** | **Formalised here** | the harness printed tool lists; these two metrics were applied *by hand* to that output in the original sessions |
| Latency capture (model wait, tool wall, round trips) | **Formalised here** | the runtime emits them on `GENERATION_COMPLETE`; the old harness only measured wall clock |
| Per-case expected answers | **Never existed** | the original defined none, so neither does this |

The last three rows are the honest edge of the recovery. Everything above them
is the original benchmark; those three are this phase's additions, versioned as
`scoring@1.0.0` so a future reader can tell them apart.

## 3. What the benchmark does *not* define

The original asserted **nothing per case**. There is no expected headline, no
expected claim set, no expected business state, no expected tool sequence. Those
are **recorded** and compared by a human across runs.

Inventing per-case expectations now would not restore the benchmark — it would
replace it with a different, stricter one wearing its name.

The only per-case *assertions* are the ones the original genuinely made, and
they are all negative: it must answer, it must not fail the claim gate, it must
not drop claims or strip refs, it must not propose a write, and it must not
touch the CRM.

## 4. Scoring contract

| Metric | Definition |
| --- | --- |
| `answered` | `ok === true`. A refusal is never an answer. |
| `unsupported-claim failures` | refused with `rejection === 'unsupported-claim'` — the claim gate destroyed the answer |
| `grounding failures` | `droppedClaims > 0 \|\| strippedRefs > 0 \|\| rejection === 'ungrounded'` — counted **even when the answer shipped**, because it shipped smaller than the model intended |
| `dropped claims` / `stripped refs` | sums of the validator's counts |
| `spurious proposals` / `spurious batches` | a non-null `proposedAction` / `proposedBatch`. All forty are intelligence-only, so any is one too many |
| `Today-only broad` | answered, touched `get_today_state`, touched **no** structural tool. A case that used *no* tools is excluded — that is a different failure |
| `saw a structural tool` | touched any of `get_business_summary`, `get_lead_health`, `get_follow_up_health`, `get_activity_trends` |
| `deadline failures` | `ok === false && stopReason === 'deadline'` |
| `unevaluable` | `stopReason === 'gate_denied'` — the AI admission gate refused **before the agent ran**. Not an agent failure, and excluded from every quality metric and from `evaluated` |
| `evaluated` | `cases − unevaluable`. The honest denominator |
| `harness errors` | the harness itself threw. **Not** an agent failure; forces `INCOMPLETE` |

**Verdict order.** A firewall breach → `FAIL`, ahead of everything. Then
coverage, which is an absence rather than a failure: fewer cases run than the
benchmark defines, **any unevaluable case**, or any harness error → `INCOMPLETE`.
Otherwise `PASS` only if every count above is clean.

**`PASS` requires all forty to have been evaluated.** No arithmetic in
`report.ts` can produce `PASS` from a partial set — a run where the gate refused
even one tenant is `INCOMPLETE`, however clean the cases that ran.

**An incomplete run is never rounded to a passing score.** If 38 of 40 ran, the
report says `38 of 40` and the verdict is `INCOMPLETE` — never `38/38`.

## 5. Immutability

- The questions, tenants and case ids are frozen by a **SHA-256 digest** pinned
  in `benchmarkIntegrity.test.ts`, which runs in CI with no model and no database.
- Changing any of them **fails that test** with an instruction: bump
  `BENCHMARK_VERSION` and accept that historical totals are no longer comparable.
- Scoring changes bump `SCORING_VERSION` instead — questions stay comparable,
  totals do not. `scoring@1.1.0` added the `unevaluable` classification; the
  `results/2026-09-08.md` record was scored under `scoring@1.0.0` and is left
  exactly as recorded, never recomputed under newer rules.
- A case that becomes invalid is **retired** in `RETIRED` with a reason. It is
  never reworded and never deleted; its id is never reused, and `retired` is
  reported as its own count rather than shrinking a denominator.

## 6. Running it

```bash
npx tsx --tsconfig __tests__/ai/evals/socialcrm-agent-40/tsconfig.eval.json \
  __tests__/ai/evals/socialcrm-agent-40/run.ts        # all 40
… run.ts B8                                            # one case
```

**Preflight.** The runner asks `admitAiRun` about each tenant before spending
anything, and **refuses to start** if any is blocked — those cases would be
`UNEVALUABLE` and the run could not produce a valid result.
`EVAL_ALLOW_UNEVALUABLE=1` overrides it for a deliberate diagnostic run and
forces the verdict to `INCOMPLETE`.

> **The benchmark is currently blocked.** Tenant B's trial expired 2026-09-07;
> tenants A and D expire 2026-09-11. See
> [`fixtures/ENTITLEMENT.md`](./fixtures/ENTITLEMENT.md) — restoring it is an
> operator decision, and this repository does not make it.

Exit code `0` = PASS, `1` = FAIL/INCOMPLETE, `2` = could not run.
A text report and the **raw per-case JSON** are written to `$EVAL_OUT_DIR`
(default `/tmp`). The raw file is the record; the summary is derived from it.

**No automatic re-runs.** A case that hits the deadline is recorded with its
investigation id, model wait, tool wall time and step count, and the run moves
on. Best-of-N is not a benchmark.

### Environment

| Requirement | Value |
| --- | --- |
| Model | `gpt-5.6` (`AGENT_OPENAI_MODEL` overrides; `DEFAULT_AGENT_OPENAI_MODEL` in `lib/ai/env.ts`) |
| Provider | OpenAI leads for `agent.investigate` (`lib/ai/providers.ts`); Anthropic/Gemini are fallbacks |
| Sampling | Not set by the product — provider default. The agent constrains output with a Zod schema, not temperature |
| Deadline | **40 s** absolute wall clock per question (`lib/ai/tasks.ts` `timeoutMs`, `DEFAULT_DEADLINE_MS`) |
| Step ceiling | 6 |
| Credentials | `OPENAI_API_KEY`, plus `DATABASE_URL` for the tenant fixtures. **Never committed** — read from `.env` / `.env.local` |
| Gate | `AI_ENABLED=true` and the four agencies admitted by `AI_AGENCY_ALLOWLIST` |
| Cost | ~$1.30 per full run |

### Tenant fixtures — the known limitation

The four tenants are **pre-existing rows in the local development database**
(agencies 56, 49, 41, 51; fixture leads marked `AGENTVAL` in agency 56 and
`PH25EVAL` in 49/41/51, in `followUpNote`). They are *not* seeded by this
directory, and this is the benchmark's weakest point — see
[`fixtures/ENTITLEMENT.md`](./fixtures/ENTITLEMENT.md) for the entitlement half,
which has already cost one run:

- A clean checkout on another machine **cannot** reproduce the numbers, only the
  procedure.
- The fixtures are **time-relative** (`createdAt` N days ago), so segments such
  as "new this week" drift as wall-clock time passes. Two runs months apart are
  not strictly comparable even on identical code.

Rewriting them as a deterministic, isolated seed would fix reproducibility and
**break comparability with every historical number** — the trade this phase
deliberately did not make. It is the first thing to revisit if the benchmark is
to outlive this database. Recorded baseline shape, for reference:

| tenant | agency | waiting | fu due | fu overdue | no next step | cold | overdue tasks | new cur/prev |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A urgent | 56 | 2 | 4 | 2 | 11 | 11 | 2 | 8 / 2 |
| B healthy | 49 | 0 | 0 | 0 | 0 | 0 | 0 | 3 / 5 |
| C opportunity | 41 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 6 |
| D mixed | 51 | 1 | 0 | 1 | 8 | 3 | 3 | 8 / 7 |

## 7. Comparing against history

Historical results (e.g. `40/40 answered, 0 grounding failures, avg 13.70s`
in `aa1aab64`) were produced by the recovered harness on these same tenants.
They are **indicative, not equal**: the fixtures have aged, the scoring metrics
above were hand-applied rather than computed, and latency depends on provider
conditions on the day.

Quote them as history. Do not present a new run as beating them unless
questions, fixtures, scoring and conditions are demonstrably identical.

## 8. Results

Each run's record lives in `results/`, newest last. The first run under this
harness — `results/2026-09-08.md` — is the reference point for everything after
it, and also documents the first fixture failure: tenant B's product-access
entitlement had lapsed, so ten of the forty never reached the model.
