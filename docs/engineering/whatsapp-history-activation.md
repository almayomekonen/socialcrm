# WhatsApp Coexistence history — activation runbook

**Status:** pre-activation. `HISTORY_SYNC_ENABLED = false`, allowlist empty, no
real archive has ever been consumed.

Read this before touching anything. A Coexistence history archive is **one-shot**:
Meta delivers it once per customer, and *"if you need to perform it again, the
customer must first offboard, then complete the Embedded Signup flow again."*
A mistake here is not a bug to fix forward — it is a customer's history, gone.

---

## The two keys

Nothing imports history unless **both** are satisfied. Neither alone does
anything, and that is the point: no single action, by any one person, in any one
place, turns this on for a customer.

| Key | Where | Governs | Changed by |
| --- | --- | --- | --- |
| `HISTORY_SYNC_ENABLED` | `lib/whatsapp/coexistence.ts` (code constant) | **Requesting** an archive from Meta | a reviewed diff + deploy |
| `WHATSAPP_HISTORY_PHONE_ALLOWLIST` | env, comma-separated `phone_number_id`s | **Requesting** and **processing** | env change, no deploy |

- Requesting requires **both**.
- Processing an already-received delivery requires **the allowlist only**.
- A delivery for a non-allowlisted number stays durable and unprocessed in
  `whatsapp_history_imports`, and becomes claimable the moment the number is
  added — **no new webhook is needed**. Deliveries are never dropped at receive.

---

## Pre-flight — human verification required

### 1. Meta App Dashboard → WhatsApp → Configuration

None of this is done by code, and nothing in this repository can verify it.

- [ ] `history` subscribed
- [ ] `smb_app_state_sync` subscribed
- [ ] `smb_message_echoes` subscribed

Meta: *"make sure … you are subscribed to the additional webhook fields,
otherwise you will miss important webhooks."* If `history` is not subscribed, the
request **still spends the archive** and the data never arrives. This is the
single highest-consequence unverified item.

### 2. Number eligibility

- [ ] The number is in active use in the **WhatsApp Business app**
- [ ] WhatsApp Business app version **≥ 2.24.17** (Meta's stated minimum)
- [ ] The business has **not** disabled history sharing in the app — if they have,
      the delivery arrives as error `2593109` and carries no messages
- [ ] The customer has **consented** to their message history being imported

**Meta documentation does not establish** whether a Meta test number, Cloud API
test number, or sandbox WABA can perform Coexistence, and documents **no test or
sandbox behaviour** for `history`. Do not assume one works until observed.

### 3. Never do these

- Do **not** point production webhooks at a tunnel or alternate endpoint. There
  is one `META_APP_ID`; repointing its callback diverts **live customer
  webhooks** away from production.
- Do **not** enable globally on first activation.
- Do **not** activate on a paying customer before an internal number has been
  verified end to end.

---

## Activation — in this order

1. **Verify production migrations applied.**
   `npx knex --knexfile knexfile.cjs migrate:list` against production.
   Required, in order:
   - `20260826000006_inbox_messages_timeline_index` — `CREATE INDEX CONCURRENTLY`,
     `transaction: false`. Builds on `inbox_messages`; non-blocking for writes but
     proportional to table size. **Run in a low-traffic window.** A failed build
     leaves an INVALID index — drop and re-run.
   - `20260826000007_create_whatsapp_history_imports` — new empty table + 3
     indexes, ordinary transaction, negligible risk.

   Applied **manually, before the deploy**, never by the build
   (`release-deployment-workflow.md` §8b).
2. **Verify webhook subscriptions** — the checklist above.
3. **Verify the worker is deployed** — `/api/cron/history-import` exists and
   `vercel.json` lists it at `*/5 * * * *`.
4. **Verify worker auth** — `AUTOMATION_API_KEY` (or `CRON_SECRET`) is set.
   An unauthenticated call must return 403.
5. **Set the allowlist to exactly one `phone_number_id`, while
   `HISTORY_SYNC_ENABLED` is still `false`.** Nothing happens yet — this is the
   safe rehearsal.
6. **Confirm activation state** — call the cron route with the secret; the
   response's `activation` must read `{ mode: 'allowlist', count: 1 }`.
7. **Deploy the reviewed one-line change** setting `HISTORY_SYNC_ENABLED = true`.
   Its own commit, its own review.
8. **Onboard exactly one consenting internal/test number** through Embedded
   Signup in coexistence mode. One number, one WABA.
9. **Observe.** `whatsapp_history_imports` rows for that `phoneNumberId`; the
   cron response counts; `historyImportSummary(agencyId, phoneNumberId)`.
10. **Verify chunk and message counts** — `byStatus`, `messagesInserted`,
    `messagesDuplicate`, `messagesSkipped`, `retried`, `metaReportedComplete`,
    `phasesSeen`.
11. **Verify thread chronology** — open the conversation. Messages must read in
    `channelTimestamp` order, with live messages interleaved correctly by time,
    not clumped at the end.
12. **Verify live conversation state is unchanged** — `unreadCount`,
    `lastMessageAt`, `lastInboundAt`, `lastDirection`, `messageCount`.
13. **Verify no automation / AI / signal / notification activity** —
    `auto_response_jobs`, `signal_jobs`, `notification_jobs`, `ai_insights`
    gained nothing for that agency.
14. **Verify no cross-tenant writes** — every imported row's `agencyId` matches
    the connection's.
15. **Only after manual verification**, consider adding a second number.

> **NEVER enable globally on first activation.** The allowlist exists precisely
> so the first real archive is one number, chosen deliberately, with a person
> watching.

---

## Rollback — immediate, non-destructive

1. **Remove the `phone_number_id` from `WHATSAPP_HISTORY_PHONE_ALLOWLIST`.**
   Takes effect on the next worker tick. No deploy.
2. **Worker processing stops for that number.** In-flight deliveries finish or
   their lease expires and returns them to `received`.
3. **If a global stop is needed**, set `HISTORY_SYNC_ENABLED = false` and deploy.
   This stops new *requests*; step 1 already stopped processing.
4. **Leave imported history intact.** Rollback is a stop, not an undo.
5. **Do not delete messages automatically.** There is no automated cleanup and no
   destructive rollback migration, deliberately.
6. **Do not rewrite conversation state.** Nothing imported it, so nothing needs
   restoring.
7. **Investigate from the raw payload and the import row before any manual
   cleanup.** Every delivery keeps its raw `payload`; that is the record of what
   Meta actually sent. If imported history ever must be removed, it is precisely
   selectable by `metadata.source = 'whatsapp_history'` — a deliberate manual
   operation, never automatic.

---

## Operational reference

- **Worker:** `lib/inbox/history/importWorker.ts` — bounded at 25 deliveries and
  a 20s budget per invocation; `FOR UPDATE SKIP LOCKED` makes concurrent runs
  safe; stale leases reclaim without refunding attempts; retries back off
  exponentially to a 5-attempt ceiling.
- **What retries:** infrastructure failures only. A missing conversation, an
  invalid wamid, an invalid timestamp and an unresolvable tenant are *answers*,
  not outages — they settle terminally as `partial`.
- **Counters describe the latest processing attempt**, not a lifetime total. The
  durable record of what was imported is `inbox_messages` itself.
- **Media follow-ups** are recorded as `deferred` and never merged. Meta
  documents no correlation guarantee beyond a shared wamid.
- **Nothing logged or returned by the cron route contains** message text, phone
  numbers, wamids, thread ids or raw payloads.
