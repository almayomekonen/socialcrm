# Catalog Adoption Strategy

**Status:** binding sequencing document. Companion to
[`customer-automation-builder-final.md`](./customer-automation-builder-final.md)
(the frozen architecture) — that document says *what* the architecture is; this
one says *how the running system gets there without ever risking production*.

**The governing constraint:** the email engine runs in production, sends real
mail in customers' names, and has no undo. Every step below is therefore
reversible, independently shippable, and behaviour-preserving by construction.

---

## The core idea: describe, then pin, then consume, then delete

Adoption runs in four movements, in this order and never any other:

```
  DESCRIBE            PIN                    CONSUME              DELETE
  the catalog    →    CI proves catalog  →   runtime reads    →   the hardcoded
  entry exists        == engine              the catalog          definition
  (B1)                (B1)                   (B2, B3, B4)         (B2, B3, B4)
```

The middle step is the one people skip, and it is the one that makes this safe.
A catalog entry that merely *exists* is a comment. A catalog entry that CI
proves *equals* the running engine is a contract — and a contract can be
switched over without a leap of faith, because the two sides are already
known-identical.

---

## Why B1 pinned instead of consumed

B1 registered `lead.created`, `lead.status_changed` and `email.send`, then
asserted that the engine's hardcoded definitions match them exactly — rather
than making the engine read them. Three reasons, in order of weight:

1. **TypeScript safety would have been the price.** `TRIGGER_TYPES` is
   `['lead_created','status_changed'] as const`, and `TriggerType` is derived
   from it. Deriving that array from catalog data at runtime collapses the type
   to `string`, and with it every exhaustiveness check in the worker, the
   actions layer and the queue. Trading compile-time guarantees for
   "architectural purity" is a bad trade, and the frozen spec's Law 3 (unknown
   ⇒ inert) depends on those literal unions being real.
2. **B1's gate was byte-identical behaviour.** Switching the source of truth
   and verifying identity in the same phase means that if something breaks you
   cannot tell which change did it. Pinning first isolates the variable.
3. **Pinning is not weaker than consuming — it is differently strong.** A
   pinned system cannot drift: if the engine or the catalog changes alone, CI
   fails. What pinning does *not* give you is a single source of truth at
   runtime, which is what the later phases buy, one narrow surface at a time.

Pinning is scaffolding with a demolition date. Every pinned surface below names
the phase that consumes it.

---

## Phase-by-phase: who stops being hardcoded, and when

| Phase | First runtime consumption | Hardcoded knowledge removed |
| --- | --- | --- |
| **B1** | none (pinning only) | none |
| **B2** | **The law pipeline.** `decideSend` composes from the action's declared `laws` instead of a fixed sequence. | The hardcoded law sequence in `laws.ts` |
| **B3** | **The Builder.** Event picker, conditions, variables, timing anchors and preview all render from catalog metadata. | The Builder's hardcoded trigger list, variable chips, timing options, and the `sheetOptions.ts` integration literals |
| **B4** | **Connections and Sources.** Parameter options resolve through `connection.options()`. | Per-integration option lookups |
| **B5** | **The action executor registry.** The worker dispatches on the action's declared key. | The worker's single hardcoded email path |
| **B6** | **The general condition evaluator.** Emission and execution both evaluate `field · operator · value` from catalog metadata, partitioned by freshness. | The `targetStatus` / `sourceFilter` projection, `sourceFilterMatches`, and the hardcoded premise-expiry comparison |
| **B6b** | **Complete action independence.** Executors own their dependencies (`defaultDeps`), recipients are generic, `sendTest` goes through `executor.test()`, variable validation is action-driven. | `WorkerDeps.send` / `.replyTo`, the email-shaped law facts, the `sendTest` bypass, the email-driven token validation |
| **B7** | nothing new — the proof | nothing; a new connector must land with **zero** Builder or engine commits |

### B7 result — the proof held, with one honest correction

Adding Calendly required a connector, a catalog registration, a registry line —
and **one thing the phase brief did not anticipate**: an additive migration
appending `appointment_booked` to the trigger vocabulary, `webhook` to the
origin vocabulary, and creating the generic `automation_connections` /
`automation_sources` tables.

That is not a Builder change and not an engine branch; it is Law 3 in its
literal form (vocabularies are append-only) plus the storage a brand-new
integration needs because, unlike WhatsApp, it has no pre-existing table. The
generic tables and the generic `webhook` origin are both one-time costs: the
NEXT connector needs neither.

**Builder diff: zero.** `git diff --stat -- components/settings/automations`
is empty for the whole phase, and a second integration invented entirely inside
the test suite ("Omega Calendar") drives the shipped Builder components,
requirement runtime, condition evaluator and ingest pipeline without a single
production line changing.

### Revision — the condition evaluator moved into B6 (and there is no B8)

The B5 audit surfaced the condition projection as the one bridge with no
removal phase, and proposed a new B8 for it. That was rejected, correctly:

> The legacy condition projection is still part of the execution path. The
> architecture should not be declared complete while execution still depends on
> legacy projections.

A phase plan that ends with "…and one legacy projection remains, scheduled for
later" has not finished; it has deferred. So the evaluator became B6, and the
channel-law work that used to be B6 shifted to **B6b**, ahead of the B7 proof.
Nothing was dropped and nothing was added — the order changed so that the
architecture is genuinely complete before it is demonstrated.

**B2 is the first phase in which the runtime consumes catalog metadata.**
It is deliberately the narrowest possible first bite: one function, one
declaration list, no I/O, fully unit-testable, and provably identical for the
only action that exists.

**B3 removes Builder knowledge.** Until then the Builder keeps its hardcoded
options and its two integration literals — an enumerated exemption in
`builderBoundary.test.ts` that may only shrink and must be empty when B3 ends.

**B5 removes connector-shaped knowledge from the engine** (the assumption that
"the action" means "send an email"). **B6 removes the last legacy projection
from the execution path.** **B6b removes the email shape from the law layer.**
No phase removes connector knowledge from *connectors* — that is where it
belongs and where it stays.

---

## When the Catalog becomes the single runtime source of truth

**At the end of B6**, for the automation domain: from that point, the set of
events, the set of actions, the laws each action obeys, the conditions each
automation narrows on, and everything the Builder renders are all read from the
catalog at runtime. Nothing in the engine or Builder restates them.

B5 was previously named as this milestone. It was not: execution still reached
its narrowing through `targetStatus` and `sourceFilter`, and a source of truth
that the execution path bypasses is not the source of truth. B6 is the
milestone because B6 is where that bypass ends.

Two qualifications, stated plainly so nobody mistakes the milestone for
completeness:

- **B6b completed it for execution.** The worker names no channel at all
  (CI-enforced), so `task.create`, `sms.send`, `webhook.post` and
  `internal.note` are each a catalog entry plus an executor.
- **Suppression's channel dimension is still owed** (engine prerequisite #1).
  B6b made the law layer channel-agnostic in shape — `suppression` is a
  declared per-action law and recipients are generic — but the
  `automation_lead_suppressions` table is still keyed `(agencyId, leadId)`.
  That is a migration of MEANING over consent data, and it must be paid before
  the first real non-email action ships, not before the architecture is
  complete.
- **The persisted vocabulary never migrates.** `automation_jobs.trigger` will
  hold `lead_created` forever (see below). The catalog is the source of truth
  for *meaning*; the database keeps the strings it was born with.

---

## Bridges: which are temporary, which are permanent

| Bridge | Purpose | Fate |
| --- | --- | --- |
| **`engineBridge.ts`** — catalog keys ↔ `lead_created` / `status_changed` / `send_email` | The frozen spec mandates namespaced keys; production rows carry unnamespaced ones under CHECK constraints | **PERMANENT.** Renaming would migrate meaning over live data for zero user benefit — exactly what the engine ADRs forbid. A small, total, round-tripping bijection is far cheaper than rewriting history so two strings match. It is not scaffolding and should not be scheduled for deletion. |
| **Conformance pins** (`catalogConformance.test.ts`) | Prove catalog == engine while both exist | **TEMPORARY per surface.** Each assertion dies when its surface is consumed: the law assertions become redundant at B2, the variable/trigger assertions at B3. Delete them as they are superseded — a pin that outlives its surface is noise pretending to be safety. |
| **`builderBoundary.test.ts` legacy exemptions** | Tolerate the pre-catalog Builder's integration literals | **TEMPORARY.** Must be empty at the end of B3. The test already forbids the list growing and fails on stale entries. |
| **The `laws` declaration on actions** | Let the engine compose per-action pipelines | **PERMANENT.** This is architecture (§3.8), not transition. |
| **Universal guards** (`origin_import`, `lead_deleted`, `premise_expired`) | Engine-level invariants that are not per-action laws | **PERMANENT and deliberately not in the catalog.** They protect the engine's own integrity, apply to every action that will ever exist, and are not a channel policy anyone should be able to opt out of by omitting a declaration. |

---

## The rule that keeps this honest

> **No phase both switches a source of truth and verifies it for the first
> time.** Verification always lands one phase before consumption.

If a future phase cannot be sequenced that way, it is too big and must be
split.
