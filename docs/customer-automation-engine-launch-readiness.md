# Customer Automation Engine — Launch Readiness Checklist

**Status:** operational checklist. The executable form of
[ADR-014](./adr/ADR-014-production-rollout-strategy.md)'s criteria. Nothing
here is optional; an unchecked box is a blocker, not a risk to accept.

**How to use:** work top to bottom. Each section names an **owner** — the role
that can actually sign it off. Engineering cannot self-certify Consent or DNS.

**Current state (2026-08-02):** Stage 0 (dark). All flags absent, live sending
unreachable, nothing enabled in production.

---

## Legend

- `[ ]` not done · `[~]` done but unverified in production · `[x]` verified
- **Gate S2** = required before internal live sending (Stage 2)
- **Gate S4** = required before pilot live sending (Stage 4)

---

## 1. Infrastructure — *owner: engineering*

- [ ] Engine migration applied to production (`db:migrate:prod`), verified
      against the production-lineage chain first (migration plan §2.5).
- [ ] All six engine tables present and empty; no existing table altered.
- [ ] Cron `/api/cron/automations-dispatch` registered in `vercel.json` and
      observed firing in production logs. **Gate S2**
- [ ] `CRON_SECRET` present; an unauthenticated call to the cron returns 403.
- [ ] `AUTOMATIONS_UNSUBSCRIBE_SECRET` set to a value distinct from every
      platform secret, and recorded in the secret store. **Gate S2**
- [ ] `AUTOMATIONS_WEBHOOK_SECRET` set and matching the provider endpoint
      configuration. **Gate S2**
- [ ] Confirmed: engine code paths are inert with all flags absent (deploy
      the engine, watch for zero engine log lines).

## 2. Monitoring — *owner: engineering, with a named on-call for the window*

- [ ] Named owner for the pilot window, with the escalation path written down.
- [ ] Worker `pass_summary` lines visible and searchable in the log platform.
- [ ] Alert or daily check on `dead` jobs (any occurrence investigated).
- [ ] Alert on identity failures (`identity_unavailable:*`) — **any**
      occurrence means a real send was refused. **Gate S2**
- [ ] Bounce and complaint counters watched (thresholds in ADR-014).
- [ ] Queue-age check: no pending job older than two cron cycles.
- [ ] **Platform email health baselined before Stage 2** so any movement
      during rollout is attributable. Shared provider account — this is the
      row people forget. **Gate S2**
- [ ] Internal pilot dashboard reachable (`AUTOMATIONS_PILOT_DASHBOARD=1`) and
      showing the pilot agency's real numbers. **Gate S4**

## 3. Deliverability — *owner: infrastructure*

- [ ] Sending subdomain warmed appropriately for expected volume.
- [ ] Smoke test: a real send received at **each** major Hebrew-market
      provider (Gmail, Outlook/Hotmail, Yahoo, Walla, and at least one
      corporate/Exchange recipient), with **inbox vs spam placement recorded
      per provider**. **Gate S2**
- [ ] Spam-folder placement, if any, investigated and resolved — not
      explained away.
- [ ] Rendered email inspected in at least one desktop and one mobile client
      for RTL correctness.
- [ ] Unsubscribe link verified working from a real received email.
- [ ] Delivery-events webhook observed: an engine send produces a
      `delivered` ladder update; a platform email produces **no** engine
      write. **Gate S2**
- [ ] Considered (not required for V1): RFC 8058 `List-Unsubscribe` /
      `List-Unsubscribe-Post` headers — deferred deliberately (ADR-003), and
      worth revisiting for Gmail/Yahoo bulk-sender expectations before GA.

## 4. DNS — *owner: infrastructure*

- [ ] Sending subdomain chosen and recorded in ADR-002. **Blocks everything
      below.**
- [ ] SPF published for the sending subdomain.
- [ ] DKIM published and verified with the provider.
- [ ] DMARC policy defined for the subdomain, with alignment confirmed and a
      reporting address that someone actually reads.
- [ ] Verified in the provider dashboard as an active sending domain.
- [ ] Platform domain (`getsocialcrm.com`) records **untouched** and
      re-verified after the change — the engine's DNS work must not disturb
      the address that carries verification and billing mail.

## 5. Sender identity — *owner: engineering + product*

- [ ] `AUTOMATIONS_FROM` set to the verified address. Until then the engine
      correctly refuses live sends (ADR-013). **Gate S2**
- [ ] Every pilot agency resolves a **complete** identity — checked, not
      assumed: business name present, admin email present and valid.
- [ ] Display name renders correctly for a Hebrew business name in received
      mail (encoding check).
- [ ] Reply-To lands in an inbox the business actually reads — confirmed with
      the customer, not inferred. **Gate S4**
- [ ] Test-send from the product produces an email indistinguishable from a
      real one apart from the `[בדיקה]` subject prefix.

## 6. Consent — *owner: product + legal (engineering cannot sign this)*

- [ ] **ADR-006 flipped to Accepted with written product and legal sign-off.**
      **Hard gate — no live send without it.**
- [ ] Feature terms-of-service language drafted and published.
- [ ] Confirmed: the business is the sender of record; SocialCRM provides the
      mechanism.
- [ ] Import exclusion confirmed as a **legal** control, not just a UX one —
      any future change to it is a consent decision.
- [ ] Pilot customer's lead sources reviewed: are these leads who initiated
      contact? Recorded. **Gate S4**
- [ ] Unsubscribe verified present, working, and permanent in a received
      email. **Gate S2**

## 7. Rollback — *owner: engineering*

- [ ] All three kill levers documented where on-call can find them in under a
      minute (not only in this repo).
- [ ] **Kill drill executed** in production before live sending, with
      time-to-silent measured and recorded. **Gate S4**
- [ ] Confirmed and understood: `AUTOMATIONS_ENABLED` off stops new emission
      but lets queued jobs drain — stopping in-flight work needs lever 2 or 3
      **plus** pausing the automations.
- [ ] Confirmed: pausing an automation cancels its pending sends.
- [ ] Team briefed that **any engineer may pull any lever without approval**.
- [ ] Understood: after the first live send, schema rollback is forbidden;
      behavior rolls back via flags only.

## 8. Support playbook — *owner: support + engineering*

Written, and exercised at least once by someone who did not write it:

- [ ] **"A lead says they got an email they didn't expect"** → find the lead
      in the activity log, identify the automation and trigger, explain in
      plain language, offer suppression.
- [ ] **"A lead says they unsubscribed but still got mail"** → check the
      suppression row and its timestamp against the send; if a send follows a
      suppression, that is a **SEV-2**, not a support ticket.
- [ ] **"The customer says nothing is sending"** → check in order: automation
      status, allowlist, `SEND_MODE`, identity completeness, skip reasons in
      the log, queue age. The skip log usually answers it outright.
- [ ] **"The customer wants to stop everything now"** → pause each automation
      (immediate, self-serve) or remove the agency from the allowlist.
- [ ] **"A lead's email bounced"** → explain the address block, and that
      correcting the lead's address resumes sending (no unblock tool exists
      by design).
- [ ] Escalation path to engineering with the severity classes from ADR-014.
- [ ] Support knows the engine surfaces `דורש טיפול` and what each identity
      problem message means.

---

## Sign-off

Live sending (`AUTOMATIONS_SEND_MODE=live`) may not be enabled until:

| Gate | Owner | Signed |
| --- | --- | --- |
| ADR-002 Accepted — sending domain verified | Infrastructure | ☐ |
| ADR-006 Accepted — consent stance | Product + Legal | ☐ |
| Deliverability smoke test passed | Infrastructure | ☐ |
| Monitoring live with named owner | Engineering | ☐ |
| Kill drill executed | Engineering | ☐ |
| Observation log reviewed **with the customer** | Product | ☐ |

**Until every row is signed, the engine stays in observation mode. That is not
a delay — it is the product working as designed.**
