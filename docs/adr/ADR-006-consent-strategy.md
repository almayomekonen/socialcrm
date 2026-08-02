# ADR-006 — Consent Strategy

**Status:** Proposed — deliberately left open (product decision 2026-08-02:
do not adopt a legal position without counsel).

> **BLOCKING NOTE:** No production rollout of customer automation email may
> occur without explicit, written product **and** legal approval of this ADR.
> The baseline below is a documented recommendation only — it is not legal
> advice, asserts no legal position, and does not substitute for counsel
> review. Phase 7 (first live send) is hard-gated on flipping this status.

**Date:** 2026-08-02

## Context

Israeli spam law (תיקון 40 לחוק התקשורת) requires consent for marketing
messages, with a recognized basis for responding to a customer-initiated
inquiry. SocialCRM's leads arrive on a spectrum: a lead who submitted a Meta
form or messaged on WhatsApp initiated contact; an imported spreadsheet row
did not. The platform cannot adjudicate consent per lead — but it chooses the
defaults, and the defaults are the compliance posture.

## Decision (proposed baseline)

- **Eligibility follows origin (ADR-004):** V1 automated email goes only to
  leads whose origin is inbound digital contact (webhook origins) or manual
  creation by the business (which asserts a real relationship). **Imported
  leads are never eligible in V1** — no opt-in checkbox at import (per the
  plan's recommendation on spec §12.4); if that checkbox is ever added, it is
  a deliberate re-tagging gated by this ADR's successor.
- **Every automated email carries the mandatory unsubscribe** (ADR-003) and
  identifies the sending business.
- **Responsibility is stated plainly in the product terms:** the business is
  the sender; SocialCRM provides the mechanism and enforces the floor
  (unsubscribe, suppression, import exclusion, caps).
- V1 launch recipes are confirmations/acknowledgments of the lead's own
  action (registration confirmation, welcome, thank-you) — the strongest
  consent posture available — and the recipe catalog is curated with this in
  mind.

## Alternatives considered

1. **Transactional-only stance** (no follow-up/nudge recipes at all) — legally
   cleanest, but excludes the follow-up recipe the spec ships; the follow-up
   still responds to the lead's own inquiry, which the recommended baseline
   covers.
2. **Double opt-in** (confirmation email before any automation) — gold-plated
   consent that kills the product's value (the instant confirmation IS the
   feature) and is not what the inquiry-response basis requires.
3. **Business self-attestation checkbox** ("I confirm I have consent") —
   compliance theater; shifts nothing legally and trains users to click
   through.

## Why this decision

It aligns the legal floor with mechanisms the engine already enforces for
product reasons: origin gating, import exclusion, mandatory unsubscribe. The
posture is defensible, explainable in one sentence, and requires no per-lead
judgment the platform cannot make.

## Consequences

- Import exclusion is load-bearing **legally**, not just UX — reviewers must
  treat any weakening of it as a consent decision, not a convenience.
- The feature's terms-of-service language is a launch deliverable (Phase 7
  gate), owned by product + legal.
- Eligibility-by-origin is enforced as an engine law, testable and logged.

## Future implications

WhatsApp/SMS actions have different consent regimes (WhatsApp's 24-hour window
and template rules are themselves a consent architecture) — each channel gets
its own consent stance at introduction, referencing this ADR's
origin-eligibility mechanism. Any import opt-in, cold-outreach feature, or
broadcast/campaign product requires a superseding consent ADR first.
