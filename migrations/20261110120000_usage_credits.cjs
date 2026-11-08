/**
 * Usage credits (monetization phase 1): an append-only, agency-scoped credit
 * ledger, plus the additive CHECK changes that let the existing Grow token-charge
 * pipeline (billing_charges) carry one-time credit-pack purchases.
 *
 *   agent_requests         one row per unique owner request reaching the AI agent:
 *                          the monthly free counter, holds, and the audit trail.
 *   agency_credit_ledger   purchased credits: one row per grant / debit / refund,
 *                          ONE balance per agency. "sourceKind" and "costMicros" keep the
 *                          internal categories and real cost. Amounts are integer
 *                          MILLI-credits so cost-weighted debits stay exact.
 *                          UNIQUE ("agencyId", "idempotencyKey") is the only
 *                          duplicate protection the writers rely on.
 *                          UPDATE and DELETE are rejected by a trigger.
 *   billing_charges.kind   + credits_200 / credits_500
 *   billing_charges."billingPeriod" + one_time (a pack is not a subscription period)
 *
 * Purely additive: no existing row, column or value changes meaning.
 */

const NEW_KINDS = ['credits_200', 'credits_500']
const OLD_KINDS = ['trial_conversion', 'renewal']
/** How Postgres renders a single-column value list: CHECK ((<col> = ANY (ARRAY['a'::text, ...]))). */
const colRef = (column) => (column === column.toLowerCase() ? column : `"${column}"`)
const isValueCheck = (def, column) => def.startsWith(`CHECK ((${colRef(column)} = ANY (ARRAY[`)

async function valueCheck(knex, table, column) {
  const { rows } = await knex.raw(`SELECT conname, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = ?::regclass AND contype = 'c'`, [table])
  const hits = rows.filter((r) => isValueCheck(r.d, column))
  if (hits.length !== 1) throw new Error(`expected exactly one value CHECK on ${table}.${column}, found ${hits.length}`)
  return { name: hits[0].conname, values: [...hits[0].d.matchAll(/'([^']+)'::text/g)].map((m) => m[1]) }
}

/** Replace that CHECK (inline CHECKs are auto-named, so it is found by its shape). */
async function replaceCheck(knex, table, column, values) {
  const { name } = await valueCheck(knex, table, column)
  await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT "${name}"`)
  await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT "${table}_${column}_check" CHECK (${colRef(column)} IN (${list(values)}))`)
}

const list = (vals) => vals.map((v) => `'${v}'`).join(',')

exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE agency_credit_ledger (
      id                bigserial PRIMARY KEY,
      "agencyId"        integer NOT NULL REFERENCES agencies(id),
      "entryType"       text NOT NULL CHECK ("entryType" IN ('purchase_grant','debit','refund','exempt_debit')),
      "amountMillis"    bigint NOT NULL,
      "periodKey"       text NOT NULL CHECK ("periodKey" ~ '^[0-9]{4}-[0-9]{2}$'),
      "idempotencyKey"  text NOT NULL CHECK (length("idempotencyKey") BETWEEN 1 AND 200),
      "sourceKind"      text NOT NULL CHECK ("sourceKind" IN ('billing_charge','agent_request')),
      "sourceId"        text NOT NULL,
      "userId"          integer NULL,
      enforced          boolean NOT NULL DEFAULT false,
      "costMicros"      bigint NULL CHECK ("costMicros" IS NULL OR "costMicros" >= 0),
      meta              jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt"       timestamptz NOT NULL DEFAULT now(),
      CHECK (
        ("entryType" IN ('purchase_grant','refund') AND "amountMillis" > 0) OR
        ("entryType" = 'debit' AND "amountMillis" <= 0) OR
        ("entryType" = 'exempt_debit' AND "amountMillis" = 0)
      )
    )`)
  await knex.raw(`CREATE UNIQUE INDEX agency_credit_ledger_idem_uniq ON agency_credit_ledger ("agencyId", "idempotencyKey")`)
  await knex.raw(`CREATE INDEX agency_credit_ledger_period_idx ON agency_credit_ledger ("agencyId", "periodKey")`)
  await knex.raw(`CREATE INDEX agency_credit_ledger_source_idx ON agency_credit_ledger ("sourceKind", "sourceId")`)
  await knex.raw(`
    CREATE FUNCTION agency_credit_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'agency_credit_ledger is append-only (% rejected)', TG_OP USING ERRCODE = 'check_violation';
    END $$`)
  await knex.raw(`
    CREATE TRIGGER agency_credit_ledger_append_only
      BEFORE UPDATE OR DELETE ON agency_credit_ledger
      FOR EACH ROW EXECUTE FUNCTION agency_credit_ledger_append_only()`)

  await knex.raw(`
    CREATE TABLE agent_requests (
      id               bigserial PRIMARY KEY,
      "agencyId"       integer NOT NULL REFERENCES agencies(id),
      "userId"         integer NULL REFERENCES users(id) ON DELETE SET NULL,
      source           text NOT NULL CHECK (source IN ('whatsapp','web')),
      "operationKind"  text NOT NULL,
      "operationId"    text NOT NULL,
      "periodKey"      text NOT NULL CHECK ("periodKey" ~ '^[0-9]{4}-[0-9]{2}$'),
      tier             text NOT NULL CHECK (tier IN ('free','paid','exempt','unmetered','blocked','void')),
      enforced         boolean NOT NULL DEFAULT false,
      "holdMillis"     bigint NOT NULL DEFAULT 0 CHECK ("holdMillis" >= 0),
      "debitMillis"    bigint NOT NULL DEFAULT 0 CHECK ("debitMillis" >= 0),
      notice           text NULL CHECK (notice IN ('full','short')),
      calls            integer NULL,
      unpriced         boolean NULL,
      "costMicros"     bigint NULL,
      "settledAt"      timestamptz NULL,
      "createdAt"      timestamptz NOT NULL DEFAULT now()
    )`)
  await knex.raw(`CREATE UNIQUE INDEX agent_requests_operation_uniq ON agent_requests ("agencyId", "operationKind", "operationId")`)
  await knex.raw(`CREATE INDEX agent_requests_month_idx ON agent_requests ("agencyId", "periodKey", tier)`)
  await knex.raw(`CREATE INDEX agent_requests_open_idx ON agent_requests ("createdAt") WHERE "settledAt" IS NULL`)

  await replaceCheck(knex, 'billing_charges', 'kind', [...OLD_KINDS, ...NEW_KINDS])
  await replaceCheck(knex, 'billing_charges', 'billingPeriod', ['monthly', 'annual', 'one_time'])
}

exports.down = async function down(knex) {
  const { rows } = await knex.raw(`SELECT count(*)::int n FROM billing_charges WHERE kind IN (${list(NEW_KINDS)}) OR "billingPeriod" = 'one_time'`)
  if (rows[0].n > 0) throw new Error('credit-pack charges exist; refusing to drop their kinds')

  await replaceCheck(knex, 'billing_charges', 'billingPeriod', ['monthly', 'annual'])
  await replaceCheck(knex, 'billing_charges', 'kind', OLD_KINDS)

  await knex.raw(`DROP TABLE agent_requests`)
  await knex.raw(`DROP TABLE agency_credit_ledger`)
  await knex.raw(`DROP FUNCTION agency_credit_ledger_append_only()`)
}

