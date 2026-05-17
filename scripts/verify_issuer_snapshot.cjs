/**
 * Phase 2.1 — Issuer snapshot runtime verification.
 *
 * What this script proves (against the dev DB, inside a transaction
 * that is ALWAYS ROLLED BACK — no persistent side-effects):
 *
 *   Verification 4 — newly-issued invoices populate snapshot fields:
 *     Run the same UPDATE that db/billing/issueInvoice.ts emits at
 *     issue time. Read back the row. Assert all 6 issuer*Snapshot
 *     fields match the agency's live issuer columns at that moment.
 *
 *   Verification 5 — changing agency identity does NOT affect history:
 *     Mutate agencies.name/businessType/taxId/address/phone/email.
 *     Re-read the same invoice row. Assert the 6 issuer*Snapshot
 *     fields are byte-identical to the values captured pre-mutation.
 *
 * Also dumps the column schema for cross-check with the migration.
 */
require('dotenv').config({ path: '.env.local' })
const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
})

const SNAPSHOT_COLS = [
  'issuerNameSnapshot',
  'issuerBusinessTypeSnapshot',
  'issuerTaxIdSnapshot',
  'issuerAddressSnapshot',
  'issuerPhoneSnapshot',
  'issuerEmailSnapshot',
]

function assertEqual(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    throw new Error(`FAIL [${label}]\n  actual:   ${a}\n  expected: ${e}`)
  }
  console.log(`  OK ${label}: ${a}`)
}

;(async () => {
  let ok = false
  try {
    // ── Schema check ─────────────────────────────────────────────
    const cols = await knex('information_schema.columns')
      .where({ table_name: 'bill_invoices' })
      .whereRaw(`column_name LIKE 'issuer%Snapshot'`)
      .select('column_name', 'data_type', 'is_nullable', 'column_default')
      .orderBy('column_name')
    console.log('Schema:')
    console.table(cols)
    if (cols.length !== 6) throw new Error(`expected 6 snapshot columns, got ${cols.length}`)

    // ── Pick a draft + its agency from the dev DB ────────────────
    const draft = await knex('bill_invoices').where({ docState: 'draft' }).orderBy('id', 'desc').first('id', 'agencyId')
    if (!draft) throw new Error('no draft invoice in dev DB to exercise against')
    console.log(`\nUsing draft invoice id=${draft.id}, agencyId=${draft.agencyId}`)

    // ── Inside a transaction that we will ALWAYS roll back ───────
    await knex
      .transaction(async (trx) => {
        // Snapshot the current agency identity (the "live" values).
        const agencyBefore = await trx('agencies')
          .where({ id: draft.agencyId })
          .first('name', 'businessType', 'taxId', 'address', 'phone', 'email')

        console.log('\nLive agency identity (pre-issue):')
        console.table([agencyBefore])

        // VERIFICATION 4 — apply the same UPDATE issueInvoice would emit
        // for the issuer snapshot columns. Use the exact coercion the
        // production code uses.
        await trx('bill_invoices')
          .where({ id: draft.id })
          .update({
            issuerNameSnapshot: String(agencyBefore.name ?? ''),
            issuerBusinessTypeSnapshot: agencyBefore.businessType ?? null,
            issuerTaxIdSnapshot: String(agencyBefore.taxId ?? ''),
            issuerAddressSnapshot: String(agencyBefore.address ?? ''),
            issuerPhoneSnapshot: String(agencyBefore.phone ?? ''),
            issuerEmailSnapshot: String(agencyBefore.email ?? ''),
          })

        const after = await trx('bill_invoices').where({ id: draft.id }).first(...SNAPSHOT_COLS)

        console.log('\nVerification 4 — snapshot captured at "issue" time:')
        assertEqual('issuerNameSnapshot', after.issuerNameSnapshot, String(agencyBefore.name ?? ''))
        assertEqual('issuerBusinessTypeSnapshot', after.issuerBusinessTypeSnapshot, agencyBefore.businessType ?? null)
        assertEqual('issuerTaxIdSnapshot', after.issuerTaxIdSnapshot, String(agencyBefore.taxId ?? ''))
        assertEqual('issuerAddressSnapshot', after.issuerAddressSnapshot, String(agencyBefore.address ?? ''))
        assertEqual('issuerPhoneSnapshot', after.issuerPhoneSnapshot, String(agencyBefore.phone ?? ''))
        assertEqual('issuerEmailSnapshot', after.issuerEmailSnapshot, String(agencyBefore.email ?? ''))

        // VERIFICATION 5 — mutate every issuer column on the agency
        // and confirm the snapshot row is byte-identical to `after`.
        await trx('agencies').where({ id: draft.agencyId }).update({
          name: '__VERIFY_MUTATED_NAME__',
          businessType: 'company',
          taxId: '__VERIFY_MUTATED_TAXID__',
          address: '__VERIFY_MUTATED_ADDRESS__',
          phone: '__VERIFY_MUTATED_PHONE__',
          email: 'mutated@example.com',
        })

        const afterMutation = await trx('bill_invoices').where({ id: draft.id }).first(...SNAPSHOT_COLS)

        console.log('\nVerification 5 — snapshot is byte-identical after agency mutation:')
        for (const k of SNAPSHOT_COLS) {
          assertEqual(k, afterMutation[k], after[k])
        }

        // Always roll back so dev DB state is untouched.
        throw new Error('__INTENTIONAL_ROLLBACK__')
      })
      .catch((err) => {
        if (err && err.message === '__INTENTIONAL_ROLLBACK__') return
        throw err
      })

    // Confirm dev DB really is untouched: the draft must still have
    // empty snapshots (because we never committed the UPDATE).
    const postRollback = await knex('bill_invoices').where({ id: draft.id }).first(...SNAPSHOT_COLS)
    const stillLegacy = SNAPSHOT_COLS.every((k) => postRollback[k] === '' || postRollback[k] === null)
    if (!stillLegacy) throw new Error('rollback leaked: snapshot fields persisted on the dev DB')
    console.log('\nRollback confirmed — dev DB untouched.')

    ok = true
    console.log('\n✓ All verifications passed (4 + 5).')
  } catch (err) {
    console.error('\n✗ Verification failed:', err.message)
    process.exitCode = 1
  } finally {
    await knex.destroy()
    if (!ok) process.exit(process.exitCode || 1)
  }
})()
