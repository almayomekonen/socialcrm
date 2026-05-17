require('dotenv').config({ path: '.env.local' })
const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
})

;(async () => {
  try {
    // All agencies with their issuer-relevant fields. Completeness =
    // Tier 1 = name + businessType + taxId all non-empty (lib/billing/issuer/completeness.ts).
    const agencies = await knex('agencies').select(
      'id', 'name', 'businessType', 'taxId', 'address', 'phone', 'email',
    ).orderBy('id', 'asc')
    console.log('All agencies (issuer-relevant columns):')
    console.table(agencies)

    // Recent invoices and which agencies they belong to.
    const recent = await knex('bill_invoices')
      .select(
        'id', 'agencyId', 'docState', 'documentNumber', 'issuedAt',
        'issuerNameSnapshot', 'issuerBusinessTypeSnapshot', 'issuerTaxIdSnapshot',
      )
      .orderBy('id', 'desc')
      .limit(6)
    console.log('\nRecent invoices:')
    console.table(recent)
  } finally {
    await knex.destroy()
  }
})()
