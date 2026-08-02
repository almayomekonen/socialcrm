# ADR-007 — Event-Date Anchor

**Status:** Accepted (product sign-off 2026-08-02) — **decided AGAINST the
engineering recommendation**: event-date anchors are intentionally **excluded
from V1**. V1 supports delay-based scheduling only; anchors remain a future
capability. Recorded before Phase 1 froze the timing laws.
**Date:** 2026-08-02

## Context

The founding customer's actual need is a reminder **before the webinar** — a
fixed calendar moment. The engine's grammar times actions relative to the
trigger (send X after the lead arrived); it cannot express "24 hours before
the event" without an anchor. Without this, V1 ships as a welcome-email
feature that does not solve the request that created it. The temptation on
the other side is a scheduling system (recurrence, calendars, campaigns) —
scope the spec explicitly rejects.

## Decision (ratified 2026-08-02)

**Event-date anchors are excluded from V1.** V1 timing is delay-based only:
send immediately or after a delay relative to the trigger. No anchor field, no
before-anchor presets, no `תאריך האירוע` variables, no anchor-passed law, and
the "תזכורת לפני האירוע" starter recipe does not ship in the V1 catalog.

What is preserved for the future (binding on ADR-008): the definition model
**reserves the optional-anchor concept** so a later inclusion is purely
additive — a new optional field, new timing presets, and one new skip law,
with no reinterpretation of existing definitions. The paragraph below records
the design the anchor will have when it ships, so the reservation is concrete:

- One optional event date per automation; before-anchor presets alongside
  after-trigger delays; scheduling computed at trigger time in `BUSINESS_TZ`;
  leads arriving after the send moment are skipped honestly, never sent late.
- No recurrence, no multiple dates, no calendar integration.

Consequence accepted with this decision: V1 does not fully solve the founding
customer's "reminder before the webinar" need (spec §12.1's named trade-off);
their registration-confirmation recipe ships, the reminder waits for the
anchor's future release.

## Alternatives considered

1. **Exclude from V1** — cleanest scope; fails the founding customer, and
   retrofitting an anchor later disturbs the frozen definition model and
   timing laws (the expensive path this ADR exists to avoid).
2. **Full scheduling/recurrence** — campaign territory; violates the
   one-sentence grammar and the spec's broadcast exclusion.
3. **Calendar-integration anchor** (hang reminders on `meetings`) — couples
   the engine to reschedule/cancel semantics; explicitly roadmap (spec §6
   exclusion table).

## Why this decision

Product chose V1 scope minimalism over founding-use-case completeness: one
timing model (delay-based), one fewer field, one fewer law, and a creation
sheet with nothing conditional in it. The trade-off — the webinar reminder
need stays unmet in V1 — is accepted explicitly rather than discovered later.
(The engineering recommendation to include was documented and not taken; both
positions are preserved in this record.)

## Consequences

- Phase 1 timing laws implement delay presets only; no anchor logic, no
  anchor-passed skip law, no `תאריך האירוע`/`שעת האירוע` variables.
- The V1 recipe catalog has four starters, not five — "תזכורת לפני האירוע"
  is held back with the anchor.
- ADR-008's reservation stands: the definition model treats the anchor as a
  future optional field so its introduction is additive, never a migration.
- Time math remains exclusively `BUSINESS_TZ`; nothing about this exclusion
  changes the timezone rule.

## Future implications

When the anchor ships (a superseding ADR flips this one), it arrives with the
design recorded above: optional field, before-anchor presets, honest
anchor-passed skip, no recurrence in its first cut. Recurrence (weekly
webinars) remains the step after that, extending the anchor rather than the
grammar.
