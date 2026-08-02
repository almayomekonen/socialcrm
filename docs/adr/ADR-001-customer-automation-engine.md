# ADR-001 — Customer Automation Engine

**Status:** Accepted (ratified by the product specification's engine section)
**Date:** 2026-08-02

## Context

A customer asked for automatic emails for webinar registrations. The codebase
already contains two automation systems, neither of which can host this:
the platform email registry (`lib/emailAutomations`) is developer-authored code
sending SocialCRM→user email, and the Instant Response Engine is a
WhatsApp-conversation-specific responder. The product need is generic —
businesses automating interactions with their leads — and will grow beyond
email (WhatsApp, SMS, internal actions).

## Decision

Build a generic **Customer Automation Engine**: a customer-side execution layer
that receives deterministic trigger events, applies platform laws (send-once,
frequency caps, suppression, origin exclusion, channel legality), executes
actions, and writes an activity log. Email is the first supported action, not
the product. The user-facing contract is a single-rule grammar — **one trigger
→ one action → one timing** — rendered as one Hebrew sentence; the engine may
grow indefinitely behind that sentence, but the sentence may not grow. Laws are
enforced in the engine's pipeline, never delegated to individual actions, so
every future action inherits them. "Customer Automation Engine" is internal
vocabulary only; users see אוטומציות.

## Alternatives considered

1. **A webinar-specific feature** — solves one customer, hard-codes their
   vocabulary, and invites parallel entities (registrants) the one-entity
   constitution forbids.
2. **Extend the platform email registry** — its automations are reviewed code
   keyed to platform users; user-generated rules structurally do not fit, and
   coupling the domains violates the spec §0 boundary.
3. **Extend the IRE** — conversation-scoped, WhatsApp-shaped state machine;
   generalizing it would destabilize a production system for a different job.
4. **A full workflow builder (branching graphs)** — rejected in the spec on
   audience, trust, and RTL grounds.

## Why this decision

The generic engine is the only option that serves the requesting customer via
a recipe while making every future automation a plug-in rather than a project.
Engine-level laws are what make scaling safe: a new channel implements its
policy once instead of trusting every recipe to remember it.

## Consequences

- New `automations` namespace (`lib/automations`, `db/automations`,
  `actions/automations`, `AUTOMATIONS_*` envs), fully isolated from platform
  email per spec §0.
- The closed trigger/action enums become persisted data from day one (ADR-008).
- No branching, no multi-audience broadcasts, no freeform workflows — anything
  inexpressible in the sentence is a different product and must be argued
  separately.

## Future implications

WhatsApp/SMS/internal actions arrive as new actions plus channel laws under
the same gallery and log. Sequences are presented groupings of single rules,
never a new engine. Any proposal to widen the grammar itself requires a
superseding ADR.
