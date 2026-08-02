# ADR-008 — Definition Storage & Versioning

**Status:** Accepted (2026-08-02, with the approval of
`customer-automation-engine-migration-plan.md` — the migration plan is the
concrete realization of these principles and was reviewed against them).
This ADR fixes the principles; it deliberately contains no schema.
**Date:** 2026-08-02

## Context

Platform automations are code: versioned by git, migrated by deploy. Customer
automations are **user data**: thousands of rows referencing engine concepts
(triggers, actions, timing, laws) that will evolve for years. The storage
principles chosen at the first migration decide whether every future engine
change is additive or a data migration. Four stores exist conceptually:
definitions, jobs, activity log, lead suppression (plan Phase 2).

## Decision (principles the Phase 2 migration plan must satisfy)

1. **Closed enums as persisted strings, forward-compatible by inertness.**
   Trigger and action identifiers are stored as strings from the closed
   registries. An engine encountering an unknown identifier (older engine,
   newer data — or a retired concept) holds that automation **inert and
   surfaces דורש טיפול** — never crashes, never guesses, never partially
   executes.
2. **Definitions are versioned rows.** Each definition carries an explicit
   schema-version marker; the engine reads all versions it knows and treats
   unknown versions per rule 1. Edits update in place (spec §8: queued sends
   render content current at send time); the activity log — not definition
   history — is the audit record.
3. **The log stores what was true at send time.** Activity entries snapshot
   the rendered subject and delivery-relevant facts, so later edits or
   deletions of the definition never falsify history (spec: "history outlives
   the automation" — delete removes the card, never the log).
4. **Dedup/claim records carry their semantics** (the ADR-005 key-design
   requirement): the send-once claim includes an explicit semantics/period
   component so future semantic options are new dimensions, not
   reinterpretations.
5. **Additive-only relationship to the existing schema.** No existing table is
   modified; leads are referenced by id, never extended. (The optional
   event-date anchor, ADR-007, lives on the definition — not on leads.)

## Alternatives considered

1. **Freeform JSON rule logic** (user-composed conditions/branches persisted
   as expression trees) — maximally flexible, unvalidatable, and the storage
   shape of exactly the workflow-builder product the spec rejected.
2. **Definitions as references to code-defined recipes only** (no stored
   user content beyond a recipe key + params) — elegant until the first
   user-edited message, which is the core of the product; content is user
   data and must live as data.
3. **Immutable versioned definition copies per edit** — full history at the
   definition layer; rejected because the activity log already provides the
   audit trail users need (rule 3), and immutable copies complicate the
   "queued sends use current content" semantic the spec chose.

## Why this decision

These five rules make every anticipated evolution — new actions, new channels,
new timing options, semantic extensions — additive. The inertness rule (1) is
the engine's forward-compatibility contract: safety degrades to silence plus
an honest card state, never to wrong execution.

## Consequences

- The Phase 2 migration document is reviewed against these five rules; any
  deviation amends this ADR first.
- "דורש טיפול on unknown concept" becomes a tested engine behavior from V1.
- Log volume grows with sends; retention policy is a named open item for the
  migration plan (not a reason to weaken rule 3).

## Future implications

WhatsApp/SMS actions, conditions, and sequences reuse the same definition
store with new enum values and version increments. A future export/import of
automations (agency templates) becomes feasible because definitions are
self-describing versioned data.
