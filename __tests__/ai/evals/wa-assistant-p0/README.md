# wa-assistant-p0 — the WhatsApp assistant regression set

What the owner actually types to the WhatsApp assistant, run against the real
model, and scored on what the owner actually receives.

## What it is

- `cases.ts` — 47 cases. 35 are **real** owner questions recovered from
  production `agent_investigations` (57 rows, 2026-08-24 → 2026-10-31, agencies
  103 and 161), de-duplicated, with lead names swapped for leads in the eval
  tenant and multi-turn cases carrying the turns that preceded them. 12 are
  **synthetic**: the short social messages and the product areas the P0 brief
  named that no recorded question reached yet.
- `run.ts` — calls `runAgentInvestigation` with the WhatsApp worker's own options
  and builds the reply with the worker's own functions (`replyForAnswer`,
  `failureReply`). One run per case, no re-runs.
- `cases.test.ts` — the CI half: no model, no database, no cost.

## What it scores

Per case, deterministically: generic fallback sent, refused as an unsupported
claim, tool calls over the case's limit (0 for social and product questions),
report format where a plain reply was expected, and per-case content patterns
(e.g. a revenue question must point to «ביצועים», the price must be ₪89). The
expectations were written before the baseline and are identical across runs.
Everything else — tone, accuracy of the wording — is in the reply column for a
human to read.

## Running it

Needs the eval tenant (agency 41, user 183 — tenant C of socialcrm-agent-40,
paid with no expiry) in a database at the current migration level, and live AI
credentials. Costs about $4 for all 47 cases.

```
DATABASE_URL=<local eval db> npx tsx \
  --tsconfig __tests__/ai/evals/socialcrm-agent-40/tsconfig.eval.json \
  --env-file=.env.local __tests__/ai/evals/wa-assistant-p0/run.ts <label> [caseId | kind]
```

## Recorded runs (results/)

| run | what | passed |
| --- | --- | --- |
| `2026-10-31-baseline` | main 8e565a2d behaviour (reply logic extracted, unchanged) | 33 / 47 |
| `2026-10-31-after` | P0: conversational replies + product knowledge | 44 / 47 |
| `2026-10-31-recheck-M7-*`, `-M8-*` | M7, M8 re-run 3× each | 6 / 6 |
| `2026-10-31-after-dedup-*` | product + financial after the headline de-duplication | 13 / 13 |

In the `after` run, M7 and M8 stopped on `deadline` after 965 s and 162 s of wall
clock with zero tool calls, against a 35 s deadline that aborts the model call.
That is the process stalling (the run crossed midnight on a laptop), not the
answer; the six re-checks completed in normal time. The `after` file is left as
recorded.
