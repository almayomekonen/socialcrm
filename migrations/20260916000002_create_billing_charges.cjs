/**
 * billing_charges — every attempt to charge a saved Grow card token.
 *
 * PERSISTED BEFORE DISPATCH. A row exists before any request can reach Grow.
 * `dispatchedAt` is committed in the same transaction as the final cancellation
 * re-check and BEFORE the network call, so:
 *   - a lease that expires with `dispatchedAt` NULL never reached Grow and goes
 *     back to `pending`;
 *   - a lease that expires with `dispatchedAt` set may have charged the card and
 *     becomes `unknown` — reconciled, never blindly retried;
 *   - a cancellation can tell "stopped in time" from "already sent to Grow".
 *
 * IDENTIFIERS. `id` is sent to Grow as transactionUniqueIdentifier. Grow
 * rejects a repeated value "regardless of the status of the first request", so
 * the sequence is restarted at the migration's epoch seconds: a rebuilt
 * staging/test database cannot replay identifiers Grow has already seen.
 * (Grow's integer range and scope are unconfirmed — plan Amendment A2.)
 * `groupIdentifier` (the first attempt's id) is sent as
 * transactionGroupIdentifier, which Grow documents as refused once a SUCCESSFUL
 * payment carries it.
 *
 * LIFECYCLE. pending → in_flight (claimed) → succeeded | failed_final |
 * failed_retryable | unknown | cancelled. A retry is a NEW row (attempt + 1),
 * never an edit of an old one. One success per (agency, period) is enforced here.
 *
 * Additive and reversible.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS billing_charges (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL REFERENCES agencies(id),
      "paymentMethodId" bigint NOT NULL REFERENCES billing_payment_methods(id),
      kind text NOT NULL CHECK (kind IN ('trial_conversion','renewal')),
      "periodKey" text NOT NULL,
      "groupIdentifier" bigint NOT NULL,
      attempt smallint NOT NULL CHECK (attempt >= 1),
      "firstAttemptAt" timestamptz NOT NULL DEFAULT now(),
      amount numeric(14,2) NOT NULL CHECK (amount > 0),
      currency text NOT NULL DEFAULT 'ILS',
      "billingPeriod" text NOT NULL CHECK ("billingPeriod" IN ('monthly','annual')),
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','in_flight','succeeded','failed_final','failed_retryable','unknown','cancelled')),
      "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
      "lockedAt" timestamptz,
      "lockedBy" text,
      "dispatchedAt" timestamptz,
      "providerTransactionId" text,
      "providerTransactionToken" text,
      "providerAsmachta" text,
      "providerStatusCode" text,
      "errorClass" text,
      "errorId" integer,
      "errorMessage" text,
      "succeededAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT billing_charges_outcome_requires_dispatch
        CHECK (status NOT IN ('succeeded','unknown') OR "dispatchedAt" IS NOT NULL)
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS billing_charges_attempt_uniq
      ON billing_charges ("agencyId", "periodKey", attempt)
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS billing_charges_one_success_per_period_uniq
      ON billing_charges ("agencyId", "periodKey") WHERE status = 'succeeded'
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS billing_charges_provider_tx_uniq
      ON billing_charges ("providerTransactionId") WHERE "providerTransactionId" IS NOT NULL
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS billing_charges_claim_idx
      ON billing_charges ("nextAttemptAt", id) WHERE status = 'pending'
  `)
  await knex.raw(`CREATE INDEX IF NOT EXISTS billing_charges_agency_status_idx ON billing_charges ("agencyId", status)`)
  const start = Math.floor(Date.now() / 1000)
  // START as well as RESTART: TRUNCATE … RESTART IDENTITY resets to START, and must not replay low ids.
  await knex.raw(`ALTER SEQUENCE billing_charges_id_seq START WITH ${start} RESTART WITH ${start}`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS billing_charges`)
}
