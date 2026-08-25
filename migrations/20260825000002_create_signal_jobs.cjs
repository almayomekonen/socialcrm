/**
 * signal_jobs — the durable execution substrate for runtime signals.
 *
 * Phase 1 proved that a CRM fact can become an ExternalSignal, pass the ratified
 * ingress, and produce a deterministic decision. It did so INLINE: detect and
 * process in one pass, in one function invocation. That is fine for a proof and
 * wrong for production — a crashed invocation loses the work, a slow subject
 * blocks the rest, and nothing can be retried.
 *
 * This table is the missing durability. It is the SCHEDULING MECHANISM §3.6
 * leaves to implementation, and nothing more: it holds signals that have been
 * detected and not yet processed. It holds no cognition, no decision, no
 * priority and no judgement — a job row says "this observation is owed a pass
 * through the runtime", and that is all it says.
 *
 * WHY A NEW TABLE AND NOT `auto_response_jobs`. That table is a transactional
 * outbox for the WhatsApp send path: its subject is a CONVERSATION
 * (`"conversationId" bigint NOT NULL REFERENCES inbox_conversations(id)`), its
 * `reason` CHECK enumerates four send-lifecycle values, and its in-flight
 * uniqueness is per conversation. Carrying lead-subject signals there would mean
 * relaxing that CHECK, dropping a NOT NULL foreign key and rewriting the
 * uniqueness rule — three destructive migrations against the live send path.
 * So the SHAPE is copied and the table is not: one concurrency model, two
 * tables, exactly as `notification_jobs` already does beside it.
 *
 * IDENTITY AND IDEMPOTENCY. `observationKey` is derived deterministically from
 * the signal — never from a clock, never random (see
 * lib/ai/integration/observationKey.ts, which mirrors the rule and the reasoning
 * of lib/notifications/eventKey.ts). The unique index on
 * ("agencyId","observationKey") plus `ON CONFLICT DO NOTHING` at the enqueue
 * makes re-detection free: a sweep may run every minute forever and an
 * already-known observation is a no-op rather than a second job. The key is
 * unique across ALL statuses, not just active ones — an observation that has
 * been processed is finished, and a follow-up whose deadline has not changed is
 * the same observation, not a new one.
 *
 * TENANCY. `agencyId` is NOT NULL, and a CHECK asserts it equals the agency
 * inside the stored signal's own scope. A row whose column and payload disagree
 * about the tenant cannot exist, so a widened or forged agency cannot be
 * persisted even if a caller tried. The agency always originates from the
 * sweep's scope — never from a request body, a session, or a model.
 *
 * STATUS. Four states, mapping the required lifecycle onto the proven shape:
 *   pending   — enqueued, or returned here by a RETRYABLE failure (with
 *               `attempts` incremented, `lastError` set and `nextAttemptAt`
 *               pushed out by the backoff)
 *   leased    — claimed by a worker; `lockedAt`/`lockedBy` hold the lease
 *   succeeded — processed; `completedAt` set
 *   dead      — TERMINAL failure: attempts exhausted, or an error a retry
 *               cannot fix (a stored signal the ingress refuses)
 *
 * `nextAttemptAt` is this table's name for what `auto_response_jobs` and
 * `notification_jobs` call `notBefore`; the semantics are identical.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS signal_jobs (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "observationKey" text NOT NULL,
      expectation text NOT NULL,
      "subjectType" text NOT NULL CHECK ("subjectType" IN ('lead','portfolio')),
      "subjectId" text NOT NULL,
      -- The ExternalSignal verbatim: enough to reconstruct the exact input the
      -- ingress accepted, including source, provenance and the absence marker.
      signal jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','leased','succeeded','dead')),
      attempts integer NOT NULL DEFAULT 0,
      "maxAttempts" integer NOT NULL DEFAULT 3,
      "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
      "lockedAt" timestamptz,
      "lockedBy" text,
      "lastError" text,
      "detectedAt" timestamptz NOT NULL,
      "completedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      -- The tenant boundary, enforced by storage: the column and the payload
      -- must name the same agency. IS NOT DISTINCT FROM, so a signal with no
      -- scope fails rather than passing on a NULL comparison.
      CONSTRAINT signal_jobs_agency_matches_signal
        CHECK ((signal->'scope'->>'agencyId') IS NOT DISTINCT FROM ("agencyId")::text)
    )`)

  // Idempotency: one job per observation, forever. The enqueue is
  // ON CONFLICT DO NOTHING, so re-detection is a no-op rather than a duplicate.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS signal_jobs_observation_uniq
      ON signal_jobs ("agencyId", "observationKey")`)

  // The worker claim scan: due pending work, oldest first.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS signal_jobs_claim_idx
      ON signal_jobs (status, "nextAttemptAt")`)

  // The lease-expiry reclaim scan.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS signal_jobs_lease_idx
      ON signal_jobs ("lockedAt") WHERE status = 'leased'`)

  // Agency-scoped inspection (every read is filtered by agency).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS signal_jobs_agency_idx
      ON signal_jobs ("agencyId", status)`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS signal_jobs`)
}
