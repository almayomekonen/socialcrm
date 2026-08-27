/**
 * whatsapp_history_imports — the durable receipt for every WhatsApp Coexistence
 * history webhook delivery.
 *
 * WHY THIS TABLE EXISTS AT ALL. Meta's history archive is one-shot: it is
 * requested once per customer, and "if you need to perform it again, the
 * customer must first offboard, then complete the Embedded Signup flow again."
 * A delivery that is parsed, half-imported and then lost to a function timeout
 * is data that CANNOT be re-requested. So the raw `value` is written to durable
 * storage and acknowledged BEFORE anything is inserted into the inbox, and it is
 * kept afterwards. If the parser turns out to have a bug, the archive is still
 * here to reprocess; without this row, it would be gone forever.
 *
 * That is also why `payload` stores the raw delivery rather than the parsed
 * result. Storing our INTERPRETATION would make the record only as good as the
 * parser that produced it, which defeats the point.
 *
 * THE SHAPE IS `signal_jobs`', deliberately: `FOR UPDATE SKIP LOCKED` claim,
 * `lockedAt`/`lockedBy` lease, `attempts + 1` on claim, exponential backoff,
 * terminal state at `maxAttempts`, stale-lease reclaim. Every hard-won property
 * of that table — no double processing, no job lost to a crashed function,
 * bounded retries — comes along unchanged. This is NOT a new job framework; it
 * is the fourth table using the existing one.
 *
 * NAMED `_imports`, NOT `_jobs`, because the row's first duty is to be a receipt.
 * The lease columns are how it is later processed; they are not why it is
 * written. A delivery that is never processed must still be recoverable.
 *
 * THE IDEMPOTENCY KEY IS CHOSEN, NOT GIVEN. Meta publishes no delivery id for
 * history webhooks. `importKey` is derived deterministically by
 * `db/whatsappHistoryImports.ts`: a chunk is identified by its own
 * `phase:chunkOrder`, which is the semantic identity Meta does document, and the
 * media-follow-up and error shapes — which carry neither — fall back to a hash
 * of the payload. `(agencyId, phoneNumberId, importKey)` is unique, so a
 * redelivery is a no-op at the database rather than a race in application code.
 *
 * `phase` / `chunkOrder` / `progress` are stored as FACTS, nullable because two
 * of the three documented shapes have none. Nothing in the schema implies an
 * ordering: Meta states chunks "may not be delivered sequentially", so arrival
 * order is not chunk order and this table never pretends otherwise.
 *
 * Additive and reversible. Nothing reads from it in production: the history gate
 * is still closed.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS whatsapp_history_imports (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      -- The tenant key Meta sent, resolved to agencyId before insert. Both are
      -- stored so every processing query can filter on both.
      "phoneNumberId" text NOT NULL,
      -- Which of Meta's three documented history-webhook shapes this was.
      kind text NOT NULL
        CHECK (kind IN ('chunk','media_followup','error')),
      -- Deterministic delivery identity. See the header: chosen, not given.
      "importKey" text NOT NULL,
      -- Meta's own chunk facts, verbatim. NULL where the shape has none.
      phase integer,
      "chunkOrder" integer,
      progress integer,
      -- The RAW webhook value. The losslessness guarantee.
      payload jsonb NOT NULL,

      status text NOT NULL DEFAULT 'received'
        CHECK (status IN ('received','processing','completed','partial','deferred','error','failed')),

      -- Outcome counters. Bodies are never stored here, only counts.
      "messagesSeen" integer NOT NULL DEFAULT 0,
      "messagesInserted" integer NOT NULL DEFAULT 0,
      "messagesDuplicate" integer NOT NULL DEFAULT 0,
      "messagesSkipped" integer NOT NULL DEFAULT 0,

      attempts integer NOT NULL DEFAULT 0,
      "maxAttempts" integer NOT NULL DEFAULT 5,
      "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
      "lockedAt" timestamptz,
      "lockedBy" text,
      -- A classification and a message, never a payload excerpt.
      "lastError" text,

      "receivedAt" timestamptz NOT NULL DEFAULT now(),
      "startedAt" timestamptz,
      "completedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)

  // A redelivery collides here rather than racing in application code.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_history_imports_key_uniq
      ON whatsapp_history_imports ("agencyId", "phoneNumberId", "importKey")
  `)

  // The claim query's exact predicate and order.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS whatsapp_history_imports_claim_idx
      ON whatsapp_history_imports (status, "nextAttemptAt", id)
      WHERE status = 'received'
  `)

  // Agency-scoped inspection and the per-connection summary read.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS whatsapp_history_imports_tenant_idx
      ON whatsapp_history_imports ("agencyId", "phoneNumberId", status)
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS whatsapp_history_imports`)
}
