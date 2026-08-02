# ADR-005 — Send-Once Semantics

**Status:** Accepted (product sign-off 2026-08-02): the default semantic is
**once per lead per automation** — intuitive behavior now, future expansion
preserved via the key-design requirement below. Freezes irreversibly when the
first production send is recorded.
**Date:** 2026-08-02

## Context

Automations fire on events that can repeat: a status can flap A→B→A→B; a
webhook can retry; multiple edits can re-save a lead. Every recorded send is
interpreted through the dedup key that guarded it — which means the semantics
chosen now are baked into historical data permanently: sends recorded under
"once ever" cannot later be reinterpreted as "once per status entry" or the
other way around.

## Decision (proposed)

**Once per lead per automation, ever** — the dedup key is (automationId,
leadId). A status flapping back into the target state does not re-fire. This
mirrors the platform registry's send-once discipline and the IRE's
first-contact-only stance, both proven in production.

The key design must leave room for evolution without reinterpretation: the
claim record carries an explicit semantics/period component (the platform's
`periodKey` concept), fixed to the "ever" value in V1. A future "re-send on
re-entry" advanced option becomes a **new key dimension for new sends** —
never a reread of old rows under new rules.

## Alternatives considered

1. **Once per status entry** — supports "every time a lead returns to
   in-progress, nudge them," but turns status flapping into repeated customer
   contact; the spec's safety-first stance rejects it as default.
2. **Once per day per automation** — arbitrary; surprises users in both
   directions.
3. **Unlimited (no dedup)** — spam by construction; violates the spec's
   safe-by-default law.

## Why this decision

Predictability is the feature (spec §11.2): "each lead gets this email at most
once" is one sentence a non-technical owner can hold. Every real V1 recipe
(welcome, confirmation, thank-you, follow-up) is naturally once-per-lead. The
one use case once-ever cannot serve (recurring re-engagement) is roadmap
territory with its own consent stakes.

## Consequences

- Webhook retries and status flaps are idempotent by construction (with the
  queue's conflict-ignore enqueue as the second layer).
- The activity log's "לא נשלח — כבר נשלח לליד הזה" skip makes the semantics
  visible to users instead of mysterious.
- Duplicating an automation creates a new automationId and therefore a fresh
  send allowance — documented behavior, and the mechanism by which users build
  sequences in V1.

## Future implications

If evidence shows a real once-per-entry need, it ships as a folded advanced
option writing new-dimension keys (per this ADR's key-design requirement) and
a superseding ADR records the extension. Historical data is never
reinterpreted.
