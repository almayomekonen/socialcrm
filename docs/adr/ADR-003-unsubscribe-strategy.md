# ADR-003 — Unsubscribe Strategy

**Status:** Accepted in shape; the token scheme freezes permanently at the
first live send (plan Phase 5 gate).
**Date:** 2026-08-02

## Context

Israeli spam law (תיקון 40) and basic trust require a working unsubscribe in
every automated email. The platform already has an unsubscribe mechanism — a
stateless HMAC token over `userId` verified at `/api/email/unsubscribe` — but
its scope is the platform user. A lead is a different identity class scoped to
one business; reusing the platform's token or suppression store could let a
lead's unsubscribe silence a user's billing email, or the reverse (spec §0).
Tokens shipped inside emails live in inboxes indefinitely: whatever scheme
ships first must be verifiable forever.

## Decision

- A **separate engine-owned route** (`/api/automations/unsubscribe`), never the
  platform route.
- A **stateless HMAC token scoped to (agencyId, leadId)** under a dedicated
  secret (`AUTOMATIONS_UNSUBSCRIBE_SECRET`), following the platform's proven
  stateless pattern — cloned, not imported.
- Unsubscribing suppresses the lead from **all automated emails of that
  business, forever, immediately** — per-business scope, never cross-tenant,
  logged on the lead. Suppression storage is the engine's own (Phase 2).
- The unsubscribe link is mandatory and non-removable in every automated email
  (auto-branding footer).
- **The mutation happens on POST, never on GET** (amended 2026-08-02 — see
  below). The URL in the email is unchanged; `GET` renders a confirmation
  page, and the page's single button `POST`s the same token back.

## Amendment (2026-08-02) — GET must not mutate

The original Phase 5 implementation suppressed directly on `GET`, mirroring the
platform route. That was reviewed and **overturned**.

**The failure it creates:** corporate mail-security gateways — Microsoft
Defender Safe Links, Proofpoint URL Defense, Mimecast URL Protect, and their
peers — fetch links found in email, at delivery or scan time, from datacenter
IPs, with no human involved. Against a GET-mutating endpoint, that fetch *is*
an unsubscribe. The result is a **silent, permanent, invisible** opt-out for a
lead who never clicked: suppression is forever with no undo (above), the
business is never told, and the lead simply stops receiving the confirmations
they asked for. Every symptom of the failure class this product exists to
prevent — a lead falling through a crack no one can see.

(Note the asymmetry in the threat model: scanners issue `GET`s. They do not
submit forms. `POST` is not a stronger cryptographic guarantee — it is simply
outside what automated link-followers do, which is exactly why RFC 8058 built
one-click unsubscribe on `POST` rather than `GET`.)

**The cost of the fix is one click**, on a page that also tells the lead
*which business* they are leaving — information the email footer alone often
fails to make obvious weeks later. This is the pattern every major sender
already uses; it is not friction the user will find surprising, and it does
not weaken the legal requirement for a simple, free opt-out.

**Why the objections do not hold:** the platform route's GET behavior is
precedent, not justification (it carries the same latent defect for platform
users, tracked separately). "Failing safe" is not a defense either — fewer
emails is only the safe direction when the user *chose* it; an unchosen
permanent opt-out is data loss.

**Deliberately not adopted here:** RFC 8058 `List-Unsubscribe` /
`List-Unsubscribe-Post` headers, which would give true mail-client one-click
alongside this page. They are a genuine deliverability asset (and Gmail/Yahoo
bulk-sender expectations point at them) but require transport header support —
recorded as a Phase 7 deliverability recommendation, not smuggled in here.

## Alternatives considered

1. **Reuse the platform route/token** — forbidden by the boundary contract;
   wrong identity scope.
2. **DB-stored one-time tokens** — revocable and auditable, but adds storage
   and failure modes for no user benefit; statelessness is proven in this
   codebase.
3. **Per-automation unsubscribe granularity** — "unsubscribe from reminders
   only" — rejected for V1: legally weaker (the law expects a full stop),
   UX-heavier, and re-subscribable later only with real consent flows.

## Why this decision

All-automations-per-business is the legally safest and simplest reading of an
unsubscribe click; the stateless HMAC keeps the route dependency-free and the
scheme identical in spirit to what already works in production.

## Consequences

- The verifier must honor **every token ever sent**: secret rotation requires
  a verify-against-previous-secrets window; the (agencyId, leadId) payload
  shape cannot change, only be extended by issuing new-format tokens alongside
  verifying old ones.
- Invalid tokens get a generic response (no enumeration oracle).
- Cross-domain non-interaction (platform vs lead unsubscribe) is a permanent
  test per the plan's Phase 5.

## Future implications

A preferences page (granular opt-outs, re-subscribe with recorded consent) can
be built **on top of** this route later; the full-stop semantics of the V1
link never weaken retroactively. WhatsApp/SMS actions get their own
channel-appropriate opt-out mechanisms — this ADR governs email only.
