# ADR-013 — Customer Email Identity

**Status:** Accepted (2026-08-02) for the identity **model**. The concrete
sending domain it resolves against remains ADR-002 (Proposed, infra owner) —
this ADR is what that decision plugs into.
**Date:** 2026-08-02

**Scope note:** this ADR defines **who the email says it is from** — not how
bytes leave the building. Transport (retry taxonomy, provider client, the
`from` parameter plumbing) is ADR-002 and the Phase 0 transport change.

## Context

Every automated email answers three questions before a word of content is
read: _who sent this, is it legitimate, and where does my reply go?_ Get those
wrong and the message is either ignored, marked as spam, or — worst — replied
to into a void the business never checks.

The engine's users are small businesses who cannot configure DNS and will not
try. The identity model therefore has to work perfectly with **zero setup**,
while leaving room for businesses that later want their own domain.

## The identity model (V1)

An engine email's identity is exactly four resolved values:

| Element                  | V1 value                                                                                        | Source                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **From address**         | A fixed platform-managed mailbox on the engine sending domain (ADR-002) — never customer-chosen | Engine configuration                                     |
| **Display name**         | The business's name, sanitized                                                                  | `agencies.name`                                          |
| **Reply-To**             | The business's real, monitored address                                                          | Agency-configured; defaults to the admin's account email |
| **Envelope/bounce path** | Platform-managed on the engine domain                                                           | Provider                                                 |

The recipient sees `סטודיו אור <automations@[engine domain]>`. Humans read the
display name; machines read the domain. Replies reach the business.

### From address

Customers **cannot set the From address in V1.** This is a deliberate refusal,
not a missing feature:

- Allowing arbitrary From domains would make SocialCRM a spoofing service —
  anyone could send "from" a domain they do not control.
- An unauthenticated custom domain fails SPF/DKIM alignment and lands in spam,
  making the product look broken for a decision the user cannot evaluate.
- A single platform-verified domain is the only shape that delivers on the
  60-second adoption promise with zero DNS work.

### Display name

The display name carries the business identity and is the **only** identity
element sourced from user-entered data. It is therefore untrusted input on a
header line (see Security).

Fallback chain: agency name → the neutral `העסק`. Never empty, never a raw id.

### Reply-To

Reply-To is what makes the email a conversation rather than a broadcast. The
spec is explicit that replies land in the owner's normal inbox and that email
is **not** an in-product inbox channel — nothing in the product may imply
otherwise.

Resolution: agency-configured reply-to → the agency admin's account email →
**no fallback beyond that**. If neither exists the identity is _incomplete_
(see Failure behavior); the engine does not send mail whose replies vanish.

### Default sender (works out of the box)

With nothing configured at all, a new agency resolves to: engine From address,
its own business name as display name, and its admin's email as Reply-To. That
is a complete, correct identity with zero setup — the requirement that makes
the gallery's one-minute adoption honest.

### Branding

V1 branding is **text only**: display name, business name in the footer, and
the mandatory unsubscribe link. Logos are deliberately deferred — remote
images are blocked by default in most clients, so a logo would be invisible
for most recipients while adding asset-hosting and layout surface. Deferring
it is a V1 exclusion to revisit with the pilot, not an oversight.

### Verified domains and domain verification

- V1 has **exactly one** verified sending domain: the engine subdomain,
  verified once by us (SPF/DKIM/DMARC alignment) as part of ADR-002.
- **Customers verify nothing.** They never see a DNS record, a TXT value, or a
  verification state, because they have no domain in the model.
- Verification is a precondition of _sending at all_, not a per-tenant gate:
  if the engine domain is not verified, the engine does not send (Failure
  behavior).

## Ownership boundaries

- The engine identity and the platform identity are **disjoint**. The engine
  never sends as `hello@getsocialcrm.com`; platform email never sends from the
  engine domain. Reputation isolation is the entire point (ADR-002): a
  customer-content incident must not touch verification, invitation, or
  billing mail.
- Identity is resolved **server-side from agency-owned records only** — never
  from client input, never from the wire, always agency-scoped.
- One resolver, one truth: the same identity function serves the worker's
  sends and the UI's test-send. A test email that could differ from a real one
  would defeat its entire purpose.

## Failure behavior

Identity is resolved **before** any transport call. Two failure shapes:

1. **Incomplete identity** (no verified engine domain configured, or no
   resolvable Reply-To): the send is **not attempted**. This is a
   configuration fault, not an infrastructure hiccup — it must **not** enter
   the transient-retry class (ADR-011), because retrying a misconfiguration
   only produces a retry storm and a dead job. It resolves as a definitive,
   non-retrying outcome, surfaced as **דורש טיפול** on the affected
   automation.
2. **Transport rejection of a well-formed identity** (provider says the domain
   is unverified/suspended): ordinary transport failure, classified by
   ADR-011, visible in the activity log with the account-level Hebrew copy —
   which deliberately does not shame the rep for an owner-level problem.

In log/observation mode, identity is still resolved and rendered so the
preview is truthful, but incompleteness never blocks a would-send — there is
no external effect to protect.

## Security considerations

- **Header injection.** The display name is user-entered. CR/LF and control
  characters must be stripped and quoting must be applied before it reaches a
  header. This is the single highest-severity concern in this ADR: an
  unsanitized display name is a header-injection primitive.
- **No customer-controlled From.** V1's refusal (above) is what keeps the
  platform from being usable for spoofing.
- **Reply-To validation.** Must be a syntactically valid single address; no
  address lists, no header continuation.
- **Tenant isolation.** Every element is resolved from the agency's own
  server-side records; a request cannot influence whose identity is used.
- **Reputation blast radius.** Because all customers share one sending domain
  in V1, one abusive tenant can degrade deliverability for all of them. The
  compensating controls are the engine's existing laws (per-lead caps, agency
  ceiling, suppression, import exclusion) plus the per-agency allowlist — and
  this is a named reason the pilot stays small.
- **Unsubscribe integrity** is ADR-003's concern, but note the interaction:
  the footer link identifies the _business_, so the display name and the
  suppression scope must agree — a lead must never opt out of "one business"
  and keep receiving mail that looks identical.

## Future multi-domain support

The model is already a function of the agency, so custom domains are additive:

- Per-agency sender configuration gains a domain reference with a verification
  state (`unverified → pending → verified`); **only `verified` is usable**,
  and an unverified domain silently falls back to the shared engine domain
  rather than failing a send.
- Verification instructions become a settings surface — the first time a
  customer sees DNS in this product, and therefore strictly opt-in for
  businesses that want it.
- Nothing in V1's resolution order changes; a new, higher-priority source is
  inserted ahead of the default. No stored identity is reinterpreted, because
  V1 stores no per-email identity snapshot beyond what the activity log
  already records.

## Consequences

- Phase 6 builds one identity resolver used by both test-send and the worker,
  with sanitization at the boundary.
- The worker's live branch must consult that resolver and treat incomplete
  identity as a non-retrying, user-visible outcome (closing the retry-storm
  path that a bare empty `from` would otherwise create).
- ADR-002's open decision (the exact subdomain) is now the only thing standing
  between this model and live sending — the model itself is settled.
