/**
 * Explicit card-storage consent, recorded by us.
 *
 * Grow's own page asks the customer to approve saving the card, and until now we
 * relied on that alone. Grow support's integration guidance is that the consent
 * to STORE the card must be given explicitly in our interface as well, separate
 * from agreement to the subscription — the customer is permitting two different
 * things, and one of them (a card kept on file and charged later) is the one
 * they are most entitled to be asked about directly.
 *
 * Nullable because it cannot be backfilled: no existing row was collected under
 * this consent, and inventing a timestamp would assert something that did not
 * happen. `startCardSetup` requires it for every new setup, so every row created
 * from here on carries one. No CHECK constraint for the same reason.
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE billing_payment_methods
      ADD COLUMN IF NOT EXISTS "cardStorageConsentAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "cardStorageConsentVersion" text
  `)
}

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE billing_payment_methods
      DROP COLUMN IF EXISTS "cardStorageConsentAt",
      DROP COLUMN IF EXISTS "cardStorageConsentVersion"
  `)
}
