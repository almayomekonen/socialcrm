# ADR-014 — Production Rollout Strategy

**Status:** Accepted (2026-08-02). Governs every production exposure of the
Customer Automation Engine, from the first observation deploy through GA.
**Date:** 2026-08-02

## Context

Everything before this ADR was built so that being wrong is survivable. This
ADR is where that assumption gets stated plainly:

> **Production failures will happen.** Not "might" — will. A bounce storm, a
> misconfigured sender, an automation nobody meant to activate, a customer
> whose leads get an email they should not have. The rollout is designed so
> that when it happens, the blast radius is one agency, the time-to-silent is
> seconds, and the evidence needed to explain it is already recorded.

The engine sends mail in a business's name to their customers. There is no
undo on a sent email. So the strategy is not "test carefully and launch" — it
is **stay unable to cause harm for as long as possible**, and make each step
that adds capability separately reversible.

## Feature flag strategy

Four independent levers. They are **multiplicative, not alternative** — every
one must be affirmatively set for a customer email to leave:

| Flag | Gates | Default (absent) | Effect when off |
| --- | --- | --- | --- |
| `AUTOMATIONS_ENABLED` | **Emission** — whether trigger events enter the queue at all | blocked | No jobs created; shadow metrics still record what *would* have been emitted |
| `AUTOMATIONS_AGENCY_ALLOWLIST` | **Which agencies** the engine exists for | empty ⇒ nobody | Agency sees no nav entry, no page, no emission |
| `AUTOMATIONS_SEND_MODE` | **The effect** — `live` vs observation | `log` | Full pipeline runs; transport is unreachable; would-sends recorded |
| `AUTOMATIONS_FROM` | **Identity completeness** (ADR-013) | empty ⇒ incomplete | Live sends refuse definitively; observation still renders truthfully |

Supporting secrets, all absent-by-default and independently rotatable:
`AUTOMATIONS_UNSUBSCRIBE_SECRET`, `AUTOMATIONS_WEBHOOK_SECRET`,
`AUTOMATIONS_PILOT_DASHBOARD`.

Three properties are deliberate and must be preserved:

1. **Safe by absence.** Every flag's *missing* state is its *safe* state. A
   config wipe, a fresh environment, or a typo'd variable name all fail
   closed. Nothing is enabled by forgetting something.
2. **No single point of enablement.** There is no one switch that turns on
   customer sending. Turning the engine loose requires four deliberate acts by
   people who know what they are doing.
3. **Flags are permanent infrastructure, not scaffolding.** They are the
   containment strategy. Removing one after GA — "we don't need the kill
   switch anymore" — is the exact reasoning that turns a contained incident
   into an uncontained one. Removal requires a superseding ADR.

## Allowlist strategy

- Explicit agency ids only. **`all` is forbidden in production** until GA is
  formally declared; it exists for local development.
- Adding an agency is a deliberate act with a named owner and a reason
  recorded. It is never a side effect of a deploy.
- Removing an agency is instant, unilateral, requires no approval, and is the
  correct first response to almost any doubt.
- The allowlist is the blast-radius control. A defect that reaches production
  affects exactly the agencies on it — which is why the pilot is small on
  purpose (ADR-013 names shared-domain reputation as the second reason).

## Rollout stages

Each stage adds exactly one capability and is independently reversible.

**Stage 0 — Dark (current state).** Code in production, all flags absent.
Nothing observes, nothing queues, nothing sends. Verifies only that shipping
the engine breaks nothing that already worked.

**Stage 1 — Internal observation.** Our own agency allowlisted;
`AUTOMATIONS_ENABLED=1`; `SEND_MODE=log`. Real triggers, real laws, real
rendering, zero external effect. We create automations against our own leads
and read the resulting log. Exit: the log matches what we predicted, and no
platform-email metric moved.

**Stage 2 — Internal live.** `SEND_MODE=live` while only our own agency is
allowlisted, plus the deliverability smoke test (§Launch checklist). This is
the first time an email actually leaves — to us, from our own domain, to our
own inboxes across the major providers. Exit: inbox placement confirmed,
unsubscribe and delivery events verified end to end.

**Stage 3 — Pilot observation.** The pilot customer is allowlisted, still in
`log` mode globally. They configure their automations; the engine records what
it would send; we review that log **with them**. This is the spec's trust
bridge delivered as a rollout stage rather than a feature.

**Stage 4 — Pilot live.** `SEND_MODE=live` with the pilot agency on the
allowlist. First real customer emails to real leads. Daily log review.

**Stage 5 — Expansion / GA.** Only after the pilot exit criteria are met, and
each additional agency added deliberately.

Stages 1–4 all satisfy the standing rule: **live sending stays off by
default**, and only one stage transition ever enables it.

## Kill switch usage

Three levers, fastest first. Every one is an environment change requiring no
deploy, no build, and no code review:

| Order | Lever | Scope | Use when |
| --- | --- | --- | --- |
| 1 | Remove agency from `AUTOMATIONS_AGENCY_ALLOWLIST` | One agency | The problem is one customer's automations |
| 2 | `AUTOMATIONS_SEND_MODE=log` | All sending, globally | Anything is wrong with what is being sent |
| 3 | `AUTOMATIONS_ENABLED` unset | The whole engine, including queueing | Systemic doubt, or the queue itself is the problem |

Rules of use:

- **Any engineer may pull any lever without approval.** Requiring a decision
  meeting is how a two-minute incident becomes a two-hour one. Pulling a lever
  is never wrong; explaining afterwards is cheap.
- Pull first, diagnose second. The levers are non-destructive: queued work
  waits, history is preserved, nothing is lost by being cautious.
- A drill is mandatory before Stage 4 (§Exit criteria), with the measured
  time-to-silent recorded.
- Note the deliberate asymmetry: `AUTOMATIONS_ENABLED` off stops *new*
  emission but lets already-queued jobs drain under their laws. To stop
  in-flight work as well, use lever 2 or 3 **and** pause the automations. This
  is documented so nobody assumes lever 3 empties the queue.

## Rollback strategy

Ordered by cost, cheapest first:

1. **Flags** (seconds, no deploy) — the intended mechanism for essentially
   every incident.
2. **Pause the automation** (per-agency, from the UI) — cancels its pending
   sends; correct when one recipe misbehaves.
3. **Code revert** (a deploy) — for a defect flags cannot contain. Every phase
   shipped as independently revertable commits precisely for this.
4. **Schema rollback — forbidden after the first live send.** Claims,
   suppressions, and activity are legal and behavioral memory (migration plan
   §2.2). Behavior rolls back via flags; storage is forward-only.

## Incident response

Failures are classified before they happen so nobody has to improvise
severity at 2am.

| Severity | Examples | Containment (immediately) | Then |
| --- | --- | --- | --- |
| **SEV-1** — harm to a customer's customers | Mail to wrong recipients; a send loop; content leaking across tenants; mass-send | Lever 3 (whole engine off) | Notify the affected customer the same day with what happened and what we did. Do not wait for a full diagnosis to tell them |
| **SEV-2** — harm to the customer's business | Sends failing silently; identity broken; deliverability collapse; bounce/complaint spike | Lever 2 (`SEND_MODE=log`) | Fix, verify in observation, resume. Tell the customer if any of their leads were affected |
| **SEV-3** — contained defect | One automation misfiring; wrong copy; a skip that should have been a send | Pause that automation; or lever 1 | Fix on the normal cadence |

Standing rules:

- **A suppression or a bounce we cannot explain is a SEV-2 until explained.**
  Silent unsubscribes were the failure mode ADR-003's amendment exists to
  prevent; if they appear anyway, we assume the mechanism is wrong, not the
  customer.
- Every incident produces a written note: what fired, which lever, what the
  logs showed, what changed. The engine's structured logs and activity rows
  are the evidence — that is what they were built for.
- **We tell the customer.** The product's promise is that nothing falls
  through the cracks; discovering that we hid a failure would cost more than
  the failure.

## Monitoring requirements

Minimum coverage before Stage 2, all available from structured logs and the
internal pilot dashboard:

| Signal | Source | Action threshold |
| --- | --- | --- |
| Worker pass summary (claimed/done/skipped/retried/dead) | `[automations][worker] pass_summary` | Any `dead > 0` is investigated |
| Identity failures | dead jobs with `identity_unavailable:*` | **Any** occurrence — it means a real send was refused |
| Delivery failures / bounces | activity `deliveryState` | Bounce rate > 2% of sends, or any hard bounce in Stage 2 |
| Complaints | suppressions with `spam_complaint` | **Any** occurrence is SEV-2 |
| Suppressions | `automation_lead_suppressions` | Unexplained growth, or any suppression without a matching send |
| Skip distribution | activity `skipReason` | A skip reason dominating unexpectedly (e.g. mass `no_email`) means a config or data problem |
| Queue age | oldest pending `notBefore` | Jobs older than two cron cycles ⇒ the drain is broken |
| Platform email health | existing platform logs | **Any** movement during engine rollout is treated as caused by us until disproven |

The last row is the one people forget: the engine's rollout must be monitored
for damage to the *platform's* mail, because they share a provider account
(ADR-002).

## Success metrics

Measured over the pilot window; deliberately not engagement metrics.

- **Time-to-active** — gallery to active automation, target under 60 seconds
  (the spec's central UX claim, now measurable).
- **Activation retention** — automations still active after 30 days. The real
  signal: an automation a customer keeps on is one they trust.
- **Delivery rate** — accepted sends that reach the inbox, per major provider.
- **Skip honesty** — every skip reason in the log is explicable by a rule the
  customer would recognize.
- **Zero unexplained suppressions.**
- **Zero platform-email incidents attributable to the engine.**
- **Support load** — questions per active automation; a surface that generates
  questions has failed the 5-second rule.

Explicitly **not** metrics: open rate, click rate (ADR-012 — we do not ingest
them and they are substantially fictional), emails sent (volume is not value),
or minutes in app (the charter's named anti-metric).

## Exit criteria from pilot

All must hold, in writing:

1. ≥ 30 days in Stage 4 with the pilot customer actively using it.
2. Zero SEV-1 incidents; every SEV-2 closed with a root cause.
3. Delivery rate acceptable across the major Hebrew-market providers, with
   spam-folder placement investigated and resolved.
4. Bounce rate < 2%; complaint rate < 0.1%.
5. Activity log reconciles against the provider dashboard for the window.
6. The customer would object to losing the feature — asked directly.
7. Kill drill executed, time-to-silent recorded.
8. Support playbook exercised at least once by someone who did not write it.

## Criteria for enabling live sending

`AUTOMATIONS_SEND_MODE=live` may be set only when **every** item holds:

1. **ADR-002 Accepted** — sending subdomain chosen, SPF/DKIM/DMARC verified,
   warm-up considered.
2. **ADR-006 Accepted** — consent stance signed off by product **and** legal
   in writing. This is the one gate no engineering result can substitute for.
3. Delivery-events webhook registered and observed ingesting engine events
   while ignoring platform events.
4. Unsubscribe verified end to end against the deployed URL, including that a
   scanner-style `GET` does **not** suppress (ADR-003 amendment).
5. Deliverability smoke test passed with recorded inbox placement.
6. Monitoring in place with a named owner for the window.
7. Kill drill executed and documented.
8. For a customer agency: the observation log reviewed **with the customer**,
   and their explicit agreement to go live.

Items 1 and 2 are outside engineering's authority. That is intentional: the
last two locks on the door are held by people who can weigh business and legal
risk, not just technical readiness.

## Consequences

- Phase 7 delivers observation-capable production plus the instrumentation to
  watch it — and deliberately does **not** deliver live sending.
- The launch checklist (`docs/customer-automation-engine-launch-readiness.md`)
  is the operational form of the criteria above.
- Every flag named here is permanent until a superseding ADR removes it.
