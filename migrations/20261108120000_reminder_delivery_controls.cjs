/**
 * Reminder Engine, Phase 5: delivery controls (architecture v1.3–v1.6.1).
 * Additive and reversible.
 *
 *   platform_whatsapp_rate_cards     official Meta rates, entered by hand from the
 *                                    published rate card. No price is assumed in code.
 *   platform_whatsapp_send_controls  ONE row (id = 1): the DB kill switch, billing
 *                                    timezone/currency, budgets, thresholds, heartbeat.
 *                                    Seeded DISABLED. Every value without an explicit
 *                                    approval is NULL, and NULL blocks sending.
 *   owner_whatsapp_message_status    + Meta `pricing` fields from status webhooks (R3),
 *                                    recorded once (first value wins).
 *   owner_personal_reminders.rateCardId gets its foreign key now that the table exists.
 *
 * Defaults that ARE approved: the platform pilot cap of 50 reminders per business
 * day (R1), and 30 per recipient per business day (B8).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS platform_whatsapp_rate_cards (
      id                bigserial PRIMARY KEY,
      market            text NOT NULL,
      "countryCode"     text NOT NULL CHECK ("countryCode" ~ '^[1-9][0-9]{0,3}$'),
      category          text NOT NULL CHECK (category IN ('service','utility')),
      currency          char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      "unitPriceMicros" bigint NOT NULL CHECK ("unitPriceMicros" > 0),
      "effectiveFrom"   date NOT NULL,
      "effectiveTo"     date NULL,
      "sourceRef"       text NOT NULL,
      "verifiedAt"      timestamptz NOT NULL,
      "verifiedBy"      text NOT NULL,
      "createdAt"       timestamptz NOT NULL DEFAULT now(),
      CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
    )
  `)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS rate_cards_market_uniq
      ON platform_whatsapp_rate_cards (market, category, currency, "effectiveFrom")`)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS platform_whatsapp_send_controls (
      id                              smallint PRIMARY KEY CHECK (id = 1),
      "remindersEnabled"              boolean NOT NULL DEFAULT false,
      "trippedAt"                     timestamptz NULL,
      "trippedReason"                 text NULL,
      "billingTimezone"               text NULL,
      "billingCurrency"               char(3) NULL CHECK ("billingCurrency" ~ '^[A-Z]{3}$'),
      "platformDailyCap"              integer NOT NULL DEFAULT 50 CHECK ("platformDailyCap" > 0),
      "recipientDailyCap"             integer NOT NULL DEFAULT 30 CHECK ("recipientDailyCap" > 0),
      "agencyDailyCap"                integer NULL CHECK ("agencyDailyCap" > 0),
      "remindersMonthlyBudget"        integer NULL CHECK ("remindersMonthlyBudget" > 0),
      "remindersMonthlyBudgetMicros"  bigint NULL CHECK ("remindersMonthlyBudgetMicros" > 0),
      "serviceSoftLimit"              integer NULL CHECK ("serviceSoftLimit" > 0),
      "serviceEmergencyLimit"         integer NULL CHECK ("serviceEmergencyLimit" > 0),
      "pricingMaxAgeDays"             integer NULL CHECK ("pricingMaxAgeDays" > 0),
      "monitorLastRunAt"              timestamptz NULL,
      "updatedAt"                     timestamptz NOT NULL DEFAULT now(),
      "updatedBy"                     text NULL,
      CHECK ("serviceEmergencyLimit" IS NULL OR "serviceSoftLimit" IS NULL OR "serviceEmergencyLimit" >= "serviceSoftLimit")
    )
  `)
  await knex.raw(`INSERT INTO platform_whatsapp_send_controls (id) VALUES (1) ON CONFLICT (id) DO NOTHING`)

  await knex.raw(`ALTER TABLE owner_whatsapp_message_status
      ADD COLUMN IF NOT EXISTS "pricingModel" text NULL,
      ADD COLUMN IF NOT EXISTS "pricingType" text NULL,
      ADD COLUMN IF NOT EXISTS "pricingCategory" text NULL,
      ADD COLUMN IF NOT EXISTS "pricingBillable" boolean NULL,
      ADD COLUMN IF NOT EXISTS "pricingRecordedAt" timestamptz NULL`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS owner_wa_message_status_delivered_idx
      ON owner_whatsapp_message_status ((COALESCE("deliveredAt", "readAt")))`)

  await knex.raw(`ALTER TABLE owner_personal_reminders DROP CONSTRAINT IF EXISTS opr_rate_card_fk`)
  await knex.raw(`ALTER TABLE owner_personal_reminders
      ADD CONSTRAINT opr_rate_card_fk FOREIGN KEY ("rateCardId") REFERENCES platform_whatsapp_rate_cards(id) ON DELETE RESTRICT`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE owner_personal_reminders DROP CONSTRAINT IF EXISTS opr_rate_card_fk`)
  await knex.raw(`DROP INDEX IF EXISTS owner_wa_message_status_delivered_idx`)
  await knex.raw(`ALTER TABLE owner_whatsapp_message_status
      DROP COLUMN IF EXISTS "pricingRecordedAt",
      DROP COLUMN IF EXISTS "pricingBillable",
      DROP COLUMN IF EXISTS "pricingCategory",
      DROP COLUMN IF EXISTS "pricingType",
      DROP COLUMN IF EXISTS "pricingModel"`)
  await knex.raw(`DROP TABLE IF EXISTS platform_whatsapp_send_controls`)
  await knex.raw(`DROP TABLE IF EXISTS platform_whatsapp_rate_cards`)
}
