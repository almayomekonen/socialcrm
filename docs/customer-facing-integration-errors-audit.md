# Customer-Facing Integration & Webhook Errors — Audit

**Status:** audit. Nothing implemented.
**Trigger:** a rejected CF7 webhook is visible only as a server log line; the customer keeps
working while leads are silently dropped.
**Scope:** how the failure is surfaced. Not the verification logic, not the CF7 connector.

---

## 1. Current failure flow

```
WordPress / CF7
   │  POST /api/automations/webhooks/contact_form_7?c=contact_form_7:3
   ▼
app/api/automations/webhooks/[integration]/route.ts
   ├─ webhookConnectorFor(integration)            unknown → 404, log only
   ├─ connection row by id + integrationKey       missing/revoked → 404, log only
   ├─ headers['x-connection-secret'] = row.webhookSecret
   │
   ├─ connector.verifyWebhook({headers, body})
   │      ✓  → recordDelivery(row.id)    lastEventAt = now(), eventCount += 1
   │      ✗  → ***nothing is recorded, anywhere***
   │
   ├─ ingestWebhookWith(...)  → { accepted: false, reason: 'invalid_signature' }
   ├─ console.warn('[automations][webhook]', { rejected, integration, agencyId, connectionId })
   └─ 401
```

The engine is never reached. `emitAutomationEvent` is not called, so there is no job, no
`automation_activity` row, and no automation that could be said to have failed.

---

## 2. Where the error currently exists

| Store                                               | Holds this failure?                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel log (`console.warn`)                         | **Yes — and only here.**                                                                                                                                                                                                                                                                                                                           |
| `automation_connections.lastEventAt` / `eventCount` | **No.** [`recordDelivery`](db/automations/connectionDelivery.ts) is called _only after_ `verifyWebhook` passes — deliberately, since a verified-but-unacted payload still proves the wiring. A rejected delivery therefore moves nothing.                                                                                                          |
| `automation_activity`                               | **No.** Nothing was emitted, so nothing ran.                                                                                                                                                                                                                                                                                                       |
| `automation_jobs`                                   | **No.** Same reason.                                                                                                                                                                                                                                                                                                                               |
| `webhook_failures` table                            | **Exists, but is not this.** Created in `20260323000002` for the **Facebook** lead path: columns are `lead_id`, `page_id`, `error_type ∈ token_expired \| graph_api_error \| timeout \| db_error`. Written only by `app/api/webhooks/facebook/route.ts`, and **read by no UI at all**. It is not generic and the connector path does not touch it. |
| Connection health                                   | **No.** [`healthOf`](lib/automations/connectors/contactForm7.ts) derives health from _stored state alone_ — `revokedAt`, `webhookSecret`, `ownerUserId`. An invalid signature changes none of them, so health stays `ok`.                                                                                                                          |

---

## 3. What the customer currently sees

**Nothing, on any surface.** Worse than nothing, in the most likely case:

- If the connection **never** worked, the card shows `never_received` — _"טרם התקבלו נתונים… שלחו טופס
  אחד לבדיקה"_. Accidentally correct, and the only case the product handles.
- If the connection **worked and then broke** — a rotated secret, a plugin update, a site
  migration — `lastEventAt` still holds yesterday's timestamp and `eventCount` is non-zero, so
  [`IntegrationConnectionCard`](components/settings/connections/IntegrationConnectionCard.tsx)
  renders **`receiving` — "מקבל אירועים"** with a stale "אירוע אחרון" line.

> The product actively reassures the customer that leads are arriving, at the exact moment they
> are being refused at the door. That is the defect, and it is worse than silence.

---

## 4. Recommended primary surface

**The leads page banner — the `MetaDisconnectedBanner` pattern, reused.**

That component already solves this exact problem for the other lead source:

```tsx
// components/clients/MetaDisconnectedBanner.tsx — mounted in app/(app)/leads/page.tsx
חשבון ה‑Meta מנותק. לידים חדשים לא ייכנסו עד שתחבר אותו מחדש.   [ חבר מחדש ]
```

Same failure class (a lead source has stopped delivering), same consequence (leads do not enter),
same audience, same page. Building a second mechanism for the website form when this one exists —
server-rendered, persistent, already mounted where a rep would notice missing leads — would be the
"new notification framework" this audit is meant to avoid.

Why not the alternatives:

| Option                      | Verdict                                                                                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Toast**                   | Fails the critical requirement outright. The failure happens when a lead submits the form — often at night, with nobody logged in.                                                                                                  |
| **New notification centre** | None exists anywhere in the product. Building one is a framework, not a fix.                                                                                                                                                        |
| **Automation card**         | **Wrong boundary.** `AutomationCardData.connectionProblem` exists and renders _דורש טיפול_, but it keys on connection **health**, and health is `ok` here. Reusing it would blame an automation that is working and never even ran. |
| **Dashboard**               | Out of scope (no redesign), and the leads page is where the consequence is felt.                                                                                                                                                    |

---

## 5. Recommended secondary surface

**The connection card's delivery badge** — where the detail and the fix live.

The vocabulary is already correct, and the card's own comment states the distinction this audit
needs:

> _"Delivery answers 'is anything getting through?'; health answers 'is the authorisation still
> good?' Both, because a connection can be perfectly authorised and silent."_

`invalid_signature` is a **third** condition that neither covers: **arriving, and being refused.**
So the honest change is one more `DeliveryState`:

```
disconnected     החיבור אינו פעיל
never_received   טרם התקבלו נתונים
receiving        מקבל אירועים
unknown          מחובר (does not report)
rejected    ←    NEW: מתקבלות פניות שנדחות
```

Banner = _you are losing leads right now_. Card = _this connection, this reason, this fix._
No third surface.

---

## 6. Customer-facing wording strategy

Three fields, one map, no branching in components — the shape `HEALTH`, `DELIVERY`, `SUBSCRIPTION`
and `SKIP_REASON_COPY` already use.

| Field           | Rule                                                                                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **title**       | Names the **source**, never the mechanism. "הטופס באתר" — not webhook, signature, endpoint, HTTP.                                                                                                        |
| **explanation** | What was attempted, what failed, **and what was lost**. The loss is the part that makes a customer act.                                                                                                  |
| **action**      | Present **only** when a real destination exists. `/settings/integrations?section=website` does (it is already the CF7 requirement's CTA). A reason with no fix carries no button rather than a dead one. |

Consistent with `care-charter` Law 13: recovery framing, never blame — _"החיבור לא אומת"_, not
_"הגדרת את החיבור לא נכון"_.

---

## 7. Severity model — what the architecture supports **today**

| Severity                           | Supported? | Evidence                                                                                  |
| ---------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| Connection / configuration failure | **Yes**    | `healthOf()` → `degraded` (no secret, no owner), `revoked` (revokedAt). Already rendered. |
| Never received anything            | **Yes**    | `eventCount === 0` → `never_received`.                                                    |
| **Transient** (one blip)           | **No**     | Nothing counts rejections. No row, no counter, no timestamp.                              |
| **Repeated** (N in a row)          | **No**     | Same reason.                                                                              |
| **Permanent**                      | **No**     | No such concept anywhere.                                                                 |

So the "1 failure → silence, 5 failures → warn" model **cannot be built from what exists**. It
needs exactly one thing: a rejection counter that a success resets.

**Do not invent a threshold — the house already has one.** `lib/polling/syncFailure.ts`:

```ts
export const SYNC_FAILURE_THRESHOLD = 3
export function nextConsecutiveFailures(prev, failed) { return failed ? prev + 1 : 0 }
export function shouldShowSyncBanner(failures, threshold = SYNC_FAILURE_THRESHOLD) { … }
```

Consecutive-failures-with-reset, threshold 3, used to decide whether a banner appears. That is the
same decision, already made once, and reusing its shape keeps the product coherent.

One exception worth stating: **a configuration failure should not wait for a threshold.** A missing
secret means _every_ future delivery will be refused, so counting to three only delays a certainty.
Threshold for rejections; immediate for `degraded`/`revoked` — which is already how health renders.

---

## 8. Technical → customer-facing mapping approach

`IngestRejection` is a closed union of six values. **Not all six are customer-facing**, and the
route already says so — three of them return **200** because they are decisions, not errors:

| Reason               | HTTP | Customer-facing?                                                                                                            |
| -------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------- |
| `invalid_signature`  | 401  | **Yes — high.** Leads are being lost and only the customer can fix it.                                                      |
| `unreadable_payload` | 400  | Yes, lower. Usually a plugin/provider fault.                                                                                |
| `not_actionable`     | 200  | **No.** "The provider sent something we do not act on."                                                                     |
| `event_undescribed`  | 200  | **No.** Internal catalog state; the customer cannot act.                                                                    |
| `event_unbridged`    | 200  | **No.** Same.                                                                                                               |
| `subject_unresolved` | 200  | Different failure — a submission with no identifiable lead. Worth its own message eventually; **not** a connection problem. |

So the map is **partial by design**:

```ts
Partial<Record<IngestRejection, CustomerFacingError>>
```

An unmapped reason is deliberately silent — the same discipline as `LAW_EVALUATORS`' `null`
entries, where "no evaluator yet" is explicit rather than accidental. A `Record` (total) would force
copy to be invented for reasons that must never reach a customer.

---

## 9. Exact example — `invalid_signature`

```ts
invalid_signature: {
  severity: 'high',
  title: 'יש בעיה בחיבור לטופס באתר',
  explanation:
    'התקבל ניסיון לשלוח ליד מהטופס באתר שלך, אבל החיבור לא אומת ולכן הליד לא נכנס למערכת.',
  action: { label: 'בדיקת החיבור', href: '/settings/integrations?section=website' },
}
```

Rendered on the two surfaces:

**Leads page banner** (primary — the consequence)

```
┌──────────────────────────────────────────────────────────────────────┐
│  יש בעיה בחיבור לטופס באתר                          [ בדיקת החיבור ] │
│  פניות מהטופס מגיעות אבל לא נכנסות למערכת.                            │
└──────────────────────────────────────────────────────────────────────┘
```

**Connection card** (secondary — the detail)

```
טופס יצירת קשר — האתר שלי          [ מתקבלות פניות שנדחות ]
התקבל ניסיון לשלוח ליד מהטופס באתר שלך, אבל החיבור לא אומת ולכן הליד לא נכנס למערכת.
מקור אחד · אוטומציה אחת · אירוע אחרון לפני 3 ימים          [ בדיקת החיבור ]
```

Note what is absent: `invalid_signature`, 401, HMAC, webhook, endpoint, connection id.

---

## 10. Infrastructure that already exists and can be reused

| Asset                                                                                             | Reuse                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `IngestRejection` union                                                                           | The technical vocabulary to map from. Closed and named already.                                                                                 |
| `automation_connections` (`agencyId`, `integrationKey`, `lastEventAt`, `eventCount`, `revokedAt`) | The row a rejection counter belongs on.                                                                                                         |
| `recordDelivery` / `deliveryFacts`                                                                | The exact shape the rejection counter mirrors — one write on the hot path, one keyed read for the UI.                                           |
| `DELIVERY` / `HEALTH` copy maps + `StatusBadge` + `StatusRole`                                    | The badge vocabulary. One new `DELIVERY` entry, no new component.                                                                               |
| `MetaDisconnectedBanner` + its mount in `app/(app)/leads/page.tsx`                                | The persistent-banner pattern, already on the right page.                                                                                       |
| `SYNC_FAILURE_THRESHOLD`, `nextConsecutiveFailures`, `shouldShowSyncBanner`                       | The consecutive-failure-with-reset model. Do not invent a second one.                                                                           |
| `ConnectionDetails` / `IntegrationConnectionCard`                                                 | The detail surface; both already branch on delivery + health.                                                                                   |
| `lib/email/sender` + `@react-email` templates (`emails/templates/`)                               | **Exists and is production-proven** (magic link, invoice, welcome, feedback). Ready for a later "we could not reach you in-app" phase. Not now. |

**Does not exist:** any in-app notification centre, badge, or inbox. Nothing in `lib/navs` or
`components/layout`. Building one is out of proportion to this problem.

---

## 11. Infrastructure genuinely required

1. **Persist the rejection.** Two additive columns on `automation_connections`, mirroring the
   delivery pair: `lastRejectedAt`, `consecutiveRejections`, plus `lastRejectionReason`.
   A **verified delivery resets the counter to 0** — that is what makes "consecutive" true and is
   exactly `nextConsecutiveFailures`.
   _Not a new table._ The delivery counters already live on this row; a rejection is the same fact
   with the opposite sign. A per-event `connection_rejections` log would buy history, and nothing
   in the recommended UX needs history yet.
2. **One write on the unverified path** — the single branch in the route that currently does nothing.
3. **`rejected` added to `DeliveryState`** + one `DELIVERY` copy entry.
4. **The partial customer-facing map** (§8), in the connections `copy.ts` beside its siblings.
5. **One read**: "does this agency have a connection at or over the threshold?" — for the banner.
6. **A second banner instance** on the leads page, fed server-side.

### One risk that must be designed for, not discovered

The rejection counter is written on a path reachable by **anyone who knows the URL**. A stranger
POSTing garbage to a valid connection id could drive the counter past the threshold and raise a
false alarm — the product crying wolf about a connection that is fine, which is precisely the
credibility this alarm depends on.

The route already narrows it: the request must name a real, non-revoked connection for this agency
before verification is attempted. Two further options worth deciding before implementing —

- require **no verified delivery in the same window** before alarming (a connection still receiving
  good traffic is not broken, whatever noise arrives alongside), or
- rate-limit the counter per connection per hour.

The first is more honest and needs no new mechanism: both counters are already on the row.

---

## 12. Smallest implementation plan

**Phase 1 — see it.** Columns + the one write + the `rejected` delivery state + the copy map + the
connection card. No banner yet. Ships the truth to the surface that already exists; nothing new is
mounted anywhere.

**Phase 2 — surface it where it hurts.** The threshold read + the leads banner, reusing
`shouldShowSyncBanner`'s shape and `MetaDisconnectedBanner`'s markup.

**Phase 3 — decide about absence.** Only after Phase 2 has run against real traffic: whether a
connection that has received _nothing_ for N days deserves the same treatment. That is a different
failure (silence, not rejection) and should not be guessed at now.

**Later, explicitly not now:** email notification, `subject_unresolved` copy, per-event rejection
history, any dashboard surface.

---

## The one recommended UX flow

```
CF7 posts an unverifiable payload
        ↓
route records the rejection on the connection row      (reason + timestamp, counter += 1)
        ↓
        ├─ counter < 3  →  nothing shown.  A blip is not an incident.
        │
        └─ counter ≥ 3, and nothing verified since
                ↓
   ┌────────────────────────────────────────────────────────────────┐
   │ LEADS PAGE — persistent, server-rendered, survives being offline│
   │                                                                 │
   │   יש בעיה בחיבור לטופס באתר               [ בדיקת החיבור ]      │
   │   פניות מהטופס מגיעות אבל לא נכנסות למערכת.                    │
   └────────────────────────────────────────────────────────────────┘
                ↓  the customer clicks
   ┌────────────────────────────────────────────────────────────────┐
   │ SETTINGS → אינטגרציות → the connection                         │
   │                                                                │
   │   טופס יצירת קשר      [ מתקבלות פניות שנדחות ]                 │
   │   התקבל ניסיון לשלוח ליד מהטופס באתר שלך, אבל החיבור לא אומת   │
   │   ולכן הליד לא נכנס למערכת.                                    │
   │                                     [ בדיקת החיבור ]           │
   └────────────────────────────────────────────────────────────────┘
                ↓  they re-authorise; the next signed delivery arrives
        recordDelivery() resets the counter → banner disappears on its own
```

The automation is never mentioned. It did not fail — it was never asked to run, and saying otherwise
would send the customer to the wrong screen.
