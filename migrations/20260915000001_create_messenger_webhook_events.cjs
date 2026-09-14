/**
 * messenger_webhook_events — the durable receipt for every Messenger event the
 * Page webhook accepts.
 *
 * RECEIVE → DURABLE RECORD → ACKNOWLEDGE → (then) PROCESS. The webhook writes
 * the raw `entry.messaging[]` event here and only then answers 200. If this
 * write fails the route answers non-2xx, so Meta redelivers instead of the
 * message being lost. Processing (`lib/facebook/messenger/eventWorker.ts`)
 * runs immediately after the response and again from a cron backstop, with
 * retries, backoff and a terminal `failed` state an operator can requeue.
 *
 * THE SHAPE IS whatsapp_history_imports' (itself signal_jobs'): `FOR UPDATE
 * SKIP LOCKED` claim, `lockedAt`/`lockedBy` lease, `attempts + 1` at claim,
 * exponential backoff, terminal at `maxAttempts`, stale-lease reclaim. This is
 * the existing queue pattern with a new payload, not a new job framework.
 *
 * IDEMPOTENCY. Meta's message id (`mid`) identifies an inbound message or an
 * echo; ("pageId", "eventKey") is unique, so a redelivery is a no-op at the
 * database. The message table's own ("pageId", mid) uniqueness makes a worker
 * that re-processes a reclaimed receipt harmless as well.
 *
 * TENANCY. `agencyId` is resolved from facebook_pages via the signed entry id
 * before insert, never read from the payload, and re-verified when processed.
 *
 * PRIVACY. `payload` holds customer message content, exactly as
 * messenger_messages does. Processed and ignored receipts are pruned by the
 * worker after a retention window; `lastError` holds a classification only.
 *
 * Additive and reversible.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS messenger_webhook_events (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "pageId" varchar(64) NOT NULL,
      -- 'mid:<mid>' — Meta's own message identity.
      "eventKey" text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('inbound','echo')),
      -- The RAW messaging event, re-parsed by the worker.
      payload jsonb NOT NULL,

      status text NOT NULL DEFAULT 'received'
        CHECK (status IN ('received','processing','processed','ignored','failed')),
      -- Why a processed receipt produced no message (e.g. 'duplicate', 'not_enabled').
      outcome text,

      attempts integer NOT NULL DEFAULT 0,
      "maxAttempts" integer NOT NULL DEFAULT 8,
      "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
      "lockedAt" timestamptz,
      "lockedBy" text,
      -- A classification (SQLSTATE / constraint), never a payload excerpt.
      "lastError" text,

      "receivedAt" timestamptz NOT NULL DEFAULT now(),
      "processedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // A redelivery collides here rather than racing in application code.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS messenger_webhook_events_key_uniq
      ON messenger_webhook_events ("pageId", "eventKey")
  `)

  // The claim query's exact predicate and order.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messenger_webhook_events_claim_idx
      ON messenger_webhook_events ("nextAttemptAt", id)
      WHERE status = 'received'
  `)

  // Stale-lease reclaim and the failed-event view.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS messenger_webhook_events_status_idx
      ON messenger_webhook_events (status, "updatedAt")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS messenger_webhook_events`)
}
