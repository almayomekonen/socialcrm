# ADR-002 — Sender Identity

**Status:** Proposed — requires infrastructure-owner sign-off. Blocks Phase 4's
live branch, Phase 6 (test-send), and Phase 7.
**Date:** 2026-08-02

## Context

All platform email leaves as `SocialCRM <hello@getsocialcrm.com>` under a
deliberate one-sender doctrine (`lib/email/config.ts`). That address carries
the platform's lifeline mail: verification, invitations, billing. Customer
automations introduce email whose content is written by businesses and sent to
their leads — content the platform does not review. Sender reputation is
domain-scoped and largely irreversible: one customer's spammy content on the
platform's primary identity could poison verification-email deliverability for
every user.

## Decision (proposed)

Customer automation email sends from a **dedicated sending subdomain** of the
product domain (working candidate: `send.getsocialcrm.com` — final name is the
infra owner's call), on the same Resend account, with:

- **From display name:** the business's name; the address is
  platform-managed on the subdomain.
- **Reply-To:** the business owner's real address — replies land in their
  normal inbox; email is not an in-product inbox channel and must never appear
  to be.
- The platform's `hello@getsocialcrm.com` and `RESEND_FROM` are never used for
  customer sends; engine config is `AUTOMATIONS_*`.

## Alternatives considered

1. **Share `hello@getsocialcrm.com`** — simplest, and rejected outright:
   customer content risk lands on the lifeline address.
2. **Per-business custom sending domains in V1** — best deliverability
   long-term, but requires each SMB to do DNS/DKIM setup they cannot do;
   directly violates the under-60-seconds adoption principle.
3. **A separate ESP account (or separate provider)** — maximum isolation, but
   doubles operational surface (keys, webhooks, monitoring) for isolation the
   subdomain already provides at the reputation layer.

## Why this decision

The subdomain is the standard deliverability-isolation pattern: reputation
accrues per sending domain, so a customer-content incident burns the
subdomain, never the primary. Same account keeps transport, logging, and
webhook plumbing singular (with event partitioning per the plan's Phase 5).

## Consequences

- DNS + DKIM setup and Resend domain verification are Phase 0/§6.2 work items;
  a warm-up period precedes real volume.
- Changing the subdomain later resets accumulated reputation — the choice is
  semi-permanent; pick once.
- The shared Resend account means account-level webhooks carry both domains'
  events; the engine's events route must partition by send ownership (plan
  Phase 5).

## Future implications

Per-business custom domains (alternative 2) layer on top later as an opt-in
for businesses that can do DNS, without changing the engine: sender resolution
becomes per-agency configuration with the subdomain as default.
