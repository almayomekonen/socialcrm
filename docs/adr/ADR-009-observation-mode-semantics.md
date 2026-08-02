# ADR-009 — Observation Mode Semantics

**Status:** Accepted (ratified with the migration-plan approval, 2026-08-02 —
this ADR promotes migration-plan §3.2 from a storage decision to what it
actually is: customer-visible product behavior).
**Date:** 2026-08-02

## Context

Observation mode ("מצב תצפית") is how the engine earns trust: it runs the full
pipeline — trigger, laws, content resolution — and records what it **would
have sent** without sending (`AUTOMATIONS_SEND_MODE=log`). The storage plan
made claims mode-agnostic; but the consequences of that choice are not
storage-internal. They decide what a business owner sees in the log, and what
happens to real leads the moment observation flips to live. That makes this a
product-behavior contract, recorded here so no later phase "fixes" it into
something dishonest.

## Decision

1. **Observation consumes eligibility.** A `would_send` evaluation consumes
   the lead's once-per-automation allowance (ADR-005 claim, recorded with the
   mode that consumed it) and counts toward the per-lead and per-agency daily
   caps exactly as a live send would.
2. **Events are never replayed after activation.** Flipping from observation
   to live sends nothing retroactively — not the observed would-sends, not
   any queued backlog reinterpretation. Live sending applies to events that
   occur after the flip.
3. **Would-sends are permanently distinct in history.** Activity rows carry
   `would_send` as their kind forever; they are never relabeled or merged
   with real sends.

## Why observation consumes eligibility

- **The preview must be the truth.** If observation didn't consume claims and
  caps, a status flap would log two would-sends where live mode would send
  one, and cap exhaustion would never appear — the owner would review a
  simulation that behaves differently from the thing they're about to turn
  on. A dishonest preview is worse than none (spec: no fake progress, honest
  counts).
- **It makes the flip safe.** Consumed claims are precisely what prevents a
  late blast at activation: nothing is "owed" to observed leads.

## Why events are never replayed

- **Automated email is a timely social act.** A registration confirmation
  five days late doesn't help the lead — it embarrasses the business. Every
  V1 recipe's value is in its immediacy; replay delivers only the awkward
  version.
- **Predictability is the product's core promise.** The activation sentence —
  the automation acts on events from activation onward — must be true in
  every mode, with no asterisk. Replay would reintroduce exactly the
  enrollment confusion (who will this email, and when?) the spec's §11
  identifies as HubSpot's defining failure.
- **Consent posture.** Replay converts an observation window into a deferred
  batch send — a different, weaker consent story than responding to a lead's
  action in the moment (ADR-006's baseline leans on timeliness of the
  inquiry-response).

## Alternatives considered and rejected

1. **Claims only on live sends.** Observation becomes a duplicate-riddled
   simulation, and activation inherits a "send now to everyone observed?"
   liability. Rejected for dishonesty and flip-risk.
2. **Replay-on-activation with confirmation** ("שלח עכשיו ל-14 הלידים
   שנצפו?"). Superficially generous; actually a batch-blast primitive
   smuggled into the trust feature, with stale timing and a weaker consent
   story. Rejected.
3. **A separate observation ledger** (claims untouched; would-sends tracked
   apart). Two sources of truth for "ever," guaranteed to disagree at flip
   time. Rejected.

## UX implications

- Leads evaluated during observation **never receive that automation's email
  later**. This is by design and must be _said_, not discovered.
- The observation log reads as history, not as a queue: nothing in it is
  pending, and no action on a row sends anything.
- Caps and skips appear in observation exactly as they would live — including
  "כבר נשלח לליד הזה" for a second qualifying event, which is the honest
  preview of once-ever semantics.

## Required UI messaging (Hebrew, binding for Phase 6)

- Entering/being in observation: **"מצב תצפית — המערכת מתעדת מה הייתה נשלחת,
  בלי לשלוח בפועל."**
- On every would-send log row: label **"היה נשלח (מצב תצפית)"** — never
  "נשלח".
- At the flip-to-live confirmation, the load-bearing sentence:
  **"לידים שנבדקו במצב תצפית לא יקבלו את האימייל בדיעבד. האוטומציה תשלח
  ללידים חדשים מכאן והלאה."**
- The activation-semantics line from the spec ("האוטומציה תפעל על לידים
  חדשים מרגע ההפעלה") remains alongside; the two are consistent by
  construction.

## Future compatibility

- The consuming mode is recorded on each claim and each activity row, so any
  future policy change applies to new data only — history is never
  reinterpreted (ADR-005/ADR-008 discipline).
- A future re-engagement or re-send capability mints a **new semantics
  dimension** on claims; it must not treat log-mode claims as unsent
  inventory.
- AI-composed content (roadmap) enters production through this same
  observation mode and inherits these semantics unchanged — that future
  feature is the strongest reason the preview must already be trustworthy.

## Consequences

- Phase 2 storage records `mode` on claims and `would_send` as an activity
  kind (this ADR is why those fields exist).
- Phase 4's worker consumes claims and counts caps identically in both
  modes; only the transport call differs.
- Phase 6 ships the three Hebrew strings above; Phase 7's pilot review walks
  the customer through a log whose semantics this ADR fixed in advance.
