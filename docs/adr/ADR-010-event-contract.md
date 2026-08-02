# ADR-010 — The Event Contract

**Status:** Accepted (2026-08-02). Canonical for every trigger, present and
future. **No trigger may invent its own payload.** A new trigger ships only
with an amendment to this ADR defining its identity rule and conditional
fields — before code.
**Date:** 2026-08-02

## Context

Phase 3 wires trigger emission into five call sites across protected files;
Phases 4+ consume events in the worker; Phase 2 persists their vocabulary on
jobs and activity rows. Without one frozen contract, each call site and each
future trigger drifts toward its own payload — and the persisted `eventKey`,
`trigger`, and `origin` columns turn into a museum of formats no engine
version can read whole. This ADR freezes the contract. The Phase 1 type
`AutomationTriggerEvent` (`lib/automations/types.ts`) is its code form; this
document is its law form. If they ever disagree, this document wins and the
code is the bug.

## The contract (v1)

### Event identity

An event's identity is the tuple **(trigger, agencyId, leadId, occurrence
key)**. The occurrence key (`eventKey`) is derived **deterministically from
business facts** — never random, never a UUID, never time-of-emission — so a
retried webhook or a re-entered code path produces the _same_ identity and
deduplicates at the queue's unique index (`automationId, leadId, eventKey`).

Per-trigger occurrence rules (v1):

| Trigger          | eventKey                                    | Why                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lead_created`   | the literal `lead_created`                  | A lead is created once; identity is the lead itself. Webhook retries collapse.                                                                                                                         |
| `status_changed` | `status_changed:{newStatus}:{occurredAtMs}` | Each entry into a status is a distinct occurrence; the business timestamp (not emission time) anchors it, so a retried write of the same transition collapses while a genuine re-entry later does not. |

### Required fields

Every event carries exactly these; nothing else exists in v1:

| Field        | Type                                             | Rule                                                                              |
| ------------ | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `trigger`    | closed enum (`lead_created` \| `status_changed`) | Required, always                                                                  |
| `origin`     | closed enum (ADR-004 taxonomy)                   | Required, always, supplied by the call site                                       |
| `agencyId`   | number                                           | Required — tenant scope; from the owned server record, never the wire             |
| `leadId`     | number                                           | Required                                                                          |
| `occurredAt` | Date                                             | Required — see timestamp semantics                                                |
| `leadSource` | string \| null                                   | Optional, `lead_created` only — the lead's `source` field for condition filtering |
| `newStatus`  | string                                           | **Required for `status_changed`; forbidden for `lead_created`**                   |

### Event ownership

- Events are constructed **only by owned server code at the mutation site** —
  the code that just performed (or observed) the write. Nothing downstream
  re-derives or edits an event; nothing upstream (client, webhook payload,
  import row) supplies one.
- **Origin is never wire-controllable.** Where a server action is reachable
  from the client (`upsertLead`), the origin parameter is validated against
  the narrow set that call site may legitimately claim (`manual`/`import`)
  and coerced to `manual` otherwise — a spoofed value can at worst suppress
  the caller's own automation, never impersonate a webhook origin.
- Each call site owns exactly one origin value (the CSV path owning `import`
  through the shared action is the one designed exception, per ADR-004).

### Timestamp semantics

- `occurredAt` is the **business moment**: the insert time for creation, the
  status-change time for transitions — taken from the server clock or the
  row's own timestamp at the mutation site. Never client-supplied, never the
  emission or enqueue time (those may lag under retries).
- It is a UTC instant. All wall-clock interpretation (quiet hours, cap days)
  happens downstream in `BUSINESS_TZ` — the event itself is timezone-free.
- It anchors `status_changed` identity and is the base for timing resolution
  (`resolveSendAt`).

### Origin semantics

ADR-004 in full applies: origin is emission provenance, not lead source;
closed set (`webhook_facebook`, `webhook_whatsapp`, `manual`, `import`);
`import` is inert at three independent layers (call-site choice, emission
gate, engine law). Additions to the origin set are ADR-004 amendments and
appear here by reference.

### Metadata rules

**There is no metadata bag.** No `meta`, no `extra`, no `payload: unknown`.
Every datum an event carries is a named, typed, contract-listed field. A
future need for new data is a new optional field added by amendment — not a
JSON pocket that silently becomes load-bearing. (This is the same discipline
the stores apply: closed vocabularies, additive evolution, nothing
uninterpretable.)

### Versioning strategy

- This document defines **contract v1**. There is no version field on the
  event — v1 is the absence of one, and the persisted columns (`trigger`,
  `origin`, `eventKey`) are the compatibility surface.
- Evolution is **additive-optional only**: new optional fields, new enum
  values (append-only), new triggers with their identity rules — each via
  amendment here. A breaking change (retyping a field, changing an identity
  rule) requires a superseding ADR and, because `eventKey` is persisted, a
  new key namespace rather than reinterpretation (the ADR-005/008
  discipline).
- Consumers must ignore unknown optional fields and hold unknown enum values
  inert (ADR-008 rule 1 applied to events).

### Future compatibility

- Anticipated triggers (inactivity, calendar/appointment, engagement) each
  need: an occurrence-key rule, their conditional required fields, and an
  origin stance — written into this ADR before implementation. The
  known-hard one is recorded now: **inactivity has no natural business
  timestamp** (it is the _absence_ of events), so its occurrence key will
  need a defined evaluation-day anchor in `BUSINESS_TZ` — a design decision,
  not an improvisation, when that trigger is proposed.
- New channels do not touch this contract: events are channel-free by
  construction (channels live on actions, not triggers).

## Consequences

- Phase 3's emission helper accepts exactly this shape and computes
  `eventKey` by the table above; call sites construct events inline from the
  rows they just wrote.
- The Phase 1 `AutomationTriggerEvent` type gains nothing and loses nothing
  from this ADR — it already matches; drift between them is a defect with a
  defined winner.
- Rule 6 of the Phase 3 instructions is operationalized: if any call site
  cannot honestly populate a required field (e.g. a path with no reliable
  `occurredAt`), implementation stops and the inconsistency is documented
  here — the contract is never bent at a call site.
