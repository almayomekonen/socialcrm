# Notification Infrastructure — Architecture Specification

**Date:** 2026-08-11
**Status:** Approved design, amended 2026-08-11 (see §28). Implementation not started.
**Authority:** Subordinate to `CLAUDE.md`, `claude/do-not-touch.md`, `claude/care-charter.md`,
`claude/architecture-rules.md`, `claude/ux-guidelines.md`, `claude/frontend-experience-guidelines.md`.
Where this spec conflicts with any of those, they win.

---

## 1. Problem statement

> If something important happens in SocialCRM while the user is not looking at the
> application, there is currently no reliable way for the user to know that it happened.

Today the only *event* surface is `lib/toast.tsx` — an ephemeral, in-memory popover that
exists solely while a tab is open, and whose only event-driven producer is WhatsApp inbound
messages via `modules/inbox/awareness/`. (`toast()` is separately used across the app for
immediate action feedback, and `components/clients/CrmSyncBanner.tsx` reports poll-health;
neither is an event notification and neither is changed by this spec.) Nothing is persisted.
A user who closes the tab, or is on another screen, loses the signal permanently.

This contradicts the product's core promise ("nothing falls through the cracks",
`claude/product.md` §5). A lead can arrive, go unhandled, and expire with the system having
had the information the entire time and no way to surface it.

**This spec defines the durable architecture** for turning business events into persisted,
prioritized, multi-channel notifications that survive the user being away.

### 1.1 What this spec is not

- It is **not** an SLA system. SLA has no definition anywhere in this codebase. SLA types
  are *registered but disabled* (§4.5) as a pure extension point.
- It is **not** a rewrite of the automation engine. It mirrors that engine's proven
  patterns, in its own bounded domain, sharing no tables.
- It does **not** change authentication, permissions (`user_perms`), or `transferSales`.
  It **reads** permission data; it never writes it.

---

## 2. Product principles

These derive from `claude/care-charter.md` and are binding on every routing decision.

| Principle | Concrete rule in this system |
|---|---|
| **Proportion governs volume** (Law 5) | Only 3 of 15 types email by default. All others reach email only by failing to be handled. |
| **Urgency must be earned** (Law 16) | A type may only escalate if it can *prove* it is still unhandled (§9.2). Unknown state ⇒ silence. |
| **Triage, never dump** (Law 6) | 20 leads while away = 20 bell rows (workable) + 1 push (interruption). Never 20 pushes. |
| **Never shame** (Law 13) | Copy frames recovery, never neglect. No overdue guilt counts. |
| **Never invent a business fact** (Law 1) | All copy is built by deterministic string builders from CRM data. **No LLM ever generates notification copy.** |
| **The assistant does not seize the user** (Law 10) | "While you were away" is a calm section in the bell — never a modal, never self-reopening. |
| **Help, then recede** (Law 11) | Silence is a valid outcome. If nothing meaningful happened, nothing renders. |
| **One voice with the product** (Law 8) | `ליד` / `לידים` / `נציג` / `סטטוס`. Never `לקוח`, never `סוכן`. |

Plus, from `CLAUDE.md` §12: **no emoji in any notification UI.** Priority and category are
conveyed with existing `@/lib/Icon` glyphs and text. This deliberately diverges from the
emoji used in the originating brief's examples; `CLAUDE.md` §13 makes that non-negotiable.

---

## 3. System architecture

```
DOMAIN EVENT  (existing emission points + new ones)
     │
     │  notifyEvent(event, { trx? })   ── never throws
     ▼
notification_jobs                ← ONE guarded INSERT (~1ms) inside the request
     │                              ON CONFLICT DO NOTHING absorbs webhook retries
     │                              joins the caller's transaction when one exists (§14)
     │
     │  after() kick (immediate, post-response)  +  cron */1 (recovery)
     ▼
╔═══ NOTIFICATION INTELLIGENCE ENGINE ═══════════════════╗
║  1  resolve recipients      handlerId → ADMIN/GM        ║
║  2  drop self-authored      actorUserId == recipient    ║
║  3  collapse / dedup        upgrade-in-place            ║
║  4  preferences             user × category × channel   ║
║  5  presence                ONLINE / IDLE / OFFLINE     ║
║  6  capabilities            what this user can receive  ║
║  7  priority + routing      + channel-level grouping    ║
╚═════════════════════════════════════════════════════════╝
     ▼
notifications            (1 row per recipient — the record of truth)
     ▼
notification_deliveries  (1 row per channel attempt)
     ├── IN_APP    the notification row itself
     ├── TOAST     feed poll surfaces it while ONLINE
     ├── WEB_PUSH  web-push → push_subscriptions
     └── EMAIL     existing lib/email/sender.ts (Resend)
```

**Why the enqueue is safe inside the critical request path:** it is a single guarded INSERT
with no joins and no fan-out. Every expensive operation — permission reads, preference
reads, dedup scans, copy rendering, channel dispatch — happens in the worker. The Facebook
webhook returns 200 to Meta in the same time it does today.

**Why the engine mirrors the Customer Automation Engine:** that engine (ADR-010/011) is
already load-bearing in production here, with a lease + `SKIP LOCKED` queue, a cron drain,
an `after()` kick, and a never-throws emission gateway. Reusing a proven pattern in a new
bounded domain is strictly safer than inventing a second execution model.

**Domain boundary:** the notification engine shares **no tables** with the automation
engine. `automation_jobs` and `notification_jobs` are separate by design — the automation
migration explicitly declares its domain boundary, and coupling two engines through one
queue would violate it.

---

## 4. Event taxonomy

15 types across 5 categories. The registry (§5) is the single source of truth; this table
is the human-readable index. The `Recipients` column is binding — every type declares one
of the two rules in §6.1, and no type is left to engine inference.

### 4.1 Category `leads`

| Type | Base priority | Recipients | Trigger source |
|---|---|---|---|
| `lead.created` | MEDIUM | `handler_or_admin` | New lead persisted (manual, FB, WhatsApp, form) |
| `lead.hot` | HIGH | `handler_or_admin` | `conversation_intelligence` row with `kind='temperature'` whose `data->>'temperature'` is `hot` |
| `lead.assigned` | MEDIUM | `handler_or_admin` | `clients.handlerId` set/changed to a user |
| `lead.status_changed` | LOW | `handler_or_admin` | Lead status transition |
| `lead.activity` | INFO | `handler_or_admin` | Notable lead-level activity |

No emitter exists today at the temperature site. P1 adds one in
`lib/inbox/intelligence/worker.ts` where the `temperature` row is written.

### 4.2 Category `messages`

| Type | Base priority | Recipients | Trigger source |
|---|---|---|---|
| `message.inbound` | HIGH | `handler_or_admin` | Inbound customer message persisted |
| `message.inbound_multiple` | MEDIUM | `handler_or_admin` | **Aggregation only** — see §4.6 |
| `message.unanswered` | HIGH | `handler_or_admin` | Inbound message with no outbound reply past threshold |

Message events route to the **assigned rep**, with ADMIN/GM as a fallback **only when the
lead is unassigned** — not to owner-plus-all-admins. An inbound message is one person's work,
and copying every admin on every message is exactly the volume failure Law 5 forbids.
See §28 amendment 2.

### 4.3 Category `followups`

| Type | Base priority | Recipients | Trigger source |
|---|---|---|---|
| `followup.due` | MEDIUM | `handler_or_admin` | `clients.nextFollowUpAt` reached |
| `followup.overdue` | HIGH | `handler_or_admin` | `nextFollowUpAt` passed without resolution |

### 4.4 Category `integrations`

| Type | Base priority | Recipients | Trigger source |
|---|---|---|---|
| `integration.disconnected` | CRITICAL | `admin_only` | FB/WhatsApp connection lost |
| `integration.error` | HIGH | `admin_only` | Recoverable integration error |
| `integration.ingestion_failed` | CRITICAL | `admin_only` | A lead was received but could not be persisted |

### 4.5 Category `sla` — REGISTERED, DISABLED, NO SEMANTICS

| Type | Base priority | Recipients | Trigger source |
|---|---|---|---|
| `sla.approaching` | HIGH | `handler_or_admin` | **None. No emitter exists.** |
| `sla.breached` | CRITICAL | `handler_or_admin` | **None. No emitter exists.** |

SLA has no definition anywhere in this codebase — no table, no config, no timer, no product
decision. These two entries exist so a future SLA system plugs into the registry without an
engine change. They are `enabled: false`, have **no** `isResolved` predicate, and **no**
call site emits them. **No SLA semantics are invented by this spec.**

`recovery_alerts` — an orphaned table whose engine (`services/automation/recoveryEngine.ts`)
was never built — is noted as a **candidate reuse target** for a future, separately-defined
SLA system. It is *not* designated as the SLA implementation, and this spec does not touch
it.

### 4.6 `message.inbound_multiple` is aggregation-only

This type is an **aggregation record**, not an independent business-state notification.

- It declares **no** `isResolved` predicate and **no** escalation ladder. Per the
  fail-closed gate (§9.2 rule 4), it therefore never escalates.
- Resolution and escalation remain the responsibility of the underlying `message.inbound`
  and `message.unanswered` notifications, which own the real business state.
- It exists so the bell and the away-summary can show one truthful row for "several
  messages arrived", without duplicating escalation responsibility.

### 4.7 Explicitly NOT notifications

- **User login.** Remains audit/activity data in `recordLoginActivity` → `users_info.ips`.
  Never surfaced as a user notification. That code is not modified.
- **A user's own actions.** Hard engine rule: if `actorUserId === recipientUserId`, the
  notification is dropped before persistence (§6.3).
- Routine field edits, cache warms, poll ticks, and other low-value system events.

---

## 5. Notification registry contract

`lib/notifications/registry.ts` is the single source of truth. Adding a notification type
means adding one registry entry — never editing the engine.

```ts
type NotificationTypeDef = {
  type: NotificationType
  category: 'leads' | 'messages' | 'followups' | 'sla' | 'integrations'
  enabled: boolean                       // false ⇒ registered but never emitted (SLA)
  basePriority: Priority

  /** Deterministic dedup identity. Pure function of business facts. */
  collapseKey: (ctx: EventContext) => string

  /** Hebrew copy builders. Deterministic string builders. NEVER an LLM. */
  title: (ctx: EventContext) => string
  body: (ctx: EventContext) => string | null

  /** Entity pointer + deep link. Never contains a notification id. */
  entity: (ctx: EventContext) => { type: EntityType; id: number }
  deepLink: (ctx: EventContext) => string

  /** Recipient rule — resolved server-side only (§6). Two rules, no third. */
  recipients: 'handler_or_admin' | 'admin_only'

  /** Channel policy by presence (§19). Intersected with prefs + capabilities. */
  channels: ChannelPolicy

  /** Absent ⇒ this type NEVER escalates (fail-closed, §9.2). */
  escalation?: EscalationLadder

  /** Absent ⇒ this type NEVER escalates (fail-closed, §9.2). */
  isResolved?: (n: NotificationRow) => Promise<boolean>
}
```

**Registry invariants** (enforced by unit tests, §22.1):

1. Every `NotificationType` in the union has exactly one entry.
2. Every entry's `category` is one of the five.
3. If `escalation` is present, `isResolved` must also be present. An escalating type that
   cannot prove non-resolution is a spec violation.
4. `enabled: false` types must have no emitter reference anywhere in the codebase.
5. All copy builders are pure and synchronous — no I/O, no randomness, no model calls.

---

## 6. Recipient resolution

### 6.1 Rules

There are exactly **two** rules. Every type is mapped to one of them in §4 — the mapping is
part of the spec, not an engine inference.

| Rule | Resolves to | Used by |
|---|---|---|
| `handler_or_admin` | `clients.handlerId`. If null/unassigned → all ADMIN + GM in the agency. | all `leads`, `messages`, `followups`, `sla` types |
| `admin_only` | All ADMIN + GM. Used for integration failures — a נציג cannot fix a broken Facebook token. | all `integrations` types |

Typical fan-out is **one recipient**, which is what keeps this system quiet by default.

A third rule (`lead_owner_and_admin`, resolving to `clients.userId` + all admins) was
considered and **rejected** — no type needed it, and it would have copied every admin on
every inbound message (§28 amendment 2). An intermediate rung between handler and admin
(fall back to `clients.userId` before escalating to admins) was also considered and
deliberately **not** added: `handlerId` is the assignment field the product already uses for
"whose work is this", and inventing a second ownership notion here would fork that meaning.
If unassigned-but-owned leads prove to be a real pattern in practice, that is a separate,
evidenced decision.

### 6.2 Server-derived only

Recipients are resolved from `clients.handlerId` / `clients.userId` and a role lookup
**within the event's own `agencyId`**. That `agencyId` originates from either a verified
Meta webhook signature or an authenticated session — never from client input. No client can
influence who receives a notification.

`user_perms` is **read** (for admin/role resolution consistent with `getPerms` semantics).
It is never written. This system does not alter, extend, or reinterpret the permission
model.

### 6.3 Never notify a user about their own action

Before persistence, the engine drops any notification where
`actorUserId === recipientUserId`. Checked per-recipient, so an admin who creates a lead
assigned to someone else still generates a notification for the assignee, but not for
themselves.

`actorUserId` is null for system-originated events (webhooks, cron), in which case no
recipient is dropped.

---

## 7. Priority and presence models

### 7.1 Priority

```
CRITICAL  business is broken / irreversible loss imminent
HIGH      needs attention today
MEDIUM    normal work item
LOW       informational, state changed
INFO      ambient activity
```

Priority is `basePriority` from the registry, optionally upgraded in place by collapse
(§10.2) or escalation (§12). It is never downgraded.

### 7.2 Presence

Presence is **derived server-side** from `user_presence`, never trusted from the client.

```
ONLINE   lastSeenAt < 90s   AND lastSeenVisible = true
IDLE     lastSeenAt < 10min (or the tab reported hidden)
OFFLINE  otherwise, including "no user_presence row at all"
```

The presence stamp is written by the notification feed poll (§13.1) — **not** by a second
dedicated heartbeat loop. `frontend-experience-guidelines.md` §14 requires one owner per
live signal, and the feed poll is that owner.

**Because the feed poll is the only presence writer, its mounting condition is a presence
correctness requirement, not a UI detail.** The feed loop is gated on
`NOTIFICATIONS_ENABLED` (§23.1) and **must not** inherit the `INBOX_DELTA_SYNC` gating that
currently controls `AwarenessProvider`. If it did, a user actively working in the app with
that unrelated flag off would never stamp presence, classify as OFFLINE, and receive push for
routine events while looking at the screen.

**Why "no row ⇒ OFFLINE" is nonetheless safe:** the only channel that treats OFFLINE
differently in a user-visible way is WEB_PUSH, and push requires an existing
`push_subscriptions` row, which only exists if that user previously used the app and
explicitly granted permission (§15.2). A user with a subscription and no recent presence
stamp is genuinely away — which is precisely when push is correct.

Writes are throttled to at most once per 30s per user, and land in a narrow dedicated table
(§18.6) so they are cheap HOT updates.

---

## 8. Notification lifecycle: `seenAt` / `readAt` / `resolvedAt`

### 8.1 Three orthogonal states

| Field | Set by | Means | Effect |
|---|---|---|---|
| `seenAt` | System, on **SocialCRM-surfaced** render | The app itself showed it to the user | Removes from "While you were away". Does **not** clear the badge. Does **not** free the collapse key. |
| `readAt` | User, explicit | Clicked it, or mark-as-read / mark-all-read | Clears the badge. **Frees the collapse key.** Does **not** mean the work is done. |
| `resolvedAt` | Business state | The underlying work actually happened | **Stops escalation.** Independent of read state. |

### 8.2 `seenAt` — what counts, and what explicitly does not

`seenAt` is stamped **only** when SocialCRM itself surfaces the notification:

- the notification feed returns it to a live client, or
- the notification dropdown renders it, or
- a toast is actually surfaced for it, or
- the notification center renders it.

**A web push being delivered or displayed by the operating system does NOT set `seenAt`.**
Push delivery is not user observation — the OS may show a banner to an empty chair, on a
locked screen, or in a tray the user never opens. A pushed notification therefore **still
appears in "While you were away"** until SocialCRM itself has shown it.

This is a deliberate correctness property: the away summary answers "what did the app never
get a chance to show you", and a push receipt cannot answer that question.

### 8.3 Why three states, not two

The model earns its keep exactly where the three disagree:

- **Seen, not read** — the dropdown was opened and the row scrolled past. Still unread,
  still absorbing related events in place, still escalating.
- **Read, not resolved** — the user clicked the hot-lead notification, looked at the lead,
  and did nothing. The badge clears, but **escalation continues**, because the lead is still
  unhandled. A two-state model would silently stop caring the moment someone glanced at it.
  This case is the strongest reason not to collapse `readAt` and `resolvedAt`.
- **Resolved, not read** — the user replied from WhatsApp Business directly. Escalation
  stops (nothing left to nag about); the badge remains until they clear it.

---

## 9. Resolution registry and the fail-closed escalation gate

### 9.1 Two resolution mechanisms

**Push path (fast).** `resolveNotifications({ agencyId, entityType, entityId, types })` is
called at domain-action sites — an outbound message sent, a status changed, a follow-up
rescheduled. Sets `resolvedAt` + `resolvedReason='business_state'`. Never throws.

**Pull path (correctness net).** A registry entry may declare
`isResolved(notification) => Promise<boolean>`, re-evaluated against live DB state before
any escalation. Catches what the push path misses: replies sent outside the CRM,
reassignment, manual DB corrections.

### 9.2 The escalation gate — hard, ordered

```
1  reload the notification row
2  resolvedAt IS NOT NULL                              → STOP
3  a newer unread row exists for same (userId, collapseKey)
       → resolve THIS row as 'superseded'              → STOP
4  the type declares no isResolved()                   → STOP
5  isResolved() === true → set resolvedAt              → STOP
6  isResolved() threw / errored                        → STOP
7  otherwise                                           → escalate exactly ONE level
```

**Rules 4 and 6 are the discipline.** A type earns the right to escalate by being able to
prove it is still unhandled. When the system does not know, it stays quiet. This is
care-charter Law 16 expressed as control flow, and it is why every escalating type must
declare a predicate (registry invariant 3, §5).

**Rule 3 closes a real edge case.** `readAt` frees the collapse key, so a new related event
can create a fresh row while the older row is still escalating — two rows for one lead,
producing duplicate pushes. Supersession resolves the older row instead.

`resolvedReason` records the path: `business_state | superseded | entity_gone | manual`.

### 9.3 V1 predicates

Every column referenced below was verified to exist.

| Types | Resolved when |
|---|---|
| `lead.created`, `lead.assigned`, `lead.hot` | `clients.status <> 'new'` OR `clients.nextFollowUpAt IS NOT NULL` |
| `message.inbound`, `message.unanswered` | `EXISTS(SELECT 1 FROM inbox_messages WHERE "conversationId"=? AND direction='outbound' AND "createdAt" > notification."createdAt")` |
| `followup.due`, `followup.overdue` | `nextFollowUpAt` moved to future or null, OR `status IN ('closed','lost')` |
| `integration.disconnected`, `integration.error`, `integration.ingestion_failed` | the connection row is healthy again |
| `lead.status_changed`, `lead.activity`, `message.inbound_multiple` | *no predicate* → never escalates |
| `sla.*` | *no predicate, disabled* → never emitted, never escalates |

**Note on the message predicate:** `inbox_conversations` has `lastInboundAt` and
`lastDirection` but **no `lastOutboundAt`**. The predicate therefore reads `inbox_messages`
directly, which does carry `direction` and `createdAt`. Verified, not assumed.

---

## 10. Collapse and deduplication

### 10.1 The constraint

```sql
CREATE UNIQUE INDEX notifications_collapse_open_uniq
  ON notifications ("userId", "collapseKey")
  WHERE "readAt" IS NULL;
```

An **open** notification with the same collapse key is *upgraded in place*, never
duplicated. Enforcement is at the database level, so it is race-proof regardless of how many
concurrent webhooks fire. This mirrors the existing `recovery_alerts_one_open_per_lead`
partial-unique pattern already proven in this codebase.

The predicate is `readAt IS NULL`, deliberately **not** `seenAt IS NULL`. A seen-but-unread
row must keep absorbing related events — that is how "3 לידים חדשים" becomes "4" in place
instead of spawning a second row.

### 10.2 Upgrade-in-place

```
collapseKey = "lead:8134:arrival"

lead.created    → INSERT  "ליד חדש — דניאל כהן"              MEDIUM
lead.assigned   → UPDATE  "ליד חדש שויך אליך — דניאל כהן"    MEDIUM
temperature=hot → UPDATE  "ליד חם שויך אליך — דניאל כהן"     HIGH   ← upgrades channels
```

One row in the bell. The count never inflates. `groupCount` tracks absorbed events;
`updatedAt` refreshes. Priority may be upgraded, never downgraded.

Once `readAt` is set the key frees and a genuinely new event may create a fresh row — with
rule 3 of the escalation gate (§9.2) preventing the old row from double-notifying.

### 10.3 Collapse key conventions

```
lead:{leadId}:arrival             lead.created / lead.assigned / lead.hot
lead:{leadId}:status              lead.status_changed
conversation:{convId}:inbound     message.inbound / message.inbound_multiple
conversation:{convId}:unanswered  message.unanswered
lead:{leadId}:followup            followup.due / followup.overdue
integration:{provider}:{agencyId} integration.*
```

Keys are pure functions of business facts — never random, never time-seeded.

---

## 11. Channel-level grouping

**Grouping is a channel concern, never a record concern.**

If 20 leads arrive while a user is away, the bell shows **20 individual rows** — the user
has to work each one, so the record must stay truthful. Only the *interruption* is
summarized:

```
push   ≥3 same-category pending within  5 min → 1 digest, individuals suppressed
email  ≥3 same-category pending within 60 min → 1 digest, individuals suppressed
in-app                                        → NEVER grouped
toast                                         → count summary (existing behavior, §13.2)
```

Digest copy example (no emoji, per `CLAUDE.md` §12):

```
20 לידים חדשים
5 דורשים טיפול מיידי
```

Suppressed deliveries are **recorded, not dropped**:
`notification_deliveries.status = 'suppressed'` + `suppressionReason` +
`groupedIntoDeliveryId`. "Why didn't I get a push?" is always answerable from data.

---

## 12. Escalation ladder

Escalation is a **channel upgrade to the same recipient** — it never pages a different
person. Most SocialCRM agencies are 1–3 people, where escalating to a manager either
notifies the same human twice or creates a surveillance dynamic that care-charter Laws 13
and 19 push against.

```
t=0     in-app (+ toast if ONLINE)          level 0
t=15m   + web push                          level 1
t=60m   + email                             level 2
```

Every step passes through the §9.2 gate first. One notification row throughout —
`escalationLevel` increments in place, so the bell count never inflates.

Escalation applies only where the registry declares a ladder. Types without one
(`lead.status_changed`, `lead.activity`, `message.inbound_multiple`, all `sla.*`) never
escalate.

---

## 13. Toast / In-app relationship, and "While you were away"

### 13.1 One system, structurally

`/api/inbox/awareness` is **promoted** into `/api/notifications/feed`. The single existing
adaptive poll loop returns unread count + recent notifications + `serverTime`, and stamps
presence on the same request.

**This retirement is explicitly authorized** (2026-08-11, §28 amendment 1). It replaces a
live production path, which `CLAUDE.md` §4 otherwise forbids; the authorization is recorded
here so no later session has to re-derive whether it was sanctioned. The mitigations in risk
#1 (§26) are binding conditions of that authorization, not optional caution.

Two mechanical requirements follow from the feed owning presence:

- The feed loop is gated on `NOTIFICATIONS_ENABLED`, **never** on `INBOX_DELTA_SYNC` (§7.2).
- The feed is a GET that writes. It must be an explicitly dynamic, uncached route — a cached
  response would both stop presence stamping and serve one user's notifications to another.

| Retired / absorbed | Replaced by |
|---|---|
| `/api/inbox/awareness` | `/api/notifications/feed` |
| `AwarenessContext` / `AwarenessItem` | `NotificationContext` / `NotificationItem` |
| WhatsApp-only toast path | Registry-driven toast for all enabled types |

Reused unchanged: `useAdaptivePoll`, `nextInterval`, and `INBOX_RECOVERY_MS`.

**The feed loop does NOT yield on `/inbox`, unlike `AwarenessPoller`** (established P2.2).
Awareness can yield there because `InboxSyncLoop` feeds the same context; the feed loop has no
such substitute and is the only writer of `user_presence`. Yielding would mean a user working
in the inbox stops stamping presence, classifies OFFLINE within the idle window, and — once P3
lands — is pushed at while looking at the screen, which is the exact failure §7.2 exists to
prevent. The single-owner discipline still holds: there is one feed loop, mounted once in the
app shell.

`CrmSyncHealthContext` is reused by the awareness and inbox loops but deliberately **not** by
the feed loop (P2.2): `CrmSyncSource` is a closed union whose only consumer is `CrmSyncBanner`,
which each page opts into explicitly, so a new member would log "banner open" for a banner that
can never appear. A feed outage has no user-facing recovery action while notifications are
additive; the recovery band handles cadence and the next successful poll restores true state.

**Migration overlap (P2.2 → P2.6).** Both systems are mounted at once, so the retirement is
staged rather than a cutover. Until `AwarenessProvider` is removed:

- `NotificationContext` suppresses **toasts** for the `messages` category
  (`AWARENESS_OWNED_CATEGORIES` in `modules/notifications/surface.ts`), because awareness still
  owns the WhatsApp toast. Without it, one inbound message would produce two toasts.

  **The suppression is narrow on purpose, and must not widen into a rule.** It removes a
  duplicate *alert*, not a record: a `messages` notification is still counted on the bell badge,
  still listed in the dropdown, and still deep-links to its conversation. So retiring awareness
  changes only which system interrupts, never what is on record — which is what makes P2.6 a
  deletion rather than a migration. `awarenessCoexistence.test.tsx` pins both halves: one toast,
  and the row present in the panel.
- The nav conversation badge keeps its existing awareness source. `unreadConversationCount`
  rides on the feed for P2.6 to consume, and nothing reads it before then, so the badge cannot
  regress.

P2.6 is therefore: delete `AwarenessProvider`, delete that suppression set, and point the badge
at the feed. `__tests__/notifications/awarenessCoexistence.test.tsx` fails if the suppression is
removed while awareness is still live.

### 13.2 A toast is a rendering, not a channel implementation

A toast is **an IN_APP notification that arrived while the user is ONLINE**. The feed
returns new rows; the client toasts those flagged toast-eligible, using the existing
`toast()` API completely unchanged.

This makes "do NOT create two independent notification systems" a *structural* property
rather than a convention someone must remember. It is also exactly how `AwarenessContext`
already behaves, including its 1-vs-many summarization.

Toast-eligibility requires: presence ONLINE, the type's ONLINE policy includes TOAST,
`createdAt` after client mount (pre-existing backlog shows as a count, never a flood), and
the row not already toasted in this session.

**Split of those four conditions, as implemented in P2.2.** The first two are SERVER decisions
and travel on each feed item as `toastEligible`
(`lib/notifications/toastEligibility.ts`, using the same §15.1 `resolveChannels` intersection
the worker uses, with `toast: true` in the capability set because an open tab *is* the toast
surface). The client is given no way to re-derive them: it has neither presence nor preferences,
and a client-side copy would be a second channel-routing site that could disagree with the
worker's. The last two are the only facts the browser alone owns, and it keeps exactly those —
mount time, and a session set of already-toasted ids.

A fifth condition is enforced alongside them: the row must be **unseen in the database**. That
is what makes the guarantee survive a reload or a second tab, where session memory cannot. Both
the session set and the `seenAt` check are required — the session set covers the window between
toasting and the seen-stamp round-trip, during which polls still return `seenAt = null`.

**"After client mount" is compared in SERVER time.** `createdAt` comes from the server and the
mount instant from the browser, and those are not the same clock. A browser running ten minutes
slow would read its entire unread backlog as newer than mount and toast all of it on load — the
flood this gate exists to prevent, produced by a wrong clock rather than by real activity. The
mount instant is therefore translated once, using the `serverTime` the first feed response
already carries, and the translated value is the boundary from then on.

### 13.3 While you were away

Derived **entirely from persisted rows**, never frontend memory:

```
away gap  = now − previous lastSeenAt  >  15 min
window    = notifications
              WHERE "userId"    = :sessionUser
                AND "agencyId"  = :sessionAgency
                AND "createdAt" > :previousLastSeenAt
                AND "seenAt" IS NULL
render    = one calm section at the top of the bell, grouped by category with counts
```

Rendered as a section inside the existing bell dropdown — **not a modal, not a takeover,
never self-reopening** (Law 10). Opening it stamps `seenAt` on the covered rows. If the gap
is short, or nothing meaningful landed, **it renders nothing at all** (Law 4).

Because push does not stamp `seenAt` (§8.2), items the user was pushed about but never saw
in-app correctly still appear here.

---

## 14. Job durability and transaction boundaries

The enqueue must be as durable as the business event that caused it. `after()` and cron are
**processing and recovery** guarantees — they do not protect against losing the enqueue.

### 14.1 `notifyEvent` joins the caller's transaction when one exists

```ts
notifyEvent(event: NotificationEvent, opts?: { trx?: Knex.Transaction }): Promise<void>
```

This mirrors `emitAutomationEvent(event, { trx })` exactly.

### 14.2 The exact boundary, per call site

| Call site | Transaction available? | Guarantee |
|---|---|---|
| `actions/clients.ts` manual create | **Yes** — runs inside `withAgencyQuotaLock(agencyId, async (trx) => …)` | **Atomic.** Pass `{ trx }`; the enqueue commits with the lead insert. |
| `lib/automations/statusChanged.ts` | Yes where the caller supplies one | Atomic when a `trx` is threaded; otherwise §14.3 applies. |
| `lib/system/createClientFromWebhook.ts` (Facebook) | **No** — `insertLeadSystem` performs a bare, un-transacted `db('clients').insert(…)` | **Not atomic.** §14.3 applies. |
| `lib/system/createLeadFromWhatsappWebhook.ts` | **No** — same `insertLeadSystem` path | **Not atomic.** §14.3 applies. |

### 14.3 Closing the non-atomic gap without distributed transactions

Wrapping `insertLeadSystem` in a transaction would modify a protected, server-internal
ingestion path (`claude/do-not-touch.md` §1). That is out of scope for this spec and would
require its own explicit approval.

Instead, the gap is closed by an **idempotent reconciliation sweep**, run by the same cron:

```
find leads created in the last N minutes (N = 30)
  with no corresponding notification_jobs row for their lead_created eventKey
→ enqueue the missing jobs
```

This is safe precisely because `notification_jobs` carries a unique `eventKey` with
`ON CONFLICT DO NOTHING`: re-enqueueing an event that already exists is a no-op, so the
sweep can run repeatedly with no duplicate risk. It converts "we might lose an enqueue on a
crash between two statements" into "an enqueue is at most N minutes late".

**Documented consequence:** for webhook-ingested leads, a process crash in the window
between the lead INSERT and the job INSERT delays the notification by up to N minutes. It
does not lose it, and it never affects the lead itself.

---

## 15. Push architecture

### 15.1 Capability-based, never device-hardcoded

The engine models channel **capability**, not device class:

```
selectedChannels =  policyChannels(type, presence, priority)
                  ∩ enabledByPreferences(user, category)
                  ∩ availableCapabilities(user)
```

```
IN_APP    always available
TOAST     presence == ONLINE  and a live client session exists
WEB_PUSH  ≥1 active push_subscriptions row  AND flag on  AND VAPID configured
EMAIL     user has a deliverable address  AND not suppressed  AND flag on
```

**"Desktop" is never encoded as an architectural assumption.** That SocialCRM currently
redirects mobile requests to `/activate` is an observed deployment property recorded under
limitations (§25), not a branch in the engine. If mobile gains app access later, push begins
working for those users with **no engine change** — a subscription simply exists where one
did not before.

### 15.2 Mechanics

- Package: `web-push` (new dependency), Node runtime only.
- Keys: VAPID, generated with `npx web-push generate-vapid-keys` (§23.2).
- Service worker: `public/sw.js`, registered from the app shell when the flag is on and the
  user has granted permission.
- Permission is requested **only on explicit user action** in preferences — never on page
  load (Law 10: the user opens the assistant; it does not seize the user).

### 15.3 Subscription lifecycle

| Event | Handling |
|---|---|
| Create | Upsert on unique `endpoint`, bound to `(agencyId, userId)`. |
| Multiple devices | Multiple rows per user, each with its own `endpoint`. All receive. |
| Re-subscribe as a different user | **Reassigns** the endpoint and deletes the prior row (a real device changing hands). Never dual-bound, never leaked. |
| `404` / `410` from push service | Subscription expired/invalid → row deleted, delivery marked `failed`, reason `subscription_gone`. |
| Remove | Session-scoped delete. |
| Other failures | Delivery marked `failed` with reason; retried per `maxAttempts`, then terminal. |

### 15.4 Payload

RFC 8291 end-to-end encrypted — the push service cannot read it. Contains only
`{ notificationId, title, body, deepLink }`, where title/body are the already-rendered
Hebrew display strings. **Never** phone number, email address, or `idNum`.

---

## 16. Email architecture

Reuses `lib/email/sender.ts` (Resend) exactly as-is — no new provider, no new transport, no
new render path. Templates live alongside the existing `emails/` React Email components and
render through `lib/email/render.ts`.

**Policy-driven, not event-driven.** Only three types email by default:

- `integration.disconnected`
- `integration.ingestion_failed`
- `sla.breached` *(registered but disabled — no emitter, so two types in practice today)*

All three are "your business is broken and you cannot find out any other way". Every other
type reaches email **only** by failing to be handled through the escalation ladder (§12).
That is the Law 16 bar made concrete.

Existing `email_suppressions` is honored. Notification emails respect the same
unsubscribe/suppression discipline as other platform email, and are never sent to a
suppressed address.

---

## 17. Preferences

Per user × category, with per-channel booleans:

```
categories: leads | messages | followups | sla | integrations
channels:   IN_APP | WEB_PUSH | EMAIL
```

`TOAST` is not separately configurable — a toast is a rendering of IN_APP (§13.2), so
disabling IN_APP for a category disables its toast.

**Smart defaults, no configuration required.** A user with **no rows at all** gets the full
§19 policy matrix. Rows exist only where a user has deliberately deviated. The product works
correctly out of the box and the preferences table stays near-empty.

`CRITICAL` in-app notifications cannot be disabled — an integration being down is not an
opinion. Push and email for CRITICAL types remain user-controllable.

---

## 18. Database schema

Six new tables. No existing table is altered, renamed, or dropped.

Two design notes, both deliberate:

- Presence and preferences are **not** folded into the existing `users_info` sidecar.
  `recordLoginActivity` does `SELECT … FOR UPDATE` then upsert-merge on `users_info.ips`; a
  30-second-cadence presence write on that row would create lock contention and a real
  clobber risk on login history. Additionally, `users_info` predates the knex migration
  history (a Prisma-era base table), so altering it via knex would deepen the
  two-migration-system drift that already breaks DB-backed testing (§22.4).
- Entity references are **polymorphic and un-foreign-keyed** (`entityType` + `entityId`),
  following the automation engine's precedent of not FK-ing to `clients`. Orphans are
  filtered at read and removed by pruning (§21.3).

### 18.1 `notification_jobs`

```sql
CREATE TABLE notification_jobs (
  id            bigserial PRIMARY KEY,
  "agencyId"    integer NOT NULL,
  type          text NOT NULL,
  "eventKey"    text NOT NULL,
  "actorUserId" integer,
  "entityType"  text NOT NULL,
  "entityId"    bigint NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','done','skipped','failed','dead')),
  attempts      integer NOT NULL DEFAULT 0,
  "maxAttempts" integer NOT NULL DEFAULT 3,
  "notBefore"   timestamptz NOT NULL DEFAULT now(),
  "lockedAt"    timestamptz,
  "lockedBy"    text,
  "skipReason"  text,
  "lastError"   text,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);
```

### 18.2 `notifications`

```sql
CREATE TABLE notifications (
  id                bigserial PRIMARY KEY,
  "agencyId"        integer NOT NULL,
  "userId"          integer NOT NULL,       -- recipient
  type              text NOT NULL,
  category          text NOT NULL
                    CHECK (category IN ('leads','messages','followups','sla','integrations')),
  priority          text NOT NULL
                    CHECK (priority IN ('critical','high','medium','low','info')),
  title             text NOT NULL,
  body              text,
  "entityType"      text,
  "entityId"        bigint,
  "deepLink"        text NOT NULL,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "collapseKey"     text NOT NULL,
  "groupCount"      integer NOT NULL DEFAULT 1,
  "escalationLevel" smallint NOT NULL DEFAULT 0,
  "escalatedAt"     timestamptz,
  "seenAt"          timestamptz,
  "readAt"          timestamptz,
  "resolvedAt"      timestamptz,
  "resolvedReason"  text
                    CHECK ("resolvedReason" IS NULL OR "resolvedReason" IN
                           ('business_state','superseded','entity_gone','manual')),
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now()
);
```

### 18.3 `notification_deliveries`

```sql
CREATE TABLE notification_deliveries (
  id                      bigserial PRIMARY KEY,
  "notificationId"        bigint NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  "agencyId"              integer NOT NULL,
  "userId"                integer NOT NULL,
  channel                 text NOT NULL
                          CHECK (channel IN ('in_app','toast','web_push','email')),
  status                  text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','sent','delivered','failed','suppressed')),
  attempts                integer NOT NULL DEFAULT 0,
  "failureReason"         text,
  "suppressionReason"     text,
  "groupedIntoDeliveryId" bigint REFERENCES notification_deliveries(id) ON DELETE SET NULL,
  "providerMessageId"     text,
  "queuedAt"              timestamptz NOT NULL DEFAULT now(),
  "sentAt"                timestamptz,
  "deliveredAt"           timestamptz,
  "failedAt"              timestamptz
);
```

`delivered` is only ever set where the channel genuinely reports it (email via Resend
events). Push and in-app record `sent`; claiming a delivery we cannot observe would be a
data-honesty violation.

### 18.4 `push_subscriptions`

```sql
CREATE TABLE push_subscriptions (
  id             bigserial PRIMARY KEY,
  "agencyId"     integer NOT NULL,
  "userId"       integer NOT NULL,
  endpoint       text NOT NULL,
  "p256dh"       text NOT NULL,
  auth           text NOT NULL,
  "userAgent"    text,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "lastUsedAt"   timestamptz,
  "failureCount" integer NOT NULL DEFAULT 0
);
```

### 18.5 `notification_preferences`

```sql
CREATE TABLE notification_preferences (
  id          bigserial PRIMARY KEY,
  "agencyId"  integer NOT NULL,
  "userId"    integer NOT NULL,
  category    text NOT NULL
              CHECK (category IN ('leads','messages','followups','sla','integrations')),
  "inApp"     boolean NOT NULL DEFAULT true,
  "webPush"   boolean NOT NULL DEFAULT true,
  email       boolean NOT NULL DEFAULT true,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
```

Absence of a row means "all defaults" (§17). `email: true` here means "allowed to receive
email for this category **when policy calls for it**" — it does not widen the §16 policy.

### 18.6 `user_presence`

```sql
CREATE TABLE user_presence (
  "userId"          integer PRIMARY KEY,
  "agencyId"        integer NOT NULL,
  "lastSeenAt"      timestamptz NOT NULL DEFAULT now(),
  "lastSeenVisible" boolean NOT NULL DEFAULT true,
  "awaySinceAt"     timestamptz,
  "updatedAt"       timestamptz NOT NULL DEFAULT now()
);
```

Narrow by design — a high-frequency, HOT-updateable row with no jsonb and no contention with
login activity.

---

## 19. Channel policy matrix

Policy is intersected with preferences and capabilities (§15.1) before dispatch.

| Type | Priority | ONLINE | IDLE | OFFLINE | Email default |
|---|---|---|---|---|---|
| `lead.created` | MEDIUM | in-app + toast | in-app | in-app + push | — |
| `lead.hot` | HIGH | in-app + toast | in-app + push | in-app + push | escalation only |
| `lead.assigned` | MEDIUM | in-app + toast | in-app | in-app + push | — |
| `lead.status_changed` | LOW | in-app | in-app | in-app | — |
| `lead.activity` | INFO | in-app | in-app | in-app | — |
| `message.inbound` | HIGH | in-app + toast | in-app + push | in-app + push | — |
| `message.inbound_multiple` | MEDIUM | in-app + toast | in-app | in-app + push | — |
| `message.unanswered` | HIGH | in-app | in-app + push | in-app + push | escalation only |
| `followup.due` | MEDIUM | in-app + toast | in-app | in-app + push | — |
| `followup.overdue` | HIGH | in-app | in-app + push | in-app + push | escalation only |
| `integration.disconnected` | CRITICAL | in-app + toast | in-app + push | in-app + push | **yes** |
| `integration.ingestion_failed` | CRITICAL | in-app + toast | in-app + push | in-app + push | **yes** |
| `integration.error` | HIGH | in-app | in-app + push | in-app + push | escalation only |
| `sla.approaching` *(disabled)* | HIGH | in-app | in-app + push | in-app + push | escalation only |
| `sla.breached` *(disabled)* | CRITICAL | in-app + toast | in-app + push | in-app + push | **yes** |

---

## 20. Security and tenant isolation

Binding. Every item is a required property, not a guideline.

### 20.1 Doubly-scoped access

Every notification read and mutation goes through a single accessor module that applies:

```sql
WHERE "agencyId" = :sessionAgencyId AND "userId" = :sessionUserId
```

There is **no code path that queries a notification by `id` alone.** An id guess returns
zero rows — indistinguishable from not-found, so there is no enumeration oracle. The
`userId` predicate alone would technically suffice (a user belongs to one agency), but the
`agencyId` predicate is retained as defense in depth and to match codebase convention.

### 20.2 Notification IDs never appear in URLs

Deep links target the **entity** (`/clients/8134`, `/inbox?conversation=91`), never
`/notifications/8134`. There is no notification detail route. Mark-as-read is a Server
Action taking an id, scoped per §20.1.

### 20.3 Deep-link authorization happens at click time

**A notification is a pointer, never a capability grant.** The target route authorizes
independently, at click time, using its own existing guards — because permissions change
between creation and click (a נציג can lose access to a lead after being notified about it).

**Notifications must never weaken target-route authorization.** No route may relax a check
because "the user arrived from a notification". There is no notification-derived trust.

**Release prerequisite for P2.** A pre-existing cross-agency authorization weakness on the
`/clients/[clientId]` lead-detail route is already tracked separately. The notification
system does not create it, does not widen it, and exposes nothing new across tenants through
its own rows — **but notification deep links increase traffic to that route, and this spec
does not make that route safe.** That issue must be fixed before P2 ships to production
(§24). It does not block writing or implementing this design.

### 20.4 Entity verification at render

The feed query verifies the referenced entity still exists and still belongs to the session
agency. Orphaned notifications are filtered from results and removed by pruning.

### 20.5 Push subscription security

- `endpoint` is globally unique and bound to `(agencyId, userId)` at subscribe time.
- Re-subscribing an existing endpoint as a different user **reassigns** it and deletes the
  prior row. Never dual-bound; a device changing hands never leaks the previous user's
  notifications.
- Unsubscribe is session-scoped — a user can only remove their own subscriptions.
- Payloads are RFC 8291 end-to-end encrypted and carry no PII beyond display name/counts
  (§15.4).

### 20.6 Preference-change authorization

The preferences Server Action **accepts no `userId` parameter from the client**. The target
is derived from the session, so a caller cannot name a victim. `category` and `channel` are
zod-validated against registry enums — never free-form strings.

### 20.7 Service worker restrictions

`public/sw.js` registers **only** `push` and `notificationclick` handlers.

It **must not** register a `fetch` handler, must not cache any response, and must not store
authenticated data. A caching service worker on an authenticated origin is a cross-session
data-leak vector; a push-only service worker cannot become one. Hard constraint, enforced by
review.

### 20.8 Reused authorization — no alternative system

- User-facing reads/actions: `requireAgencyUser` / `requireProductAccess`.
- Worker/cron endpoint: existing `CRON_SECRET` bearer + `x-cron-secret` pattern.
- Admin/role resolution: consistent with `getPerms` semantics, read-only.

No new authorization abstraction is introduced. `user_perms` is never written.

---

## 21. Performance, concurrency, pruning

### 21.1 Indexes

```sql
-- badge + dropdown (hot path)
CREATE INDEX notifications_user_unread_idx
  ON notifications ("userId", "createdAt" DESC) WHERE "readAt" IS NULL;

-- notification center pagination
CREATE INDEX notifications_user_created_idx
  ON notifications ("userId", "createdAt" DESC);

-- dedup / collapse (also the ON CONFLICT target)
CREATE UNIQUE INDEX notifications_collapse_open_uniq
  ON notifications ("userId", "collapseKey") WHERE "readAt" IS NULL;

-- escalation scan — only rows that could still escalate.
-- The predicate is "resolvedAt IS NULL" ALONE, deliberately NOT "AND readAt IS NULL":
-- a read-but-unresolved notification MUST keep escalating (§8.3). Adding readAt to
-- this predicate would silently exclude the single most important escalation case —
-- the user who glanced at a hot lead and did nothing.
CREATE INDEX notifications_escalation_idx
  ON notifications ("createdAt") WHERE "resolvedAt" IS NULL;

-- while-you-were-away window
CREATE INDEX notifications_unseen_idx
  ON notifications ("userId", "createdAt") WHERE "seenAt" IS NULL;

-- worker claim scan (mirrors automation_jobs_claim_idx)
CREATE INDEX notification_jobs_claim_idx
  ON notification_jobs ("notBefore") WHERE status = 'pending';

-- retry/webhook dedup (also what makes the reconciliation sweep safe, §14.3)
CREATE UNIQUE INDEX notification_jobs_event_uniq
  ON notification_jobs ("eventKey");

CREATE INDEX notification_deliveries_notification_idx
  ON notification_deliveries ("notificationId");
CREATE INDEX notification_deliveries_pending_idx
  ON notification_deliveries (channel, "queuedAt") WHERE status = 'pending';

CREATE UNIQUE INDEX push_subscriptions_endpoint_uniq ON push_subscriptions (endpoint);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions ("userId");

CREATE UNIQUE INDEX notification_preferences_user_category_uniq
  ON notification_preferences ("userId", category);
```

### 21.2 N+1 avoidance and concurrency

- The worker **batch-loads** leads, handlers, and preferences once per drain pass — never
  per notification.
- The feed endpoint is a single query with its entity join; no per-row lookups.
- Collapse: `ON CONFLICT … DO UPDATE` against the partial unique index — race-proof.
- Job claim: lease + `SKIP LOCKED`, the automation engine's proven approach. Safe to overlap
  with itself and with `after()` kicks.
- Escalation: optimistic `UPDATE … WHERE "escalationLevel" = :expected`, making
  double-escalation from overlapping workers impossible.

### 21.3 Pruning

Run by the same cron:

- `notifications` where `readAt IS NOT NULL AND resolvedAt IS NOT NULL`, older than 90 days.
- `notifications` whose referenced entity no longer exists (orphans).
- `notification_jobs` in terminal status older than 90 days.
- `push_subscriptions` past a failure threshold or with a `410`-confirmed dead endpoint.

90 days matches the automation engine's operational window. Pruning is load-bearing, not
optional: a 200-lead/day agency generates ~200 rows/user/day.

---

## 22. Testing strategy

### 22.1 Pure unit tests (`VITEST_NO_DB=1` — run today)

Most of the engine's intelligence lives in pure functions **specifically** so it is testable
without a database:

- Registry completeness and all five invariants (§5).
- Priority × presence × channel resolution for all 15 types.
- Capability intersection (§15.1), including "push unavailable ⇒ routes elsewhere".
- Collapse-key derivation determinism.
- Presence classification from timestamp fixtures (ONLINE/IDLE/OFFLINE boundaries).
- Grouping threshold logic (3-in-5min push, 3-in-60min email).
- **The 7-step escalation gate as an explicit decision table** — every rule, including
  fail-closed on no-predicate (rule 4) and on predicate error (rule 6).
- Hebrew copy builder determinism, plus an assertion that **no builder output contains an
  emoji**.
- Recipient resolution from fixtures: unassigned → admin fallback, and the self-authored drop.

### 22.2 SQL-shape tests (`.toSQL()`)

Every notification query asserts that **both** `agencyId` and `userId` predicates are
present. This is the tenant-isolation regression net that works despite the DB harness
blocker, and it is the primary automated defense for §20.1.

### 22.3 Accessibility tests

Extend the existing `__tests__/a11y` suite (never weaken existing assertions, per
`claude/release-deployment-workflow.md` §9):

- The icon-only bell has an accessible name.
- The unread badge is announced appropriately and is not color-only.
- Dropdown focus management: focus returns on close, Escape closes.

### 22.4 DB-backed integration tests — honest constraint

DB-backed tests currently fail in this repo for a **pre-existing, unrelated reason**: base
tables are Prisma-managed while migrations are knex, so the test harness cannot construct a
complete schema.

These tests **will be written and committed**, and are **expected to fail** until that
harness is fixed. They will be **reported as failing** — never skipped, never deleted, and
the spec will not be weakened to fit the harness.

### 22.5 Full gate before any merge

`npx tsc --noEmit`, `npm run test:a11y`, `npm run test:unit`, `npm run test:integration`,
plus `npm run test:runtime` where applicable.

**What "green" means here**, since §22.4 makes a literally-all-passing run impossible:

- `npx tsc --noEmit`, `test:a11y`, and `test:unit` must pass **completely**. No exceptions —
  all of this system's intelligence is covered by `test:unit` (§22.1).
- `test:integration` is expected to fail on the pre-existing knex/Prisma harness issue. The
  requirement is that **the set of failing tests does not grow beyond that known cause**:
  record the failure list before the first notification commit and compare against it. A new
  failure, or a failure with any other cause, is a blocking condition.
- Failures are always reported, never skipped, never deleted, and the spec is never weakened
  to make them pass (§22.4).

This is a narrower definition than `claude/release-deployment-workflow.md` §2 assumes, and it
applies **only** to the pre-existing harness cause named in §22.4.

---

## 23. Feature flags, environment, rollout

### 23.1 Flags

| Flag | Off behavior |
|---|---|
| `NOTIFICATIONS_ENABLED` | `notifyEvent()` is inert — logs a shadow metric, touches no DB. Master kill switch. |
| `NOTIFICATIONS_AGENCY_ALLOWLIST` | Canary by agency id, mirroring the automations allowlist. |
| `NOTIFICATIONS_PUSH_ENABLED` | Push channel skipped; engine routes to in-app/email. |
| `NOTIFICATIONS_EMAIL_ENABLED` | Email channel skipped. |

### 23.2 Environment variables

| Variable | Purpose |
|---|---|
| `VAPID_PUBLIC_KEY` | Push signing (server) |
| `VAPID_PRIVATE_KEY` | Push signing (server) |
| `VAPID_SUBJECT` | `mailto:` contact required by the push protocol |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Client-side subscription |

Generate with:

```
npx web-push generate-vapid-keys
```

**Any missing variable ⇒ the channel reports `not_configured` and the engine routes around
it.** Never a crash, never a silent drop. Per the project's Feature Rollout Standard, no
feature may require an undocumented env var to appear in the UI — every variable above is
documented here and must also be recorded in the deployment checklist.

### 23.3 Cron

A fifth entry in `vercel.json`:

```json
{ "path": "/api/cron/notifications-dispatch", "schedule": "*/1 * * * *" }
```

The `after()` kick remains the normal-latency path. Cron bounds **recovery**, escalation
timing precision (±1 min), reconciliation (§14.3), and pruning.

**Cadence is a cost decision, not a correctness one.** `*/1` is 1,440 invocations/day, and
the finest existing schedule in this file is the `*/5` automations cron — which demonstrates
sub-hourly cadence works here but does not by itself justify `*/1`. Because cron is the
recovery net and never the delivery-latency path, `*/2` or `*/5` would loosen only escalation
precision against a 15-minute first rung. Start at `*/1`; drop to `*/5` if invocation volume
proves to matter, with no other change required.

### 23.4 Migration strategy

- New tables only; **no existing table is altered, renamed, or dropped.**
- One knex migration per logical group, `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT
  EXISTS`, matching existing migration style (`{YYYYMMDDHHMMSS}_{snake_case}.cjs`).
- **Each migration gets a unique timestamp prefix.** `migrations/` already contains two files
  sharing `20260811000001`, which makes knex's lexical ordering depend on the filename
  suffix. Six new migrations that must run in dependency order (`notifications` before
  `notification_deliveries`, which references it) must not repeat that.
- `down()` is valid only before the first live notification is delivered. After that,
  behavioral rollback is via flags, never schema — the same forward-only posture the
  automation engine adopted.
- `/api/inbox/awareness` is kept as a thin alias for **one release** after
  `/api/notifications/feed` ships, then removed. It is never deleted in the same release that
  introduces the replacement.

---

## 24. Implementation phases

### P1 — Foundation (no user-visible change)

- Six migrations, all indexes and constraints.
- `lib/notifications/registry.ts` + type union + invariant tests.
- `notifyEvent()` with `{ trx }` support; wired to existing emission points, atomic where a
  transaction exists (§14.2).
- Worker: claim/lease, recipient resolution, self-authored drop, collapse, persistence.
- IN_APP channel only. Flag off by default.
- Reconciliation sweep + pruning.

**Exit:** notifications are being created correctly in the database for the canary agency,
with nothing rendered in the UI.

### P2 — In-app surface

- `/api/notifications/feed` (unread + items + presence stamp); `/api/inbox/awareness` kept
  as an alias. — **delivered P2.1**
- `NotificationContext` replacing `AwarenessContext`; toast wired through the registry.
  — **delivered P2.2** (context and toast; awareness retirement itself deferred to P2.6)
- Bell + badge in `Topbar`; dropdown; mark-read / mark-all-read; deep links; a11y tests.
  — **delivered P2.3**
- `/notifications` center. — **delivered P2.4**

**P2.3 / P2.4 surfaces, for the record.** `seenAt` may now be stamped by three things and nothing
else: the toast (P2.2), the dropdown rendering a row (P2.3), and the notification center (P2.4).
A feed GET stamps presence, never `seenAt`. The dropdown's boundary is `renderedNotifications` in
`modules/notifications/dropdown.ts` — a feed page of fifty with eight on screen stamps eight, and
the ids past the render limit stay unseen rather than being quietly consumed. The center stamps
every row it has loaded; pages the user never requested stay unseen.

The bell shows `unreadNotificationCount`; the nav keeps showing `unreadConversationCount` from
awareness. They share one renderer (`lib/navs/NavBadge.tsx`, moved out of `Nav.tsx` in P2.3 for
exactly this reason) so the 99+ cap cannot drift, and they share nothing else.

**Release prerequisite:** the `/clients/[clientId]` cross-agency authorization issue (§20.3)
must be fixed before P2 reaches production. Still open as of 2026-08-11; P1 neither created
nor widened it, but P2's deep links increase traffic to that route (risk #3, §26).

**Prerequisite before any `message.inbound` emitter is wired:** `eventKeyForEvent` gives every
type except `lead.status_changed` an identity of `type:agency:entityType:entityId`, which for a
conversation-entity type is *once ever per conversation*. The second inbound message on a
conversation would therefore produce the same `eventKey`, be absorbed by
`ON CONFLICT DO NOTHING`, and never notify — while the collapse machinery below it
(`groupCount`, `message.inbound_multiple`) is built assuming repeat events do arrive. A
per-message discriminator is required.

**The discriminator is deliberately not specified here.** It must be derived from the actual
inbox message model and emitter when those are inspected in P2 — the message id, or the
provider message id, or the message's own `createdAt`, depending on what is stable across a
provider retry. Choosing now would be inventing an identity for a model this spec has not
read, and the wrong choice fails in the same silent direction: an unstable discriminator turns
one message into several notifications, exactly the volume failure Law 5 forbids.

### P3 — Push and email

**MANDATORY PREREQUISITE — `processJob` must read real presence before WEB_PUSH routing
exists.** `lib/notifications/processJob.ts` classifies presence with the P1 placeholder
`p1Presence = () => classifyPresence(null, new Date())`, i.e. **everyone is OFFLINE**. That was
a truthful reading while `user_presence` had no writer, and it stays harmless for as long as
IN_APP is the only capability, because IN_APP appears in the offline column of every row of the
§19 matrix.

It becomes a **live defect the moment WEB_PUSH is enabled**, and it fails in the worst
direction: every user classifies OFFLINE, every offline policy row includes `web_push`, so a
user sitting and looking at the screen would be pushed for routine events. That is precisely
the failure §7.2 exists to prevent, and it would arrive as a flood rather than a visible error.

`user_presence` has had its single writer since P2.1 (`db/notifications/presence.ts`, commit
`1f2701af`), so the data is there. P3 must replace `p1Presence` with a **batched** read
(one query per worker pass keyed by userId, never per-notification — §21.2), and must not be
merged with the placeholder still in place. Deliberately deferred out of P2.2, which added no
presence-dependent channel.

- `push_subscriptions` management, `public/sw.js` (push + notificationclick only),
  permission request from preferences.
- `web-push` dispatch, expiry handling, multi-device.
- Resend email templates for the default-email types.
- Delivery tracking across all channels.
- Preferences UI in `/settings/(user_settings)`.

### P4 — Intelligence

- Channel-level grouping digests (push 3/5min, email 3/60min) with suppression records.
- Escalation ladder with the full §9.2 gate.
- "While you were away" section.
- `resolveNotifications()` push-path wiring at domain-action sites.

*(Collapse/dedup ships in P1 — it is a database constraint, not a feature.)*

---

## 25. Known limitations

1. **Push reaches only browsers that can subscribe.** SocialCRM currently redirects mobile
   requests to `/activate`, so in practice today that means desktop browsers. Recorded as a
   deployment property, **not** encoded in the engine (§15.1). Email remains the only channel
   that reaches a genuinely-away user.
2. **Escalation timing precision is ±1 minute**, bounded by cron cadence. Stated honestly in
   copy; never presented as exact.
3. **Webhook-ingested notifications may be up to 30 minutes late** in the rare crash window
   described in §14.3. They are never lost.
4. **`delivered` status is only truthful for email.** Push and in-app record `sent`.
5. **SLA is not implemented.** Two types are registered and disabled with no semantics.
6. **DB-backed integration tests will fail** on a pre-existing harness issue (§22.4).

---

## 26. Architectural risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Retiring `AwarenessContext` touches a live production path (WhatsApp toast behind `INBOX_DELTA_SYNC`) | Feed reproduces the awareness contract exactly; old endpoint kept as an alias for one release; flag-gated rollout |
| 2 | Presence write amplification (one write per poll per user) | ≥30s throttle; narrow dedicated table for HOT updates; not on `users_info` |
| 3 | Deep links increase traffic to a route with a known authorization weakness | §20.3 release prerequisite — fix before P2 production; notifications never relax target-route checks |
| 4 | `after()` is best-effort on Vercel | Cron is the correctness guarantee, same posture as ADR-011 |
| 5 | Notification volume for high-traffic agencies | Pruning is load-bearing; in-app rows are cheap; grouping caps interruptions |
| 6 | Two migration systems (knex vs Prisma-era base tables) | New tables are knex-only; no base table is altered; drift is not deepened |
| 7 | Escalation could become a spam vector if a predicate is wrong | Fail-closed gate (§9.2 rules 4 and 6); registry invariant 3; decision-table unit tests |
| 8 | Push permission prompt could feel intrusive | Requested only on explicit user action in preferences, never on load (Law 10) |
| 9 | Adding a 5th cron increases scheduled load | Well within Vercel Pro limits; the existing `*/5` automations cron proves sub-hourly cadence works here |

---

## 27. Preserved decisions (explicit checklist)

- Assigned rep (`handlerId`) with ADMIN/GM fallback; `admin_only` for integrations.
- **Every type declares its recipient rule in §4** — two rules exist, and message events use
  `handler_or_admin`, not owner-plus-all-admins.
- **The notification feed owns presence, gated on `NOTIFICATIONS_ENABLED` only** — never on
  `INBOX_DELTA_SYNC`.
- **No notification about your own actions** (`actorUserId === recipientUserId` → drop).
- **User login remains audit activity**, never a notification.
- **SLA is registered but disabled**, with no invented semantics and no emitter.
- **`recovery_alerts` is only a future SLA reuse candidate** — untouched by this spec.
- **`message.inbound_multiple` is aggregation-only** — no predicate, no ladder, never escalates.
- **Push delivery does NOT set `seenAt`.**
- **The bell stays individual and truthful**; push/email may group independently.
- **No LLM-generated notification copy** — deterministic builders only.
- **Notification IDs never appear in URLs.**
- **Notification authorization is doubly scoped by `agencyId` + `userId`.**
- Toast is a rendering of IN_APP, not a second notification system.
- Channels are capability-based, never device-hardcoded.
- Enqueue is atomic with the business event wherever a transaction exists; the exact
  boundary and its reconciliation fallback are documented (§14).
- No emoji in any notification UI.

---

## 28. Amendment log

### 2026-08-11 — continuation review, before any implementation

The design was reviewed against the originating architectural brief and against the actual
codebase (every claim in §§1, 4, 6, 9.3, 13, 14, 15, 16, 18, 20, 21, 22, 23 was verified
against real files). The architecture was confirmed unchanged. Six gaps were closed:

1. **Retiring `AwarenessContext` is now explicitly authorized.** §13.1 replaces a live
   production path, which `CLAUDE.md` §4 forbids absent an explicit instruction. That
   instruction was given on 2026-08-11. The alias-for-one-release and flag-gated rollout in
   risk #1 (§26) are binding conditions of the authorization. Recorded so the sanction is
   provable later, and so §13.1 is not mistaken for an unrequested refactor.

2. **Per-type recipient mapping added; the third recipient rule removed.** The design declared
   a `recipients` field and defined three rules, but never mapped the 15 types to them.
   Message events now use `handler_or_admin` (assigned rep, admins only as fallback when
   unassigned). `lead_owner_and_admin` is removed from the contract — it had no users, and
   applying it to messages would have copied every admin on every inbound message, defeating
   §6.1's own "typical fan-out is one recipient" property and care-charter Law 5.

3. **The presence gap is closed.** Presence is written only by the feed poll, and the loop it
   replaces mounts only when `INBOX_DELTA_SYNC` is on. Inheriting that gating would classify
   an actively-working user as OFFLINE and push at them. §7.2 and §13.1 now require gating on
   `NOTIFICATIONS_ENABLED` only, state that a missing `user_presence` row classifies OFFLINE,
   and explain why that default is safe (push needs an opted-in subscription).

4. **"Green" is defined.** §22.5 demanded a passing `test:integration` that §22.4 says cannot
   pass. The bar is now: typecheck, a11y, and unit fully green; integration's known-failure
   set must not grow.

5. **Cron cadence recorded as a cost decision.** `*/1` stands, with the honest note that the
   existing `*/5` cron does not justify it and that `*/5` costs only escalation precision.

6. **Factual corrections.** §1 no longer calls toast the only notification surface
   (`CrmSyncBanner` exists; `toast()` also serves action feedback). §4.1 states the real hot
   representation (`data->>'temperature' = 'hot'`) and that P1 must add the emitter in
   `lib/inbox/intelligence/worker.ts`. §23.4 requires unique migration timestamps, since
   `migrations/` already contains a duplicated prefix.

**Adjacent system, deliberately untouched.** Support Center Phase 4 plans `lib/support/notify.ts`
as a best-effort Resend path for support tickets. It has no in-app surface, no queue, and no
registry, so it does not fork this architecture. It is a **future candidate** to route through
this registry — not part of this spec, and not modified by it.

**Still open, deliberately not decided here:** the `/clients/[clientId]` cross-agency
authorization issue (§20.3) remains a P2 release prerequisite tracked separately.

### 2026-08-11 — P1 implemented, audited, and hardened back to spec

P1 shipped in nine commits and was then audited read-only against this document. The audit
found no blocking defect. Two findings changed the code or this spec:

1. **The reconciliation durability net drifted and has been restored.** The implementation had
   shortened the §14.3 window from 30 minutes to 10 and started the §23.3 cron at `*/5` instead
   of `*/1`. Each looked locally defensible, but together they cut recovery attempts for a lost
   enqueue from roughly thirty to two, which contradicts both §14.3 ("does not lose it") and
   §25 limitation 3, where 30 minutes is the worst case published to users. Both values are
   back to the spec, and both are now pinned by tests so the next change has to be deliberate.
   The flag-flip blast radius that motivated the shorter window is recorded in
   `db/notifications/reconcile.ts` as a separate concern with a separate fix, because narrowing
   durability to solve a rollout problem trades the wrong thing.

2. **A `message.inbound` identity prerequisite is now recorded in §24** rather than discovered
   during P2. No message emitter exists today, so nothing is broken; the constraint is written
   down, and the discriminator is deliberately left unspecified until the real message model is
   inspected.

Non-blocking findings left as-is and recorded for later: a retried job can increment
`groupCount` twice if it crashes between its transaction committing and the job being marked
done (at-least-once, visible only on count-dependent copy); the collapse `DO UPDATE` and the
orphan prune are scoped by `userId` / entity id without a redundant `agencyId` guard
(unreachable without cross-agency data corruption, and §10.1 defines the index that way);
`CRITICAL_WITH_EMAIL` includes email in the ONLINE state, which §19's presence-unqualified
email column permits but which P3 should confirm before email ships; and collapse
race-proofness remains asserted structurally rather than exercised against live Postgres,
which is the standing §22.4 consequence.
