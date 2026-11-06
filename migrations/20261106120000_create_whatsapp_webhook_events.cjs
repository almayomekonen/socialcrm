/**
 * whatsapp_webhook_events — the durable receipt for every WhatsApp Cloud API event
 * that changes a conversation: an inbound message, a business echo, a delivery status.
 *
 * RECEIVE → DURABLE RECORD → ACKNOWLEDGE → (then) PROCESS, exactly the shape of
 * messenger_webhook_events. The webhook writes one row per event and answers 200 only
 * after the insert commits. If the write fails it answers 503 and Meta redelivers,
 * instead of the event being lost. Processing (lib/whatsapp/webhook/worker.ts) runs
 * right after the response and every minute from a cron backstop, with a leased
 * claim, retries, backoff, and a terminal `failed` state an operator can requeue.
 *
 * IDEMPOTENCY. ("phoneNumberId", "eventKey") is unique: a redelivery is a no-op here,
 * and the message tables' own uniqueness makes a reprocessed receipt harmless too.
 *
 * ORDERING. "orderingKey" is the customer's WhatsApp id for messages and echoes. A
 * receipt is not claimed while an earlier receipt with the same key is still pending,
 * so one customer's events are applied in arrival order.
 *
 * TENANCY. "agencyId" is resolved from whatsapp_connections by the signed payload's
 * phone_number_id before insert, never read from the payload, and re-checked when the
 * receipt is processed.
 *
 * PRIVACY. `payload` holds customer message content, as inbox_messages does. Settled
 * receipts are pruned after a retention window; `lastError` holds a classification
 * only, never payload text.
 *
 * Additive and reversible.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "phoneNumberId" varchar(64) NOT NULL,
      -- 'msg:<wamid>', 'echo:<wamid>' or 'st:<wamid>:<status>:<timestamp>'.
      "eventKey" text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('message','echo','status')),
      -- The customer's WhatsApp id for message and echo; NULL for statuses.
      "orderingKey" text,
      -- The raw event (plus the profile name for a message), re-parsed by the worker.
      payload jsonb NOT NULL,

      status text NOT NULL DEFAULT 'received'
        CHECK (status IN ('received','processing','processed','ignored','failed')),
      outcome text,

      attempts integer NOT NULL DEFAULT 0,
      "maxAttempts" integer NOT NULL DEFAULT 8,
      "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
      "lockedAt" timestamptz,
      "lockedBy" text,
      "lastError" text,

      "receivedAt" timestamptz NOT NULL DEFAULT now(),
      "processedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // A redelivery collides here rather than racing in application code.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_webhook_events_key_uniq
      ON whatsapp_webhook_events ("phoneNumberId", "eventKey")
  `)

  // The claim query's predicate and order.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS whatsapp_webhook_events_claim_idx
      ON whatsapp_webhook_events ("nextAttemptAt", id)
      WHERE status = 'received'
  `)

  // The per-customer ordering check: "is an earlier receipt for this customer pending?"
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS whatsapp_webhook_events_ordering_idx
      ON whatsapp_webhook_events ("phoneNumberId", "orderingKey", id)
      WHERE status IN ('received','processing') AND "orderingKey" IS NOT NULL
  `)

  // Stale-lease reclaim, the failed view, and retention pruning.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS whatsapp_webhook_events_status_idx
      ON whatsapp_webhook_events (status, "updatedAt")
  `)
}

exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS whatsapp_webhook_events`)
}
