# Research latency — observed, not yet optimised

**Status: observation only. No change proposed, no deadline moved.**

## What was measured

| run | n | avg | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| Research eval, live cases (2026-09-08) | 10 | 40.3s | 48.2s | **70.4s** | 70.4s |
| — research phase alone | 10 | 20.0s | — | — | 39.3s |
| CRM-only benchmark, evaluable cases | 30 | 19.5s | 18.2s | 28.0s | 29.2s |

The research deadline WAS **90s** (`deadlineMs: 90000`) when this was measured, separate
from the 40s the CRM path uses; p95 sat at 78% of it. It is now **45s**, because the
route running it has `maxDuration = 60` — past 60s the platform killed the run with no
answer. Against these measurements (p50 48.2s, p95 70.4s) roughly half of research
questions now end as a clean `deadline` answer; getting them back means raising the
route's `maxDuration` first (see `REQUEST_DEADLINE_MS` in lib/agent/budget.ts).

## The one decomposition already available

A shape probe issued the same hosted searches with **no agent loop around them** —
no CRM tools, no structured-output phase, no validation:

| scenario | provider round trip |
| --- | --- |
| no usable source (0 tool calls) | 2.1s |
| search + openPage | 3.5s |
| search only | 7.9s |
| page opened after a search | 7.4s |
| multiple searches | 8.1s |
| multiple opened pages (3 actions) | 11.1s |

So the provider's own search-and-read work is **2–11s**. A live research case
takes 40s on average and 70s at p95. **The hosted search is not where the time
goes** — most of it is the agent loop around it, and any optimisation aimed at
search breadth would be aimed at the wrong layer.

That is as far as the current instrumentation can honestly divide it. What is
missing is not effort; it is data.

## What would be needed to decompose the rest

`toolTimings` cannot see hosted search: it wraps our own `execute`, and the
provider runs this one. `researchWallMs` is measured at the phase seam, so it
covers the whole model turn that contained the searches — model reasoning
included — not the searches themselves.

To attribute the remaining ~30–60s, these would be needed:

1. **Per-`web_search_call` start/end timestamps.** The response carries `id` and
   `status` per call but no timing. Streaming would expose ordering
   (`response.output_item.added` / `.done` for each `web_search_call`), which is
   the only place per-call duration could come from without guessing.
2. **Time to first token of the answer turn**, separating "still searching" from
   "writing the answer". `generateText` reports neither; `streamText` would.
3. **The structured-output phase, measured apart from the research phase.** The
   two-phase autonomous path already splits these; the interactive research path
   reports one `researchWallMs` covering both.
4. **Provider-side queueing vs execution.** `response.usage` has no timing
   breakdown, so a slow call cannot currently be told from a queued one.

Items 1 and 2 both require moving research to a streaming call, which changes how
the answer reaches validation — a real design change, not instrumentation. That
is the reason this document ends here rather than in a patch.

## Why nothing is being changed now

p95 is inside the deadline. The measurement above says the obvious lever (search
breadth, `searchContextSize`, harvest caps) is not the one that matters, and the
lever that would matter cannot be pulled without first being able to see what it
moves. Optimising against a single number, without the decomposition, is how a
system gets slower in a place nobody was watching.
