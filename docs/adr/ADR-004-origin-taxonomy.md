# ADR-004 — Origin Taxonomy

**Status:** Accepted (product sign-off 2026-08-02, including the
manual-creation sub-decision). Frozen as of Phase 1.
**Date:** 2026-08-02

## Context

Lead creation has five code paths and no single choke point
(plan §1.1). Critically, the CSV import path calls the manual-creation action
(`upsertLead`) internally — so any trigger hook that infers "a new lead was
created, fire the welcome email" from inside shared code would make bulk
imports fire automations, violating the spec's import-storm law (importing 500
leads must never send 500 emails). The engine needs a way to know *how* a lead
came to exist that cannot be fooled by code reuse.

## Decision

Every trigger emission carries an explicit **origin**, supplied by the call
site and never inferred: a closed enum, initially
`webhook_facebook | webhook_whatsapp | manual | import`. The engine's laws
make `import`-origin events inert unconditionally. Origin is recorded on jobs
and activity-log entries.

Two clarifications that are part of the decision:

- **Origin ≠ lead source.** Origin is emission provenance (how the event
  entered the engine); the lead's `source` field is what users filter on in
  automation conditions ("מפייסבוק"). They usually correlate but are separate
  vocabularies — conflating them would break the moment a source can arrive
  via two paths.
- **Sub-decision (RESOLVED — product, 2026-08-02):** manual single-lead
  creation **fires** `lead_created` with origin `manual`; imported leads
  remain explicitly excluded; the origin is always supplied explicitly by the
  caller, never inferred. The welcome recipe therefore works for a lead the
  owner just typed in, and the CSV footgun stays neutralized by the origin
  parameter.

## Alternatives considered

1. **Infer origin from context** (call stack, request type, heuristics) —
   exactly the fragility that produces the CSV footgun; rejected.
2. **Separate emission functions per path** (`emitFromWebhook`,
   `emitFromManual`, …) — equivalent information, worse ergonomics, and still
   spoofable by calling the wrong one; a required parameter on one function is
   harder to misuse silently.
3. **Exclude manual creation entirely** — safer-looking, but breaks the
   welcome recipe for the product's primary action (adding a lead) with no
   compensating safety, since `import` origin already covers the dangerous
   case.

## Why this decision

Explicit beats inferred wherever a law depends on the answer. The origin
parameter converts the codebase's riskiest structural fact into a typed,
testable contract with a permanent regression test (CSV import enqueues
nothing, always).

## Consequences

- Every emission call site must pass origin honestly; review checklist item
  for any new lead-creation path.
- Origin strings are persisted vocabulary (jobs, logs) — additions are cheap,
  renames are migrations; names chosen carefully at Phase 1.
- The import opt-in (spec §12.4), if ever built, becomes a deliberate
  re-tagging decision at the import boundary — not a loophole.

## Future implications

New arrival paths (Instagram DM ingestion, API imports, integrations) each add
an origin value and an explicit law stance (trigger-eligible or inert) at the
moment they are built — the taxonomy forces the safety conversation to happen
per path, once, in review.
