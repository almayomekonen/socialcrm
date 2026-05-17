require('dotenv').config({ path: '.env.local' })
const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
})
;(async () => {
  try {
    const rows = await knex('bill_invoices')
      .where({ agencyId: 27 })
      .orderBy('createdAt', 'desc')
      .limit(3)
      .select(
        'id', 'createdAt', 'docState', 'fulfillState', 'kind',
        'paymentReceived', 'paymentMethod', 'paymentAmount', 'paymentDate',
        'paymentMethodSnapshot', 'paymentAmountSnapshot', 'paymentDateSnapshot',
        'subtotalAmount', 'taxAmount', 'totalAmount',
        'documentNumber', 'documentYear', 'issuedAt',
      )
    console.log('Most recent invoices on agency 27:')
    console.table(rows)

    if (rows.length > 0) {
      const events = await knex('bill_financial_events')
        .where({ invoiceId: rows[0].id })
        .orderBy('occurredAt', 'asc')
        .select('eventType', 'occurredAt', 'payload')
      console.log(`\nEvents for invoice ${rows[0].id}:`)
      console.table(events.map(e => ({
        eventType: e.eventType,
        occurredAt: e.occurredAt,
        payload: JSON.stringify(e.payload).slice(0, 100),
      })))
    }

    const ag = await knex('agencies').where({ id: 27 })
      .first('businessType', 'taxId', 'name', 'address', 'phone', 'email', 'img')
    console.log('\nAgency 27 issuer state:')
    console.table([ag])
  } finally {
    await knex.destroy()
  }
})()
