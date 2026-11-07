# WhatsApp webhook: durable receipt and the emergency kill switch

**Audience:** whoever operates WhatsApp in production, and whoever removes the fallback later.

## How it works

Every WhatsApp Cloud API delivery is handled in this order:

1. **Verify.** The `X-Hub-Signature-256` HMAC is checked before anything else. A bad signature gets 403 and nothing is recorded.
2. **Receive.** Every entry and every change is read. Each inbound message, business echo and delivery status becomes one row in `whatsapp_webhook_events`. The agency comes from `whatsapp_connections`, matched by the signed `phone_number_id`.
3. **Acknowledge.** The webhook answers 200 only after that insert commits. If the insert fails, it answers **503** and Meta redelivers. It never falls back to processing without a record.
4. **Process.** The worker (`lib/whatsapp/webhook/worker.ts`) runs right after the response for that delivery's receipts. The cron `/api/cron/whatsapp-webhook-events` runs every minute as a backstop.
   - Receipts are leased with `SKIP LOCKED`, so concurrent runs never share one.
   - **One customer's events apply in arrival order**: a receipt waits while an earlier receipt for the same customer is still pending.
   - Each receipt is applied by the same function the direct path uses (`lib/whatsapp/webhook/processEvent.ts`).
5. **Retry.** If an event did not commit, its receipt is retried with backoff: 2s, 4s, 8s and so on, capped at 15 minutes, for up to 8 attempts. It then becomes terminal `failed`. Failed receipts are kept, and can be requeued.

Fields with their own handling keep it, unchanged:
- Coexistence `history` (already durable on its own)
- `smb_app_state_sync`
- `account_update`
- template status and quality updates

**Duplicates are harmless at every step:**
- A redelivered event collides on `("phoneNumberId","eventKey")`.
- Message and echo rows are unique on Meta's id.
- Statuses only ever move forward.

## Monitoring (Axiom, `vercel` dataset)

| Alert on | Meaning | Severity |
|---|---|---|
| `[wa-webhook] direct_mode_active` | The kill switch is on. Logged on every webhook and every cron run while it is set. | Page while unexpected |
| `[wa-webhook] receipts failed` | Receipts used up their attempts. A standing count: logged on every cron run while any failed receipt remains, so do not alert on it | Trend only |
| `[wa-webhook] receipts newly failed` | Receipts that became `failed` in this worker run (attempts spent, or a reclaimed final attempt). Logged once per receipt | Investigate, then requeue |
| `[wa-webhook] receipts waiting` | The oldest unprocessed receipt is over 5 minutes old | The worker is stalled |
| `[wa-webhook] receipt write failed; not acknowledged` | Meta is being told to retry | Database health |
| `[wa-webhook] event failed; will retry` | A single event failed. Normal in small numbers | Trend only |

Every line carries counts, ids and classification codes only. None carries a phone number, a customer id or message text.

## The kill switch: `WA_WEBHOOK_DIRECT_PROCESSING`

Use it only if the durable path itself is broken in production, for example a worker bug that leaves receipts piling up. Do **not** use it for database outages: direct mode needs the database too.

| Value | Mode |
|---|---|
| unset (default) | Durable: record, acknowledge, then process |
| `1` | Direct: process inside the request, as before receipts existed |

**Direct mode still:**
- verifies the signature
- resolves the agency from the signed number
- applies duplicate protection
- answers **503 when an event was not stored**

Each delivery is handled by exactly one mode, because the mode is read once per request. Receipts recorded before the switch keep draining through the cron.

### Activate

1. Confirm the durable path is the problem: `[wa-webhook] receipts waiting` or `receipts failed` is rising, and the database is healthy.
2. Vercel, Production: add `WA_WEBHOOK_DIRECT_PROCESSING` = `1`.
3. Redeploy the current production build. An environment change takes effect only on a new deployment, because this codebase has no runtime configuration store.
4. Verify:
   - `[wa-webhook] direct_mode_active` appears within a minute;
   - new inbound messages appear in the inbox;
   - `[wa-webhook] received` lines show `"mode":"direct"`.

### Deactivate

1. Fix the durable path and deploy the fix.
2. Vercel, Production: remove `WA_WEBHOOK_DIRECT_PROCESSING`.
3. Redeploy.
4. Verify:
   - `direct_mode_active` stops;
   - `[wa-webhook] received` shows `"mode":"durable"`;
   - the cron reports `processed`;
   - `receipts waiting` clears.

### Requeue terminal failures

After fixing the cause, call `requeueFailedWhatsappEvents({ ids: [...] })` or `requeueFailedWhatsappEvents({ agencyId })` from `db/whatsappWebhookEvents.ts`, from an approved operator context. The cron applies them on its next run. There is no "requeue everything" without a scope.

## Deployment

1. Apply the migration **before** the deploy, alone:
   `npx knex --knexfile knexfile.cjs migrate:up 20261106120000_create_whatsapp_webhook_events.cjs`
2. Deploy. The new cron is in `vercel.json`.
3. Verify:
   - a test message from a synthetic number shows `[wa-webhook] received` with `recorded: 1`;
   - `[wa-webhook] worker` shows `processed: 1`;
   - the message appears in the inbox.

**Rollback:**
- Vercel instant rollback returns to direct-in-request processing (the previous code ignores the table).
- Drain or inspect any `received` rows first: the previous code never processes them.
- `migrate:down` drops the table. Do this only after it is empty or exported.

## Removing the fallback later

Once durable processing has run cleanly in production for a period you choose:

- **Code:** delete `lib/whatsapp/webhook/mode.ts`, the `direct` branch in `lib/whatsapp/webhook/receive.ts` and in the route, the `direct_mode_active` handling in the cron, and the direct-mode tests.
- **Environment:** remove the `WA_WEBHOOK_DIRECT_PROCESSING` variable.

Nothing else depends on it.
