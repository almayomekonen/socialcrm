# Architecture Decision Records — Customer Automation Engine

Decision records for the irreversible choices identified in
[`../customer-automation-engine-implementation-plan.md`](../customer-automation-engine-implementation-plan.md) §6.
Statuses here are authoritative; the plan defers to them.

| ADR | Title | Status | Owner of sign-off |
| --- | --- | --- | --- |
| [ADR-001](./ADR-001-customer-automation-engine.md) | Customer Automation Engine | Accepted | — (ratified by the product spec) |
| [ADR-002](./ADR-002-sender-identity.md) | Sender Identity | Proposed | Infrastructure owner |
| [ADR-003](./ADR-003-unsubscribe-strategy.md) | Unsubscribe Strategy | Accepted (frozen at first live send) | — |
| [ADR-004](./ADR-004-origin-taxonomy.md) | Origin Taxonomy | **Accepted** (2026-08-02, incl. manual-creation sub-decision) | — |
| [ADR-005](./ADR-005-send-once-semantics.md) | Send-Once Semantics | **Accepted** (2026-08-02: once per lead per automation) | — |
| [ADR-006](./ADR-006-consent-strategy.md) | Consent Strategy | Proposed — **BLOCKS production rollout** until written product + legal approval | Product + legal |
| [ADR-007](./ADR-007-event-date-anchor.md) | Event-Date Anchor | **Accepted** (2026-08-02: excluded from V1; delay-based only) | — |
| [ADR-008](./ADR-008-definition-storage-versioning.md) | Definition Storage & Versioning | **Accepted** (2026-08-02, with the migration-plan approval) | — |
| [ADR-009](./ADR-009-observation-mode-semantics.md) | Observation Mode Semantics | **Accepted** (2026-08-02: observation consumes eligibility; no replay after activation) | — |
| [ADR-010](./ADR-010-event-contract.md) | The Event Contract | **Accepted** (2026-08-02: canonical trigger payload; no trigger invents its own) | — |
| [ADR-011](./ADR-011-worker-execution-model.md) | Worker Execution Model | **Accepted** (2026-08-02: job/claim lifecycles, at-most-once, crash recovery, observability) | — |
| [ADR-012](./ADR-012-delivery-event-boundaries.md) | Delivery Event Boundaries | **Accepted** (2026-08-02: telemetry may only subtract sends; never triggers automations) | — |
| [ADR-013](./ADR-013-customer-email-identity.md) | Customer Email Identity | **Accepted** (2026-08-02: model settled; the sending domain itself is ADR-002) | — |
| [ADR-014](./ADR-014-production-rollout-strategy.md) | Production Rollout Strategy | **Accepted** (2026-08-02: staged rollout, 4 multiplicative flags, incident containment) | — |

Conventions: one decision per record; a record is amended only by a superseding
ADR, never edited into a different decision. *Proposed* records document the
recommended decision fully — sign-off flips the status line, nothing else.
