# ADR-011 — Worker Execution Model

**Status:** Accepted (2026-08-02). Behavioral guarantees only — no
implementation detail. The Phase 4 worker is correct exactly insofar as it
satisfies this document; every future action (WhatsApp, SMS, internal)
executes under these same semantics.
**Date:** 2026-08-02

## Context

The worker is where the engine finally *acts*: it consumes queued jobs,
applies the laws, and produces sends (or would-sends). Everything upstream is
reversible bookkeeping; the worker's transitions are where money, consent,
and trust are spent. Its semantics therefore cannot be an emergent property
of the code — they are fixed here, before the code exists.

## Job lifecycle

A job moves through exactly these states; there are no others and no hidden
paths between them:

```
              claim (+attempt, lease)
  pending ────────────────────────────→ processing
     ↑                                      │
     │  lease expiry (reclaim)              ├─→ done      (outcome recorded: sent | would_send,
     │←─────────────────────────────────────┤              or idempotent completion after resume)
     │  transient failure, attempts < max   ├─→ skipped   (final business decision, reason recorded)
     │←─────────────────────────────────────┤
                                            └─→ dead      (attempts exhausted, or ambiguous-after-crash;
                                                           user-visible failure recorded)
```

**Guarantee — no job disappears silently.** Every job reaches exactly one of
`done`, `skipped`, or `dead`, and every terminal state carries its reason on
the job row. `skipped` and `dead` additionally surface to the user-facing
activity log whenever the decision concerns an active automation the user
believes is running (law skips → the Hebrew skip row; death → the terminal
failure row). The one deliberate exception: a job whose *definition* was
paused or deleted between enqueue and claim is skipped on the job row only —
the user was already told pausing cancels pending sends, so a user-facing row
would contradict the product's own promise.

## Lease semantics

- Claiming sets a lease (owner + timestamp) and increments the attempt
  counter **at claim time**, not at failure time — a crashed attempt has
  already paid for itself.
- A lease is exclusive: no other worker pass may process a leased job.
- An expired lease (owner presumed dead) returns the job to `pending` via
  reclaim, with the reclamation recorded on the row. Reclaim is the ONLY path
  that moves `processing` backward besides classified transient failure.

## Retry policy

- Only **transient** failures retry: the job returns to `pending` with a
  bounded, increasing backoff and a recorded error.
- Retries are bounded by the job's max-attempts; reaching the bound is the
  `dead` transition, never an infinite loop.
- **Every retry preserves idempotency** (see below): a retry may repeat
  *evaluation*, never repeat an *effect*.

## Failure classification

Every failure is classified; "an error happened" is not a state:

| Class | Meaning | Consequence |
| --- | --- | --- |
| **Law skip** | A law said no (suppressed, capped, premise expired…) | Not a failure. `skipped` + user-facing reason row |
| **Definition-inert** | Stored definition unusable (paused/deleted post-enqueue, unknown content version) | `skipped` on the job row; unknown-version cases surface as דורש טיפול at the definition (ADR-008 rule 1) |
| **Transient** | Infrastructure said not-now (storage, render, transport hiccup) | Retry with backoff |
| **Exhausted** | Transient failures reached max attempts | `dead` + user-facing terminal failure row (spec copy) |
| **Ambiguous-after-crash** | Live mode only: an unconfirmed claim from a crashed attempt — the send may or may not have left | `dead`, **never resent** (at-most-once; idempotency over completeness, migration plan §5). Log mode has no such ambiguity — see recovery |

## Idempotency guarantees and claim lifecycle

The claim (ADR-005/009) is the effect-guard; the job is only the work-guard:

- Order is law: **claim → effect → confirm → complete.** The effect (send, or
  the would-send activity row) happens only while holding an unconfirmed
  claim; confirmation marks the effect as having happened; completion closes
  the job.
- A failed effect **releases** the unconfirmed claim so a retry may re-claim.
  A confirmed claim is permanent and is never released by anything.
- A raced claim (another pass already owns the allowance) is a law outcome
  (`already_sent`), not an error.
- Re-running any pass over any queue state produces no second effect: the
  queue's uniqueness absorbs duplicate enqueues, the claim absorbs duplicate
  evaluations, and confirmation absorbs duplicate completions.

## Recovery after crashes

- Crash **before claim**: nothing happened; reclaim returns the job and the
  next pass evaluates freshly.
- Crash **after claim, before effect/confirm**:
  - **Log mode:** no external effect is possible, so recovery completes
    idempotently — if the would-send row exists, confirm and close without a
    second row; if it doesn't, write it once and close. No duplicates, no
    loss.
  - **Live mode:** the send may or may not have left the building — the
    ambiguous-after-crash class applies: `dead`, never resent.
- Crash **after confirm, before job completion**: the effect is recorded;
  recovery closes the job without re-evaluating.

## Cron responsibilities

The scheduled drain is the engine's heartbeat and its only steady-state
executor. Per pass it: reclaims expired leases, claims due jobs (bounded
batch), processes them, and prunes terminal queue rows past the operational
window (migration plan §4.4). It is authenticated, bounded in duration, and
safe to run concurrently with itself (leases + SKIP-LOCKED claiming make
overlap harmless). Delay accuracy is bounded by its cadence and is stated
honestly in product copy ("תוך מספר דקות") — never presented as exact.

## after() responsibilities

The post-commit kick exists ONLY to make the immediate case feel immediate:
after a successful enqueue, one bounded worker pass runs post-response. It is
best-effort by definition — it may fail, be dropped, or never fire, and the
system remains correct because the cron drains everything eventually. The
kick must never affect the emitting request's outcome (the emission
never-throws contract extends over it) and never replaces cron duties
(reclaim/prune remain cron-owned).

## Logging lifecycle and observability

- **Every state transition emits a structured log line** with a stable
  machine-readable prefix, the job identity (job, automation, agency, lead),
  the transition, and an **explicit reason** — including the transitions that
  decide to do nothing. Claim, skip (which law), would-send, send, retry
  (which class, which attempt), death (which class), reclaim, prune count:
  all observable from logs alone.
- The user-facing observability surface is the activity log (spec §8): every
  send/would-send/law-skip/terminal-failure concerning an active automation
  appears there with Hebrew copy. Job-row reasons are the engineering
  counterpart; between the two, every decision path is reconstructable.
- Worker passes log a summary (claimed / done / skipped / retried / dead) so
  a silent pass and an idle pass are distinguishable.

## Kill switch behavior

- `AUTOMATIONS_ENABLED` gates **emission**, not execution: switching it off
  stops new jobs immediately; jobs already queued still drain under their
  laws (they represent events from when the engine was on). Emptying the
  queue outright is the pause/cancel path, not the kill switch.
- `AUTOMATIONS_SEND_MODE` gates the **effect**: anything but explicit `live`
  means log mode — the transport is unreachable, and this is the only
  executable path until Phase 7 flips it deliberately. The worker consumes
  claims and counts caps identically in both modes (ADR-009); only the
  effect differs.
- Both gates are re-read per pass — no restart required for either lever.

## Consequences

- Phase 4 implements exactly this machine; its tests assert transitions,
  reasons, idempotent recovery, and the unreachability of the transport in
  log mode.
- Phase 5's delivery events attach to `sent` activity rows and never touch
  job states. Phase 6's pause action cancels pending jobs (the promise the
  definition-inert exception relies on).
- Future actions plug in at the effect step only; every guarantee above is
  action-agnostic and inherited unchanged.
