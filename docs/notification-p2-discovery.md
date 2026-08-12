# Notification Infrastructure — P2.0 Discovery + Contracts

Status: discovery complete, no application code written.
Authority: `docs/notification-infrastructure-spec.md` (approved). This document records
what P2 found in the existing code and fixes the contracts P2.1–P2.6 will build against.
Where this document and the spec disagree, the spec wins and the disagreement is listed
in §11 rather than silently resolved.

P1 baseline: the twelve-commit series `7738e5af` (architecture spec) through `8cd422c8`
(reconciliation hardening), with implementation spanning `ec95741f`..`7b840342`. P2 starts
from `8cd422c8`.

---

## 1. Existing awareness architecture (verified)

### 1.1 The five moving parts

| Part | File | Role |
|---|---|---|
| `AwarenessProvider` | `modules/inbox/awareness/AwarenessContext.tsx:43` | Holds `whatsappUnread`, owns toast dedup memory, mounts the poller |
| `AwarenessPoller` | same file, `:97` | The single global loop; **yields on `/inbox`** |
| `AwarenessItem` | `modules/inbox/awareness/types.ts` | `{ type:'whatsapp_message', conversationId, contactName, at, priority? }` |
| Route | `app/api/inbox/awareness/route.ts` | auth → product access → `getInboxAwareness` |
| Query | `modules/inbox/queries.ts:230` | unread conversation count + ≤20 recent unread conversations |

Mounted at `app/(app)/layout.tsx:96`, wrapping the whole workspace, **inside**
`CrmSyncHealthProvider` and outside `UserProvider`.

### 1.2 What the endpoint returns today

```
{ counts: { whatsappUnread: number },
  items:  AwarenessItem[],          // ≤20, ordered lastInboundAt DESC
  serverTime: string }              // ISO, becomes the next ?since
```

`items` is filtered by `cv."lastInboundAt" > (since - 2000ms)` — a deliberate 2s
overlap so a message landing mid-request is not skipped. **The `since` cursor is a
server timestamp echoed back by the client, never a client clock.**

### 1.3 How polling works

`useAdaptivePoll` (`modules/inbox/client/useAdaptivePoll.ts`) with awareness defaults:
focused `[3500, 5000]`ms, hidden `[30000, 60000]`ms, `maxIdle: 4`, recovery
`INBOX_RECOVERY_MS`. Behaviour that P2 inherits for free:

- interval eases from fast → slow end of the band as `idleStreak` grows; any change resets it
- `visibilitychange` → immediate tick and `idleStreak = 0`
- `inFlight` guard — never two concurrent requests
- failures do **not** raise `idleStreak`; a fixed recovery band owns outage cadence
- `retryRef` exposes a manual retry, wired into `CrmSyncHealthContext.report('awareness', …)`

### 1.4 How presence is represented today

**It is not.** There is no presence concept in the awareness path — no heartbeat, no
`user_presence` write, no server-side classification. `lib/notifications/presence.ts`
already contains the classifier (`classifyPresence`, 90s / 10min windows) and its header
records that **nothing writes the table yet and the feed poll is its single owner**. P2.1
is that first writer.

### 1.5 How toast triggering works (behaviour that must be preserved)

`mergeAwareness` (`:60`) is the only toast trigger, and its three guards are the
care-charter behaviour P2 must reproduce exactly:

1. `seen: Set<'conversationId:at'>` — never toast the same arrival twice in a session
2. `it.at > mountedAt` — pre-existing backlog is a **count, never a toast flood**
3. 1 item → named toast deep-linking to that conversation; >1 → one summary toast to `/inbox`

`toast()` (`lib/toast.tsx:12`) is a **single-slot** toast: a second call replaces the
first. That is *why* the 1-vs-many summarization exists, and it is a hard constraint on
P2.2 — surfacing N notifications must never mean calling `toast()` N times.

### 1.6 The two consumers (the actual retirement blast radius)

| Consumer | Line | Uses | Consequence for P2.6 |
|---|---|---|---|
| `lib/navs/Nav.tsx:18` | `useAwarenessCount()` | live inbox nav badge; `null` ⇒ fall back to the server-rendered `inboxUnread` prop | **The feed must keep supplying this number** |
| `modules/inbox/client/InboxSyncLoop.tsx:24` | `setCount()` | on `/inbox`, moves the badge but never toasts | Single-owner discipline must survive |

### 1.7 `INBOX_DELTA_SYNC` usage

`isInboxDeltaSyncEnabled()` (`lib/flags/inboxFlags.ts:11`) has exactly two call sites:
`app/(app)/inbox/page.tsx:47` and `app/(app)/layout.tsx:92` — the latter being
`<AwarenessProvider enabled={deltaSyncEnabled}>`. When the flag is off, the provider
still mounts (context exists, `whatsappUnread` is `null`) but **no poll runs**.

---

## 2. Existing polling architecture (reused unchanged)

| Asset | File | P2 use |
|---|---|---|
| `useAdaptivePoll` | `modules/inbox/client/useAdaptivePoll.ts` | the feed loop; no new framework |
| `nextInterval` / `PollBand` | `lib/polling/pollSchedule.ts` | unchanged |
| `CrmSyncHealthContext` | `lib/polling/CrmSyncHealthContext.tsx` | `report('notifications', failures, retry)` |
| `INBOX_RECOVERY_MS`, `scheduleDelayAfterPoll`, `nextConsecutiveFailures` | `lib/polling/syncFailure.ts` | unchanged |

P2 adds **zero** polling primitives. The only new thing is one `useAdaptivePoll` caller.

---

## 3. Proposed feed contract

### 3.1 `GET /api/notifications/feed`

`Cache-Control: no-store` on every exit. Spec §13.1: a cached response would both stop
presence stamping and risk serving one user's rows to another.

> **Corrected during P2.1.** This section originally prescribed
> `export const dynamic = 'force-dynamic'`. That is **wrong for this repo** and fails the
> build: `next.config.mjs` enables `cacheComponents`, and Next 16.0.10 rejects it with
> *"Route segment config \"dynamic\" is not compatible with `nextConfig.cacheComponents`.
> Please remove it."* Discovery inferred compatibility from the absence of a prohibition
> string in the Next bundle; `npm run build` disproved it. Under Cache Components, caching
> is **opt-in** via `'use cache'`, so an endpoint that never opts in is uncached by
> default — a stronger guarantee than opting out. `npm run build` lists the route as `ƒ`
> (Dynamic). That no route in this repo exports `dynamic` was the available clue, and it
> now has a reason recorded beside it.

Query: `?since=<ISO>` (server-issued, for toast candidacy) ·
`?cursor=<id>&limit=<n≤50>` (notification center only).

The authoritative contract now lives in code at `modules/notifications/types.ts`; the two
count fields were renamed during P2.1 (`unreadCount` → `unreadNotificationCount`,
`inboxUnread` → `unreadConversationCount`) so that neither name can be mistaken for the
other at a call site — the §11.1 collision is easy to reintroduce by autocomplete.

```ts
type NotificationFeedResponse = {
  enabled: boolean                 // false ⇒ every other field is inert; client keeps awareness
  unreadNotificationCount: number  // notifications WHERE readAt IS NULL   (bell badge)
  unreadConversationCount: number  // unread CONVERSATIONS                 (nav badge — see §11.1)
  presence: 'online' | 'idle' | 'offline'   // server-classified, echoed for observability only
  items: NotificationFeedItem[]    // ≤20, createdAt DESC, individual rows
  whileYouWereAway: WhileYouWereAway | null
  serverTime: string               // ISO — the next ?since
  nextCursor: { createdAt: string; id: number } | null   // keyset, null on the bell path
}

type NotificationItem = {
  id: number
  type: string                     // registry NotificationType
  category: 'leads' | 'messages' | 'followups' | 'sla' | 'integrations'
  priority: 'critical' | 'high' | 'medium' | 'low' | 'info'
  title: string
  body: string | null
  entityType: string | null
  entityId: number | null
  deepLink: string                 // entity URL, never a notification id (spec §20.2)
  createdAt: string
  seenAt: string | null
  readAt: string | null
  toastEligible: boolean           // SERVER-decided (§3.3)
}

type WhileYouWereAway = {
  since: string                    // persisted boundary, from user_presence.awaySinceAt
  total: number
  categories: { category: NotificationItem['category']; count: number }[]
}
```

### 3.2 Request ordering is load-bearing

The presence read **must** precede the presence write, or the away boundary is destroyed
by the very request that needs it:

```
1  getUser()                        → 401 without agencyId
2  getAgencyProductAccess           → 403
3  NOTIFICATIONS_ENABLED + allowlist → { enabled:false } and return  (no table touched)
4  READ  user_presence row          → prevLastSeenAt, classifyPresence()
5  DERIVE away boundary             → §7
6  WRITE user_presence (throttled)  → §4
7  READ  unreadCount, items, inboxUnread, WYWA aggregate
8  respond no-store
```

### 3.3 `toastEligible` is decided on the server

Spec §13.2 requires presence ONLINE **and** the type's ONLINE policy to include TOAST —
both of which live server-side (`resolveChannels`, `lib/notifications/policy.ts:94`). The
client must not re-derive policy; it only applies the two client-only facts it alone owns:
`createdAt > mountedAt` and per-session dedup. Sending policy to the browser would be a
second decision site for channel routing.

### 3.4 Companion write routes

Both doubly scoped (`WHERE "userId" = session AND "agencyId" = session`, spec §20.1), ids
in the **body**, never the URL:

- `POST /api/notifications/seen` `{ ids: number[] }` → `seenAt = now() WHERE seenAt IS NULL`
- `POST /api/notifications/read` `{ ids: number[] } | { all: true }` → `readAt = now() WHERE readAt IS NULL`

`readAt` frees the collapse key (partial unique index is `WHERE "readAt" IS NULL`), so the
read route is the one that must never be loosened in scope.

### 3.5 No second source

Every field above is a `SELECT` over `notifications` / `user_presence` /
`inbox_conversations`. No in-memory queue, no cache, no parallel store.

---

## 4. Presence implementation plan

Single statement, DB-level throttle — no read-modify-write race:

```sql
INSERT INTO user_presence ("userId","agencyId","lastSeenAt","lastSeenVisible","updatedAt")
VALUES (:userId, :agencyId, now(), :visible, now())
ON CONFLICT ("userId") DO UPDATE
   SET "lastSeenAt"      = now(),
       "lastSeenVisible" = EXCLUDED."lastSeenVisible",
       "agencyId"        = EXCLUDED."agencyId",
       "updatedAt"       = now()
 WHERE user_presence."lastSeenAt" < now() - interval '30 seconds'
    OR user_presence."lastSeenVisible" IS DISTINCT FROM EXCLUDED."lastSeenVisible"
```

- **Throttle** = the `ON CONFLICT … WHERE`. At the focused 3.5–5s cadence this collapses
  ~7 polls into one write. Narrow table ⇒ cheap HOT update (spec §7.2).
- **Visibility change still writes** even inside the 30s window, because a tab going
  hidden is exactly the transition that flips ONLINE → IDLE.
- `classifyPresence` is reused unchanged; **missing row ⇒ OFFLINE** already holds.
- Gated on `NOTIFICATIONS_ENABLED`, **never** `INBOX_DELTA_SYNC` (spec §7.2 / §13.1).
- Nothing is written to `users_info`.

---

## 5. NotificationContext plan

`NotificationProvider` mounts where `AwarenessProvider` does (`app/(app)/layout.tsx`),
**outside** `Topbar` so the bell can consume it. It owns:

| State | Source |
|---|---|
| `unreadCount`, `items`, `presence` | last feed response |
| `inboxUnread` | last feed response — re-exported for the nav badge |
| `whileYouWereAway` | last feed response (persisted, §7) |
| toast dedup `Set<id>` | client session only |
| `mountedAt` | client session only |
| `markSeen(ids)`, `markRead(ids)`, `markAllRead()` | optimistic local update + POST |

Toast surfacing reuses `mergeAwareness`'s exact shape, with `id` replacing
`conversationId:at` as the dedup key (a database id is a strictly better key than a
composite timestamp):

```
fresh = items.filter(i => i.toastEligible && !toasted.has(i.id) && i.createdAt > mountedAt)
fresh.length === 1  → toast(icon, item.title, 6000, () => router.push(item.deepLink))
fresh.length  >  1  → toast(icon, `${n} התראות חדשות`, 6000, () => router.push('/notifications'))
```

Single-slot `toast()` (§1.5) makes the summary branch mandatory, not stylistic.
Toast-surfaced rows get `seenAt` (spec §8.2 — a SocialCRM surface). Push never will.

**Single-owner discipline preserved:** the feed loop yields on `/inbox` exactly as
`AwarenessPoller` does; `InboxSyncLoop` keeps feeding the badge via a `setInboxCount`
equivalent and still never toasts.

---

## 6. Bell / dropdown integration points

- **Slot:** `lib/navs/Topbar.tsx:50-53`, the desktop system-control cluster
  (`hidden desktop:flex items-center gap-3`), between `CopilotTopbarTrigger` and
  `UserNAgency`. No Topbar restructuring.
- **Trigger pattern:** copy `CopilotTopbarTrigger` verbatim — `<button aria-label>` +
  `aria-expanded` + `aria-haspopup='menu'`, `size-7 rounded-full border focus:ring-2`.
- **Icon:** `<Icon name='bell' type='sol' />`. `bell` is confirmed present in `IconNames`
  (`lib/Icon.tsx:78`). `Icon` is `aria-hidden` by construction, so **the count must be in
  the button's `aria-label`** (`NavBadge` is `aria-hidden` and announces nothing).
- **Badge:** reuse `NavBadge`'s exact classes (`absolute -top-1 -end-1 … bg-red-500`).
  Cap: see §11.2.
- **Dropdown:** native `popover='auto'` + `popoverTarget`, per `ActionsMenu`
  (`components/clients/funcs.tsx:71`) — the browser then owns Escape, click-outside and
  focus return, which is why it satisfies "do not aggressively reopen it" for free.
- **Mobile: out of scope for P2** (decision, user, 2026-08-11). The desktop cluster is
  `hidden desktop:flex` and there is **no** existing mobile Topbar system-control slot —
  on mobile, Copilot and user identity move into the Nav drawer. Adding a mobile bell
  would mean inventing either a new Topbar slot or a new drawer affordance, which
  `CLAUDE.md` §14 forbids without explicit instruction. The bell is therefore
  `hidden desktop:flex`, matching the cluster it lives in, and mobile is its own later
  step. No mobile behaviour is stubbed, degraded, or half-built.

---

## 7. While You Were Away data flow

The spec derives the window from "previous `lastSeenAt`", but that value is overwritten by
the same poll that needs it — so a naive read makes WYWA appear once and then vanish
mid-session. The already-provisioned `user_presence.awaySinceAt` column closes this:

```
on feed poll:
  prev = user_presence.lastSeenAt
  if prev IS NULL or now - prev > 15 min → awaySinceAt = prev   (persist the boundary)
  then stamp lastSeenAt

WYWA = SELECT category, COUNT(*) FROM notifications
        WHERE "userId" = :user AND "agencyId" = :agency
          AND "createdAt" > :awaySinceAt
          AND "seenAt" IS NULL
        GROUP BY category

render  → only when awaySinceAt IS NOT NULL AND total > 0
stamp   → dropdown open stamps seenAt on the covered rows
clear   → awaySinceAt = NULL once the window yields nothing unseen
```

Consequences, all matching the spec: derived **entirely** from persisted rows; stable
across polls; disappears once actually seen and never self-reopens; renders nothing when
the gap is short or nothing landed; and because push does not stamp `seenAt`, pushed-but-
unseen items correctly still appear.

---

## 8. `/clients/[clientId]` authorization — verified findings

The spec §20.3 calls this a **cross-agency** issue. Direct inspection shows cross-agency
read is already closed, and that the real remaining gap is **intra-agency**. Recording the
correction rather than restating the spec:

**Closed (verified).** `getFullLead` (`db/clients.ts:15`) scopes the query:

```
db('clients as c').join('clients_info as ci', …).where('c.id', id).where('c.agencyId', user.agencyId)
```

A user of agency A passing a `clientId` from agency B gets `undefined`, and the layout
renders `ליד זה לא נמצא` (`app/(app)/clients/[clientId]/layout.tsx:25`). Covered by
`__tests__/lead-isolation.test.ts` (cross-agency read / update / delete).

**Open (verified) — intra-agency permission parity.** The billing tab applies a
permission check the lead layout does not:

```
app/(app)/clients/[clientId]/billing/page.tsx:17-21
  const { gotPermIds } = await getPerms(user)
  const leadAccessQ = db('clients').where({ id: leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadAccessQ.whereIn('userId', gotPermIds)
  if (!lead) notFound()
```

The layout runs `getFullLead` only. So a **non-admin rep inside the same agency**, with no
`user_perms` grant over the lead's owner, can still open `/clients/{id}` by URL and read
the header fields: `name`, `rank`, `birthDate`, `gender`, `familyStatus`, `email`, `phone`,
`secPhone`, `handlerId`.

**Secondary (verified).** `get5TasksByClientId` (`db/tasks.ts:52`) and `getTasksTbl`
(`:57`) filter on `clientId` alone, with no `agencyId` join. The layout's early return
means the output is not rendered; whether Next.js still executes those child-segment
fetches for a foreign id is **not verified** and should not be assumed either way.

**Does this block P2 deep links?** Assessment: **no.** Notification recipients are
`handler_or_admin` / `admin_only` (spec §6.1) — the handler already owns the lead and
admins already bypass `gotPermIds`. A P2 deep link therefore cannot hand a lead to a user
who lacked access. The gap is reachable by typing a URL, exactly as it is today, and P2
neither widens nor narrows it.

**Safest minimal fix** (one file, existing idiom, no new abstraction): lift the billing
block into `app/(app)/clients/[clientId]/layout.tsx` and `notFound()`. Risk to review
before doing it: admins are exempt via `isAdmin`, but GM/office roles, `sale_users`
collaborators and transferred leads must be confirmed to appear in `gotPermIds`, or
legitimate access regresses.

**Decision (user, 2026-08-11): its own commit, after P2.** P2 neither widens nor narrows
the gap, so sequencing it after keeps the security change out of feature work (spec: no
unrelated security refactors inside feature commits) and leaves room to verify the role
matrix properly instead of under feature-branch pressure. The §20.3 wording correction
lands with that commit. This is tracked, not dropped — it remains a release prerequisite
and must not ship to production unaddressed.

---

## 9. Inbox message discriminator (verified — do not implement yet)

| Column | NOT NULL | UNIQUE | Notes |
|---|---|---|---|
| `inbox_messages."externalId"` | **no** | yes, `(channel,"externalId")` | the WhatsApp **wamid**, from `message.id` |
| `inbox_messages.id` | yes | yes (PK) | known only after insert |
| `(conversationId, sequence)` | yes | yes | per-thread ordinal |

Verified in `migrations/20260608000001_create_inbox_messaging_tables.cjs:80-124` and
`db/inboxMessages.ts:85-126`, which inserts with
`.onConflict(['channel','externalId']).ignore()` and returns `inserted: false` on a
redelivered webhook. All ingest side effects are already gated on `inserted === true`
(`lib/inbox/ingestWhatsappInbound.ts:81`).

**Chosen discriminator: `externalId` (wamid).** It is retry-stable by construction — the
same identity the inbox itself dedups on, so a notification cannot fire twice for a
redelivered Meta webhook. Proposed key shape (P3+, not now):

```
message.inbound:{agencyId}:inbox_message:{externalId}
```

Caveats to carry forward: `externalId` is **nullable**, and Postgres treats NULLs as
distinct in a unique index, so a malformed payload with no `message.id` is dedup-exempt
for the inbox *and* would be for notifications — the emitter must skip when it is null
rather than fall back to a timestamp. `inbox_messages` is WhatsApp-only today
(`InboxChannel = 'whatsapp'`); Facebook comments live in `facebook_page_comments` with
their own `(pageId, commentId)` key. `inbox_conversations.leadId` is `NOT NULL`, which
retires the P1 audit's `entityId` nullability concern for this path.

**Not implemented in P2** — no `message.inbound` / `message.unanswered` wiring, per the
P2 brief.

---

## 10. Files expected to change

**New**

```
app/api/notifications/feed/route.ts          GET, dynamic, no-store
app/api/notifications/seen/route.ts          POST
app/api/notifications/read/route.ts          POST
db/notifications/feed.ts                     list + unread count + WYWA aggregate
db/notifications/presence.ts                 throttled upsert + read
db/notifications/reads.ts                    markSeen / markRead / markAllRead
modules/notifications/NotificationContext.tsx
modules/notifications/types.ts               NotificationItem, FeedResponse
components/notifications/NotificationBell.tsx
components/notifications/NotificationDropdown.tsx
components/notifications/WhileYouWereAway.tsx
app/(app)/notifications/page.tsx             the center
__tests__/notifications/feed.sql.test.ts
__tests__/notifications/presence.test.ts
__tests__/notifications/context.test.tsx
__tests__/a11y/notificationBell.test.tsx
```

**Modified (surgical)**

```
app/(app)/layout.tsx                mount NotificationProvider (AwarenessProvider stays)
lib/navs/Topbar.tsx                 one bell button in the existing cluster
lib/navs/Nav.tsx                    badge source switches to the feed's inboxUnread
modules/inbox/client/InboxSyncLoop.tsx   point setCount at the new context
app/api/inbox/awareness/route.ts    P2.6 only: thin alias
docs/notification-infrastructure-spec.md  amendment log + §20.3 correction
docs/notification-p1-test-baseline.md     new gate counts
```

**Explicitly untouched:** `lib/notifications/{registry,worker,plan,policy,emit,processJob,
collapseKeys,eventKey,copy}.ts`, all six migrations, `db/notifications/{jobs,deliveries,
recipients,reconcile}.ts`, `lib/toast.tsx`, `useAdaptivePoll`, `pollSchedule.ts`.
`AwarenessContext.tsx` is **not deleted** in P2.

---

## 11. Conflicts between existing code and the approved spec

### 11.1 The nav badge counts conversations, the bell counts notifications — BLOCKING

Spec §13.1 retires `AwarenessContext` in favour of `NotificationContext`, but the numbers
are not interchangeable. `countUnreadConversationsForUser` counts unread **conversations**;
the bell counts unread **notification rows**. One conversation with six unread messages is
`1` in the nav badge; a collapsed notification is `1` with `groupCount: 6`. Substituting
one for the other silently changes a live production badge.

**Resolution (adopted in §3.1):** the feed returns **both** `unreadCount` and
`inboxUnread`, the latter from the untouched existing query. The nav badge keeps its exact
current semantics and its `null` → server-prop fallback; only its transport changes.

### 11.2 Badge cap: brief said `9+`, codebase says `99+` — RESOLVED: `99+`

The P2 brief specified a `9+` cap. Every existing badge caps at `99+` — `NavBadge`
(`lib/navs/Nav.tsx:128`) and `AdminChrome` (`components/admin/AdminChrome.tsx:26`).
`CLAUDE.md` §12 ("match existing spacing and styles exactly") and §13 (CLAUDE.md wins over
task instructions) point at `99+`.

**Decision (user, 2026-08-11): `99+`.** The bell badge sits inches from `NavBadge` in the
same chrome; two different caps in one bar would read as a bug. `NavBadge`'s cap logic is
reused rather than reimplemented.

### 11.3 Presence classification is dead code until P2.1 — expected, not a defect

`lib/notifications/presence.ts` classifies everyone OFFLINE because nothing writes the
table. Harmless in P1 (IN_APP is presence-independent in every §19 row). P2.1 makes it
live.

### 11.4 Spec §20.3 mislabels the authorization gap — DOCUMENTATION FIX

The spec calls it cross-agency; it is intra-agency (§8). The wording should be corrected
when the fix lands, so a later session does not go looking for a tenant-isolation hole
that `getFullLead` already closes.

### 11.5 `enabled: false` must keep awareness alive — ROLLOUT REQUIREMENT

`NOTIFICATIONS_ENABLED` defaults OFF, so on every environment today the feed is inert.
`AwarenessProvider` therefore stays mounted and unmodified through P2.5, and the two
paths coexist: notifications OFF ⇒ today's behaviour byte-for-byte; ON ⇒ the feed owns
the badge and toasts. That is what makes the awareness retirement (P2.6) a flag flip with
a rollback rather than a cutover.

### 11.6 Single-slot toast — CONSTRAINT, not a conflict

`toast()` shows one message at a time (`lib/toast.tsx:12`). Any "surface N notifications"
design must summarize. Recorded because it is easy to violate while writing P2.2.
