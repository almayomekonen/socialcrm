/**
 * Lead form answers — everything the customer wrote in a Lead Ads form.
 *
 * WHY THIS TABLE EXISTS. The Graph lead node returns `field_data`: every
 * question on the form and the customer's answer. Ingest kept three of them
 * (name, phone, email) and dropped the rest — the budget, the service, the city,
 * the "when do you want to start" the business owner designed the form to ask.
 * Production leads carry 4–5 fields (webhook logs, 2026-09-28); the extra ones
 * were lost at the door.
 *
 * A SEPARATE TABLE, not a column on `lead_attribution`:
 *   · these are the customer's own words (personal data), while attribution is
 *     campaign metadata — separate rows keep deletion and retention decisions
 *     separate;
 *   · attribution is skipped when Meta returns no campaign/form metadata; the
 *     answers must not depend on that.
 *
 * ONE ROW PER LEAD, WRITE-ONCE. `leadId` is UNIQUE and the insert conflicts and
 * is ignored, exactly like `lead_attribution`: a Meta redelivery or a retry
 * cannot duplicate or overwrite the answers the first delivery stored.
 *
 * `answers` is a JSON array, in form order, of `{ "key": text, "values": text[] }`.
 * An array rather than an object because a form can repeat a key and a question
 * can have several answers (multiple choice); both must survive as sent.
 *
 * AGENCY SCOPE. `agencyId` is stored and every read filters on it.
 *
 * Additive and reversible. Nothing existing reads or writes it before this ships.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS lead_form_answers (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "leadId" integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      provider text NOT NULL DEFAULT 'meta',
      -- Text, never an integer: Meta ids exceed 2^53.
      "leadgenId" text,
      answers jsonb NOT NULL DEFAULT '[]'::jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT lead_form_answers_answers_is_array CHECK (jsonb_typeof(answers) = 'array')
    )`)

  // The idempotency mechanism: one answers record per lead, forever.
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS lead_form_answers_lead_uniq
      ON lead_form_answers ("leadId")`)

  await knex.raw(`CREATE INDEX IF NOT EXISTS lead_form_answers_agency_idx
      ON lead_form_answers ("agencyId")`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS lead_form_answers`)
}
