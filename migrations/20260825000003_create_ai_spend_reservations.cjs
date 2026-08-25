/**
 * ai_spend_reservations — the durable economic substrate for autonomous work.
 *
 * WHY THIS TABLE EXISTS. Autonomous spend was, until now, bounded by
 * `lib/ai/router/spend.ts` — a module-scope `Map`. On Vercel every concurrent
 * lambda holds its own copy and every cold start resets it, so the daily USD cap
 * was per-instance, not per-agency. Interactive traffic tolerates that because a
 * human is throttling it. A one-minute cron across overlapping invocations has no
 * human in the loop, and that is exactly the shape that turns a per-instance cap
 * into no cap at all. Nothing writes `ai_runs` either, so no durable record of AI
 * cost existed anywhere in this repository.
 *
 * THE RESERVATION IS ALSO THE CONCURRENCY BOUND. `ai_spend_open_uniq` is a
 * PARTIAL UNIQUE INDEX over `("agencyId", kind) WHERE status = 'reserved'`. Two
 * overlapping cron invocations that both try to reserve for one agency race at
 * the storage layer: one INSERT wins, the other raises `unique_violation` and is
 * declined. That is the whole mechanism — no advisory lock, no counter row to
 * drift, and no read-then-write window. It is the same device
 * `notifications_collapse_open_uniq` and `signal_jobs_observation_uniq` already
 * use to make "only one of these may be open at a time" a storage fact rather
 * than an application promise.
 *
 * Because at most one reservation per agency can be open, the daily-cap SUM
 * evaluated inside the same transaction as the INSERT cannot be double-spent:
 * the losing transaction never lands a row, so it never consumes budget.
 *
 * This fixes autonomous concurrency at ONE per agency. That is the deliberate
 * canary value — a 20s Agent deadline does not fit twice inside a 25s phase
 * budget — and raising it to N later means replacing this index with a counter
 * row plus a conditional `UPDATE … WHERE open < N`. It is a schema decision, not
 * an application constant, precisely so it cannot be loosened by accident.
 *
 * COMPOSED WITH THE LEASE, NOT BESIDE IT. `expiresAt` is the owning
 * `signal_jobs` lease's expiry. A killed lambda therefore cannot strand a
 * reservation: the same cutoff that returns an abandoned lease to `pending`
 * releases the reservation that rode on it. There is no second queue and no
 * second concurrency model here — only a budget hold that expires when the work
 * it was held for provably stopped.
 *
 * THREE STATUSES, AND WHAT EACH COSTS:
 *   reserved  — a hold. Counts `reservedUsd` toward the day, occupies the slot.
 *   settled   — work finished. Counts ACTUAL `spentUsd`, refunding the
 *               difference automatically. Frees the slot.
 *   released  — nothing was spent: a precondition declined, capacity declined,
 *               or the lease expired. Counts ZERO. Frees the slot.
 *
 * Additive and isolated, exactly as `signal_jobs` and `ai_shadow_coverage` are:
 * no foreign key into a production table, `agencyId` on the row so every read is
 * tenant-scoped without a join, and `down()` drops it independently.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_spend_reservations (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      kind text NOT NULL CHECK (kind IN ('autonomous_investigation')),
      -- The budget day. A date, not a timestamp: the cap is per calendar day UTC,
      -- and storing the instant would make the daily aggregate depend on a range
      -- scan instead of an equality.
      "dateUtc" date NOT NULL,
      -- The lease this reservation rides on. Deliberately NOT a foreign key: the
      -- table stays independently droppable, exactly like signal_jobs itself.
      "signalJobId" bigint NOT NULL,
      -- What was almost investigated. Carried so a declined reservation is
      -- explainable after the fact without joining a queue row that may be gone.
      "observationKey" text NOT NULL,
      -- The SUBJECT, denormalised out of the observation key on purpose. The
      -- refractory precondition asks "was this lead investigated recently?", and
      -- the key's discriminator changes when a deadline moves — so answering it
      -- from the key would need a prefix scan that no index can serve.
      "subjectType" text NOT NULL CHECK ("subjectType" IN ('lead','portfolio')),
      "subjectId" text NOT NULL,
      "reservedUsd" numeric(10,6) NOT NULL CHECK ("reservedUsd" >= 0),
      -- NULL until settled. In Phase 4.2 this is always 0 when set, because no
      -- investigator exists to invoke.
      "spentUsd" numeric(10,6) CHECK ("spentUsd" IS NULL OR "spentUsd" >= 0),
      status text NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved','settled','released')),
      -- Deterministic outcome vocabulary. Never model-authored text.
      outcome text CHECK (outcome IS NULL OR outcome IN ('admitted','declined','no_investigator')),
      "declineReason" text,
      -- The owning lease's expiry. A reservation can never outlive it.
      "expiresAt" timestamptz NOT NULL,
      -- resolveRecipients() result: the SAME identity that governs evidence access
      -- and will govern eventual delivery, so an insight can never reach someone
      -- who could not have seen the evidence beneath it.
      "operatorUserId" integer,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      -- A settled row must carry what it actually spent; a reserved one must not.
      CONSTRAINT ai_spend_settled_has_spend
        CHECK ((status = 'settled') = ("spentUsd" IS NOT NULL))
    )`)

  // THE CONCURRENCY INVARIANT. One open autonomous reservation per agency,
  // enforced by storage. Do not replace this with an application-level check.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_spend_open_uniq
      ON ai_spend_reservations ("agencyId", kind) WHERE status = 'reserved'`)

  // The daily-cap aggregate: equality on every leading column.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_spend_day_idx
      ON ai_spend_reservations ("agencyId", "dateUtc", kind, status)`)

  // The refractory lookup: "has this subject been investigated recently?"
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_spend_subject_idx
      ON ai_spend_reservations ("agencyId", "subjectType", "subjectId", "createdAt" DESC)`)

  // The expiry sweep, mirroring signal_jobs_lease_idx.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_spend_expiry_idx
      ON ai_spend_reservations ("expiresAt") WHERE status = 'reserved'`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS ai_spend_reservations`)
}
