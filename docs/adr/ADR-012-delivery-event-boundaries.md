# ADR-012 — Delivery Event Boundaries

**Status:** Accepted (2026-08-02). Binding for every delivery-telemetry surface,
present and future.
**Date:** 2026-08-02

## Context

Once the engine sends, the provider reports back: delivered, bounced,
complained, opened, clicked. This telemetry is genuinely useful — the spec's
activity log promises honest delivery state, and a hard bounce must stop the
engine from emailing a dead address again.

It is also the single most dangerous input the engine has. Every competitor
eventually turns delivery events into triggers ("email a follow-up when they
open"), and that step converts an observability feed into a business-logic
feed: opens that Apple's Mail Privacy Protection fabricates start driving real
messages to real customers. This ADR draws the line before the first delivery
event is ever ingested.

## The Prime Rule

> **Delivery events never trigger automations. In V1 they may only ever
> _subtract_ future sends — never add, resume, or schedule one.**

Telemetry is allowed to make the engine quieter (mark an address
undeliverable, suppress a complainer). It is never allowed to make the engine
louder. Concretely, a delivery event may **never**: create a job, enqueue an
event, resolve a claim, resume a paused automation, or alter any timing.

A future feature that acts _on_ opens, clicks, or bounces is a **new product
decision** requiring its own ADR, its own consent analysis, and — because
open-tracking is substantially fictional post-MPP (spec §8) — an honest
accounting of what the signal is actually worth. It is not an extension of
this ADR; it supersedes it.

## Which delivery events exist (engine-side)

The engine's delivery ladder is exactly the Phase 2 vocabulary, unchanged:

```
sent(1) ──→ delivered(2) ──→ bounced(3) | failed(3)
```

Monotonic by rank; a lower or equal rank never overwrites a higher one. `sent`
is written by the worker at send time, never by a webhook. There is no
`opened`, no `clicked`, and no `delayed` state — their absence is the design.

## Which provider events are persisted

| Provider event     | Effect                                                                                                                                            | Rationale                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email.sent`       | Ladder no-op (rank 1 vs existing 1)                                                                                                               | The worker already recorded it; processed only to prove idempotency, never to create a row                                                                                    |
| `email.delivered`  | Ladder → `delivered`                                                                                                                              | The one genuinely informative positive signal                                                                                                                                 |
| `email.bounced`    | Ladder → `bounced`; **hard** bounces also write an address block (`automation_email_blocks`) keyed on the bouncing address from the event payload | Protective subtraction — the `address_undeliverable` law then skips future sends                                                                                              |
| `email.complained` | Lead suppression (`source = 'spam_complaint'`); **ladder untouched**                                                                              | A complaint is not a delivery failure — the mail _was_ delivered. Recording it as `failed` would be a lie in the activity log. Suppression is the honest, protective response |

Nothing else is persisted. In particular, an address block is written from the
**event's own recipient address**, not from the lead's current record — the
address that bounced is the fact; the lead's row may have been corrected since
(migration plan §1.0).

## Which provider events are ignored

| Ignored                                                   | Why                                                                                                                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email.opened`, `email.clicked`                           | Post-MPP these are substantially fabricated; the spec bans open/click metrics outright. Ignoring them at ingestion is what makes that ban structural rather than aspirational |
| `email.delivery_delayed`                                  | Transient and non-terminal; the ladder cannot express it without a schema change, and "delayed" tells the user nothing actionable                                             |
| `contact.*`, `domain.*`                                   | Provider-account housekeeping, not engine business                                                                                                                            |
| **Any event whose message id matches no engine send row** | Shared-account partitioning — see correlation. This is how platform-email events arriving on the same account are ignored without ever touching a platform store (spec §0)    |
| Any unrecognized event type                               | Logged with its type and ignored. Unknown ⇒ inert, never guessed (ADR-008 rule 1 applied to telemetry)                                                                        |

Ignored means: **no writes of any kind**, plus one structured log line. It is
never an error, never a non-2xx response.

## Correlation strategy

- Correlation is by the **provider's immutable message id**, captured on the
  `sent` activity row at send time (`providerMessageId`) and never mutated.
- A webhook resolves its event by that id against engine `sent` rows. A match
  yields the owning agency and lead; **no match means the event is not ours**
  and is ignored.
- Correlation is never by recipient address, subject, or timestamp — those are
  mutable, ambiguous, and shared across domains.
- Because platform email flows through the same provider account, this lookup
  _is_ the domain boundary at runtime: the engine can only ever write to rows
  it provably owns.

## Idempotency guarantees

Every ingestion path is idempotent by construction, not by bookkeeping:

1. **Ladder updates** are guarded by the monotonic rank comparison in SQL — a
   replayed `delivered` finds rank 2 already present, matches zero rows, and
   changes nothing.
2. **Address blocks** and **suppressions** are conflict-ignoring inserts on
   their unique keys.
3. **Nothing is counted, incremented, or enqueued.**

Therefore replaying the provider's entire webhook history — in any order, any
number of times — converges to the same state as processing it once. No
dedup table is needed, and none is introduced.

## Event ordering assumptions

**None.** Delivery events may arrive out of order, duplicated, or interleaved
across messages. The rank ladder absorbs disorder: a late `delivered` arriving
after a `bounced` is a no-op (rank 2 < 3), which is correct — the terminal
truth wins regardless of arrival sequence.

## Duplicate webhook handling

A duplicate is a no-op by the guarantees above and returns 2xx. Duplicates are
expected (providers retry on any non-2xx, on timeouts, and at-least-once by
design) and are never treated as anomalies.

## Late delivery handling

Late events are applied whenever they arrive; there is no acceptance window
beyond signature-timestamp tolerance. If an event arrives after its activity
row has been pruned or its automation deleted, the correlating update matches
nothing — a no-op, logged.

## Missing delivery handling

If an event never arrives, the row simply stays at `sent`, and the UI's
`sent` copy means exactly what it has always meant: **accepted for delivery,
not proof of arrival** (the WhatsApp `sent ≠ delivered` precedent). Missing
telemetry degrades honesty gracefully — it never inflates a claim, and there
is no reconciliation poller inventing one.

## Provider outage behavior

- **Webhook delivery outage:** rows hold at their last known state; the engine
  is unaffected because no business logic reads delivery state. Events that
  arrive after recovery apply normally (idempotent, order-free).
- **Sending outage:** a concern of the worker (transient failure class,
  ADR-011), not of this ADR.
- **Endpoint outage on our side:** the provider retries; because ingestion is
  idempotent, retries are safe. We never ask for a replay we cannot absorb.

## Consequences

- Phase 5 ships one signature-verified ingestion endpoint implementing exactly
  the tables above; it holds no ordering state and no dedup ledger.
- The bounce law (`address_undeliverable`) and consent suppression become
  reachable through telemetry — the only two effects telemetry is permitted.
- Engagement-driven automation, if ever proposed, starts from a blank ADR and
  a fresh consent review — never from "we already ingest opens." We do not.
